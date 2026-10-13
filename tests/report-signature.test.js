const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'backend', 'SignatureService.gs'), 'utf8');
const verifyBackend = fs.readFileSync(path.join(root, 'backend', 'VerifyService.gs'), 'utf8');
const reportArchiveBackend = verifyBackend;

test('exported PDF archives reuse QR codes and preserve password-confirmed versions', () => {
    assert.match(html, /id="btn-export-pdf-primary"/);
    assert.match(html, /id="btn-export-new-version"[^>]+confirmCreateNewExportArchive\(\)/);
    assert.match(html, /id="btn-export-share"[^>]+shareCurrentExportArchive\(\)/);
    assert.match(html, /id="btn-export-history"[^>]+showExportArchiveHistory\(\)/);
    assert.match(app, /status === 'saved' && archived\.fileUrl/);
    assert.match(app, /reserveReportArchive/);
    assert.match(app, /saveReportArchiveFile/);
    assert.match(app, /passwordHash: await sha256/);
    assert.match(app, /allowCreateVerifyCode: false/);
    assert.match(reportArchiveBackend, /if \(!forceNew && current\)/);
    assert.match(reportArchiveBackend, /user\.password_hash/);
    assert.match(reportArchiveBackend, /index\.versions\.push\(metadata\)/);
    assert.match(reportArchiveBackend, /report_archive_token_/);
    assert.doesNotMatch(reportArchiveBackend, /setSharing\(DriveApp\.Access\.ANYONE_WITH_LINK/);
});

test('report signing UI supports reusable signatures, separate identity fields, and additional signers', () => {
    for (const role of ['prepared', 'checked', 'approved']) {
        assert.match(html, new RegExp(`pdf-${role === 'prepared' ? 'preparer' : role === 'checked' ? 'reviewer' : 'approver'}-signature-select`));
        assert.match(html, new RegExp(`openSignatureModal\\('${role}'\\)`));
        assert.match(html, new RegExp(`handleSignatureUpload\\('${role}'`));
    }
    for (const field of ['pdf-preparer-position', 'pdf-reviewer-position', 'pdf-approver-position']) {
        assert.match(html, new RegExp(`id="${field}"`));
    }
    for (const field of ['pdf-preparer-role-label', 'pdf-reviewer-role-label', 'pdf-approver-role-label']) {
        assert.match(html, new RegExp(`id="${field}"`));
    }
    assert.match(html, /id="pdf-add-signer"[^>]+onclick="addExportSigner\(\)"/);
    assert.match(app, /signatureLibrary/);
    assert.match(app, /getSignatureDataUrl/);
    assert.match(app, /signature\.preparerImage/);
    assert.match(app, /registerImage\(signer\.image\)/);
    assert.match(app, /const MAX_EXPORT_SIGNERS = 9/);
    assert.match(app, /function addExportSigner/);
    assert.match(app, /function applyExportSignerRows/);
});

test('signature placement supports first and last together while every-page is exclusive', () => {
    for (const field of ['pdf-signature-first-page', 'pdf-signature-last-page', 'pdf-signature-every-page']) {
        assert.match(html, new RegExp(`id="${field}"`));
    }
    assert.match(app, /function handleSignaturePlacementChange/);
    assert.match(app, /if \(every\.checked\) \{[\s\S]*first\.checked = false;[\s\S]*last\.checked = false;/);
    assert.match(app, /if \(signaturePlacements\.every\) return true;/);
    assert.match(app, /signaturePlacements\.first && currentPage === 1/);
    assert.match(app, /signaturePlacements\.last && currentPage === pageCount/);
    assert.match(app, /syncExportSignatureTargetAvailability\(\)/);
});

test('signature settings can target registered report sections and projects found in the report month', () => {
    assert.match(html, /id="pdf-signature-section-options"/);
    assert.match(html, /4\.4 ลงนามใต้หัวข้อรายการหลัก/);
    assert.match(app, /function getExportSignatureTargetDefinitions/);
    assert.match(app, /getExportSectionDefinitions\(\)\.map\(section =>/);
    assert.match(app, /function getExportSignatureProjectTargets/);
    assert.match(app, /key: `project:\$\{projectId\}`/);
    assert.match(app, /โครงการเพิ่มเติม \/ โครงการที่มีรายการในเดือนรายงาน/);
    assert.match(app, /effectiveSignatureTargets[\s\S]*\.filter\(target => target && target\.sectionKey === section\.key\)[\s\S]*\.forEach\(appendSectionSignature\)/);
    assert.match(app, /if \(everyPage \|\| !sectionEnabled\) input\.checked = false/);
});

test('PDF signature footer groups three signers per row and right aligns an incomplete row', () => {
    assert.match(app, /for \(let index = 0; index < signatureAssets\.length; index \+= 3\)/);
    assert.match(app, /const leadingBlanks = chunk\.length < 3/);
    assert.match(app, /leadingBlanks\.concat\(chunk\.map\(buildSignatureBlock\)\)/);
    assert.match(app, /`\(\$\{String\(signer\.name/);
    assert.match(app, /String\(signer\.position/);
    assert.match(app, /String\(signer\.label/);
    assert.match(app, /signatureFooterHeight/);
});

test('report templates retain signature people and page placement', () => {
    assert.match(app, /placements: getExportSignaturePlacements\(\)/);
    assert.match(app, /targets: getExportSignatureTargets\(\)\.map\(target => target\.key\)/);
    assert.match(app, /signers: getExportSignerRows\(\)\.map/);
    assert.match(app, /if \(Array\.isArray\(t\.signature\.signers\)\) applyExportSignerRows/);
    assert.match(app, /applyExportSignatureTargets\(t\.signature\.targets \|\| \[\]\)/);
});

test('report attachment failures remain visible and attachment count is exportable', () => {
    assert.match(app, /attachmentWarnings/);
    assert.match(app, /หลักฐานแนบโหลดไม่สำเร็จ/);
    assert.match(app, /id: 'attachmentsCount'/);
    assert.match(app, /data-export-column-section=[\s\S]*value="\$\{escapeHTML\(column\.id\)\}"/);
    assert.match(app, /attachmentCount: sections\.reduce/);
    assert.match(app, /หลักฐาน \$\{Number\(header\.attachmentCount\) \|\| 0\} ไฟล์/);
    assert.match(verifyBackend, /attachmentCount: Number\(attachmentCount\) \|\| 0/);
});

test('reports include receipt evidence after every selected section by default', () => {
    assert.match(html, /value="with_attachments" selected>รายงานพร้อมหลักฐานแนบ \(ค่าเริ่มต้น\)/);
    assert.match(html, /รายงานแบบสรุป \(ไม่แทรกหลักฐาน\)/);
    assert.match(app, /row\.attachmentsCount = \(attachmentStore\[row\.id\] \|\| \[\]\)\.length/);
    assert.match(app, /text: wrapPdfTextByWords\(`หลักฐานใบเสร็จ - \$\{section\.label\}`/);
    assert.match(app, /const firstEvidenceImageFit = \[contentWidth - 8,/);
    assert.match(app, /text: description/);
    assert.match(app, /pageBreak: 'before'/);
    assert.match(app, /dontBreakRows: true/);
    assert.match(app, /text: 'สรุปรายการทั้งหมด'/);
    assert.match(app, /preservePdfText: true/);
    assert.match(app, /currentPage === 1 \|\| !qrImageKey/);
    assert.match(app, /image: qrImageKey, width: 28, height: 28/);
    assert.match(html, /<option value="docNo" selected>เลขบิล \/ ใบเสร็จ<\/option>/);
    assert.match(html, /<option value="sequence">ลำดับรายการ<\/option>/);
});

test('report columns include item details and future sections use one registry', () => {
    assert.match(html, /id="export-section-options"/);
    assert.match(app, /class="export-section-column[\s\S]*data-export-column-section/);
    assert.match(app, /id: 'description', label: 'รายละเอียดรายการ'/);
    assert.match(app, /description: x\.description \|\| x\.detail \|\| ''/);
    assert.match(app, /const EXPORT_REPORT_SECTIONS = \[/);
    assert.match(app, /function registerExportReportSection/);
    assert.match(app, /window\.registerExportReportSection = registerExportReportSection/);
    assert.match(app, /function renderExportSectionControls/);
    assert.match(app, /sectionState: getExportSectionState\(\)/);
    assert.match(app, /const specs = getExportSectionDefinitions\(\)\.map/);
    assert.match(app, /getExportSectionDefinitions\(\)[\s\S]*getExportSectionRows\(section\.key\)/);
});

test('report page margins are configurable and persist in preview templates', () => {
    for (const side of ['top', 'bottom', 'left', 'right']) {
        assert.match(html, new RegExp(`id="export-margin-${side}"`));
    }
    assert.match(app, /DEFAULT_EXPORT_PAGE_MARGINS_MM = Object\.freeze\(\{ top: 22, bottom: 18, left: 16, right: 16 \}\)/);
    assert.match(app, /pageMarginsMm: getExportPageMarginsMm\(\)/);
    assert.match(app, /pageMargins: pageMargins/);
    assert.match(app, /margin: \[pageMargins\[0\], repeatedHeaderTop, pageMargins\[2\], 0\]/);
    assert.match(app, /EXPORT_PAGE_MARGIN_STORAGE_KEY/);
    assert.match(app, /if \(t\.pageMarginsMm\) setExportPageMarginInputs\(t\.pageMarginsMm, true\)/);
});

test('report preview exposes live evidence and PDF progress', () => {
    assert.match(html, /id="export-preview-progress"[^>]+role="progressbar"/);
    assert.match(html, /id="export-preview-progress-bar"/);
    assert.match(html, /id="export-preview-progress-stage"/);
    assert.match(html, /id="export-preview-progress-count"/);
    assert.match(app, /function updateExportPreviewProgress/);
    assert.match(app, /กำลังโหลดรายการหลักฐาน/);
    assert.match(app, /กำลังประมวลผลรูปหลักฐาน/);
    assert.match(app, /notifyProgress\(completed, missing\.length\)/);
    assert.match(app, /notifyProgress\(completedImages, imageJobs\.length\)/);
});

test('report preview timeout scales with uncached evidence instead of stopping at 45 seconds', () => {
    assert.match(app, /function getExportPreviewCollectionTimeoutMs/);
    assert.match(app, /Math\.min\(300000, Math\.max\(90000,/);
    assert.match(app, /collectionTimeoutMs = getExportPreviewCollectionTimeoutMs\(\)/);
    assert.doesNotMatch(app, /buildReportModel\(\), 45000/);
    assert.match(app, /controller\.abort\(\), 20000/);
});

test('evidence layout settings support report defaults, per-section overrides, and a live A4 sample', () => {
    for (const id of [
        'export-evidence-orientation',
        'export-evidence-items-per-page',
        'export-evidence-placement',
        'export-evidence-layout-preview',
    ]) assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, /ทดลองเลือกรูปแบบจัดวางหลักฐาน/);
    assert.match(html, /หลักฐานที่ 1/);
    assert.match(html, /หลักฐานที่ 2/);
    assert.match(app, /function normalizeExportEvidenceLayout/);
    assert.match(app, /function getExportSectionEvidenceLayout/);
    assert.match(app, /data-export-evidence-mode/);
    assert.match(app, /evidenceLayout: getExportEvidenceLayoutState\(\)/);
    assert.match(app, /evidenceLayout: getExportEvidenceLayoutState\(\),[\s\S]*sortBy/);
    assert.match(app, /pageOrientation: sectionEvidenceLayout\.orientation/);
    assert.match(app, /columns: group\.map\(card =>/);
    assert.match(style, /\.export-layout-preview\[data-orientation="landscape"\]/);
    assert.match(style, /\.export-layout-preview\[data-items="2"\]\[data-placement="horizontal"\]/);
    assert.match(style, /\.export-evidence-layout-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(style, /\.export-section-card-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(style, /\.export-section-card-header\s*\{[\s\S]*?flex-direction:\s*column/);
});

test('backend signature storage validates images and uses Drive metadata', () => {
    assert.match(backend, /MAX_BYTES: 2 \* 1024 \* 1024/);
    assert.match(backend, /Utilities\.base64Decode/);
    assert.match(backend, /DriveApp\.getFolderById/);
    assert.match(backend, /sha256_hash/);
    assert.match(backend, /getDataUrl\(data, authCtx\)/);
});
