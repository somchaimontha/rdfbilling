const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');
const fontDir = path.join(__dirname, '..', 'fonts');

function fontMapsCodePoint(fontBuffer, codePoint) {
    const tableCount = fontBuffer.readUInt16BE(4);
    let cmapOffset = -1;
    for (let index = 0; index < tableCount; index++) {
        const recordOffset = 12 + index * 16;
        if (fontBuffer.toString('ascii', recordOffset, recordOffset + 4) === 'cmap') {
            cmapOffset = fontBuffer.readUInt32BE(recordOffset + 8);
            break;
        }
    }
    if (cmapOffset < 0) return false;

    const subtableCount = fontBuffer.readUInt16BE(cmapOffset + 2);
    for (let index = 0; index < subtableCount; index++) {
        const recordOffset = cmapOffset + 4 + index * 8;
        const subtableOffset = cmapOffset + fontBuffer.readUInt32BE(recordOffset + 4);
        if (fontBuffer.readUInt16BE(subtableOffset) !== 4 || codePoint > 0xFFFF) continue;

        const segmentCount = fontBuffer.readUInt16BE(subtableOffset + 6) / 2;
        const endCodeOffset = subtableOffset + 14;
        const startCodeOffset = endCodeOffset + segmentCount * 2 + 2;
        const deltaOffset = startCodeOffset + segmentCount * 2;
        const rangeOffset = deltaOffset + segmentCount * 2;
        for (let segment = 0; segment < segmentCount; segment++) {
            const endCode = fontBuffer.readUInt16BE(endCodeOffset + segment * 2);
            const startCode = fontBuffer.readUInt16BE(startCodeOffset + segment * 2);
            if (codePoint < startCode || codePoint > endCode) continue;
            const delta = fontBuffer.readUInt16BE(deltaOffset + segment * 2);
            const rangeAddress = rangeOffset + segment * 2;
            const glyphRange = fontBuffer.readUInt16BE(rangeAddress);
            if (glyphRange === 0) return ((codePoint + delta) & 0xFFFF) !== 0;
            const glyphAddress = rangeAddress + glyphRange + (codePoint - startCode) * 2;
            if (glyphAddress + 1 >= fontBuffer.length) return false;
            const glyph = fontBuffer.readUInt16BE(glyphAddress);
            return glyph !== 0 && ((glyph + delta) & 0xFFFF) !== 0;
        }
    }
    return false;
}

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
        addDocumentBreakOpportunities, preparePdfDocumentText, buildPdfDocDefinition, sortExportRows,
        wrapPdfTextByWords, splitPdfTableColumns, getPdfTableColumnWidths,
        EXPORT_BILL_COLUMNS, getExportColumnValue
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

test('pdf document preparation keeps Thai text exact for reliable copying', () => {
    const api = createHarness();
    const originalTitle = 'สรุปรายจ่าย Expense Summary';
    const originalProject = 'โครงการ Project';
    const documentDefinition = {
        content: [{ text: originalTitle }, { stack: [{ text: originalProject }] }],
        images: { logo: 'data:image/png;base64,abc' },
        pageSize: 'A4'
    };

    api.preparePdfDocumentText(documentDefinition);

    assert.equal(documentDefinition.content[0].text, originalTitle);
    assert.equal(documentDefinition.content[1].stack[0].text, originalProject);
    assert.doesNotMatch(JSON.stringify(documentDefinition.content), /[\u00AD\u200B\u200C\u2060\uFEFF]/);
    assert.ok(documentDefinition.content[0].text.includes('Expense Summary'));
    assert.equal(documentDefinition.images.logo, 'data:image/png;base64,abc');
    assert.equal(documentDefinition.pageSize, 'A4');
});

test('pdf document preparation removes legacy unsupported invisible characters', () => {
    const api = createHarness();
    const documentDefinition = {
        content: [{ text: 'รายงาน\u200Bสรุป\u200Cรายการ\u2060บิล\uFEFFประจำเดือน' }]
    };

    api.preparePdfDocumentText(documentDefinition);

    assert.doesNotMatch(documentDefinition.content[0].text, /[\u200B\u200C\u2060\uFEFF]/);
    assert.equal(documentDefinition.content[0].text, 'รายงานสรุปรายการบิลประจำเดือน');
});

