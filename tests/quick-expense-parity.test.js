const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'app.js');
const htmlPath = path.join(__dirname, '..', 'index.html');
const backendExpensePath = path.join(__dirname, '..', 'backend', 'ExpenseService.gs');
const backendSheetHelperPath = path.join(__dirname, '..', 'backend', 'SheetHelper.gs');
const source = fs.readFileSync(appPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const backendExpenseSource = fs.readFileSync(backendExpensePath, 'utf8');
const backendSheetHelperSource = fs.readFileSync(backendSheetHelperPath, 'utf8');

const commonValues = {
    'inline-exp-project': 'PRJ-9',
    'inline-exp-category': 'CAT-2',
    'inline-exp-category-input': 'อุปกรณ์',
    'inline-exp-fund': 'FUND-3',
    'inline-exp-fund-input': 'เงินสำรอง',
    'inline-exp-claimable': 'false'
};

const rowValues = {
    documentPrefix: 'BS',
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
    const storage = new Map([
        ['rdf_current_user', JSON.stringify({ id: 'ADMIN-1', role: 'admin', organizationId: 'ORG-ROOT' })]
    ]);
    for (const [id, value] of Object.entries(commonValues)) elements.set(id, { value });
    for (const id of fullFieldIds) elements.set(id, { value: '' });

    const rowFields = new Map(Object.entries(rowValues).map(([field, value]) => [field, { value }]));
    const row = {
        dataset: { rowId: 'quick-exp-1', requestId: 'expense-test-request-1', saved: 'false' },
        classList: { contains() { return false; }, add() {}, remove() {}, toggle() {} },
        querySelector(selector) {
            const field = selector.match(/^\[data-field="(.+)"\]$/)?.[1];
            if (field) return rowFields.get(field) || null;
            if (selector === '[data-role="row-status"]') return elements.get('row-status');
            return null;
        }
    };
    elements.set('row-status', { textContent: '' });
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
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        },
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
            getQuickExpenseDocumentPreview,
            getQuickExpenseBillingProfileOptions,
            getQuickExpenseDescriptionSuggestions,
            getQuickExpenseSavedRowInitial,
            getExpensePostingMonth,
            buildVerifyUrl,
            buildQuickExpenseRowHTML,
            persistQuickExpenseLocalDraft,
            loadQuickExpenseLocalDraft,
            setQuickRow: (rowId, attachments, multiItems) => {
                quickExpenseRows = [rowId];
                quickExpenseAttachmentsByRow[rowId] = attachments;
                quickExpenseMultiItemsByRow[rowId] = multiItems;
            },
            getTempAttachments: () => tempBillAttachments,
            setProjects: value => { state.projects = value; },
            setVendors: value => { state.vendors = value; },
            setExpenses: value => { state.expenses = value; },
            setOrganizations: value => { state.organizations = value; },
            getProjects: () => state.projects,
            getModalSource: () => expenseModalSource,
            getModalOrganizationId: () => expenseModalOrganizationId,
            getModalDocumentPrefix: () => expenseModalDocumentPrefix,
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
    return { context, elements, storage, api: context.__quickExpenseParity };
}

test('quick monthly bill form is a repeatable receipt table with shared collapsible fields', () => {
    assert.match(html, /onsubmit="submitQuickExpenseBatch\(event\)"/);
    assert.match(html, /id="quick-expense-common-details"/);
    assert.match(html, /ข้อมูลสำคัญที่ใช้ร่วมกัน/);
    assert.match(html, /id="inline-exp-billing-profile"/);
    assert.match(html, /บันทึกในนาม/);
    assert.match(html, /รอบบันทึก \/ โครงการ \/ หมวดหมู่ \/ แหล่งเงิน \/ ประเภท/);
    assert.match(html, /id="quick-expense-rows"/);
    assert.match(html, /id="bills-widget-month-badge"/);
    assert.match(html, /id="inline-exp-posting-month"/);
    assert.doesNotMatch(html, /<th class="quick-col-month">รอบบันทึก<\/th>/);
    assert.match(html, /เล่มที่ \/ เลขที่ใบเสร็จ/);
    assert.match(html, /ร้านค้า \/ ผู้ขาย/);
    assert.match(html, /รายละเอียดเพิ่มเติมและหลักฐาน/);
    assert.match(html, /รวมรายการทั้งหมดในตาราง/);
    assert.match(html, /onclick="addQuickExpenseRow\(\)"/);
    assert.match(html, /id="bill-receipt-no"[^>]+required/);
    assert.match(source, /data-field="receiptNo"/);
    assert.match(source, /openQuickExpenseMultiItems/);
    assert.match(html, /onclick="openExpenseModalMultiItems\(\)"/);
    assert.match(source, /requestId: item\.draft\.requestId/);
    assert.match(source, /documentPrefix: item\.draft\.documentPrefix/);
    assert.match(source, /idPrefix: 'ATT'/);
    assert.match(source, /retryQuickExpenseRowAttachments/);
    assert.match(source, /const total = visibleRows\.reduce/);
    assert.match(source, /getQuickExpenseDocumentPreview/);
    assert.match(source, /editQuickExpenseDocumentNo/);
});

