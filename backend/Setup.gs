// ============================================================
// Setup.gs — ออนบอร์ดสเปรดชีตและการเตรียมระบบฐานข้อมูล
// ============================================================

function initDatabase() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  Logger.log('เริ่มการทำงาน: ปรับโครงสร้างชีตฐานข้อมูล');
  
  // นิยามสเปรดชีตและคอลัมน์ของแต่ละชีต
  const sheetSchemas = {
    'organizations': [
      'id', 'name_th', 'name_en', 'short_name', 'address_th', 'address_en', 'phone', 'director_name', 'logo_url', 'active', 'created_at'
    ],
    'projects': [
      'id', 'organization_id', 'project_name', 'project_name_en', 'budget', 'start_date', 'end_date', 'fiscal_year', 'active', 'created_at'
    ],
    'fund_sources': [
      'id', 'organization_id', 'name', 'description', 'active'
    ],
    'categories': [
      'id', 'category_name', 'category_name_en', 'sort_order', 'active'
    ],
    'vendors': [
      'id', 'vendor_name', 'vendor_name_en', 'address', 'phone', 'tax_id', 'bank_name', 'bank_account', 'active'
    ],
    'expenses': [
      'id', 'document_no', 'document_prefix', 'expense_date', 'organization_id', 'project_id', 'fund_source_id', 'category_id', 'vendor_id', 'description', 'quantity', 'unit', 'unit_price', 'vat_amount', 'amount', 'total_amount', 'claimable', 'status', 'claim_id', 'note', 'created_by', 'created_at', 'updated_by', 'updated_at', 'posting_month', 'receipt_no', 'request_id'
    ],
    'attachments': [
      'id', 'expense_id', 'drive_file_id', 'file_name', 'original_file_name', 'file_type', 'file_size', 'compressed_size', 'sha256_hash', 'file_url', 'thumbnail_url', 'uploaded_by', 'uploaded_at'
    ],
    'audit_logs': [
      'id', 'user_id', 'ip_address', 'action', 'record_id', 'before_data', 'after_data', 'timestamp'
    ],
    'food_expenses': [
      'id', 'document_no', 'organization_id', 'month', 'year', 'dormitory', 'responsible_person', 'note', 'total_amount', 'created_by', 'created_at', 'status', 'request_id'
    ],
    'food_expense_items': [
      'id', 'food_expense_id', 'item_no', 'expense_date', 'ingredient_name', 'quantity', 'unit', 'unit_price', 'total_price', 'has_attachment', 'created_at'
    ],
    'food_expense_attachments': [
      'id', 'food_expense_item_id', 'drive_file_id', 'original_file_name', 'stored_file_name', 'mime_type', 'file_size', 'compressed_size', 'sha256_hash', 'file_url', 'thumbnail_url', 'uploaded_by', 'uploaded_at'
    ],
    'fund_receipts': [
      'id', 'month', 'organization_id', 'amount', 'drive_file_id', 'file_name', 'file_url', 'mime_type', 'note', 'created_by', 'created_at', 'updated_by', 'updated_at', 'verify_code'
    ],
    'claims': [
      'id', 'claim_month', 'organization_id', 'title', 'total_amount', 'item_count', 'status', 'submitted_date', 'submitted_by', 'approved_date', 'approved_by', 'rejected_date', 'rejected_by', 'reject_reason', 'paid_date', 'remark', 'created_by', 'created_at', 'updated_at', 'verify_code'
    ],
    'claim_items': [
      'id', 'claim_id', 'expense_id', 'amount', 'added_by', 'added_at'
    ],
    'reimbursements': [
      'id', 'claim_id', 'received_date', 'amount', 'reference_no', 'note', 'created_by', 'created_at'
    ],
    'users': [
      'id', 'username', 'password_hash', 'full_name', 'full_name_en', 'role', 'organization_id', 'email', 'phone', 'active', 'last_login', 'created_at', 'updated_at'
    ],
    'sessions': [
      'token', 'user_id', 'expires_at', 'created_at', 'is_revoked'
    ],
    'signatures': [
      'id', 'user_id', 'claim_id', 'role_in_doc', 'drive_file_id', 'file_name', 'mime_type', 'sha256_hash', 'signature_url', 'source', 'signed_at', 'signed_by'
    ],
    'monthly_ledger': [
      'id', 'month', 'organization_id', 'opening_balance', 'total_expense', 'claimable_amount', 'non_claimable_amount', 'submitted_amount', 'reimbursed_amount', 'outstanding_amount', 'closing_balance', 'is_locked', 'locked_at', 'locked_by', 'updated_at'
    ],
    'system_config': [
      'key', 'value', 'description', 'updated_at', 'updated_by'
    ],
    'sequence_counters': [
      'key', 'last_seq', 'updated_at'
    ]
  };

  // วนลูปตรวจสอบและสร้างชีต
  for (let sheetName in sheetSchemas) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`สร้างชีตใหม่: ${sheetName}`);
      sheet = ss.insertSheet(sheetName);
    }
    
    // ตั้งค่า Header (เขียนบรรทัดแรก)
    const headers = sheetSchemas[sheetName];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // ตรึงแถวแรก (Freeze row 1)
    if (sheet.getFrozenRows() === 0) {
      sheet.setFrozenRows(1);
    }
    
    // กำหนดรูปแบบตัวหนาให้แก่ Header
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  
  Logger.log('จัดเรียงโครงสร้างตารางเสร็จสิ้น -> ทำการเติมข้อมูลเริ่มต้น (Initial Seeding)');
  
  // 1. เพิ่มข้อมูลหน่วยงานเริ่มต้น (organizations)
  const orgSheet = ss.getSheetByName('organizations');
  if (orgSheet.getLastRow() <= 1) {
    const createdAt = new Date().toISOString();
    const defaultOrganizations = [
      ['ORG001', 'วิทยาลัยการอาชีพแม่สะเรียง', 'Mae Sariang Vocational College', 'VC', 'ต.บ้านกาศ อ.แม่สะเรียง จ.แม่ฮ่องสอน', 'Mae Sariang, Mae Hong Son', '', '', '', true, createdAt],
      ['ORG002', 'โรงเรียนแม่สะเรียงบริพัตร์', 'Mae Sariang Boriphat School', 'MBS', 'อ.แม่สะเรียง จ.แม่ฮ่องสอน', 'Mae Sariang, Mae Hong Son', '', '', '', true, createdAt],
      ['ORG003', 'สำนักงาน', 'Office', 'OFFICE', 'อ.แม่สะเรียง จ.แม่ฮ่องสอน', 'Mae Sariang, Mae Hong Son', '', '', '', true, createdAt]
    ];
    defaultOrganizations.forEach(row => orgSheet.appendRow(row));
    Logger.log('เพิ่มข้อมูล organizations เริ่มต้นแล้ว');
  }

  // 2. เพิ่มหมวดหมู่รายจ่ายเริ่มต้น (categories)
  const catSheet = ss.getSheetByName('categories');
  if (catSheet.getLastRow() <= 1) {
    const defaultCategories = [
      ['CAT001', 'อาหาร', 'Food', 1, true],
      ['CAT002', 'วัสดุ', 'Supplies', 2, true],
      ['CAT003', 'ค่าไฟฟ้า', 'Electricity', 3, true],
      ['CAT004', 'ค่าน้ำประปา', 'Water', 4, true],
      ['CAT005', 'เชื้อเพลิง', 'Fuel', 5, true],
      ['CAT006', 'ค่าซ่อมบำรุง', 'Maintenance', 6, true],
      ['CAT007', 'ค่าเดินทาง', 'Travel', 7, true],
      ['CAT008', 'กิจกรรม', 'Activity', 8, true],
      ['CAT009', 'ครุภัณฑ์', 'Equipment', 9, true],
      ['CAT010', 'อื่นๆ', 'Others', 10, true]
    ];
    defaultCategories.forEach(row => catSheet.appendRow(row));
    Logger.log('เพิ่มข้อมูล categories เริ่มต้นแล้ว');
  }

  // 3. เพิ่มคอนฟิกเริ่มต้น (system_config)
  const configSheet = ss.getSheetByName('system_config');
  if (configSheet.getLastRow() <= 1) {
    const defaultConfigs = [
      ['document_prefix', 'VC', 'Prefix สำหรับรหัสเลขเอกสารรายงาน', new Date().toISOString(), 'system'],
      ['fiscal_year_start', '10', 'เดือนเริ่มต้นของปีงบประมาณ (ตุลาคมคือ 10)', new Date().toISOString(), 'system'],
      ['default_currency', 'THB', 'สกุลเงินหลักของระบบ', new Date().toISOString(), 'system'],
      ['max_attachment_mb', '10', 'ขนาดไฟล์อัปโหลดสูงสุดหน่วย MB', new Date().toISOString(), 'system'],
      ['require_attachment', 'true', 'กำหนดให้บังคับแนบรูปใบเสร็จ', new Date().toISOString(), 'system'],
      ['public_export_verify_enabled', 'false', 'เปิดให้ QR รายงานส่งออกแสดงข้อมูลสรุปสาธารณะก่อนเข้าสู่ระบบ', new Date().toISOString(), 'system'],
      ['min_attachment_count', '1', 'จำนวนไฟล์แนบขั้นต่ำต่อหนึ่งบิล', new Date().toISOString(), 'system'],
      ['signature_required', 'true', 'ต้องมีลายเซ็นผู้จัดทำผู้ตรวจสอบจึงส่งออก PDF ได้', new Date().toISOString(), 'system'],
      ['schema_version', '2', 'เวอร์ชันโครงสร้างฐานข้อมูล', new Date().toISOString(), 'system'],
      ['token_expiry_hours', '8', 'อายุ Session Token หน่วยเป็นชั่วโมง', new Date().toISOString(), 'system']
    ];
    defaultConfigs.forEach(row => configSheet.appendRow(row));
    Logger.log('เพิ่มข้อมูล system_config เริ่มต้นแล้ว');
  }

  // 4. เพิ่มผู้ใช้งานเริ่มต้น (users)
  const userSheet = ss.getSheetByName('users');
  if (userSheet.getLastRow() <= 1) {
    const temporaryPassword = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    const passwordHash = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      temporaryPassword,
      Utilities.Charset.UTF_8
    ).map(byte => (byte & 0xff).toString(16).padStart(2, '0')).join('');
    userSheet.appendRow([
      'USR001',
      'admin',
      passwordHash,
      'ผู้ดูแลระบบ',
      'System Administrator',
      'admin',
      'ORG001',
      'admin@rdf.org',
      '',
      true,
      '',
      new Date().toISOString()
    ]);
    Logger.log('เพิ่มข้อมูลผู้ใช้เริ่มต้น (admin) เรียบร้อย — รหัสผ่านชั่วคราว: ' + temporaryPassword);
  }

  // 5. เพิ่มการทำดัชนีรหัสเอกสารเริ่มต้น (sequence_counters)
  const seqSheet = ss.getSheetByName('sequence_counters');
  if (seqSheet.getLastRow() <= 1) {
    const defaultSeqs = [
      ['expense_id', 0, new Date().toISOString()],
      ['claim_id', 0, new Date().toISOString()],
      ['attachment_id', 0, new Date().toISOString()],
      ['reimbursement_id', 0, new Date().toISOString()],
      ['project_id', 0, new Date().toISOString()],
      ['vendor_id', 0, new Date().toISOString()],
      // เริ่มที่ 1 ไม่ใช่ 0 เพราะ admin ที่ seed ไว้ด้านบนถูกฮาร์ดโค้ดเป็น USR001 ไปแล้ว
      // ถ้าเริ่มที่ 0 ผู้ใช้คนแรกที่สร้างผ่านหน้าเว็บจะได้ id USR001 ชนกับ admin ตัวจริง
      ['user_id', 1, new Date().toISOString()],
      // เหตุผลเดียวกัน — ORG001 ถูกฮาร์ดโค้ดไว้แล้วด้านบน (ข้อ 1), ถ้าเริ่มนับที่ 0 องค์กรแรกที่สร้างผ่านหน้าเว็บ (createOrganization) จะได้ id ORG001 ชนของจริง
      ['organization_id', 3, new Date().toISOString()]
    ];
    defaultSeqs.forEach(row => seqSheet.appendRow(row));
    Logger.log('เพิ่มข้อมูล sequence_counters เริ่มต้นแล้ว');
  }

  // 6. เพิ่มข้อมูลโครงการเริ่มต้น (projects)
  const projSheet = ss.getSheetByName('projects');
  if (projSheet.getLastRow() <= 1) {
    projSheet.appendRow([
      'PJ001', 
      'ORG001', 
      'ค่าซ่อมแซมหอพัก', 
      'Dormitory Repair Project', 
      0, 
      '', 
      '', 
      2569, 
      true, 
      new Date().toISOString()
    ]);
    Logger.log('เพิ่มข้อมูล projects เริ่มต้นแล้ว');
  }

  // 7. เพิ่มข้อมูลแหล่งเงินเริ่มต้น (fund_sources)
  const fsSheet = ss.getSheetByName('fund_sources');
  if (fsSheet.getLastRow() <= 1) {
    fsSheet.appendRow(['FS001', 'ORG001', 'เงินสะสมหอพัก', 'เงินสะสมสำหรับใช้ซ่อมแซมหอพัก', true]);
    fsSheet.appendRow(['FS002', 'ORG001', 'เงินสำรองจ่าย(เงินเก็บนักเรียน)', 'เงินสำรองสำหรับรองจ่าย', true]);
    Logger.log('เพิ่มข้อมูล fund_sources เริ่มต้นแล้ว');
  }

  Logger.log('เสร็จสิ้นการตั้งค่าฐานข้อมูล! พร้อมใช้งานระบบ');
}

