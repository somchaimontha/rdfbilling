const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function createHarness() {
    const elements = new Map();
    for (const id of [
        'database-load-status', 'database-load-status-message', 'database-load-status-detail',
        'database-load-status-retry', 'database-load-status-elapsed'
    ]) {
        elements.set(id, { hidden: true, disabled: false, dataset: {}, style: {}, textContent: '' });
    }
    const storage = new Map([
        ['rdf_session_token', 'session-1'],
        ['rdf_current_user', JSON.stringify({ id: 'u1', role: 'staff' })]
    ]);
    const document = {
        addEventListener() {},
        getElementById(id) { return elements.get(id) || null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        documentElement: { setAttribute() {} },
        body: { classList: { add() {}, remove() {}, toggle() {} } }
    };
    const context = {
        console: { log() {}, warn() {}, error() {} }, document,
        localStorage: {
            getItem(key) { return storage.get(key) || null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        location: { hostname: 'example.test', search: '', pathname: '/' },
        history: { replaceState() {} },
        navigator: {}, crypto: globalThis.crypto, TextEncoder, AbortController,
        URLSearchParams, Blob, FileReader: class {}, Image: class {},
        setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
        addEventListener() {}, removeEventListener() {},
        Swal: { fire: async () => ({}), isVisible: () => false, isLoading: () => false, close() {} },
        lucide: { createIcons() {} }
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source + `\n;globalThis.__loadingTest = {
        initAppWithAPI, retryDatabaseLoad,
        renderSignaturePreviews,
        getState: () => state,
        setMonth: (month, year) => { state.selectedMonth = month; state.selectedYear = year; },
        getProgress: () => appLoadProgress
    };`, context, { filename: appPath });
    return { context, elements, api: context.__loadingTest };
}

function successfulValue(action) {
    const values = {
        getRuntimeConfig: {},
        getMasterData: { projects: [], categories: [], vendors: [], fundSources: [], organizations: [] },
        getExpenses: { expenses: [{ id: 'EXP001', amount: 10 }], pagination: { total: 1, limit: 200 } },
        getFoodExpenses: { foodExpenses: [], pagination: { total: 0, limit: 200 } },
        getClaims: { claims: [] },
        getFundReceipts: { fundReceipts: [] },
        getCarryOverAmount: { carryOverAmount: 25 },
        getMonthStatuses: { statuses: {} }
    };
    return values[action];
}

test('monthly records render before slow supplementary reads finish', async () => {
    const { context, api, elements } = createHarness();
    const pending = new Map();
    const calls = [];
    context.__mockApiCall = (action) => {
        calls.push(action);
        const request = deferred();
        pending.set(action, request);
        return request.promise;
    };
    vm.runInContext(`
        apiCall = globalThis.__mockApiCall;
        globalThis.__renders = 0;
        renderAll = () => { globalThis.__renders++; };
        renderTables = updateMetricsBar = renderSpreadsheet = updateFundReceiptWidget = renderClaims = renderFundReceiptsOverview = () => {};
    `, context);

    const loading = api.initAppWithAPI();
    assert.deepEqual(new Set(calls), new Set([
        'getRuntimeConfig', 'getMasterData', 'getExpenses', 'getFoodExpenses',
        'getClaims', 'getFundReceipts', 'getCarryOverAmount', 'getMonthStatuses'
    ]));

    pending.get('getMasterData').resolve(successfulValue('getMasterData'));
    pending.get('getExpenses').resolve(successfulValue('getExpenses'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(context.__renders, 1);
    assert.equal(api.getState().expenses.length, 1);
    assert.equal(api.getState().carryOverAmount, 0, 'old/supplementary totals must not leak into the first render');
    assert.equal(elements.get('database-load-status').hidden, false);

    for (const [action, request] of pending) {
        if (!['getMasterData', 'getExpenses'].includes(action)) request.resolve(successfulValue(action));
    }
    await loading;
    assert.equal(api.getState().carryOverAmount, 25);
    assert.equal(elements.get('database-load-status').hidden, true);
});

test('retry keeps successful resources and requests only failed resources', async () => {
    const { context, api, elements } = createHarness();
    const calls = [];
    let claimsAttempt = 0;
    context.__mockApiCall = async (action) => {
        calls.push(action);
        if (action === 'getClaims' && claimsAttempt++ === 0) throw new TypeError('offline');
        return successfulValue(action);
    };
    vm.runInContext(`apiCall = globalThis.__mockApiCall; renderAll = () => {}; renderTables = () => {};`, context);

    await api.initAppWithAPI();
    assert.equal(api.getState().claimsLoadStatus, 'error');
    assert.equal(elements.get('database-load-status').hidden, false);
    assert.equal(elements.get('database-load-status-retry').hidden, false);

    const callsBeforeRetry = calls.length;
    await api.retryDatabaseLoad();
    assert.deepEqual(calls.slice(callsBeforeRetry), ['getClaims']);
    assert.equal(api.getState().claimsLoadStatus, 'ready');
    assert.equal(elements.get('database-load-status').hidden, true);
});

test('missing optional signature preview markup does not break rendering', () => {
    const { api } = createHarness();
    assert.doesNotThrow(() => api.renderSignaturePreviews());
});

test('a core rendering failure is recorded once after all data has loaded', async () => {
    const { context, api, elements } = createHarness();
    context.__mockApiCall = async action => successfulValue(action);
    vm.runInContext(`
        apiCall = globalThis.__mockApiCall;
        globalThis.__renders = 0;
        renderAll = () => {
            globalThis.__renders++;
            throw new TypeError("Cannot read properties of null (reading 'style')");
        };
        renderTables = updateMetricsBar = renderSpreadsheet = updateFundReceiptWidget = renderClaims = renderFundReceiptsOverview = () => {};
    `, context);

    await api.initAppWithAPI();

    assert.equal(context.__renders, 1);
    assert.equal(Object.keys(api.getProgress().results).length, 8);
    assert.equal(Object.keys(api.getProgress().errors).length, 1);
    assert.match(elements.get('database-load-status-message').textContent, /โหลดข้อมูลครบ 8\/8/);
    assert.equal(
        elements.get('database-load-status-detail').textContent,
        "Cannot read properties of null (reading 'style')"
    );
});
