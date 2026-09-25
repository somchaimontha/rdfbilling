const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'app.js');
const htmlPath = path.join(__dirname, '..', 'index.html');
const source = fs.readFileSync(appPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

const commonValues = {
    'inline-exp-project': 'PRJ-9',
    'inline-exp-category': 'CAT-2',
    'inline-exp-category-input': 'อุปกรณ์',
    'inline-exp-fund': 'FUND-3',
    'inline-exp-fund-input': 'เงินสำรอง',
    'inline-exp-claimable': 'false'
};

const rowValues = {
    postingMonth: '2026-09',
    receiptNo: 'RC-2026-001',
    expenseDate: '2026-08-28',
    vendorName: 'ร้านทดสอบ',
    description: 'ซื้ออุปกรณ์สำนักงาน',
    quantity: '3',
    unit: 'กล่อง',
    unitPrice: '125.50',
    note: 'ส่งเอกสารต้นฉบับแล้ว'
};

const fullFieldIds = [
    'bill-receipt-no', 'bill-date', 'bill-posting-month', 'bill-project',
    'bill-category', 'bill-category-input', 'bill-fund-source',
    'bill-fund-source-input', 'bill-vendor', 'bill-vendor-input', 'bill-desc',
    'bill-qty', 'bill-unit', 'bill-price', 'bill-claim-type', 'bill-note'
];

function createHarness() {
    const elements = new Map();
    for (const [id, value] of Object.entries(commonValues)) elements.set(id, { value });
    for (const id of fullFieldIds) elements.set(id, { value: '' });

    const rowFields = new Map(Object.entries(rowValues).map(([field, value]) => [field, { value }]));
    const row = {
        dataset: { rowId: 'quick-exp-1', requestId: 'expense-test-request-1', saved: 'false' },
        querySelector(selector) {
            const field = selector.match(/^\[data-field="(.+)"\]$/)?.[1];
            return field ? rowFields.get(field) || null : null;
        }
    };
    const document = {
        addEventListener() {},
        getElementById(id) { return elements.get(id) || null; },
        querySelector(selector) {
            return selector === '.quick-expense-batch-row[data-row-id="quick-exp-1"]' ? row : null;
        },
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
        URL: { createObjectURL: () => 'blob:generated', revokeObjectURL() {} },
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
            openExpenseModalFromQuickExpenseRow,
            quickAddProject,
            validateQuickExpenseDraft,
            isQuickExpenseDraftEmpty,
            setQuickRow: (rowId, attachments, multiItems) => {
                quickExpenseRows = [rowId];
                quickExpenseAttachmentsByRow[rowId] = attachments;
                quickExpenseMultiItemsByRow[rowId] = multiItems;
            },
            getTempAttachments: () => tempBillAttachments,
            setProjects: value => { state.projects = value; },
            setVendors: value => { state.vendors = value; },
            getProjects: () => state.projects,
            getModalSource: () => expenseModalSource,
            getExpenseRequestId: () => expenseCreateRequestId,
            getExpenseNoteMetadata: () => expenseModalNoteMetadata
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

test('quick monthly bill form is a repeatable receipt table with shared collapsible fields', () => {
    assert.match(html, /onsubmit="submitQuickExpenseBatch\(event\)"/);
    assert.match(html, /id="quick-expense-common-details"/);
    assert.match(html, /ข้อมูลสำคัญที่ใช้ร่วมกัน/);
    assert.match(html, /โครงการ \/ หมวดหมู่ \/ แหล่งเงิน \/ ประเภท/);
    assert.match(html, /id="quick-expense-rows"/);
    assert.match(html, /<th class="quick-col-month">รอบบันทึก<\/th>/);
    assert.match(html, /เลขที่ใบเสร็จ/);
    assert.match(html, /ร้านค้า \/ ผู้ขาย/);
    assert.match(html, /รายละเอียดเพิ่มเติมและหลักฐาน/);
    assert.match(html, /onclick="addQuickExpenseRow\(\)"/);
    assert.match(html, /id="bill-receipt-no"[^>]+required/);
    assert.match(source, /data-field="receiptNo"/);
    assert.match(source, /openQuickExpenseMultiItems/);
    assert.match(html, /onclick="openExpenseModalMultiItems\(\)"/);
    assert.match(source, /requestId: item\.draft\.requestId/);
    assert.match(source, /idPrefix: 'ATT'/);
    assert.match(source, /retryQuickExpenseRowAttachments/);
});

test('batch row validation requires all receipt fields and accepts a complete row', () => {
    const { api } = createHarness();
    const complete = {
        postingMonth: '2026-09', receiptNo: 'RC-001', expenseDate: '2026-09-01', vendorName: 'ร้านค้า',
        description: 'วัสดุ', quantity: 2, unit: 'ชิ้น', unitPrice: 50,
        note: '', attachments: [], multiItems: []
    };
    assert.equal(api.validateQuickExpenseDraft(complete, 1), '');
    const invalid = { ...complete, receiptNo: '', vendorName: '', unitPrice: 0 };
    assert.match(api.validateQuickExpenseDraft(invalid, 3), /แถว 3/);
    assert.match(api.validateQuickExpenseDraft(invalid, 3), /เลขที่ใบเสร็จ/);
    assert.match(api.validateQuickExpenseDraft(invalid, 3), /ร้านค้า\/ผู้ขาย/);
    assert.equal(api.isQuickExpenseDraftEmpty({
        postingMonth: '2026-09', receiptNo: '', vendorName: '', description: '', unitPrice: 0,
        note: '', attachments: [], multiItems: []
    }), true);
});

test('opening a batch row in the full form preserves receipt data, common fields, and attachments', () => {
    const { context, elements, api } = createHarness();
    const attachment = {
        file: { type: 'image/png' }, previewUrl: 'blob:test-preview',
        originalFileName: 'receipt.png', originalSize: 200,
        compressedSize: 150, sha256Hash: 'abc123'
    };
    api.setVendors([{ id: 'VENDOR-4', name: rowValues.vendorName, active: true }]);
    api.setQuickRow('quick-exp-1', [attachment], [{ desc: 'ปากกา', qty: 3, price: 125.5 }]);

    api.openExpenseModalFromQuickExpenseRow('quick-exp-1');

    assert.equal(context.__modalOpened, true);
    assert.equal(api.getModalSource(), 'quick-row:quick-exp-1');
    assert.equal(elements.get('bill-receipt-no').value, rowValues.receiptNo);
    assert.equal(elements.get('bill-date').value, rowValues.expenseDate);
    assert.equal(elements.get('bill-posting-month').value, rowValues.postingMonth);
    assert.equal(elements.get('bill-project').value, commonValues['inline-exp-project']);
    assert.equal(elements.get('bill-category').value, commonValues['inline-exp-category']);
    assert.equal(elements.get('bill-fund-source').value, commonValues['inline-exp-fund']);
    assert.equal(elements.get('bill-vendor').value, 'VENDOR-4');
    assert.equal(elements.get('bill-vendor-input').value, rowValues.vendorName);
    assert.equal(elements.get('bill-desc').value, rowValues.description);
    assert.equal(elements.get('bill-qty').value, Number(rowValues.quantity));
    assert.equal(elements.get('bill-unit').value, rowValues.unit);
    assert.equal(elements.get('bill-price').value, Number(rowValues.unitPrice));
    assert.equal(elements.get('bill-claim-type').value, 'no-claim');
    assert.equal(elements.get('bill-note').value, rowValues.note);
    assert.equal(api.getExpenseRequestId(), 'expense-test-request-1');
    assert.deepEqual(
        JSON.parse(JSON.stringify(api.getExpenseNoteMetadata().multiItems)),
        [{ desc: 'ปากกา', qty: 3, price: 125.5 }]
    );
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
