const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'app.js');
const htmlPath = path.join(__dirname, '..', 'index.html');
const stylePath = path.join(__dirname, '..', 'style.css');
const backendExpensePath = path.join(__dirname, '..', 'backend', 'ExpenseService.gs');
const backendSheetHelperPath = path.join(__dirname, '..', 'backend', 'SheetHelper.gs');
const backendSystemPath = path.join(__dirname, '..', 'backend', 'SystemService.gs');
const backendCodePath = path.join(__dirname, '..', 'backend', 'Code.gs');
const backendAttachmentPath = path.join(__dirname, '..', 'backend', 'AttachmentService.gs');
const backendFoodPath = path.join(__dirname, '..', 'backend', 'FoodExpenseService.gs');
const source = fs.readFileSync(appPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const style = fs.readFileSync(stylePath, 'utf8');
const backendExpenseSource = fs.readFileSync(backendExpensePath, 'utf8');
const backendSheetHelperSource = fs.readFileSync(backendSheetHelperPath, 'utf8');
const backendSystemSource = fs.readFileSync(backendSystemPath, 'utf8');
const backendCodeSource = fs.readFileSync(backendCodePath, 'utf8');
const backendAttachmentSource = fs.readFileSync(backendAttachmentPath, 'utf8');
const backendFoodSource = fs.readFileSync(backendFoodPath, 'utf8');

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
            validateQuickExpenseInlineEdit,
            isQuickExpenseDraftEmpty,
            getQuickExpenseDocumentPreview,
            getQuickExpenseBillingProfileOptions,
            getQuickExpenseDescriptionSuggestions,
            getQuickExpenseSavedRowInitial,
            getExpensePostingMonth,
            formatSystemDate,
            normalizeSystemDateFormat,
            buildRoleAwareAlertPresentation,
            inferAlertIcon,
            getExpenseDeleteConfirmationMessage,
            parseSimpleCsv,
            mapQuickImportRows,
            normalizeImportedDate,
            sortQuickImportRowsByDate,
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
            setDateFormat: value => { state.dateFormat = value; },
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
    assert.match(html, /id="quick-expense-table-alert"[^>]+role="alert"/);
    assert.match(html, /id="bills-widget-month-badge"/);
    assert.match(html, /id="monthly-bills-records-toggle"[^>]+aria-controls="monthly-bills-records"/);
    assert.match(html, /id="monthly-bills-records"/);
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
    assert.match(source, /function toggleMonthlyBillsRecords/);
    assert.match(source, /if \(quickExpenseEntryMode === 'ATT'\) toggleAttachmentBillsRecords\(false\);\s*else toggleMonthlyBillsRecords\(false\)/);
    assert.match(source, /if \(quickExpenseEntryMode === 'ATT'\) toggleAttachmentBillsRecords\(true\);\s*else toggleMonthlyBillsRecords\(true\)/);
    assert.match(style, /\.monthly-bills-records\[hidden\]/);
});

test('receipt rows can be reordered across saved and pending entries', () => {
    assert.match(source, /if \(upButton\) upButton\.disabled = index === 0/);
    assert.match(source, /if \(downButton\) downButton\.disabled = index === quickExpenseRows\.length - 1/);
    assert.doesNotMatch(source, /row\.dataset\.saved === 'true' \|\| currentIndex < 0/);
    assert.doesNotMatch(source, /targetRow\.dataset\.saved === 'true'/);
    assert.match(source, /tbody\.appendChild\(item\)/);
    assert.match(source, /row\.classList\.add\('is-reordered'\)/);
    assert.match(style, /@keyframes quick-expense-reordered/);
});