// ============================================================
// Migration: จัดตั้งขอบเขตข้อมูล 3 สถาบัน (รันซ้ำได้อย่างปลอดภัย)
// ข้อมูลเดิมยังคงอยู่ที่ ORG001/VC และไม่มีการลบองค์กรอื่น
// ============================================================
function setupInstitutionAccessModel() {
  const definitions = [
    { id: 'ORG001', nameTh: 'วิทยาลัยการอาชีพแม่สะเรียง', nameEn: 'Mae Sariang Vocational College', shortName: 'VC' },
    { id: 'ORG002', nameTh: 'โรงเรียนแม่สะเรียงบริพัตร์', nameEn: 'Mae Sariang Boriphat School', shortName: 'MBS' },
    { id: 'ORG003', nameTh: 'สำนักงาน', nameEn: 'Office', shortName: 'OFFICE' }
  ];
  const now = new Date().toISOString();

  definitions.forEach(definition => {
    const existing = SheetHelper.findRow(SHEETS.ORGANIZATIONS, 'id', definition.id);
    if (existing) {
      SheetHelper.updateRow(SHEETS.ORGANIZATIONS, 'id', definition.id, {
        nameTh: definition.nameTh,
        nameEn: definition.nameEn,
        shortName: definition.shortName,
        active: true
      });
    } else {
      SheetHelper.appendRow(SHEETS.ORGANIZATIONS, {
        ...definition,
        addressTh: 'อ.แม่สะเรียง จ.แม่ฮ่องสอน',
        addressEn: 'Mae Sariang, Mae Hong Son',
        phone: '', directorName: '', logoUrl: '', active: true, createdAt: now
      });
    }
  });

  const sequence = SheetHelper.findRow(SHEETS.SEQUENCE_COUNTERS, 'key', 'organization_id');
  if (sequence) {
    SheetHelper.updateRow(SHEETS.SEQUENCE_COUNTERS, 'key', 'organization_id', {
      lastSeq: Math.max(3, Number(sequence.last_seq) || 0),
      updatedAt: now
    });
  } else {
    SheetHelper.appendRow(SHEETS.SEQUENCE_COUNTERS, { key: 'organization_id', lastSeq: 3, updatedAt: now });
  }

  const prefix = SheetHelper.findRow(SHEETS.SYSTEM_CONFIG, 'key', 'document_prefix');
  if (prefix && String(prefix.value || '').toUpperCase() === 'MIS') {
    SheetHelper.updateRow(SHEETS.SYSTEM_CONFIG, 'key', 'document_prefix', { value: 'VC', updatedAt: now });
  }
  try {
    const cache = CacheService.getScriptCache();
    ['ORG001', 'ORG002', 'ORG003', 'ALL'].forEach(id => cache.remove('masterData_' + id));
  } catch (error) {
    Logger.log('ล้างแคชข้อมูลสถาบันไม่สำเร็จ: ' + error.message);
  }
  Logger.log('ตั้งค่าสถาบัน VC, MBS และ OFFICE เรียบร้อย ข้อมูลเดิมยังอยู่ใน ORG001');
  return definitions;
}