test('PDF soft breaks are opt-in only for exceptional long text', () => {
    const api = createHarness();
    const documentDefinition = {
        content: [{ text: 'รายละเอียดภาษาไทยที่ยาวมาก', allowPdfSoftBreaks: true }]
    };

    api.preparePdfDocumentText(documentDefinition);

    assert.ok(documentDefinition.content[0].text.includes('\u00AD'));
    assert.equal(Object.hasOwn(documentDefinition.content[0], 'allowPdfSoftBreaks'), false);
});

test('copy-safe PDF nodes keep Thai text exact without hidden break characters', () => {
    const api = createHarness();
    const original = 'เลขบิล: VCSEP26_1 | รอบบันทึก: กันยายน 2569 | ผู้ขาย: ธนาพาณิชย์';
    const documentDefinition = {
        content: [{ text: original + '\u00AD\u200B', preservePdfText: true }]
    };

    api.preparePdfDocumentText(documentDefinition);

    assert.equal(documentDefinition.content[0].text, original);
    assert.equal(Object.hasOwn(documentDefinition.content[0], 'preservePdfText'), false);
    assert.doesNotMatch(documentDefinition.content[0].text, /[\u00AD\u200B\u200C\u2060\uFEFF]/);
});

test('every embedded Sarabun font supports the PDF soft-break character', () => {
    const fontFiles = [
        'Sarabun-Regular.ttf',
        'Sarabun-Bold.ttf',
        'Sarabun-Italic.ttf',
        'Sarabun-BoldItalic.ttf'
    ];
    for (const fileName of fontFiles) {
        const fontBuffer = fs.readFileSync(path.join(fontDir, fileName));
        assert.equal(fontMapsCodePoint(fontBuffer, 0x00AD), true, `${fileName} must support U+00AD`);
    }
});

test('receipt evidence is placed after each matching report section', () => {
    const api = createHarness();
    const makeSection = (key, label) => ({
        key,
        label,
        accent: '#059669',
        columns: [],
        rows: [{ id: `${key}-1` }],
        detailed: false,
        attachmentOnly: false,
        attachmentCount: 1,
        attachmentWarnings: [],
        attachmentItems: [{
            detail: [
                { label: 'เลขบิล', value: `${key.toUpperCase()}-001` },
                { label: 'เล่มที่ / เลขที่ใบเสร็จ', value: '026/1299' },
                { label: 'วันที่', value: 'SEP 22 2026' },
                { label: 'รอบบันทึก', value: 'กันยายน 2569' },
                { label: 'โครงการ', value: 'ปกติ' },
                { label: 'หมวดหมู่', value: 'อาหาร' },
                { label: 'ผู้ขาย', value: 'ธนาพาณิชย์' },
                { label: 'ยอดรวม', value: '515.00' },
                { label: 'จำนวนหลักฐาน', value: '1' },
                { label: 'ประเภทเบิก', value: 'เบิกมูลนิธิ' },
            ],
            images: key === 'bills' ? [
                { src: 'data:image/png;base64,one', caption: 'ด้านหน้า' },
                { src: 'data:image/png;base64,two', caption: 'ด้านหลัง' },
            ] : [{ src: 'data:image/png;base64,food', caption: 'ใบเสร็จค่าอาหาร' }],
            fileRefs: [{ name: `${key}.pdf`, url: 'https://example.test/file', note: '' }],
            fileCount: 1
        }]
    });
    const definition = api.buildPdfDocDefinition({
        header: {
            title: 'รายงานทดสอบ', monthLabel: 'กันยายน พ.ศ. 2569', attachmentCount: 2,
            docNum: 'RDF-ALL-256909', verifyCode: 'TEST-CODE', qrDataUrl: 'data:image/png;base64,abc'
        },
        signature: null,
        reportOptions: { pageOrientation: 'portrait' },
        sections: [makeSection('bills', 'รายการบิล'), makeSection('food', 'ค่าอาหารประจำเดือน')]
    });
    const normalized = value => JSON.stringify(value).replaceAll('\u00AD', '').replaceAll('\\n', '');
    const findMainSection = text => definition.content.findIndex(node => node.pageBreak === 'before' && node.table && normalized(node).includes(text));
    const findEvidence = text => definition.content.findIndex(node => node.pageBreak === 'before' && node.stack && normalized(node).includes(text));
    const summary = definition.content.findIndex(node => normalized(node).includes('สรุปรายการทั้งหมด'));
    const billsSection = findMainSection('รายการบิล');
    const billsEvidence = findEvidence('หลักฐานใบเสร็จ - รายการบิล');
    const foodSection = findMainSection('ค่าอาหารประจำเดือน');
    const foodEvidence = findEvidence('หลักฐานใบเสร็จ - ค่าอาหารประจำเดือน');

    assert.ok(summary >= 0 && billsSection > summary);
    assert.ok(billsEvidence > billsSection);
    assert.ok(foodSection > billsEvidence && foodEvidence > foodSection);
    assert.equal(definition.content[billsSection].pageBreak, 'before');
    assert.equal(definition.content[foodSection].pageBreak, 'before');
    assert.equal(definition.content[billsEvidence].pageBreak, 'before');
    assert.equal(definition.content[foodEvidence].pageBreak, 'before');

    const firstEvidenceItem = definition.content[billsEvidence];
    const prose = firstEvidenceItem.stack.find(node => Array.isArray(node.text));
    const firstImage = firstEvidenceItem.stack.find(node => node.image);
    assert.ok(prose, 'evidence metadata must be prose, not a table');
    assert.equal(firstEvidenceItem.stack.some(node => node.table), false);
    assert.ok(firstImage);
    assert.equal(firstEvidenceItem.unbreakable, true);
    assert.ok(firstImage.fit[0] < 507.3 && firstImage.fit[1] < 590);
    assert.equal(normalized(firstEvidenceItem).includes('กันยายน 2569'), true);
    assert.doesNotMatch(JSON.stringify(firstEvidenceItem), /[\u00AD\u200B\u200C\u2060\uFEFF]/);

    const continuation = definition.content[billsEvidence + 1];
    assert.equal(continuation.pageBreak, 'before');
    assert.equal(continuation.unbreakable, true);
    assert.match(normalized(continuation), /หลักฐาน 2\/2/);

    const repeatedHeader = definition.header(2, 4);
    assert.equal(repeatedHeader.columns[2].width, 28);
    assert.equal(repeatedHeader.columns[2].height, 28);
    assert.match(repeatedHeader.columns[1].text, /RDF-ALL-256909/);
    assert.match(repeatedHeader.columns[1].text, /หน้า 2\/4/);
    assert.ok(repeatedHeader.columns[1].fontSize <= 5.2);
});

