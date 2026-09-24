const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'app.js');
const htmlPath = path.join(__dirname, '..', 'index.html');
const source = fs.readFileSync(appPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

const quickValues = {
    'inline-exp-date': '2026-08-28',
    'inline-exp-posting-month': '2026-09',
    'inline-exp-project': 'PRJ-9',
    'inline-exp-category': 'CAT-2',
    'inline-exp-category-input': 'อุปกรณ์',
    'inline-exp-fund': 'FUND-3',
    'inline-exp-fund-input': 'เงินสำรอง',
    'inline-exp-vendor': 'VENDOR-4',
    'inline-exp-vendor-input': 'ร้านทดสอบ',
    'inline-exp-desc': 'ซื้ออุปกรณ์สำนักงาน',
    'inline-exp-qty': '3',
    'inline-exp-unit': 'กล่อง',
    'inline-exp-price': '125.50',
    'inline-exp-claimable': 'false',
    'quick-exp-note': 'ส่งเอกสารต้นฉบับแล้ว'
};

const fullFieldIds = [
    'bill-date', 'bill-posting-month', 'bill-project', 'bill-category',
    'bill-category-input', 'bill-fund-source', 'bill-fund-source-input',
    'bill-vendor', 'bill-vendor-input', 'bill-desc', 'bill-qty', 'bill-unit',
    'bill-price', 'bill-claim-type', 'bill-note'
];

function createHarness() {
    const elements = new Map();
    for (const [id, value] of Object.entries(quickValues)) elements.set(id, { value });
    for (const id of fullFieldIds) elements.set(id, { value: '' });

    const document = {
        addEventListener() {},
        getElementById(id) { return elements.get(id) || null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        documentElement: { setAttribute() {} },
        body: { classList: { add() {}, remove() {}, toggle() {} } }
    };
    const context = {
        console: { log() {}, warn() {}, error() {} },
        document,
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        location: { hostname: 'example.test', search: '', pathname: '/' },
        history: { replaceState() {} },
        navigator: {},
        crypto: globalThis.crypto,
        TextEncoder,
        AbortController,
        URLSearchParams,
        Blob,
        FileReader: class {},
        Image: class {},
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval() {},
        addEventListener() {},
        removeEventListener() {},
        Swal: { fire: async () => ({}), isVisible: () => false, isLoading: () => false, close() {} },
        lucide: { createIcons() {} }
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source + `
        ;globalThis.__quickExpenseParity = {
            openExpenseModalFromQuickEntry,
            quickAddProject,
            setQuickAttachments: value => { quickExpenseAttachments = value; },
            getTempAttachments: () => tempBillAttachments,
            setProjects: value => { state.projects = value; },
            getProjects: () => state.projects,
            getModalSource: () => expenseModalSource
        };
    `, context, { filename: appPath });
    vm.runInContext(`
        openExpenseModal = () => { globalThis.__modalOpened = true; expenseModalSource = null; };
        renderTempBillAttachmentsPreview = expenseId => { globalThis.__previewExpenseId = expenseId; };
        appAlert = () => {};
        showLoading = () => {};
    `, context);
    return { context, elements, api: context.__quickExpenseParity };
}

test('quick monthly bill form exposes the full-form capabilities', () => {
    const postingMonth = html.match(/<input[^>]+id="inline-exp-posting-month"[^>]*>/)?.[0] || '';
    assert.match(postingMonth, /required/);
    assert.doesNotMatch(postingMonth, /readonly/);
    assert.match(html, /quickAddProject\('inline-exp'\)/);
    assert.match(html, /onclick="openExpenseModalFromQuickEntry\(\)"/);
    assert.match(html, /id="bill-unit"[^>]+required/);
    assert.match(html, /id="bill-attachment-input"[^>]+\.docx/);
    assert.doesNotMatch(html.match(/id="bill-attachment-input"[^>]*>/)?.[0] || '', /\.xls(?:,|")/);
});

test('opening the full form preserves every quick-form value and attachment', () => {
    const { context, elements, api } = createHarness();
    const attachment = {
        file: { type: 'image/png' },
        previewUrl: 'blob:test-preview',
        originalFileName: 'receipt.png',
        originalSize: 200,
        compressedSize: 150,
        sha256Hash: 'abc123'
    };
    api.setQuickAttachments([attachment]);

    api.openExpenseModalFromQuickEntry();

    assert.equal(context.__modalOpened, true);
    assert.equal(api.getModalSource(), 'quick-entry');
    assert.equal(elements.get('bill-date').value, quickValues['inline-exp-date']);
    assert.equal(elements.get('bill-posting-month').value, quickValues['inline-exp-posting-month']);
    assert.equal(elements.get('bill-project').value, quickValues['inline-exp-project']);
    assert.equal(elements.get('bill-category').value, quickValues['inline-exp-category']);
    assert.equal(elements.get('bill-category-input').value, quickValues['inline-exp-category-input']);
    assert.equal(elements.get('bill-fund-source').value, quickValues['inline-exp-fund']);
    assert.equal(elements.get('bill-fund-source-input').value, quickValues['inline-exp-fund-input']);
    assert.equal(elements.get('bill-vendor').value, quickValues['inline-exp-vendor']);
    assert.equal(elements.get('bill-vendor-input').value, quickValues['inline-exp-vendor-input']);
    assert.equal(elements.get('bill-desc').value, quickValues['inline-exp-desc']);
    assert.equal(elements.get('bill-qty').value, quickValues['inline-exp-qty']);
    assert.equal(elements.get('bill-unit').value, quickValues['inline-exp-unit']);
    assert.equal(elements.get('bill-price').value, quickValues['inline-exp-price']);
    assert.equal(elements.get('bill-claim-type').value, 'no-claim');
    assert.equal(elements.get('bill-note').value, quickValues['quick-exp-note']);
    assert.equal(api.getTempAttachments().length, 1);
    assert.equal(api.getTempAttachments()[0].originalFileName, attachment.originalFileName);
    assert.equal(context.__previewExpenseId, null);
});

test('quick project creation selects the new project without reloading all database data', async () => {
    const { context, elements, api } = createHarness();
    api.setProjects([{ id: 'PRJ-1', name: 'โครงการเดิม', active: true }]);
    context.prompt = () => 'โครงการใหม่';
    context.__apiCalls = [];
    context.__reloads = 0;
    vm.runInContext(`
        apiCall = async (action, payload) => {
            globalThis.__apiCalls.push({ action, payload });
            return { id: 'PRJ-NEW' };
        };
        initAppWithAPI = async () => { globalThis.__reloads++; };
    `, context);

    await api.quickAddProject('inline-exp');

    assert.equal(context.__apiCalls.length, 1);
    assert.equal(context.__apiCalls[0].action, 'createProject');
    assert.equal(context.__reloads, 0);
    assert.equal(api.getProjects().at(-1).id, 'PRJ-NEW');
    assert.match(elements.get('inline-exp-project').innerHTML, /value="PRJ-NEW" selected/);
});
