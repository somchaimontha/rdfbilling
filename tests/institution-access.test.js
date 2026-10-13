const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(root, 'backend', 'Config.gs'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'backend', 'Auth.gs'), 'utf8');
const fundReceipts = fs.readFileSync(path.join(root, 'backend', 'FundReceiptService.gs'), 'utf8');
const masterData = fs.readFileSync(path.join(root, 'backend', 'MasterDataService.gs'), 'utf8');
const setup = fs.readFileSync(path.join(root, 'backend', 'Setup.gs'), 'utf8');
const users = fs.readFileSync(path.join(root, 'backend', 'UserService.gs'), 'utf8');

test('institution context exposes VC, MBS, and OFFICE and is locked for non-admin users', () => {
    assert.match(html, /id="active-organization-select"/);
    assert.match(app, /VC:\s*'VC'/);
    assert.match(app, /MBS:\s*'MBS'/);
    assert.match(app, /OFFICE:\s*'OFFICE'/);
    assert.match(app, /select\.disabled = !isAdminUser\(user\)/);
    assert.match(app, /rdf_active_organization_/);
});

test('all recording workflows carry the selected institution', () => {
    assert.match(app, /const inlineOrganizationId = isAdminUser\(inlineUser\)/);
    assert.match(app, /organizationId: isAdminUser\(currentUser\)[\s\S]*?getActiveOrganizationId\(\)/);
    assert.match(app, /const payload = \{ month, amount, note, organizationId \}/);
    assert.match(app, /organizationId: orgId,[\s\S]*?projectId: projectId/);
    assert.match(fundReceipts, /Auth\.resolveOrgId\(authCtx, data && data\.organizationId\)/);
    assert.match(masterData, /Auth\.resolveOrgId\(authCtx, data\.organizationId\)/);
});

test('user management assigns one institution while admin retains global access', () => {
    assert.match(html, /สถาบันที่กำลังบันทึก/);
    assert.match(app, /class="form-select user-recording-organization"/);
    assert.match(app, /changeUserRecordingOrganization/);
    assert.match(app, /เข้าถึงทุกสถาบัน · ค่านี้เป็นค่าเริ่มต้น/);
    assert.match(app, /ยืนยันเปลี่ยนสถาบันของผู้ใช้/);
    assert.match(app, /กรุณาเลือกสถาบันที่กำลังบันทึก/);
    assert.match(users, /\['admin', 'manager', 'staff', 'viewer'\]/);
    assert.match(users, /สถาบันที่รับผิดชอบไม่ถูกต้องหรือถูกปิดใช้งาน/);
    assert.match(config, /deleteExpense:\s*\['admin', 'manager'\]/);
    assert.match(config, /createExpense:\s*\['admin', 'manager', 'staff'\]/);
    assert.match(config, /getExpenses:\s*\['admin', 'manager', 'staff', 'viewer'\]/);
    assert.match(config, /getUsers:\s*\['admin'\]/);
});