test('evidence pages can mix landscape paired images with portrait report sections', () => {
    const api = createHarness();
    const evidenceItems = Array.from({ length: 3 }, (_, index) => ({
        detail: [
            { label: 'เลขบิล', value: `BILL-${index + 1}` },
            { label: 'รายละเอียดรายการ', value: `หลักฐานทดสอบ ${index + 1}` },
        ],
        images: [{ src: `data:image/png;base64,image${index + 1}`, caption: `ภาพ ${index + 1}` }],
        fileRefs: [],
        fileCount: 1,
    }));
    const definition = api.buildPdfDocDefinition({
        header: { title: 'รายงานทดสอบ', attachmentCount: 3 },
        signature: null,
        reportOptions: {
            pageOrientation: 'portrait',
            evidenceLayout: { orientation: 'portrait', itemsPerPage: 1, placement: 'vertical' },
        },
        sections: [{
            key: 'bills', label: 'รายการบิลประจำเดือน', accent: '#059669',
            columns: [], rows: [], detailed: false, attachmentOnly: false,
            attachmentCount: 3, attachmentWarnings: [], attachmentItems: evidenceItems,
            evidenceLayout: { orientation: 'landscape', itemsPerPage: 2, placement: 'horizontal' },
        }, {
            key: 'food', label: 'ค่าอาหารประจำเดือน', accent: '#f59e0b',
            columns: [], rows: [], detailed: false, attachmentOnly: false,
            attachmentCount: 0, attachmentWarnings: [], attachmentItems: [],
            evidenceLayout: { orientation: 'portrait', itemsPerPage: 1, placement: 'vertical' },
        }],
    });
    const normalized = value => JSON.stringify(value).replaceAll('\u00AD', '').replaceAll('\\n', '');
    const evidencePages = definition.content.filter(node => node.stack
        && normalized(node).includes('หลักฐานใบเสร็จ - รายการบิลประจำเดือน'));
    const pairedLayout = evidencePages[0].stack.find(node => Array.isArray(node.columns));
    const pairedImages = pairedLayout.columns.map(column => column.stack.find(node => node.image));
    const foodHeading = definition.content.find(node => node.pageBreak === 'before'
        && node.table && normalized(node).includes('ค่าอาหารประจำเดือน'));

    assert.equal(evidencePages.length, 2, 'three images at two per page must use two evidence pages');
    assert.equal(evidencePages[0].pageOrientation, 'landscape');
    assert.equal(evidencePages[1].pageOrientation, 'landscape');
    assert.equal(pairedLayout.columns.length, 2);
    assert.equal(pairedLayout.columns[0].width, pairedLayout.columns[1].width,
        'left and right evidence slots must have equal widths');
    assert.equal(pairedLayout.columnGap, 12, 'paired evidence must keep a readable center gap');
    assert.deepEqual(Array.from(pairedLayout.margin), [4, 0, 4, 0],
        'paired evidence must keep equal safe insets on both page edges');
    assert.ok((pairedLayout.columns[0].width * 2) + pairedLayout.columnGap
        + pairedLayout.margin[0] + pairedLayout.margin[2] < 800,
    'paired evidence columns must remain inside A4 landscape content width');
    assert.ok(pairedImages.every(Boolean));
    assert.ok(pairedImages.every(image => image.fit[0] < 380 && image.fit[1] < 430));
    assert.ok(pairedImages.every(image => image.fit[0] === pairedLayout.columns[0].width - 4),
        'image fit must stay inside each evidence slot');
    assert.ok(pairedImages.every(image => image.fit[1] > 330),
        'portrait receipts should use more of the available landscape page height');
    const leftoverImage = evidencePages[1].stack.find(node => node.image);
    assert.ok(leftoverImage);
    assert.equal(leftoverImage.alignment, 'center', 'an odd leftover receipt must stay centered');
    assert.ok(foodHeading);
    assert.equal(foodHeading.pageOrientation, 'portrait', 'the following report topic must reset to the report orientation');
});