// ============================================================
// Repair: แก้รหัสองค์กร/สถานที่ซ้ำจาก deployment รุ่นเก่า
// - ไม่ลบแถวและไม่ลบเอกสารเดิม
// - แถวที่ id ซ้ำแต่เป็นคนละสถานที่จะได้รับ ORG ใหม่
// - แถวที่ชื่อ+รหัสย่อซ้ำกันจากการกด/ส่งซ้ำ จะถูกปิดใช้งาน เหลือรายการแรก
// - อัปเดต sequence counter ให้สูงกว่ารหัสที่ใช้งานจริง
// รันจาก Apps Script editor หนึ่งครั้งหลัง deploy รุ่นล่าสุด
// ============================================================
function repairOrganizationRegistry() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = SheetHelper.getSheet(SHEETS.ORGANIZATIONS);
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow < 2) return { changed: 0, changes: [] };

    const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    const headers = values[0];
    const idIndex = headers.indexOf('id');
    const nameIndex = headers.indexOf('name_th');
    const shortNameIndex = headers.indexOf('short_name');
    const activeIndex = headers.indexOf('active');
    if ([idIndex, nameIndex, shortNameIndex, activeIndex].some(index => index < 0)) {
      throw new Error('โครงสร้างชีต organizations ไม่ครบ กรุณารัน setupDatabase() ก่อน');
    }

    const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizeCode = value => String(value || '').trim().toUpperCase();
    const usedIds = new Set();
    const seenRecords = new Map();
    const changes = [];
    let maxSequence = 3;

    values.slice(1).forEach(row => {
      const match = /^ORG(\d+)$/i.exec(String(row[idIndex] || '').trim());
      if (match) maxSequence = Math.max(maxSequence, Number(match[1]) || 0);
    });

    const allocateId = () => {
      let id = '';
      do {
        maxSequence += 1;
        id = 'ORG' + String(maxSequence).padStart(3, '0');
      } while (usedIds.has(id));
      return id;
    };

    for (let index = 1; index < values.length; index++) {
      const row = values[index];
      const sheetRow = index + 1;
      const originalId = String(row[idIndex] || '').trim().toUpperCase();
      const recordKey = `${normalizeCode(row[shortNameIndex])}|${normalize(row[nameIndex])}`;
      const firstRecordRow = seenRecords.get(recordKey);
      let nextId = originalId;

      if (!/^ORG\d+$/i.test(nextId) || usedIds.has(nextId)) nextId = allocateId();
      usedIds.add(nextId);
      if (nextId !== originalId) {
        sheet.getRange(sheetRow, idIndex + 1).setValue(nextId);
        changes.push({ row: sheetRow, field: 'id', from: originalId, to: nextId });
      }

      if (recordKey !== '|' && firstRecordRow) {
        sheet.getRange(sheetRow, activeIndex + 1).setValue(false);
        changes.push({ row: sheetRow, field: 'active', from: row[activeIndex], to: false, duplicateOfRow: firstRecordRow });
      } else if (recordKey !== '|') {
        seenRecords.set(recordKey, sheetRow);
      }
    }

    const now = new Date().toISOString();
    const sequence = SheetHelper.findRow(SHEETS.SEQUENCE_COUNTERS, 'key', 'organization_id');
    if (sequence) {
      SheetHelper.updateRow(SHEETS.SEQUENCE_COUNTERS, 'key', 'organization_id', {
        lastSeq: Math.max(maxSequence, Number(sequence.last_seq) || 0),
        updatedAt: now
      });
    } else {
      SheetHelper.appendRow(SHEETS.SEQUENCE_COUNTERS, { key: 'organization_id', lastSeq: maxSequence, updatedAt: now });
    }

    try {
      const cache = CacheService.getScriptCache();
      cache.remove('masterData_ALL');
      cache.remove('masterData_ORG001');
      cache.remove('masterData_ORG002');
      cache.remove('masterData_ORG003');
    } catch (cacheError) {
      Logger.log('ล้างแคชหลังซ่อม organizations ไม่สำเร็จ: ' + cacheError.message);
    }

    Logger.log('repairOrganizationRegistry: ' + JSON.stringify(changes));
    return { changed: changes.length, changes };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// Migration: เพิ่มคอลัมน์ organization_id ให้ food_expenses + ย้ายคีย์สถานะรายเดือน
