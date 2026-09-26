const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'backend', 'SignatureService.gs'), 'utf8');

test('report signing UI supports blank, drawn, and uploaded signatures for all roles', () => {
    for (const role of ['prepared', 'checked', 'approved']) {
        assert.match(html, new RegExp(`pdf-${role === 'prepared' ? 'preparer' : role === 'checked' ? 'reviewer' : 'approver'}-signature-select`));
        assert.match(html, new RegExp(`openSignatureModal\\('${role}'\\)`));
        assert.match(html, new RegExp(`handleSignatureUpload\\('${role}'`));
    }
    assert.match(app, /signatureLibrary/);
    assert.match(app, /getSignatureDataUrl/);
    assert.match(app, /signature\.preparerImage/);
    assert.match(app, /registerImage\(image\)/);
});

test('report attachment failures remain visible and attachment count is exportable', () => {
    assert.match(app, /attachmentWarnings/);
    assert.match(app, /หลักฐานแนบโหลดไม่สำเร็จ/);
    assert.match(app, /id: 'attachmentsCount'/);
    assert.match(html, /value="attachmentsCount"/);
});

test('backend signature storage validates images and uses Drive metadata', () => {
    assert.match(backend, /MAX_BYTES: 2 \* 1024 \* 1024/);
    assert.match(backend, /Utilities\.base64Decode/);
    assert.match(backend, /DriveApp\.getFolderById/);
    assert.match(backend, /sha256_hash/);
    assert.match(backend, /getDataUrl\(data, authCtx\)/);
});