test('first page summarizes large sections and keeps every main section on a new page', () => {
    const api = createHarness();
    const rows = Array.from({ length: 8 }, (_, index) => ({
        id: `food-${index + 1}`,
        foodName: `รายการอาหาร ${index + 1}`,
        foodCategory: index % 2 ? 'วัตถุดิบ' : 'เครื่องปรุง',
        foodAmount: 100,
    }));
    const definition = api.buildPdfDocDefinition({
        header: { title: 'รายงานทดสอบ', attachmentCount: 0 },
        signature: null,
        reportOptions: { pageOrientation: 'portrait' },
        sections: [{
            key: 'food', label: 'ค่าอาหารประจำเดือน', accent: '#f59e0b',
            columns: [], rows, detailed: false, attachmentOnly: false,
            attachmentCount: 0, attachmentWarnings: [], attachmentItems: [],
        }]
    });
    const normalized = value => JSON.stringify(value)
        .replaceAll('\u00AD', '')
        .replaceAll('\\n', '');
    const summaryTable = definition.content.find(node => node.table
        && normalized(node).includes('ค่าอาหารประจำเดือน')
        && normalized(node).includes('จำนวนรายการ')
        && normalized(node).includes('8 รายการ'));
    const mainSection = definition.content.find(node => node.pageBreak === 'before' && normalized(node).includes('ค่าอาหารประจำเดือน'));

    assert.ok(summaryTable);
    assert.equal(summaryTable.table.dontBreakRows, true);
    assert.equal(summaryTable.table.headerRows, 2);
    assert.doesNotMatch(normalized(summaryTable), /รายการอาหาร 1/);
    assert.equal(summaryTable.table.body.at(-1)[0].text, 'ยอดรวม');
    assert.ok(mainSection);
});