// ให้ผูกกับองค์กร — รันครั้งเดียวจาก Apps Script editor "ก่อน" เพิ่มสถานศึกษาที่ 2
// ============================================================
function migrateAddOrgToFoodExpenses() {
  const orgs = SheetHelper.getAllRows(SHEETS.ORGANIZATIONS);
  if (orgs.length !== 1) {
    throw new Error('พบ ' + orgs.length + ' องค์กรในระบบ — ฟังก์ชันนี้ออกแบบให้รันครั้งเดียวตอนที่ยังมีองค์กรเดียวเท่านั้น (ก่อนเพิ่มสถานศึกษาที่ 2)');
  }
  const defaultOrgId = orgs[0].id;

  // 1. เพิ่มคอลัมน์ organization_id ให้ food_expenses แล้ว backfill แถวเดิมทั้งหมด
  const sheet = SheetHelper.getSheet(SHEETS.FOOD_EXPENSES);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('organization_id') === -1) {
    sheet.getRange(1, headers.length + 1).setValue('organization_id');
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const col = headers.length + 1;
      const values = Array(lastRow - 1).fill([defaultOrgId]);
      sheet.getRange(2, col, values.length, 1).setValues(values);
    }
    Logger.log('เพิ่มคอลัมน์ organization_id ให้ food_expenses และ backfill เป็น ' + defaultOrgId + ' แล้ว');
  } else {
    Logger.log('food_expenses มีคอลัมน์ organization_id อยู่แล้ว ข้ามขั้นตอนนี้');
  }

  // 2. ย้ายคีย์ system_config รูปแบบเดิม month_status_YYYY-MM ให้เป็น month_status_{orgId}_YYYY-MM
  const rows = SheetHelper.getAllRows(SHEETS.SYSTEM_CONFIG);
  let renamed = 0;
  rows.forEach(r => {
    const key = String(r.key || '');
    if (key.indexOf('month_status_') === 0 && key.split('_').length === 3) {
      // รูปแบบเดิม: month_status_YYYY-MM (3 ท่อนคั่นด้วย _ เท่านั้น ยังไม่มี org คั่นกลาง)
      const monthPart = key.replace('month_status_', '');
      SheetHelper.updateRow(SHEETS.SYSTEM_CONFIG, 'key', key, {
        key: 'month_status_' + defaultOrgId + '_' + monthPart
      });
      renamed++;
    }
  });

  Logger.log('Migration เสร็จสิ้น: food_expenses ผูกกับ ' + defaultOrgId + ' แล้ว, ย้ายคีย์ month_status ' + renamed + ' รายการ');
}

