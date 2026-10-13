// ============================================================
// MasterDataService.gs — Master Data (ดึงครั้งเดียวทั้งหมด)
// ============================================================

const MasterDataService = {

  getAll(authCtx, options) {
    // ใช้ CacheService เพื่อลดการอ่าน Sheet ซ้ำ
    const cache = CacheService.getScriptCache();
    const isAdmin = authCtx.role === 'admin';
    const cacheKey = isAdmin ? 'masterData_ALL' : `masterData_${authCtx.organizationId}`;
    const forceRefresh = !!(options && options.forceRefresh === true);

    // การแก้ Google Sheet โดยตรงจะไม่ผ่าน service ที่ล้าง cache ตามปกติ
    // ปุ่มซิงก์ของ Admin จึงล้าง cache ทุกองค์กรแล้วอ่าน Sheet จริงทันที
    if (forceRefresh) {
      const keys = [cacheKey];
      if (isAdmin) {
        keys.push('masterData_ALL');
        SheetHelper.getAllRows(SHEETS.ORGANIZATIONS).forEach(row => {
          if (row.id) keys.push(`masterData_${row.id}`);
        });
      }
      cache.removeAll([...new Set(keys)]);
    }

    const cached = forceRefresh ? null : cache.get(cacheKey);

    if (cached) {
      return ContentService.createTextOutput(cached)
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = {
      organizations: SheetHelper.toCamelArray(
        SheetHelper.findRows(SHEETS.ORGANIZATIONS, r => this._isActive(r))
      ),
      projects: SheetHelper.toCamelArray(
        SheetHelper.findRows(SHEETS.PROJECTS, r =>
          this._isActive(r) && (isAdmin || r.organization_id === authCtx.organizationId))
      ),
      fundSources: SheetHelper.toCamelArray(
        SheetHelper.findRows(SHEETS.FUND_SOURCES, r =>
          this._isActive(r) && (isAdmin || r.organization_id === authCtx.organizationId))
      ),
      categories: SheetHelper.toCamelArray(
        SheetHelper.findRows(SHEETS.CATEGORIES, r => this._isActive(r))
          .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
      ),
      vendors: SheetHelper.toCamelArray(
        SheetHelper.findRows(SHEETS.VENDORS, r => this._isActive(r))
      ),
      masterDataFresh: forceRefresh,
      masterDataReadAt: new Date().toISOString(),
    };

    const result = JSON.stringify({ success: true, data });
    cache.put(cacheKey, result, CONFIG.MASTER_DATA_CACHE_TTL);
    return ContentService.createTextOutput(result)
      .setMimeType(ContentService.MimeType.JSON);
  },

  createProject(data, authCtx) {
    if (!data.projectName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อโครงการ');
    const organizationId = Auth.resolveOrgId(authCtx, data.organizationId);
    const id = 'PJ' + String(SheetHelper.nextSequence('project_id')).padStart(3, '0');
    SheetHelper.appendRow(SHEETS.PROJECTS, {
      id, organizationId,
      projectName: data.projectName, budget: data.budget || 0,
      active: true, createdAt: new Date().toISOString(),
    });
    
    // เคลียร์แคช
    this.clearCache(organizationId);

    return respond(true, { id });
  },

  createVendor(data, authCtx) {
    if (!data.vendorName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อผู้ขาย');
    const existing = this._findActiveByName(SHEETS.VENDORS, 'vendor_name', data.vendorName);
    if (existing) return respond(true, { id: existing.id, existing: true });
    const id = 'VEN' + String(SheetHelper.nextSequence('vendor_id')).padStart(3, '0');
    SheetHelper.appendRow(SHEETS.VENDORS, {
      id, vendorName: data.vendorName, phone: data.phone || '',
      taxId: data.taxId || '', active: true,
    });
    
    // เคลียร์แคช
    this.clearCache(authCtx.organizationId);

    return respond(true, { id });
  },

  createFundSource(data, authCtx) {
    if (!data.fundSourceName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อแหล่งทุน');
    const organizationId = Auth.resolveOrgId(authCtx, data.organizationId);
    const existing = this._findActiveByName(SHEETS.FUND_SOURCES, 'name', data.fundSourceName, organizationId);
    if (existing) return respond(true, { id: existing.id, existing: true });
    const id = 'FS' + String(SheetHelper.nextSequence('fund_source_id')).padStart(3, '0');
    SheetHelper.appendRow(SHEETS.FUND_SOURCES, {
      id, organizationId, name: data.fundSourceName, active: true,
    });

    // เคลียร์แคช
    this.clearCache(organizationId);

    return respond(true, { id });
  },

  createOrganization(data, authCtx) {
    if (!data.nameTh) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อสถาบัน / สถานที่');
    if (!data.shortName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุรหัสย่อ (ใช้ขึ้นต้นเลขที่เอกสาร)');
    const shortName = this._normalizeOrganizationCode(data.shortName);
    if (!/^[A-Z0-9_-]{2,12}$/.test(shortName)) {
      return respond(false, null, ERROR.VALIDATION_ERROR, 'รหัสย่อต้องเป็น A-Z, 0-9, ขีดกลาง หรือขีดล่าง จำนวน 2-12 ตัว');
    }
    const duplicate = this._findDuplicateOrganization(data.nameTh, shortName);
    if (duplicate) {
      const sameName = this._normalizeName(duplicate.name_th) === this._normalizeName(data.nameTh);
      const sameCode = this._normalizeOrganizationCode(duplicate.short_name) === shortName;
      if (sameName && sameCode) {
        // การกดซ้ำหรือ response ครั้งแรกหาย: คืนรายการเดิมแทนการเพิ่มแถวใหม่
        return respond(true, { id: duplicate.id, existing: true });
      }
      return respond(false, null, ERROR.VALIDATION_ERROR,
        `ชื่อหรือรหัสย่อซ้ำกับสถาบัน / สถานที่ ${duplicate.name_th || duplicate.id}`);
    }
    // รองรับฐานข้อมูลเก่าที่ sequence counter ยังไม่ถูกเลื่อนตาม ORG001-ORG003
    // โดยข้าม id ที่มีอยู่จริงเสมอ ป้องกัน primary key ซ้ำถาวร
    let id = '';
    do {
      id = 'ORG' + String(SheetHelper.nextSequence('organization_id')).padStart(3, '0');
    } while (SheetHelper.findRow(SHEETS.ORGANIZATIONS, 'id', id));
    SheetHelper.appendRow(SHEETS.ORGANIZATIONS, {
      id, nameTh: String(data.nameTh).trim(), nameEn: data.nameEn || '', shortName,
      addressTh: data.addressTh || '', phone: data.phone || '', directorName: data.directorName || '',
      logoUrl: '', active: true, createdAt: new Date().toISOString(),
    });

    // เคลียร์แคช
    this.clearCache(authCtx.organizationId);

    return respond(true, { id });
  },

  createCategory(data, authCtx) {
    if (!data.categoryName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อหมวดหมู่');
    const existing = this._findActiveByName(SHEETS.CATEGORIES, 'category_name', data.categoryName);
    if (existing) return respond(true, { id: existing.id, existing: true });
    const id = 'CAT' + String(SheetHelper.nextSequence('category_id')).padStart(3, '0');
    SheetHelper.appendRow(SHEETS.CATEGORIES, {
      id, categoryName: data.categoryName, active: true, sortOrder: data.sortOrder || 99,
    });
    
    // เคลียร์แคช
    this.clearCache(authCtx.organizationId);

    return respond(true, { id });
  },

  updateProject(data, authCtx) {
    const row = this._requireOwnedRow(SHEETS.PROJECTS, data.id, authCtx);
    if (!row) return respond(false, null, ERROR.NOT_FOUND);
    if (!data.projectName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อโครงการ');
    const updates = {
      projectName: data.projectName,
      budget: data.budget || 0,
    };
    SheetHelper.updateRow(SHEETS.PROJECTS, 'id', data.id, updates);
    this.clearCache(row.organization_id || authCtx.organizationId);
    AuditService.log('UPDATE', SHEETS.PROJECTS, data.id, row, updates, authCtx);
    return respond(true, { id: data.id, updated: true });
  },

  disableProject(data, authCtx) {
    return this._disableOwned(SHEETS.PROJECTS, data.id, authCtx);
  },

  updateVendor(data, authCtx) {
    const row = SheetHelper.findRow(SHEETS.VENDORS, 'id', data.id);
    if (!row) return respond(false, null, ERROR.NOT_FOUND);
    if (!data.vendorName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อผู้ขาย');
    const updates = {
      vendorName: data.vendorName,
      phone: data.phone || '',
      taxId: data.taxId || row.tax_id || '',
    };
    SheetHelper.updateRow(SHEETS.VENDORS, 'id', data.id, updates);
    this.clearCache(authCtx.organizationId);
    AuditService.log('UPDATE', SHEETS.VENDORS, data.id, row, updates, authCtx);
    return respond(true, { id: data.id, updated: true });
  },

  disableVendor(data, authCtx) {
    return this._disableGlobal(SHEETS.VENDORS, data.id, authCtx);
  },

  updateFundSource(data, authCtx) {
    const row = this._requireOwnedRow(SHEETS.FUND_SOURCES, data.id, authCtx);
    if (!row) return respond(false, null, ERROR.NOT_FOUND);
    if (!data.fundSourceName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อแหล่งเงิน');
    const updates = {
      name: data.fundSourceName,
      description: data.description || row.description || '',
    };
    SheetHelper.updateRow(SHEETS.FUND_SOURCES, 'id', data.id, updates);
    this.clearCache(row.organization_id || authCtx.organizationId);
    AuditService.log('UPDATE', SHEETS.FUND_SOURCES, data.id, row, updates, authCtx);
    return respond(true, { id: data.id, updated: true });
  },

  disableFundSource(data, authCtx) {
    return this._disableOwned(SHEETS.FUND_SOURCES, data.id, authCtx);
  },

  updateCategory(data, authCtx) {
    const row = SheetHelper.findRow(SHEETS.CATEGORIES, 'id', data.id);
    if (!row) return respond(false, null, ERROR.NOT_FOUND);
    if (!data.categoryName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อหมวดหมู่');
    const updates = {
      categoryName: data.categoryName,
      sortOrder: data.sortOrder || row.sort_order || 99,
    };
    SheetHelper.updateRow(SHEETS.CATEGORIES, 'id', data.id, updates);
    this.clearCache(authCtx.organizationId);
    AuditService.log('UPDATE', SHEETS.CATEGORIES, data.id, row, updates, authCtx);
    return respond(true, { id: data.id, updated: true });
  },

  disableCategory(data, authCtx) {
    return this._disableGlobal(SHEETS.CATEGORIES, data.id, authCtx);
  },

  updateOrganization(data, authCtx) {
    const row = SheetHelper.findRow(SHEETS.ORGANIZATIONS, 'id', data.id);
    if (!row) return respond(false, null, ERROR.NOT_FOUND);
    if (!data.nameTh) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุชื่อสถาบัน / สถานที่');
    if (!data.shortName) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุรหัสย่อ');
    const shortName = this._normalizeOrganizationCode(data.shortName);
    if (!/^[A-Z0-9_-]{2,12}$/.test(shortName)) {
      return respond(false, null, ERROR.VALIDATION_ERROR, 'รหัสย่อต้องเป็น A-Z, 0-9, ขีดกลาง หรือขีดล่าง จำนวน 2-12 ตัว');
    }
    const duplicate = this._findDuplicateOrganization(data.nameTh, shortName, data.id);
    if (duplicate) {
      return respond(false, null, ERROR.VALIDATION_ERROR,
        `ชื่อหรือรหัสย่อซ้ำกับสถาบัน / สถานที่ ${duplicate.name_th || duplicate.id}`);
    }
    const updates = {
      nameTh: String(data.nameTh).trim(),
      shortName,
      addressTh: data.addressTh || '',
      phone: data.phone || '',
      directorName: data.directorName || '',
    };
    SheetHelper.updateRow(SHEETS.ORGANIZATIONS, 'id', data.id, updates);
    this.clearCache(data.id);
    this.clearCache(authCtx.organizationId);
    AuditService.log('UPDATE', SHEETS.ORGANIZATIONS, data.id, row, updates, authCtx);
    return respond(true, { id: data.id, updated: true });
  },

  disableOrganization(data, authCtx) {
    if (!data.id) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุ id');
    const row = SheetHelper.findRow(SHEETS.ORGANIZATIONS, 'id', data.id);
    if (!row) return respond(false, null, ERROR.NOT_FOUND);
    const assignedUsers = SheetHelper.findRows(SHEETS.USERS, user =>
      this._isActive(user) && String(user.organization_id || '') === String(data.id));
    if (assignedUsers.length) {
      return respond(false, null, ERROR.VALIDATION_ERROR,
        `ยังมีผู้ใช้งาน ${assignedUsers.length} คนผูกกับสถาบัน / สถานที่นี้ กรุณาย้ายผู้ใช้ก่อนปิดใช้งาน`);
    }
    const activeOrganizations = SheetHelper.findRows(SHEETS.ORGANIZATIONS, item => this._isActive(item));
    if (activeOrganizations.length <= 1) {
      return respond(false, null, ERROR.VALIDATION_ERROR, 'ไม่สามารถปิดสถาบัน / สถานที่สุดท้ายของระบบได้');
    }
    const updates = { active: false };
    SheetHelper.updateRow(SHEETS.ORGANIZATIONS, 'id', data.id, updates);
    this.clearCache(data.id);
    this.clearCache(authCtx.organizationId);
    AuditService.log('DISABLE', SHEETS.ORGANIZATIONS, data.id, row, updates, authCtx);
    return respond(true, { id: data.id, disabled: true });
  },

  _requireOwnedRow(sheetName, id, authCtx) {
    if (!id) return null;
    const row = SheetHelper.findRow(sheetName, 'id', id);
    if (!row) return null;
    if (authCtx.role !== 'admin' && row.organization_id !== authCtx.organizationId) return null;
    return row;
  },

  _disableOwned(sheetName, id, authCtx) {
    const row = this._requireOwnedRow(sheetName, id, authCtx);
    if (!row) return respond(false, null, ERROR.NOT_FOUND);
    const updates = { active: false };
    SheetHelper.updateRow(sheetName, 'id', id, updates);
    this.clearCache(row.organization_id || authCtx.organizationId);
    AuditService.log('DISABLE', sheetName, id, row, updates, authCtx);
    return respond(true, { id, disabled: true });
  },

  _disableGlobal(sheetName, id, authCtx) {
    if (!id) return respond(false, null, ERROR.VALIDATION_ERROR, 'กรุณาระบุ id');
    const row = SheetHelper.findRow(sheetName, 'id', id);
    if (!row) return respond(false, null, ERROR.NOT_FOUND);
    const updates = { active: false };
    SheetHelper.updateRow(sheetName, 'id', id, updates);
    this.clearCache(authCtx.organizationId);
    AuditService.log('DISABLE', sheetName, id, row, updates, authCtx);
    return respond(true, { id, disabled: true });
  },

  _isActive(row) {
    return row && (row.active === true || String(row.active).toLowerCase() === 'true');
  },

  _normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  },

  _normalizeOrganizationCode(value) {
    return String(value || '').trim().toUpperCase();
  },

  _findDuplicateOrganization(nameTh, shortName, excludeId) {
    const normalizedName = this._normalizeName(nameTh);
    const normalizedCode = this._normalizeOrganizationCode(shortName);
    return SheetHelper.findRows(SHEETS.ORGANIZATIONS, row =>
      String(row.id || '') !== String(excludeId || '') &&
      (this._normalizeName(row.name_th) === normalizedName ||
       this._normalizeOrganizationCode(row.short_name) === normalizedCode)
    )[0] || null;
  },

  _findActiveByName(sheetName, nameColumn, name, organizationId) {
    const normalized = this._normalizeName(name);
    if (!normalized) return null;
    return SheetHelper.findRows(sheetName, r =>
      this._isActive(r) &&
      (!organizationId || r.organization_id === organizationId) &&
      this._normalizeName(r[nameColumn]) === normalized
    )[0] || null;
  },

  clearCache(organizationId) {
    try {
      const cache = CacheService.getScriptCache();
      cache.remove(`masterData_${organizationId}`);
      cache.remove('masterData_ALL');
    } catch (e) {
      console.warn('ล้างแคชผิดพลาด:', e.message);
    }
  }
};