test('front summary separates main topics, lists non-food details, and totals every table', () => {
    const api = createHarness();
    const makeSection = (key, label, rows, accent = '#059669') => ({
        key, label, accent, columns: [], rows, detailed: false, attachmentOnly: false,
        attachmentCount: rows.reduce((sum, row) => sum + (row.attachmentsCount || 0), 0),
        attachmentWarnings: [], attachmentItems: [],
    });
    const sections = [
        makeSection('bills', 'รายการบิลประจำเดือน', [{
            id: 'bill-1', docNo: 'VCSEP26_1', receiptNo: '026/1299', date: '2026-09-22',
            postingMonth: '2026-09', vendor: 'ธนาพาณิชย์', description: 'แก๊สหุงต้ม 15 กิโลกรัม',
            project: 'ปกติ', category: 'อาหาร', claimType: 'เบิกมูลนิธิ', amount: 515, attachmentsCount: 1,
        }]),
        makeSection('attach', 'บิลแนบ / ค่าสาธารณูปโภค', [{
            id: 'attach-1', docNo: 'UTSEP26_1', description: 'ค่าไฟฟ้าประจำเดือน',
            project: 'สำนักงาน', category: 'สาธารณูปโภค', amount: 100, attachmentsCount: 1,
        }], '#7c3aed'),
        makeSection('projects', 'โครงการเพิ่มเติม', [{
            id: 'project-1', referenceNo: 'PJ-001', description: 'วัสดุสำหรับโครงการฝึกอาชีพ',
            project: 'ฝึกอาชีพ', category: 'วัสดุ', amount: 200, attachmentsCount: 0,
        }], '#2563eb'),
        makeSection('food', 'ค่าอาหารประจำเดือน', [
            { id: 'food-1', foodName: 'ข้าวสาร', foodCategory: 'วัตถุดิบ', foodAmount: 30 },
            { id: 'food-2', foodName: 'น้ำมันพืช', foodCategory: 'เครื่องปรุง', foodAmount: 40 },
        ], '#f59e0b'),
    ];
    const definition = api.buildPdfDocDefinition({
        header: { title: 'รายงานทดสอบ', attachmentCount: 2 }, signature: null,
        reportOptions: { pageOrientation: 'portrait' }, sections,
    });
    const normalized = value => JSON.stringify(value).replaceAll('\u00AD', '').replaceAll('\\n', '');
    const summaryTables = sections.map(section => definition.content.find(node => node.table
        && !node.pageBreak
        && normalized(node).includes(section.label)));

    assert.ok(summaryTables.every(Boolean));
    assert.equal(new Set(summaryTables).size, sections.length);
    assert.ok(summaryTables.every(table => table.table.body.every(row => row.length === table.table.widths.length)));
    assert.match(normalized(summaryTables[0]), /แก๊สหุงต้ม 15 กิโลกรัม/);
    assert.match(normalized(summaryTables[0]), /รายละเอียดร่วม: หมวดหมู่: อาหาร \| จำนวนหลักฐาน: 1 \| ประเภทเบิก: เบิกมูลนิธิ/);
    assert.match(normalized(summaryTables[1]), /ค่าไฟฟ้าประจำเดือน/);
    assert.match(normalized(summaryTables[2]), /วัสดุสำหรับโครงการฝึกอาชีพ/);
    assert.match(normalized(summaryTables[0]), /ยอดรวม 1 รายการ/);
    assert.match(normalized(summaryTables[1]), /ยอดรวม 1 รายการ/);
    assert.match(normalized(summaryTables[2]), /ยอดรวม 1 รายการ/);
    assert.match(normalized(summaryTables[3]), /2 รายการ/);
    assert.doesNotMatch(normalized(summaryTables[3]), /ข้าวสาร|น้ำมันพืช/);
    assert.equal(summaryTables[3].table.body.at(-1)[0].text, 'ยอดรวม');
    const billHeaders = summaryTables[0].table.body[1].map(cell => normalized(cell));
    assert.ok(billHeaders.findIndex(label => label.includes('หลักฐาน')) < billHeaders.findIndex(label => label.includes('ยอดรวม')));
    const foodHeaders = summaryTables[3].table.body[1].map(cell => normalized(cell));
    assert.ok(foodHeaders.findIndex(label => label.includes('หลักฐาน')) < foodHeaders.findIndex(label => label.includes('ยอดรวม')));

    const grandTotal = definition.content.find(node => node.table && normalized(node).includes('ยอดรวมสรุปรายการทั้งหมด'));
    assert.ok(grandTotal);
    assert.match(normalized(grandTotal), /2 หลักฐาน/);
    assert.match(normalized(grandTotal), /885\.00/);
});