// ============================================================
// Migration: แยก "วันที่บิล" ออกจาก "รอบเดือนที่บันทึก"
// เพิ่ม posting_month ต่อท้ายชีต expenses และเติมข้อมูลเก่าจาก expense_date
// รันซ้ำได้อย่างปลอดภัย
// ============================================================
function migrateAddPostingMonthToExpenses() {
  const sheet = SheetHelper.getSheet(SHEETS.EXPENSES);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const expenseDateIndex = headers.indexOf('expense_date');
  if (expenseDateIndex === -1) throw new Error('ไม่พบคอลัมน์ expense_date ในชีต expenses');

  let postingMonthIndex = headers.indexOf('posting_month');
  if (postingMonthIndex === -1) {
    postingMonthIndex = headers.length;
    sheet.getRange(1, postingMonthIndex + 1).setValue('posting_month').setFontWeight('bold');
  }

  if (lastRow < 2) {
    Logger.log('เพิ่มคอลัมน์ posting_month แล้ว (ยังไม่มีข้อมูลเดิมให้ย้าย)');
    return;
  }

  const rowCount = lastRow - 1;
  const dateValues = sheet.getRange(2, expenseDateIndex + 1, rowCount, 1).getValues();
  const postingValues = sheet.getRange(2, postingMonthIndex + 1, rowCount, 1).getDisplayValues();
  let updated = 0;
  const merged = postingValues.map((row, index) => {
    const existing = String(row[0] || '').trim();
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(existing)) return [existing];
    const rawDate = dateValues[index][0];
    let fallback = '';
    if (rawDate instanceof Date && !isNaN(rawDate.getTime())) {
      fallback = Utilities.formatDate(rawDate, 'Asia/Bangkok', 'yyyy-MM');
    } else {
      const match = String(rawDate || '').trim().match(/^(\d{4})-(0[1-9]|1[0-2])/);
      fallback = match ? `${match[1]}-${match[2]}` : '';
    }
    if (fallback) updated++;
    return [fallback];
  });
  sheet.getRange(2, postingMonthIndex + 1, rowCount, 1).setValues(merged);
  Logger.log('Migration posting_month เสร็จสิ้น — เติมข้อมูลเดิม ' + updated + ' รายการ');
}

