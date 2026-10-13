// ============================================================
// SystemService.gs — บริการสำหรับการจัดการค่ากำหนดระบบ
// ============================================================

const SystemService = {
  getConfigValue(key, fallback) {
    const row = SheetHelper.findRow(SHEETS.SYSTEM_CONFIG, 'key', key);
    return row && row.value !== undefined && row.value !== '' ? row.value : fallback;
  },

  getMaxAttachmentMb() {
    const value = this.getConfigValue(
      'max_upload_size_mb',
      this.getConfigValue('max_attachment_mb', CONFIG.MAX_ATTACHMENT_MB)
    );
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : CONFIG.MAX_ATTACHMENT_MB;
  },

  getDriveFolderId() {
    return this.getConfigValue('drive_folder_id', CONFIG.DRIVE_FOLDER_ID);
  },

  getDocumentPrefix() {
    return this.getConfigValue(
      'document_prefix',
      this.getConfigValue('doc_prefix', CONFIG.DOC_PREFIX)
    );
  },

  getTokenExpiryHours() {
    const parsed = Number(this.getConfigValue('token_expiry_hours', CONFIG.TOKEN_EXPIRY_HOURS));
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 24 ? parsed : CONFIG.TOKEN_EXPIRY_HOURS;
  },

  getRuntimeConfig(authCtx) {
    return respond(true, {
      maxUploadSizeMb: this.getMaxAttachmentMb(),
      requireAttachment: this.getConfigValue('require_attachment', 'false') === 'true',
      dateFormat: this.getConfigValue('date_format', 'MMM_DD_YYYY'),
      // Frontend จะ retry คำสั่งเขียนก็ต่อเมื่อ backend ประกาศค่านี้เท่านั้น
      // deployment รุ่นเก่าที่ไม่มี idempotency จึงไม่สร้างข้อมูลซ้ำเมื่อ timeout
      idempotencySupported: true,
    });
  },

  // ดึงค่าตั้งค่าที่ปลอดภัยให้เช็คได้ก่อน login (ไม่ต้อง authCtx) — คืนเฉพาะฟิลด์ที่จำเป็นสำหรับปุ่ม Google Sign-In เท่านั้น
  getPublicConfig() {
    const rows = SheetHelper.getAllRows(SHEETS.SYSTEM_CONFIG);
    const config = {};
    rows.forEach(r => {
      config[r.key] = r.value;
    });
    const camelConfig = SheetHelper.toCamel(config);
    return respond(true, {
      googleLoginEnabled: camelConfig.googleLoginEnabled || 'false',
      googleOauthClientId: camelConfig.googleOauthClientId || ''
    });
  },

  // ดึงการตั้งค่าของระบบ
  getConfig(authCtx) {
    const rows = SheetHelper.getAllRows(SHEETS.SYSTEM_CONFIG);
    const config = {};
    rows.forEach(r => {
      config[r.key] = r.value;
    });

    // กำหนดค่า Default หากไม่มีข้อมูลในชีต
    if (!config.document_prefix && !config.doc_prefix) config.document_prefix = CONFIG.DOC_PREFIX;
    if (!config.public_export_verify_enabled) config.public_export_verify_enabled = 'false';
    if (!config.date_format) config.date_format = 'MMM_DD_YYYY';

    return respond(true, { config: SheetHelper.toCamel(config) });
  },

  // อัปเดตการตั้งค่าระบบ
  updateConfig(data, authCtx) {
    const configData = data || {};
    const now = new Date().toISOString();

    for (const [key, value] of Object.entries(configData)) {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      const normalized = this.normalizeConfigValue(snakeKey, value);
      if (!normalized.ok) {
        return respond(false, null, ERROR.VALIDATION_ERROR, normalized.message);
      }
      const existing = SheetHelper.findRow(SHEETS.SYSTEM_CONFIG, 'key', snakeKey);
      
      if (existing) {
        SheetHelper.updateRow(SHEETS.SYSTEM_CONFIG, 'key', snakeKey, {
          value: normalized.value,
          updatedAt: now,
          updatedBy: authCtx.userId
        });
      } else {
        SheetHelper.appendRow(SHEETS.SYSTEM_CONFIG, {
          key: snakeKey,
          value: normalized.value,
          updatedAt: now,
          updatedBy: authCtx.userId
        });
      }
    }

    // ล้างแคชที่เกี่ยวข้องกับ Master Data เผื่อว่าคอนฟิกมีผลต่อการสร้าง ID หรือ prefix
    try {
      const cache = CacheService.getScriptCache();
      cache.remove(`masterData_${authCtx.organizationId}`);
    } catch (e) {}

    // ล้างแคช Permission Matrix ให้มีผลทันทีถ้ามีการบันทึกสิทธิ์ใหม่
    if (configData.permissionMatrix) {
      try { CacheService.getScriptCache().remove('permission_overrides'); } catch (e) {}
    }

    AuditService.log('UPDATE_SYSTEM_CONFIG', SHEETS.SYSTEM_CONFIG, 'global', null, configData, authCtx);

    return respond(true, { message: 'อัปเดตการตั้งค่าระบบเรียบร้อยแล้ว' });
  },

  normalizeConfigValue(key, value) {
    const stringValue = String(value === undefined || value === null ? '' : value).trim();
    const booleanKeys = ['require_attachment', 'google_login_enabled', 'signature_required', 'public_export_verify_enabled'];
    if (booleanKeys.includes(key)) {
      return {
        ok: true,
        value: value === true || stringValue.toLowerCase() === 'true' ? 'true' : 'false'
      };
    }

    if (key === 'max_upload_size_mb' || key === 'max_attachment_mb') {
      const parsed = Number(stringValue);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
        return { ok: false, message: 'ขนาดไฟล์แนบสูงสุดต้องอยู่ระหว่าง 1-20 MB' };
      }
      return { ok: true, value: String(parsed) };
    }

    if (key === 'token_expiry_hours') {
      const parsed = Number(stringValue);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24) {
        return { ok: false, message: 'อายุ Session Token ต้องเป็นจำนวนเต็ม 1-24 ชั่วโมง' };
      }
      return { ok: true, value: String(parsed) };
    }

    if (key === 'fiscal_year_start') {
      if (!['1', '4', '10'].includes(stringValue)) {
        return { ok: false, message: 'เดือนเริ่มต้นปีงบประมาณไม่ถูกต้อง' };
      }
      return { ok: true, value: stringValue };
    }

    if (key === 'default_currency') {
      const currency = stringValue.toUpperCase();
      if (!['THB', 'USD', 'EUR'].includes(currency)) {
        return { ok: false, message: 'สกุลเงินหลักไม่ถูกต้อง' };
      }
      return { ok: true, value: currency };
    }

    if (key === 'date_format') {
      const allowedFormats = ['MMM_DD_YYYY', 'DD_MMM_YYYY', 'YYYY_MMM_DD', 'MMM_DD_BBBB'];
      const format = stringValue.toUpperCase();
      if (!allowedFormats.includes(format)) {
        return { ok: false, message: 'รูปแบบวันที่ไม่ถูกต้อง' };
      }
      return { ok: true, value: format };
    }

    if (key === 'document_prefix' || key === 'doc_prefix') {
      const prefix = stringValue.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (!prefix || prefix.length > 12) {
        return { ok: false, message: 'รหัสนำหน้าเลขเอกสารต้องมี 1-12 ตัวอักษร และใช้ได้เฉพาะ A-Z, 0-9, _ หรือ -' };
      }
      return { ok: true, value: prefix };
    }

    return { ok: true, value: stringValue };
  },
};