test('attachment-only section keeps its heading with the first evidence page', () => {
    const api = createHarness();
    const definition = api.buildPdfDocDefinition({
        header: { title: 'รายงานทดสอบ', attachmentCount: 1 },
        signature: null,
        reportOptions: { pageOrientation: 'portrait' },
        sections: [{
            key: 'attach', label: 'บิลแนบ / ค่าสาธารณูปโภค', accent: '#2563eb',
            columns: [], rows: [], detailed: false, attachmentOnly: true,
            attachmentCount: 1, attachmentWarnings: [],
            attachmentItems: [{
                detail: [{ label: 'เลขบิล', value: 'ATT-001' }],
                images: [{ src: 'data:image/png;base64,evidence', caption: 'ใบเสร็จ' }],
                fileRefs: [], fileCount: 1,
            }],
        }]
    });
    const normalized = value => JSON.stringify(value).replaceAll('\u00AD', '');
    const sectionIndex = definition.content.findIndex(node => node.pageBreak === 'before' && node.table && normalized(node).includes('บิลแนบ / ค่าสาธารณูปโภค'));
    const evidenceIndex = definition.content.findIndex(node => node.stack && normalized(node).includes('หลักฐานใบเสร็จ - บิลแนบ / ค่าสาธารณูปโภค'));

    assert.ok(sectionIndex >= 0);
    assert.equal(evidenceIndex, sectionIndex + 1);
    assert.equal(definition.content[evidenceIndex].pageBreak, undefined);
    assert.equal(definition.content[evidenceIndex].unbreakable, true);
});

test('section-scoped signatures render after the selected report topic without reserving every page footer', () => {
    const api = createHarness();
    const defaultBottomMargin = 18 * (72 / 25.4);
    const definition = api.buildPdfDocDefinition({
        header: { title: 'รายงานทดสอบ', attachmentCount: 0 },
        signature: {
            signers: [{ role: 'prepared', name: 'สมชาย ใจดี', position: 'เจ้าหน้าที่การเงิน', label: 'ผู้จัดทำ', image: '' }],
            placements: { first: false, last: false, every: false },
            targets: [{ key: 'section:bills', type: 'section', sectionKey: 'bills', label: 'รายการบิลประจำเดือน' }],
        },
        reportOptions: { pageOrientation: 'portrait' },
        sections: [{
            key: 'bills', label: 'รายการบิลประจำเดือน', accent: '#059669',
            columns: [], rows: [], detailed: false, attachmentOnly: false,
            attachmentCount: 0, attachmentWarnings: [], attachmentItems: [],
        }],
    });
    const signatureBlock = definition.content.find(node => JSON.stringify(node).includes('การลงชื่อใต้เอกสาร - รายการบิลประจำเดือน'));

    assert.ok(signatureBlock);
    assert.match(JSON.stringify(signatureBlock), /\(สมชาย ใจดี\)/);
    assert.match(JSON.stringify(signatureBlock), /เจ้าหน้าที่การเงิน/);
    assert.ok(Math.abs(definition.pageMargins[3] - defaultBottomMargin) < 0.001);
});

test('custom report margins move repeated headers away from the page edge', () => {
    const api = createHarness();
    const definition = api.buildPdfDocDefinition({
        header: {
            title: 'รายงานทดสอบ', docNum: 'RDF-001', verifyCode: 'VERIFY',
            qrDataUrl: 'data:image/png;base64,qr', attachmentCount: 0,
        },
        signature: null,
        reportOptions: {
            pageOrientation: 'portrait',
            pageMarginsMm: { top: 30, bottom: 20, left: 12, right: 14 },
        },
        sections: [],
    });

    assert.ok(Math.abs(definition.pageMargins[0] - (12 * 72 / 25.4)) < 0.01);
    assert.ok(Math.abs(definition.pageMargins[1] - (30 * 72 / 25.4)) < 0.01);
    assert.ok(Math.abs(definition.pageMargins[2] - (14 * 72 / 25.4)) < 0.01);
    assert.ok(Math.abs(definition.pageMargins[3] - (20 * 72 / 25.4)) < 0.01);
    const repeatedHeader = definition.header(2, 3);
    assert.equal(repeatedHeader.margin[0], definition.pageMargins[0]);
    assert.equal(repeatedHeader.margin[2], definition.pageMargins[2]);
    assert.ok(repeatedHeader.margin[1] > 5);
});