// ============================================================
// Migration: เพิ่มเลขที่ใบเสร็จโดยต่อคอลัมน์ท้ายชีต expenses
// ปลอดภัยกับข้อมูลเดิมและสามารถรันซ้ำได้
// ============================================================
function migrateAddReceiptNoToExpenses() {
  const sheet = SheetHelper.getSheet(SHEETS.EXPENSES);
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (headers.indexOf('receipt_no') !== -1) {
    Logger.log('คอลัมน์ receipt_no มีอยู่แล้ว');
    return false;
  }
  sheet.getRange(1, lastColumn + 1).setValue('receipt_no').setFontWeight('bold');
  Logger.log('เพิ่มคอลัมน์ receipt_no ในชีต expenses แล้ว');
  return true;
}

// Adds the idempotency key used by createExpense. Safe to run repeatedly;
// createExpense also performs this migration lazily for older installations.
function migrateAddRequestIdToExpenses() {
  const sheet = SheetHelper.getSheet(SHEETS.EXPENSES);
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (headers.indexOf('request_id') !== -1) {
    Logger.log('คอลัมน์ request_id มีอยู่แล้ว');
    return false;
  }
  sheet.getRange(1, lastColumn + 1).setValue('request_id').setFontWeight('bold');
  Logger.log('เพิ่มคอลัมน์ request_id ในชีต expenses แล้ว');
  return true;
}

// Run this once from the Apps Script editor as the deployment owner after
// adding Drive support or changing OAuth scopes. The editor will show the
// Google authorization dialog and this function verifies the configured IDs.
function authorizeRequiredServices() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const folderId = SystemService.getDriveFolderId();
  const folder = DriveApp.getFolderById(folderId);
  const result = {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    driveFolderId: folder.getId(),
    driveFolderName: folder.getName(),
    checkedAt: new Date().toISOString()
  };
  Logger.log(JSON.stringify(result));
  return result;
}