test('monthly food entry supports repeatable compact rows with shared defaults', () => {
    assert.match(html, /id="quick-food-posting-month-label"/);
    assert.match(html, /id="quick-food-category"[^>]+value="อาหารประจำเดือน"/);
    assert.match(html, /id="quick-food-rows"/);
    assert.match(html, /id="quick-food-save-progress"[^>]+hidden/);
    assert.match(html, /id="quick-food-save-progress-count">0\/0/);
    assert.match(html, /onclick="addQuickFoodRow\(\)"/);
    assert.match(html, /บันทึกค่าอาหารที่รอทั้งหมด/);
    assert.doesNotMatch(html, /id="quick-food-unit"/);
    assert.match(source, /function addQuickFoodRow/);
    assert.match(source, /function ensureQuickFoodTrailingRow/);
    assert.match(source, /unit: value\('unit'\) \|\| 'รายการ'/);
    assert.match(source, /if \(postingMonth\) postingMonth\.value = selectedMonth/);
    assert.match(source, /note: category/);
    assert.match(source, /for \(const item of drafts\)/);
    assert.match(source, /setBatchUploadProgress\('quick-food-save', processedCount, drafts\.length/);
    assert.match(style, /\.quick-food-batch-container/);
    assert.match(style, /\.batch-upload-progress-track/);
    assert.match(style, /\.quick-food-row-details/);
});

test('monthly food records collapse responsively and expose semantic row actions', () => {
    assert.match(html, /id="food-table-disclosure" hidden/);
    assert.match(html, /id="food-table-toggle"[\s\S]*toggleFoodBillsTable\(\)/);
    assert.match(html, /<th class="text-center">ลำดับ<\/th>/);
    assert.match(source, /return Number\(window\.innerWidth \|\| 1024\) <= 900 \? 5 : 6/);
    assert.match(source, /rows\.slice\(0, collapsedLimit\)/);
    assert.match(source, /class="text-center food-row-number" data-label="ลำดับ">\$\{index \+ 1\}/);
    assert.match(source, /btn-icon-edit/);
    assert.match(source, /btn-icon-delete/);
    assert.match(style, /\.btn svg,[\s\S]*stroke: currentColor/);
    assert.match(style, /\.btn-action-view/);
});

test('food editor uses a responsive wide modal and preserves every history field', () => {
    assert.match(html, /class="modal-card food-entry-modal-card"/);
    assert.match(html, /class="data-table food-entry-history-table"/);
    assert.match(source, /class="food-entry-item-text"[^>]+>\$\{escapeHTML\(item\.name\)\}/);
    assert.match(source, /data-label="ยอดเงิน"/);
    assert.match(source, /data-label="จัดการ"/);
    assert.match(style, /#modal-food-entry \.food-entry-modal-card[\s\S]*width: min\(1080px, calc\(100vw - 48px\)\)/);
    assert.match(style, /\.food-entry-item-text[\s\S]*-webkit-line-clamp: 2/);
    assert.match(style, /#modal-food-entry \.food-entry-history-table tbody td::before/);
});

test('attachment bills share the repeatable monthly bill workflow', () => {
    assert.match(html, /id="attachment-bills-records-toggle"/);
    assert.match(html, /id="quick-attachment-entry-host"/);
    assert.match(html, /toggleQuickExpenseEntry\(undefined, 'ATT'\)/);
    assert.match(html, /id="attachment-bills-records"/);
    assert.match(html, /class="data-table compact-record-table" id="attached-bills-table"/);
    assert.match(source, /let quickExpenseEntryMode = 'EXP'/);
    assert.match(source, /function getQuickExpenseDataSource/);
    assert.match(source, /quickExpenseEntryMode === 'ATT' \? \(state\.attachments \|\| \[\]\)/);
    assert.match(source, /idPrefix: quickExpenseEntryMode/);
    assert.match(source, /function setQuickExpenseEntryMode/);
    assert.match(source, /บันทึกบิลแนบที่รอทั้งหมด/);
    assert.match(source, /function toggleAttachmentBillsRecords/);
    assert.match(source, /compact-attachment-row/);
    assert.match(style, /#attached-bills-table\.compact-record-table th:nth-child\(6\)/);
});

test('evidence attachments support drag and drop in every expense entry flow', () => {
    assert.match(html, /id="modal-att-body" data-attachment-drop-zone/);
    assert.match(html, /ondrop="handleSavedAttachmentDrop\(event\)"/);
    assert.match(html, /ondrop="handleBillAttachmentDrop\(event\)"/);
    assert.match(html, /ondrop="handleFoodFilesDrop\(event\)"/);
    assert.match(html, /id="food-entry-file"[^>]+multiple/);
    assert.match(source, /function setAttachmentDropZoneState/);
    assert.match(source, /handleQuickExpenseRowDrop\('\$\{rowId\}', event\)/);
    assert.match(source, /handleQuickFoodRowDrop\('\$\{rowId\}', event\)/);
    assert.match(style, /\.attachment-drop-zone\.is-dragover/);
    assert.match(style, /วางไฟล์หลักฐานที่นี่/);
});

test('evidence attachments accept clipboard files without blocking pasted text', () => {
    assert.match(html, /onpaste="handleSavedAttachmentPaste\(event\)"/);
    assert.match(html, /onpaste="handleBillAttachmentPaste\(event\)"/);
    assert.match(html, /onpaste="handleFoodFilesPaste\(event\)"/);
    assert.match(source, /function getPastedAttachmentFiles/);
    assert.match(source, /if \(!files\.length\) return \[\]/);
    assert.match(source, /event\.preventDefault\(\)/);
    assert.match(source, /handleQuickExpenseRowPaste\('\$\{rowId\}', event\)/);
    assert.match(source, /handleQuickFoodRowPaste\('\$\{rowId\}', event\)/);
    assert.match(source, /clipboard-\$\{Date\.now\(\)\}-\$\{index \+ 1\}/);
    assert.match(style, /\.attachment-drop-zone\.is-pasting/);
});

test('saved evidence modal previews the bill, supports camera capture, and hydrates Drive images', () => {
    assert.match(html, /id="att-record-summary-body"/);
    assert.match(html, /เลขบิล \/ ใบเสร็จ/);
    assert.match(html, /วันที่ \/ รอบ/);
    assert.match(html, /รายละเอียดรายการ/);
    assert.match(html, /id="att-camera-input"[^>]+accept="image\/\*"[^>]+capture="environment"/);
    assert.match(html, /id="att-enhance-image"[^>]+checked/);
    assert.match(html, /id="att-upload-queue"/);
    assert.match(source, /function renderExpenseAttachmentRecordSummary/);
    assert.match(source, /function stageExpenseAttachmentFiles/);
    assert.match(source, /ภาพจะยังไม่ถูกส่งจนกว่าจะกดยืนยัน/);
    assert.match(source, /function enhanceReceiptImage/);
    assert.match(source, /getAttachmentImageDataUrl\(attachment\)/);
    assert.match(source, /function hydrateExpenseAttachmentPreviewImages/);
    assert.match(style, /\.attachment-record-summary-table/);
    assert.match(style, /\.attachment-upload-queue-preview/);
});

test('quick tables provide spreadsheet templates and validated import previews', () => {
    const { api } = createHarness();
    const raw = api.parseSimpleCsv('\uFEFFวันที่ซื้อ,รายการ,จำนวน,หน่วย,ราคา/หน่วย\n2026-09-01,ข้าวสาร,2,ถุง,150');
    assert.equal(raw.length, 1);
    const rows = api.mapQuickImportRows(raw, 'FOOD');
    assert.equal(rows[0].errors.length, 0);
    assert.equal(rows[0].row.name, 'ข้าวสาร');
    assert.equal(rows[0].row.quantity, 2);
    assert.equal(rows[0].row.unitPrice, 150);
    const header = 'รอบบันทึก,หมวดหมู่,วันที่ซื้อ,รายการ,จำนวน,หน่วย,ราคา/หน่วย';
    const repeatedHeaderRows = api.parseSimpleCsv(`${header}\n${header}\n2026-09,อาหารประจำเดือน,2026-09-10,เต้าหู้,2,ถุง,35`);
    const filteredRows = api.mapQuickImportRows(repeatedHeaderRows, 'FOOD');
    assert.equal(filteredRows.length, 1);
    assert.equal(filteredRows[0].sourceRow, 3);
    assert.equal(filteredRows[0].row.name, 'เต้าหู้');
    const datedRows = api.mapQuickImportRows(api.parseSimpleCsv(
        'รอบบันทึก,หมวดหมู่,วันที่ซื้อ (เดือน-วัน-ปี),รายการ,จำนวน,หน่วย,ราคา/หน่วย\n' +
        '2026-09,อาหารประจำเดือน,09-11-2026,รายการวันที่สอง,1,ถุง,20\n' +
        '2026-09,อาหารประจำเดือน,09-10-2026,รายการแรก,1,ถุง,10\n' +
        '2026-09,อาหารประจำเดือน,09-10-2026,รายการถัดมา,1,ถุง,15'
    ), 'FOOD');
    const sortedRows = api.sortQuickImportRowsByDate(datedRows);
    assert.deepEqual(Array.from(sortedRows, item => item.row.name), ['รายการแรก', 'รายการถัดมา', 'รายการวันที่สอง']);
    assert.equal(api.normalizeImportedDate('09-10-2026'), '2026-09-10');
    assert.match(html, /id="quick-expense-import-file"[^>]+accept="\.csv,\.xlsx,\.xls"/);
    assert.match(html, /id="quick-food-import-file"[^>]+accept="\.csv,\.xlsx,\.xls"/);
    assert.match(html, /id="modal-quick-import"/);
    assert.match(html, /id="quick-import-preview-table"/);
    assert.match(html, /id="quick-import-progress"[^>]+hidden/);
    assert.match(html, /id="quick-import-progress-count">0\/0/);
    assert.match(html, /id="quick-import-confirm"[^>]*>[\s\S]*?data-lucide="circle-check"[\s\S]*?ยืนยันเพิ่มลงตาราง/);
    assert.match(source, /async function downloadQuickImportTemplate/);
    assert.match(source, /async function handleQuickTableImport/);
    assert.match(source, /function renderQuickImportPreview/);
    assert.match(source, /function confirmQuickTableImport/);
    assert.match(source, /function isQuickImportHeaderRow/);
    assert.match(source, /function sortQuickImportRowsByDate/);
    assert.match(source, /วันที่ซื้อ \(เดือน-วัน-ปี\)/);
    assert.match(source, /dateCell\.z = 'mm-dd-yyyy'/);
    assert.match(source, /async function confirmQuickTableImport/);
    assert.match(source, /setBatchUploadProgress\('quick-import', completed, total/);
    assert.match(source, /function removeEmptyQuickFoodRowsBeforeImport/);
    const confirmImportSection = source.slice(source.indexOf('function confirmQuickTableImport()'), source.indexOf('window.confirmQuickTableImport'));
    assert.match(confirmImportSection, /removeEmptyQuickFoodRowsBeforeImport\(\);[\s\S]*for \(let index = 0; index < preview\.rows\.length; index\+\+\)/);
    assert.match(source, /ไฟล์หนึ่งครั้งรองรับไม่เกิน 1,000 รายการ/);
    assert.match(style, /\.quick-import-preview-table tbody tr\.has-error/);
});

test('monthly bill actions are unique, visible, and table clearing is confirmed', () => {
    const compactStart = source.indexOf('function renderCompactExpenseRow');
    const compactEnd = source.indexOf('function renderAttachmentRow', compactStart);
    const compactRenderer = source.slice(compactStart, compactEnd);

    assert.equal((compactRenderer.match(/btn-icon-edit/g) || []).length, 1);
    assert.doesNotMatch(compactRenderer, /data-lucide="pencil"/);
    assert.match(compactRenderer, /data-lucide="square-pen"/);
    assert.doesNotMatch(html, /clearSavedQuickExpenseRows/);
    assert.match(html, /quick-expense-clear-table/);
    assert.match(source, /ยืนยันล้างตาราง/);
    assert.match(style, /\.quick-expense-batch-container\s*\{[^}]*min-height:\s*360px/s);
    assert.match(style, /\.compact-record-table \.record-tools \.btn-icon-edit/);
    assert.match(style, /\.compact-record-table \.record-tools \.btn-icon-delete/);
    assert.match(style, /\.quick-expense-clear-table\s*\{[^}]*color:\s*#dc2626/s);
});

test('icons are rendered locally without loading an external icon library', () => {
    assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/lucide@/);
    assert.doesNotMatch(html, /unpkg\.com\/lucide@/);
    assert.match(source, /LOCAL_ICON_PATHS/);
    assert.match(source, /LOCAL_ICON_ALIASES/);
    assert.match(source, /'circle-check': '<circle[^']+<path/);
    assert.match(source, /document\.createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/);
    assert.match(source, /svg\.setAttribute\('stroke', 'currentColor'\)/);
    assert.match(source, /function addQuickExpenseRow[\s\S]*?initializeLucide\(\)/);
    assert.match(style, /\.local-icon\s*\{/);
});

test('local icon renderer replaces action placeholders with visible SVG elements', () => {
    const iconStart = source.indexOf('const LOCAL_ICON_PATHS');
    const iconEnd = source.indexOf('// ID Generator', iconStart);
    const iconRendererSource = source.slice(iconStart, iconEnd);
    const createIcon = name => {
        const attributes = [
            { name: 'data-lucide', value: name },
            { name: 'class', value: 'action-icon' }
        ];
        return {
            attributes,
            replacement: null,
            getAttribute(attributeName) {
                return attributes.find(attribute => attribute.name === attributeName)?.value || null;
            },
            replaceWith(replacement) { this.replacement = replacement; }
        };
    };
    const icons = [createIcon('square-pen'), createIcon('trash-2'), createIcon('plus')];
    const document = {
        querySelectorAll(selector) {
            assert.equal(selector, 'i[data-lucide]');
            return icons;
        },
        createElementNS(namespace, tagName) {
            assert.equal(namespace, 'http://www.w3.org/2000/svg');
            assert.equal(tagName, 'svg');
            return {
                attributes: new Map(),
                innerHTML: '',
                setAttribute(name, value) { this.attributes.set(name, String(value)); }
            };
        }
    };
    const context = { document, console };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(`${iconRendererSource}\nglobalThis.iconRenderResult = initializeLucide();`, context);

    assert.equal(context.iconRenderResult, true);
    icons.forEach(icon => {
        assert.ok(icon.replacement);
        assert.equal(icon.replacement.attributes.get('viewBox'), '0 0 24 24');
        assert.equal(icon.replacement.attributes.get('stroke'), 'currentColor');
        assert.match(icon.replacement.attributes.get('class'), /local-icon/);
        assert.match(icon.replacement.innerHTML, /<(?:path|circle|rect|ellipse)/);
    });
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
    assert.match(source, /showQuickExpenseTableValidation\([\s\S]*?กรุณากรอกข้อมูลใบเสร็จอย่างน้อย 1 รายการ/);
    assert.match(source, /firstPendingRowId \? \[firstPendingRowId\] : \[\]/);
    assert.match(style, /\.quick-expense-batch-container\.has-validation-warning/);
    assert.match(style, /\.quick-expense-batch-row\.is-validation-error/);
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
    assert.doesNotMatch(rowHtml, /quick-expense-add-row/);
    assert.match(rowHtml, /quick-expense-remove-row/);
    assert.match(rowHtml, /moveQuickExpenseRow\('quick-exp-preview', -1\)/);
    assert.match(rowHtml, /moveQuickExpenseRow\('quick-exp-preview', 1\)/);
    assert.match(rowHtml, /handleQuickExpenseDescriptionInput\('quick-exp-preview'\)/);
    assert.match(rowHtml, /data-role="description-suggestions"/);
    assert.doesNotMatch(source, /ตัวอย่าง \$\{escapeHTML\(getQuickExpenseDocumentPreview/);
    assert.doesNotMatch(source, /สร้างเลขจริงเมื่อบันทึก/);
});

test('quick-row tool buttons stay active and deleting a row requires confirmation', () => {
    const { api } = createHarness();
    const confirmation = api.getExpenseDeleteConfirmationMessage({
        documentNo: 'OFSEP26_1',
        receiptNo: '026/1299',
        description: 'แก๊ส ปตท. หุงต้ม 15 kg.'
    });
    assert.match(confirmation, /เลขบิล: OFSEP26_1/);
    assert.match(confirmation, /เล่มที่ \/ เลขที่ใบเสร็จ: 026\/1299/);
    assert.match(confirmation, /แก๊ส ปตท\. หุงต้ม 15 kg\./);
    assert.match(confirmation, /หายจากเมนู “แสดงรายการเดิม”/);
    assert.match(source, /window\.addQuickExpenseRow = addQuickExpenseRow/);
    assert.match(source, /window\.removeQuickExpenseRow = removeQuickExpenseRow/);
    assert.match(source, /async function removeQuickExpenseRow/);
    assert.match(source, /ยืนยันลบแถว/);
    assert.match(source, /confirmButtonText: saved \? 'ลบออกจากระบบ' : 'ลบแถว'/);
    assert.match(source, /cancelButtonText: 'ย้อนกลับ'/);
    assert.match(source, /\.quick-expense-open-full, \[data-row-remove\]/);
    assert.match(source, /sourceRow\.dataset\.saved === 'true'/);
    assert.match(source, /openExpenseModal\(expenseIndex\)/);
    assert.match(source, /async function deleteExpenseRecordAndSync/);
    assert.match(source, /apiCall\('deleteExpense', \{ id: normalizedId \}\)/);
    assert.match(source, /applyExpenseDeletionToClientState\(normalizedId\)/);
    assert.match(source, /state\.expenses = \(state\.expenses \|\| \[\]\)\.filter/);
    assert.match(source, /renderAll\(\)/);
    assert.match(backendExpenseSource, /AttachmentService\.removeByExpenseId\(id, authCtx\)/);
    assert.match(backendAttachmentSource, /removeByExpenseId\(expenseId, authCtx\)/);
    assert.match(backendAttachmentSource, /setTrashed\(true\)/);
});

test('saved receipt rows support direct editing with automatic server updates', () => {
    const { api } = createHarness();
    const validDraft = {
        receiptNo: '026/1299', expenseDate: '2026-09-01', vendorName: 'ร้านค้า',
        description: 'วัสดุสำนักงาน', quantity: 2, unit: 'ชิ้น', unitPrice: 50
    };
    assert.equal(api.validateQuickExpenseInlineEdit(validDraft), '');
    assert.match(api.validateQuickExpenseInlineEdit({ ...validDraft, description: '' }), /รายละเอียด/);
    assert.match(source, /saveQuickExpenseInlineEdit/);
    assert.match(source, /apiCall\('updateExpense', payload, null, null, \{/);
    assert.match(source, /row\.dataset\.inlineSaveError = 'true'/);
    assert.match(source, /failedInlineRowIds/);
    assert.match(source, /ไม่มีรายการใหม่ที่รอบันทึก/);
    assert.match(source, /กำลังลองบันทึกการแก้ไขอีกครั้ง/);
    assert.match(source, /event\.type === 'change'/);
    assert.match(source, /บันทึกแล้ว · คลิกช่องข้อมูลเพื่อแก้ไข/);
    assert.match(source, /ระบบจะบันทึกเมื่อออกจากช่อง/);
    assert.match(style, /\.quick-expense-batch-row\.is-saved \[data-field\]:not\(:disabled\)/);
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

test('bill dates use configurable unambiguous English month abbreviations', () => {
    const { api } = createHarness();

    api.setDateFormat('MMM_DD_YYYY');
    assert.equal(api.formatSystemDate('2026-09-29'), 'SEP 29 2026');
    api.setDateFormat('DD_MMM_YYYY');
    assert.equal(api.formatSystemDate('2026-09-29'), '29 SEP 2026');
    api.setDateFormat('YYYY_MMM_DD');
    assert.equal(api.formatSystemDate('2026-09-29'), '2026 SEP 29');
    api.setDateFormat('MMM_DD_BBBB');
    assert.equal(api.formatSystemDate('2026-09-29'), 'SEP 29 2569');

    assert.equal(api.normalizeSystemDateFormat('invalid'), 'MMM_DD_YYYY');
    assert.match(html, /id="setting-date-format"/);
    assert.match(html, /SEP 29 2026/);
    assert.match(style, /\.system-date-control/);
    assert.match(source, /input\[type="date"\]/);
    assert.doesNotMatch(source, /toLocaleDateString/);
    assert.match(backendSystemSource, /dateFormat: this\.getConfigValue\('date_format', 'MMM_DD_YYYY'\)/);
    assert.match(backendSystemSource, /const allowedFormats = \['MMM_DD_YYYY', 'DD_MMM_YYYY', 'YYYY_MMM_DD', 'MMM_DD_BBBB'\]/);
});

test('month selectors start at the current Bangkok month while remaining user-selectable', () => {
    const loadStateSection = source.slice(source.indexOf('function loadState()'), source.indexOf('function saveState()'));
    const saveStateSection = source.slice(source.indexOf('function saveState()'), source.indexOf('// ==========================================================================', source.indexOf('function saveState()')));
    assert.match(source, /function getCurrentBangkokPeriod/);
    assert.match(source, /timeZone: 'Asia\/Bangkok'/);
    assert.match(loadStateSection, /state\.selectedMonth = defaults\.selectedMonth/);
    assert.match(loadStateSection, /state\.selectedYear = defaults\.selectedYear/);
    assert.doesNotMatch(loadStateSection, /parsed\.selectedMonth|parsed\.selectedYear/);
    assert.doesNotMatch(saveStateSection, /selectedMonth: state\.selectedMonth|selectedYear: state\.selectedYear/);
    assert.match(source, /function syncSharedMonthSelectors/);
    assert.match(source, /foodOverviewMonth\.value = postingMonth/);
    assert.match(source, /monthInput\.value = getSelectedPostingMonth\(\)/);
});

test('dashboard displays all twelve monthly totals for the selected year', () => {
    assert.match(html, /id="dashboard-year-summary-table"/);
    assert.match(html, /id="dashboard-year-summary-body"/);
    assert.match(html, /id="dashboard-year-total"/);
    assert.match(source, /function cacheAuthorizedExpenseRecords/);
    assert.match(source, /function renderDashboardAnnualSummary/);
    assert.match(source, /Array\.from\(\{ length: 12 \}/);
    assert.match(source, /function selectDashboardMonth/);
    assert.match(source, /renderSection\('dashboard-year-summary', renderDashboardAnnualSummary\)/);
    assert.match(style, /\.dashboard-year-summary-table/);
    assert.match(style, /\.dashboard-year-month-button/);
});

test('alerts show full diagnostics to admin and concise guidance to other users', () => {
    const { api, storage } = createHarness();
    const message = 'Apps Script ขัดข้องชั่วคราว (HTTP 504)';
    assert.equal(api.inferAlertIcon('บันทึกข้อมูลล้มเหลว'), 'error');
    assert.equal(api.inferAlertIcon('กรุณากรอกข้อมูลให้ครบ'), 'warning');
    assert.equal(api.inferAlertIcon('บันทึกเรียบร้อยแล้ว'), 'success');

    const adminAlert = api.buildRoleAwareAlertPresentation(message, 'error');
    assert.equal(adminAlert.isAdmin, true);
    assert.match(adminAlert.html, /รายละเอียดสำหรับผู้ดูแลระบบสูงสุด/);
    assert.match(adminAlert.html, /รายละเอียดทางเทคนิค/);
    assert.match(adminAlert.html, /Apps Script &gt; Executions/);
    assert.match(adminAlert.html, /วิธีตรวจสอบและแก้ไข/);

    storage.set('rdf_current_user', JSON.stringify({ id: 'STAFF-1', role: 'staff', organizationId: 'ORG-1' }));
    const staffAlert = api.buildRoleAwareAlertPresentation(message, 'error');
    assert.equal(staffAlert.isAdmin, false);
    assert.match(staffAlert.html, /สิ่งที่ควรทำ/);
    assert.doesNotMatch(staffAlert.html, /รายละเอียดทางเทคนิค|Stack trace|Apps Script &gt; Executions/);

    assert.match(backendCodeSource, /const isAdmin = authCtx && authCtx\.role === 'admin'/);
    assert.match(backendCodeSource, /isAdmin \? adminMessage : publicMessage/);
    assert.match(backendCodeSource, /if \(meta\) payload\.error\.details = meta/);
});

test('Drive authorization failures provide an explicit recovery path', () => {
    const rootManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
    const backendManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backend', 'appsscript.json'), 'utf8'));
    for (const manifest of [rootManifest, backendManifest]) {
        assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive'));
        assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'));
        assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
    }
    const backendSetupSource = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Setup.gs'), 'utf8');
    assert.match(backendSetupSource, /function authorizeRequiredServices/);
    assert.match(backendSetupSource, /DriveApp\.getFolderById\(folderId\)/);
    assert.match(backendCodeSource, /DRIVE_AUTH_REQUIRED/);
    assert.match(source, /authorizeRequiredServices/);
    assert.match(source, /146sp7FoRNOyTyclbJ4Q5qqw07e4ZnSSG/);
});

test('transient write failures retry safely and expose item-level status', () => {
    assert.match(source, /const API_WRITE_RETRY_ATTEMPTS = 3/);
    assert.match(source, /function canSafelyRetryWrite/);
    assert.match(source, /const MUTATING_API_ACTIONS = new Set/);
    assert.match(source, /return MUTATING_API_ACTIONS\.has\(action\)/);
    assert.match(source, /requestId: statusRequestId/);
    assert.match(source, /status: attempt > 1 \? 'retrying' : 'sending'/);
    assert.match(source, /reportApiRequestStatus\(options, \{ action, isWrite, requestId: statusRequestId, status: 'success'/);
    assert.match(source, /กำลังส่งซ้ำ \$\{detail\.attempt\}\/\$\{detail\.maxAttempts\}/);
    assert.match(source, /ยังไม่บันทึกเลขบิล · ระบบลองส่งซ้ำแล้ว/);
    assert.match(style, /\.api-write-status-item\.is-success/);
    assert.match(style, /@keyframes api-write-spin/);
    assert.match(backendFoodSource, /ensureFoodExpenseRequestIdColumn_/);
    assert.match(backendFoodSource, /replayFoodExpenseCreateRequest_/);
    assert.match(backendFoodSource, /requestId/);
    assert.match(backendCodeSource, /function runIdempotentMutation_/);
    assert.match(backendCodeSource, /cache\.put\(cacheKey, content, 21600\)/);
    assert.match(backendCodeSource, /runIdempotentMutation_\(requestId, action/);
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