test('Thai PDF wrapping inserts line breaks only between words', () => {
    const api = createHarness();
    const original = 'การคอมพิวเตอร์สำหรับสำนักงานและการศึกษา';
    const wrapped = api.wrapPdfTextByWords(original, 8);

    assert.equal(wrapped.replaceAll('\n', ''), original);
    assert.doesNotMatch(wrapped, /ก\nาร|คอมพิว\nเตอร์|สำนัก\nงาน/);
    assert.doesNotMatch(wrapped, /[\u00AD\u200B\u200C\u2060\uFEFF]/);
});

test('wide report tables move future columns to a full-width continuation row', () => {
    const api = createHarness();
    const columns = Array.from({ length: 11 }, (_, index) => ({
        id: `futureColumn${index + 1}`,
        label: index === 10 ? 'รายละเอียดรายการ' : `คอลัมน์ ${index + 1}`,
        align: 'left',
        get: row => row[`value${index + 1}`],
    }));
    const row = Object.fromEntries(columns.map((column, index) => [
        `value${index + 1}`,
        index === 10 ? 'การคอมพิวเตอร์สำหรับสำนักงาน' : `ข้อมูล ${index + 1}`,
    ]));
    const definition = api.buildPdfDocDefinition({
        header: { title: 'รายงานทดสอบ', attachmentCount: 0 },
        signature: null,
        reportOptions: { pageOrientation: 'portrait' },
        sections: [{
            key: 'future', label: 'หัวข้อในอนาคต', accent: '#2563eb', columns, rows: [row],
            detailed: false, attachmentOnly: false, attachmentCount: 0,
            attachmentWarnings: [], attachmentItems: [],
        }],
    });
    const reportTable = definition.content.find(node => node.table && node.table.widths?.length === 10 && JSON.stringify(node).includes('คอลัมน์ 1'));

    assert.ok(reportTable);
    assert.ok(reportTable.table.widths.every(width => typeof width === 'number'));
    const contentWidth = 595.28 - definition.pageMargins[0] - definition.pageMargins[2];
    const occupiedWidth = reportTable.table.widths.reduce((sum, width) => sum + width, 0) + (4 * reportTable.table.widths.length) + 2;
    assert.ok(occupiedWidth <= contentWidth + 0.01);
    const continuationRow = reportTable.table.body.find(tableRow => tableRow[0]?.colSpan === 10);
    assert.ok(continuationRow);
    assert.match(continuationRow[0].text, /รายละเอียดรายการ/);
    assert.doesNotMatch(continuationRow[0].text, /คอมพิว\nเตอร์/);
});

test('monthly bill report keeps the requested business column order and balanced widths', () => {
    const api = createHarness();
    const orderedIds = Array.from(api.EXPORT_BILL_COLUMNS, column => column.id);
    assert.deepEqual(orderedIds, [
        'sequence', 'docNo', 'date', 'receiptNo', 'postingMonth', 'vendor',
        'description', 'project', 'category', 'attachmentsCount', 'amount', 'claimType',
    ]);
    assert.equal(api.getExportColumnValue(api.EXPORT_BILL_COLUMNS[0], {}, 0), 1);
    assert.equal(api.getExportColumnValue(api.EXPORT_BILL_COLUMNS[0], {}, 7), 8);

    const split = api.splitPdfTableColumns(api.EXPORT_BILL_COLUMNS, 'portrait');
    assert.deepEqual(Array.from(split.primary, column => column.id), [
        'sequence', 'docNo', 'date', 'receiptNo', 'postingMonth',
        'vendor', 'description', 'project', 'attachmentsCount', 'amount',
    ]);
    const widths = api.getPdfTableColumnWidths(split.primary, 500);
    const descriptionWidth = widths[split.primary.findIndex(column => column.id === 'description')];
    const ordinaryWidths = widths.filter((_, index) => split.primary[index].id !== 'description');
    assert.ok(descriptionWidth > Math.max(...ordinaryWidths));
    assert.ok(widths.every(width => Number.isFinite(width) && width > 0));
    assert.ok(widths.reduce((sum, width) => sum + width, 0) + (split.primary.length * 4) + 2 <= 500.001);
});

