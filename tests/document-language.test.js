const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

function createHarness() {
    const document = {
        readyState: 'loading',
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        documentElement: { setAttribute() {} },
        body: { classList: { add() {}, remove() {}, toggle() {} } }
    };
    const context = {
        console: { log() {}, warn() {}, error() {} }, document,
        localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
        location: { hostname: 'example.test', search: '', pathname: '/' },
        history: { replaceState() {} },
        navigator: {}, crypto: globalThis.crypto, TextEncoder, AbortController,
        URLSearchParams, Blob, FileReader: class {}, Image: class {}, Intl,
        setTimeout, clearTimeout, setInterval, clearInterval,
        addEventListener() {}, removeEventListener() {},
        Swal: { fire: async () => ({}), isVisible: () => false, isLoading: () => false, close() {} },
        lucide: { createIcons() {} }
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source + `\n;globalThis.__documentLanguageTest = {
        addDocumentBreakOpportunities, preparePdfDocumentText
    };`, context, { filename: appPath });
    return context.__documentLanguageTest;
}

test('document wrapping adds Thai break opportunities while preserving English and URLs', () => {
    const api = createHarness();
    const input = 'รายงานค่าใช้จ่าย Monthly Report https://example.com/ภาษาไทย';
    const output = api.addDocumentBreakOpportunities(input);

    assert.ok(output.includes('\u200B'));
    assert.equal(output.replaceAll('\u200B', ''), input);
    assert.ok(output.includes('Monthly Report'));
    assert.ok(output.includes('https://example.com/ภาษาไทย'));
});

test('pdf document preparation processes text fields without changing other values', () => {
    const api = createHarness();
    const documentDefinition = {
        content: [{ text: 'สรุปรายจ่าย Expense Summary' }, { stack: [{ text: 'โครงการ Project' }] }],
        images: { logo: 'data:image/png;base64,abc' },
        pageSize: 'A4'
    };

    api.preparePdfDocumentText(documentDefinition);

    assert.ok(documentDefinition.content[0].text.includes('\u200B'));
    assert.ok(documentDefinition.content[0].text.includes('Expense Summary'));
    assert.equal(documentDefinition.images.logo, 'data:image/png;base64,abc');
    assert.equal(documentDefinition.pageSize, 'A4');
});
