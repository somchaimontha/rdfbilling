const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const serverPath = path.join(__dirname, '..', 'local-dev-server.js');
const source = fs.readFileSync(serverPath, 'utf8');

function createProxy(fetchImpl) {
    let handler;
    let timeout;
    let timeoutMs;
    const context = {
        require(name) {
            if (name === 'http') {
                return { createServer(callback) {
                    handler = callback;
                    return { listen() {} };
                } };
            }
            return require(name);
        },
        __dirname: path.dirname(serverPath),
        process: { env: {} },
        AbortController,
        fetch: fetchImpl,
        setTimeout(callback, ms) { timeout = callback; timeoutMs = ms; return 1; },
        clearTimeout() { timeout = null; },
        console
    };
    vm.runInNewContext(source, context, { filename: serverPath });
    const req = new EventEmitter();
    Object.assign(req, { url: '/api', method: 'POST' });
    const res = new EventEmitter();
    Object.assign(res, {
        writableEnded: false,
        writeHead(status, headers) { this.status = status; this.headers = headers; },
        end(body) { this.body = body; this.writableEnded = true; this.emit('finish'); }
    });
    handler(req, res);
    return {
        req, res,
        start(action = 'getMasterData') {
            req.emit('data', JSON.stringify({ action }));
            req.emit('end');
        },
        expire() { timeout(); },
        get timeoutMs() { return timeoutMs; },
        get timerCleared() { return timeout === null; }
    };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const response = (status, text) => ({
    status,
    headers: { get: () => 'application/json' },
    text: async () => text
});
function waitForAbort(signal) {
    return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
        }, { once: true });
    });
}

test('one upstream attempt per request, including safe reads and writes', async () => {
    for (const action of ['getMasterData', 'saveExpense']) {
        let calls = 0;
        const proxy = createProxy(async () => {
            calls++;
            return response(503, '{"success":false}');
        });
        proxy.start(action);
        await settle();
        assert.equal(calls, 1);
        assert.equal(proxy.res.status, 502);
        assert.equal(JSON.parse(proxy.res.body).error.code, 'UPSTREAM_UNAVAILABLE');
        assert.equal(proxy.timerCleared, true);
    }
});

test('timeout covers upstream response body and returns before browser deadline', async () => {
    let upstreamSignal;
    const proxy = createProxy(async (url, options) => {
        upstreamSignal = options.signal;
        return { ...response(200, ''), text: () => waitForAbort(options.signal) };
    });
    proxy.start();
    await settle();
    assert.ok(proxy.timeoutMs < 30000);
    proxy.expire();
    await settle();
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(proxy.res.status, 504);
    assert.equal(JSON.parse(proxy.res.body).error.code, 'UPSTREAM_TIMEOUT');
    assert.equal(proxy.timerCleared, true);
});

test('client disconnect aborts in-flight upstream without writing a response', async () => {
    let upstreamSignal;
    const proxy = createProxy((url, options) => {
        upstreamSignal = options.signal;
        return waitForAbort(options.signal);
    });
    proxy.start();
    proxy.res.emit('close');
    await settle();
    assert.equal(upstreamSignal.aborted, true);
    assert.equal(proxy.res.writableEnded, false);
    assert.equal(proxy.timerCleared, true);
    assert.doesNotThrow(() => proxy.req.emit('error', new Error('socket reset')));
});

test('normal request-body close does not abort a successful response', async () => {
    let upstreamSignal;
    const proxy = createProxy(async (url, options) => {
        upstreamSignal = options.signal;
        return response(200, '{"success":true,"data":[]}');
    });
    proxy.start();
    proxy.req.emit('close');
    await settle();
    assert.equal(upstreamSignal.aborted, false);
    assert.equal(proxy.res.status, 200);
    assert.deepEqual(JSON.parse(proxy.res.body), { success: true, data: [] });
    assert.equal(proxy.timerCleared, true);
});