test('new users always receive an institution and secure password validation', () => {
    assert.match(html, /id="admin-user-org-wrap" style="margin-top:14px;"/);
    assert.match(app, /if \(!orgs\.length\) \{[\s\S]*?ไม่พบสถาบันที่เปิดใช้งาน/);
    assert.doesNotMatch(app, /if \(orgs\.length <= 1\)[\s\S]*?wrap\.style\.display = 'none'/);
    assert.match(html, /id="admin-user-password-confirm"/);
    assert.match(html, /minlength="12" maxlength="128"/);
    assert.match(app, /function evaluatePasswordPolicy/);
    assert.match(app, /COMMON_PASSWORDS/);
    assert.match(app, /รหัสผ่านยังไม่ผ่านเงื่อนไขความปลอดภัย/);
    assert.match(users, /รูปแบบรหัสผ่านที่เข้ารหัสไม่ถูกต้อง/);
});

test('Google login email is validated and remains admin-provisioned', () => {
    assert.match(html, /อีเมล \(สำหรับ Google Login\)/);
    assert.match(html, /Google Workspace/);
    assert.match(app, /function validateAdminUserEmail/);
    assert.match(users, /_findEmailOwner/);
    assert.match(users, /อีเมลนี้ถูกผูกกับผู้ใช้งานอื่นแล้ว/);
    assert.match(app, /ไม่มีการสมัครสมาชิกอัตโนมัติ|ไม่มีการสมัครสมาชิกอัตโนมัติ/);
    assert.match(auth, /google_login_enabled/);
    assert.match(auth, /email_verified/);
    assert.match(auth, /info\.aud !== expectedAud/);
});

test('institution migration is repeatable and preserves legacy data in VC', () => {
    assert.match(setup, /function setupInstitutionAccessModel\(\)/);
    assert.match(setup, /ORG001[\s\S]*?วิทยาลัยการอาชีพแม่สะเรียง[\s\S]*?'VC'/);
    assert.match(setup, /ORG002[\s\S]*?โรงเรียนแม่สะเรียงบริพัตร์[\s\S]*?'MBS'/);
    assert.match(setup, /ORG003[\s\S]*?สำนักงาน[\s\S]*?'OFFICE'/);
    assert.match(setup, /ข้อมูลเดิมยังอยู่ใน ORG001/);
    assert.match(masterData, /masterData_ALL/);
});

test('institution and location management uses one shared registry across the system', () => {
    assert.match(html, /data-settings-tab="organizations"/);
    assert.match(html, /id="settings-panel-organizations"/);
    assert.match(html, /จัดการสถาบัน \/ สถานที่/);
    assert.match(html, /id="organization-sync-status"/);
    assert.equal((html.match(/id="master-organizations-table"/g) || []).length, 1);
    assert.match(app, /function applyMasterDataToState/);
    assert.match(app, /async function refreshOrganizationsAcrossSystem/);
    assert.match(app, /rebuildOrganizationFilter\('summary-org-filter'/);
    assert.match(app, /rebuildOrganizationFilter\('export-org-filter'/);
    assert.match(app, /setupAdminUserOrgSelect\(currentSelection\)/);
    assert.match(app, /if \(adminUserList\.length\) renderUserManagementRows\(\)/);
});

test('institution registry prevents duplicate codes and unsafe deactivation', () => {
    assert.match(masterData, /_findDuplicateOrganization/);
    assert.match(masterData, /\^\[A-Z0-9_-\]\{2,12\}\$/);
    assert.match(masterData, /SheetHelper\.findRows\(SHEETS\.USERS/);
    assert.match(masterData, /กรุณาย้ายผู้ใช้ก่อนปิดใช้งาน/);
    assert.match(masterData, /activeOrganizations\.length <= 1/);
    assert.match(masterData, /ไม่สามารถปิดสถาบัน \/ สถานที่สุดท้ายของระบบได้/);
    assert.match(masterData, /while \(SheetHelper\.findRow\(SHEETS\.ORGANIZATIONS, 'id', id\)\)/);
    assert.match(masterData, /existing:\s*true/);
    assert.match(setup, /function repairOrganizationRegistry\(\)/);
    assert.match(setup, /duplicateOfRow/);
    assert.match(setup, /lastSeq:\s*Math\.max\(maxSequence/);
});

test('institution form prevents invalid native patterns and repeated submissions', () => {
    assert.doesNotMatch(app, /pattern="\[A-Za-z0-9_-\]\{2,12\}"/);
    assert.match(app, /let masterSaveInFlight = false/);
    assert.match(app, /if \(masterSaveInFlight\) return false/);
    assert.match(app, /saveButton\.disabled = true/);
    assert.match(app, /switchSettingsTab\('organizations'\)/);
    assert.match(app, /idx === null && !apiIdempotencySupported/);
    assert.match(app, /ยังไม่ส่งข้อมูล: Apps Script ที่เชื่อมต่อเป็นรุ่นเก่า/);
});

test('institution sync bypasses Apps Script cache after direct Sheet edits', () => {
    assert.match(app, /apiCall\('getMasterData', \{ forceRefresh: true \}\)/);
    assert.match(app, /master\.masterDataFresh !== true/);
    assert.match(app, /organizationSyncInFlight/);
    assert.match(app, /tabKey === 'organizations'/);
    assert.match(masterData, /getAll\(authCtx, options\)/);
    assert.match(masterData, /options && options\.forceRefresh === true/);
    assert.match(masterData, /cache\.removeAll/);
    assert.match(masterData, /masterDataFresh:\s*forceRefresh/);
    assert.match(fs.readFileSync(path.join(root, 'backend', 'Code.gs'), 'utf8'), /MasterDataService\.getAll\(authCtx, requestData\)/);
});