test('batch row validation requires all receipt fields and accepts a complete row', () => {
    const { api } = createHarness();
    const complete = {
        organizationId: 'ORG-ROOT', documentPrefix: 'BS', postingMonth: '2026-09', receiptNo: 'RC-001', expenseDate: '2026-09-01', vendorName: 'ร้านค้า',
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
    assert.equal(api.getModalOrganizationId(), 'ORG-ROOT');
    assert.equal(api.getModalDocumentPrefix(), rowValues.documentPrefix);
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

test('bill preview offers all billing profiles and keeps row labels compact', () => {
    const { api } = createHarness();
    api.setOrganizations([
        { id: 'ORG-OF', name: 'office', shortName: 'OF', active: true },
        { id: 'ORG-BS', name: 'Boribhat Suksa', shortName: 'BS', active: true }
    ]);

    assert.equal(api.getQuickExpenseDocumentPreview('2026-09', 'BS'), 'BSSEP26_1');
    const compactOptions = api.getQuickExpenseBillingProfileOptions('BS', true);
    assert.match(compactOptions, />OF<\/option>/);
    assert.match(compactOptions, />BS<\/option>/);
    assert.match(compactOptions, />VC<\/option>/);
    assert.match(compactOptions, />P<\/option>/);
    assert.doesNotMatch(compactOptions, /Boribhat Suksa|Vocational College|โปรเจกต์อื่นๆ/);
    const rowHtml = api.buildQuickExpenseRowHTML('quick-exp-preview', {
        postingMonth: '2026-09', documentPrefix: 'OF', expenseDate: '2026-09-01'
    });
    assert.match(rowHtml, /data-role="billing-code">OF<\/span>/);
    assert.match(rowHtml, /class="quick-expense-billing-menu"/);
    assert.match(rowHtml, /class="quick-expense-billing-options" role="listbox"/);
    assert.doesNotMatch(rowHtml, /quick-expense-org-select/);
    assert.match(rowHtml, /OF — office/);
    assert.match(rowHtml, /BS — Boribhat Suksa/);
    assert.match(rowHtml, /VC — Vocational College/);
    assert.match(rowHtml, /P — โปรเจกต์อื่นๆ/);
    assert.match(rowHtml, /title="เปิดรายการแบบป๊อปอัป"/);
    assert.match(rowHtml, /quick-expense-add-row/);
    assert.match(rowHtml, /quick-expense-remove-row/);
    assert.match(rowHtml, /moveQuickExpenseRow\('quick-exp-preview', -1\)/);
    assert.match(rowHtml, /moveQuickExpenseRow\('quick-exp-preview', 1\)/);
    assert.match(rowHtml, /handleQuickExpenseDescriptionInput\('quick-exp-preview'\)/);
    assert.match(rowHtml, /data-role="description-suggestions"/);
    assert.doesNotMatch(source, /ตัวอย่าง \$\{escapeHTML\(getQuickExpenseDocumentPreview/);
    assert.doesNotMatch(source, /สร้างเลขจริงเมื่อบันทึก/);
});

test('description suggestions find similar saved items and include their units', () => {
    const { api } = createHarness();
    api.setExpenses([
        { id: 'EXP-1', description: 'ซื้ออุปกรณ์สำนักงาน', unit: 'กล่อง' },
        { id: 'EXP-2', description: 'ค่าซ่อมอุปกรณ์คอมพิวเตอร์', unit: 'งาน' },
        { id: 'EXP-3', description: 'ค่าเดินทาง', unit: 'ครั้ง' }
    ]);

    const matches = JSON.parse(JSON.stringify(api.getQuickExpenseDescriptionSuggestions('อุปกรณ์')));
    assert.deepEqual(matches, [
        { description: 'ซื้ออุปกรณ์สำนักงาน', unit: 'กล่อง' },
        { description: 'ค่าซ่อมอุปกรณ์คอมพิวเตอร์', unit: 'งาน' }
    ]);
});

test('unfinished bill rows are stored locally as recoverable drafts', () => {
    const { elements, api } = createHarness();
    api.setQuickRow('quick-exp-1', [], [{ desc: 'ปากกา', qty: 3, price: 125.5 }]);

    api.persistQuickExpenseLocalDraft();
    const saved = api.loadQuickExpenseLocalDraft();

    assert.equal(saved.rows.length, 1);
    assert.equal(saved.rows[0].receiptNo, rowValues.receiptNo);
    assert.equal(saved.rows[0].documentPrefix, rowValues.documentPrefix);
    assert.equal(saved.rows[0].description, rowValues.description);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.rows[0].multiItems)), [{ desc: 'ปากกา', qty: 3, price: 125.5 }]);
    assert.equal(elements.get('row-status').textContent, 'ฉบับร่าง · บันทึกอัตโนมัติแล้ว');
    assert.match(source, /ensureQuickExpenseTrailingRow\(row\.dataset\.rowId\)/);
});

test('saved cloud bills are restored into the quick table after reload', () => {
    const { api } = createHarness();
    api.setVendors([{ id: 'VENDOR-1', name: 'ร้านทดสอบ' }]);
    api.setOrganizations([{ id: 'ORG-OF', name: 'office', shortName: 'OF', active: true }]);

    const restored = api.getQuickExpenseSavedRowInitial({
        id: 'EXP000001',
        requestId: 'REQ-1',
        documentNo: 'OFSEP26_1',
        receiptNo: '001/2569',
        expenseDate: '2026-09-27T00:00:00.000Z',
        postingMonth: '2026-09',
        organizationId: 'ORG-OF',
        vendorId: 'VENDOR-1',
        description: 'วัสดุสำนักงาน',
        quantity: 2,
        unit: 'กล่อง',
        unitPrice: 150,
        note: 'หมายเหตุ __multi_items__:[{"desc":"ปากกา","qty":2,"price":150}]'
    });

    assert.equal(restored.postingMonth, '2026-09');
    assert.equal(restored.documentPrefix, 'OF');
    assert.equal(restored.vendorName, 'ร้านทดสอบ');
    assert.equal(restored.note, 'หมายเหตุ');
    assert.deepEqual(JSON.parse(JSON.stringify(restored.multiItems)), [{ desc: 'ปากกา', qty: 2, price: 150 }]);
    assert.match(source, /\.forEach\(addQuickExpenseSavedRow\)/);
    assert.match(source, /syncQuickExpenseSavedRows\(\)/);
});

test('sheet date values retain the selected posting month', () => {
    const { api } = createHarness();
    assert.equal(api.getExpensePostingMonth({
        postingMonth: '2026-09-01T00:00:00.000Z',
        expenseDate: '2025-08-18T00:00:00.000Z'
    }), '2026-09');
    assert.equal(api.getExpensePostingMonth({
        postingMonth: '2026-08-31T17:00:00.000Z',
        expenseDate: '2025-08-18T00:00:00.000Z'
    }), '2026-09');
    assert.equal(api.getExpensePostingMonth({
        expenseDate: '2026-09-23T00:00:00.000Z'
    }), '2026-09');
    assert.match(backendExpenseSource, /postingMonth instanceof Date|value instanceof Date/);
    assert.match(source, /Filter in the browser until every deployed Apps Script version/);
});

test('report verification QR always points to the public site', () => {
    const { api } = createHarness();
    assert.equal(
        api.buildVerifyUrl('export', 'ABC 123'),
        'https://somchaimontha.github.io/rdfbilling/?v=ABC%20123'
    );
    assert.equal(
        api.buildVerifyUrl('claim', 'CLAIM/1'),
        'https://somchaimontha.github.io/rdfbilling/?verify_type=claim&verify_code=CLAIM%2F1'
    );
});

test('backend uses an admin billing profile before the organization fallback', () => {
    assert.match(backendExpenseSource, /let docPrefix = authCtx\.role === 'admin' \? requestedDocumentPrefix : ''/);
    assert.match(backendExpenseSource, /if \(!docPrefix && resolvedOrgId\)/);
    assert.match(backendExpenseSource, /documentPrefix: docPrefix/);
    assert.match(backendSheetHelperSource, /monthStr\.slice\(0, 3\)/);
    assert.match(backendSheetHelperSource, /String\(year\)\.slice\(-2\)/);
    assert.match(backendSheetHelperSource, /_\$\{seq\}/);
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