test('bill tables show evidence before amount and collapse identical metadata below the last item', () => {
    const api = createHarness();
    const baseRows = [
        {
            id: 'bill-1', docNo: 'VCSEP26_1', date: '2026-09-22', receiptNo: '026/1299',
            postingMonth: '2026-09', vendor: 'ธนาพาณิชย์', description: 'แก๊สหุงต้ม 15 กิโลกรัม',
            project: 'ปกติ', category: 'อาหาร', attachmentsCount: 1, amount: 515, claimType: 'เบิกมูลนิธิ',
        },
        {
            id: 'bill-2', docNo: 'VCSEP26_2', date: '2026-09-23', receiptNo: '026/1300',
            postingMonth: '2026-09', vendor: 'ธนาพาณิชย์', description: 'แก๊สหุงต้ม 15 กิโลกรัม',
            project: 'ปกติ', category: 'อาหาร', attachmentsCount: 1, amount: 515, claimType: 'เบิกมูลนิธิ',
        },
    ];
    const buildTable = rows => {
        const definition = api.buildPdfDocDefinition({
            header: { title: 'รายงานทดสอบ', attachmentCount: 0 }, signature: null,
            reportOptions: { pageOrientation: 'portrait' },
            sections: [{
                key: 'bills', label: 'รายการบิลประจำเดือน', accent: '#059669',
                columns: Array.from(api.EXPORT_BILL_COLUMNS), rows, detailed: true,
                attachmentOnly: false,
                attachmentCount: rows.reduce((sum, row) => sum + row.attachmentsCount, 0),
                attachmentWarnings: [], attachmentItems: [],
            }],
        });
        return definition.content.find(node => node.table?.headerRows === 1
            && node.table.widths?.length === 10
            && JSON.stringify(node).includes('VCSEP26_1'));
    };
    const normalized = value => JSON.stringify(value).replaceAll('\u00AD', '').replaceAll('\\n', '');
    const sharedTable = buildTable(baseRows);
    assert.ok(sharedTable);
    assert.ok(sharedTable.table.body.every(row => row.length === sharedTable.table.widths.length));
    const headers = sharedTable.table.body[0].map(cell => normalized(cell));
    const evidenceIndex = headers.findIndex(label => label.includes('หลักฐาน'));
    const amountIndex = headers.findIndex(label => label.includes('ยอดรวม'));
    assert.ok(evidenceIndex >= 0 && evidenceIndex < amountIndex);
    const sharedNotes = sharedTable.table.body.filter(row => normalized(row).includes('รายละเอียดร่วม:'));
    const itemNotes = sharedTable.table.body.filter(row => normalized(row).includes('รายละเอียดรายการที่'));
    assert.equal(sharedNotes.length, 1);
    assert.equal(itemNotes.length, 0);
    assert.match(normalized(sharedNotes[0]), /หมวดหมู่: อาหาร \| จำนวนหลักฐาน: 1 \| ประเภทเบิก: เบิกมูลนิธิ/);
    assert.equal(sharedTable.table.body.at(-1)[evidenceIndex].text, '2');
    assert.equal(sharedTable.table.body.at(-1)[amountIndex].text, '1,030.00');

    const variedRows = baseRows.map(row => ({ ...row }));
    variedRows[1].category = 'สาธารณูปโภค';
    variedRows[1].attachmentsCount = 2;
    variedRows[1].claimType = 'ไม่เบิกมูลนิธิ';
    const variedTable = buildTable(variedRows);
    assert.ok(variedTable);
    assert.equal(variedTable.table.body.filter(row => normalized(row).includes('รายละเอียดร่วม:')).length, 0);
    assert.equal(variedTable.table.body.filter(row => normalized(row).includes('รายละเอียดรายการที่')).length, 2);
});

test('report rows sort naturally by bill and receipt number with sequence fallback', () => {
    const api = createHarness();
    const rows = [
        { sequence: 3, docNo: 'VCSEP26_10', receiptNo: '026/1300' },
        { sequence: 2, docNo: 'VCSEP26_2', receiptNo: '026/1272' },
        { sequence: 1, docNo: 'OFSEP26_1', receiptNo: '026/1200' },
    ];

    const byBill = api.sortExportRows([...rows], 'bills', 'docNo', 'asc');
    assert.deepEqual(Array.from(byBill, row => row.docNo), ['OFSEP26_1', 'VCSEP26_2', 'VCSEP26_10']);

    const bySequence = api.sortExportRows([...rows], 'bills', 'sequence', 'asc');
    assert.deepEqual(Array.from(bySequence, row => row.sequence), [1, 2, 3]);
});
