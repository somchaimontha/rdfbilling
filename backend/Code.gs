// ============================================================
// Code.gs — Entry Point หลัก
// ============================================================

// รองรับ POST request จาก Frontend
function doPost(e) {
  let requestAction = 'unknown';
  let authCtx = null;
  try {
    const body = JSON.parse(e.postData.contents);
    const { action, token, data, filters, pagination, requestId } = body;
    requestAction = action || 'unknown';

    if (!action) {
      return respond(false, null, ERROR.UNKNOWN_ACTION, 'ต้องระบุ action');
    }

    // Rate Limiting by Action & Token
    const cache = CacheService.getScriptCache();
    const rateKey = `rate_${action}_${token || 'guest'}`;
    let reqCount = parseInt(cache.get(rateKey) || '0', 10);
    
    let limit = 100; // API max
    let windowSec = 15 * 60; // 15 mins
    
    if (action === 'login') {
      limit = 5;
      windowSec = 5 * 60;
    } else if (action === 'uploadAttachment' || action === 'uploadFoodAttachment' || action === 'saveReportArchiveFile') {
      limit = 20;
      windowSec = 60 * 60; // 1 hour
    }
    
    if (reqCount >= limit) {
      return respond(false, null, {code: 'RATE_LIMIT_EXCEEDED', msg: 'Too many requests'}, 'คุณทำรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    }
    
    cache.put(rateKey, (reqCount + 1).toString(), windowSec);

    // Auth: ยกเว้น action สาธารณะที่ต้องเรียกได้ก่อน login (login เอง + เช็คว่า Google Login เปิดใช้งานไหม)
    const PUBLIC_ACTIONS = ['login', 'loginWithGoogle', 'getPublicSettings', 'verifyDocument'];
    if (!PUBLIC_ACTIONS.includes(action)) {
      authCtx = Auth.validateToken(token);
      if (!authCtx.valid) {
        return respond(false, null, ERROR.UNAUTHORIZED);
      }
      if (!Auth.checkPermission(authCtx.role, action)) {
        return respond(false, null, ERROR.FORBIDDEN);
      }
    }

    // Route ไปยัง Service
    const requestData = data || {};
    switch (action) {

      // Auth
      case 'login':            return Auth.login(data);
      case 'loginWithGoogle':  return Auth.loginWithGoogle(data);
      case 'logout':           return runIdempotentMutation_(requestId, action, () => Auth.logout(token));
      case 'getPublicSettings': return SystemService.getPublicConfig();
      case 'getRuntimeConfig': return SystemService.getRuntimeConfig(authCtx);

      // Master Data
      case 'getMasterData':       return MasterDataService.getAll(authCtx, requestData);
      case 'createProject':       return runIdempotentMutation_(requestId, action, () => MasterDataService.createProject(data, authCtx));
      case 'updateProject':       return runIdempotentMutation_(requestId, action, () => MasterDataService.updateProject(data, authCtx));
      case 'disableProject':      return runIdempotentMutation_(requestId, action, () => MasterDataService.disableProject(data, authCtx));
      case 'createVendor':        return runIdempotentMutation_(requestId, action, () => MasterDataService.createVendor(data, authCtx));
      case 'updateVendor':        return runIdempotentMutation_(requestId, action, () => MasterDataService.updateVendor(data, authCtx));
      case 'disableVendor':       return runIdempotentMutation_(requestId, action, () => MasterDataService.disableVendor(data, authCtx));
      case 'createFundSource':    return runIdempotentMutation_(requestId, action, () => MasterDataService.createFundSource(data, authCtx));
      case 'updateFundSource':    return runIdempotentMutation_(requestId, action, () => MasterDataService.updateFundSource(data, authCtx));
      case 'disableFundSource':   return runIdempotentMutation_(requestId, action, () => MasterDataService.disableFundSource(data, authCtx));
      case 'createCategory':      return runIdempotentMutation_(requestId, action, () => MasterDataService.createCategory(data, authCtx));
      case 'updateCategory':      return runIdempotentMutation_(requestId, action, () => MasterDataService.updateCategory(data, authCtx));
      case 'disableCategory':     return runIdempotentMutation_(requestId, action, () => MasterDataService.disableCategory(data, authCtx));
      case 'createOrganization':  return runIdempotentMutation_(requestId, action, () => MasterDataService.createOrganization(data, authCtx));
      case 'updateOrganization':  return runIdempotentMutation_(requestId, action, () => MasterDataService.updateOrganization(data, authCtx));
      case 'disableOrganization': return runIdempotentMutation_(requestId, action, () => MasterDataService.disableOrganization(data, authCtx));

      // Expenses
      case 'createExpense':       return runIdempotentMutation_(requestId, action, () => ExpenseService.create(data, authCtx));
      case 'getExpenses':         return ExpenseService.getList(filters, pagination, authCtx);
      case 'getExpenseById':      return ExpenseService.getById(requestData.id, authCtx);
      case 'updateExpense':       return runIdempotentMutation_(requestId, action, () => ExpenseService.update(data, authCtx));
      case 'deleteExpense':       return runIdempotentMutation_(requestId, action, () => ExpenseService.remove(requestData.id, authCtx));

      // Attachments
      case 'uploadAttachment':    return runIdempotentMutation_(requestId, action, () => AttachmentService.upload(data, authCtx));
      case 'deleteAttachment':    return runIdempotentMutation_(requestId, action, () => AttachmentService.remove(requestData.id, authCtx));
      case 'getAttachments':       return AttachmentService.getByExpenseId(requestData.expenseId, authCtx);
      case 'getAttachmentDataUrl': return AttachmentService.getDataUrl(data, authCtx);

      // Signatures (saved image library + online signature pad)
      case 'getSignatures':        return SignatureService.getList(data, authCtx);
      case 'uploadSignature':      return runIdempotentMutation_(requestId, action, () => SignatureService.upload(data, authCtx));
      case 'getSignatureDataUrl':  return SignatureService.getDataUrl(data, authCtx);
      case 'deleteSignature':      return runIdempotentMutation_(requestId, action, () => SignatureService.remove(requestData.id, authCtx));

      // Claims
      case 'createClaim':         return runIdempotentMutation_(requestId, action, () => ClaimService.create(data, authCtx));
      case 'cancelClaimDraft':    return runIdempotentMutation_(requestId, action, () => ClaimService.cancelDraft(data, authCtx));
      case 'getClaims':           return ClaimService.getList(filters, authCtx);
      case 'getClaimById':        return ClaimService.getById(requestData.claimId, authCtx);
      case 'submitClaim':         return runIdempotentMutation_(requestId, action, () => ClaimService.submit(data, authCtx));
      case 'approveClaim':        return runIdempotentMutation_(requestId, action, () => ClaimService.approve(data, authCtx));
      case 'rejectClaim':         return runIdempotentMutation_(requestId, action, () => ClaimService.reject(data, authCtx));
      case 'addExpenseToClaim':   return runIdempotentMutation_(requestId, action, () => ClaimService.addExpense(data, authCtx));
      case 'removeExpenseFromClaim': return runIdempotentMutation_(requestId, action, () => ClaimService.removeExpense(data, authCtx));

      // Reimbursement
      case 'recordReimbursement': return runIdempotentMutation_(requestId, action, () => ClaimService.recordReimbursement(data, authCtx));

      // Dashboard & Reports
      case 'getDashboard':        return DashboardService.getDashboard(data, authCtx);
      case 'getMonthlyLedger':    return DashboardService.getMonthlyLedger(data, authCtx);
      case 'getCarryOverAmount':  return DashboardService.getCarryOverAmount(data, authCtx);
      case 'getMonthStatuses':    return DashboardService.getMonthStatuses(data, authCtx);
      case 'toggleMonthStatus':   return runIdempotentMutation_(requestId, action, () => DashboardService.toggleMonthStatus(data, authCtx));

      // Users
      case 'getUsers':            return UserService.getList(authCtx);
      case 'createUser':          return runIdempotentMutation_(requestId, action, () => UserService.create(data, authCtx));
      case 'updateUser':          return runIdempotentMutation_(requestId, action, () => UserService.update(data, authCtx));
      case 'updateProfile':       return runIdempotentMutation_(requestId, action, () => UserService.updateProfile(data, authCtx));
      case 'changePassword':      return runIdempotentMutation_(requestId, action, () => UserService.changePassword(data, authCtx));

      // System
      case 'getSystemConfig':     return SystemService.getConfig(authCtx);
      case 'updateSystemConfig':  return runIdempotentMutation_(requestId, action, () => SystemService.updateConfig(data, authCtx));

      // Food Expenses
      case 'getFoodExpenses':     return FoodExpenseService.getList(filters, pagination, authCtx);
      case 'getFoodExpenseById':  return FoodExpenseService.getById(requestData.id, authCtx);
      case 'createFoodExpense':   return runIdempotentMutation_(requestId, action, () => FoodExpenseService.create(data, authCtx));
      case 'updateFoodExpense':   return runIdempotentMutation_(requestId, action, () => FoodExpenseService.update(data, authCtx));
      case 'uploadFoodAttachment':return runIdempotentMutation_(requestId, action, () => FoodExpenseService.uploadAttachment(data, authCtx));
      case 'deleteFoodAttachment':return runIdempotentMutation_(requestId, action, () => FoodExpenseService.deleteAttachment(requestData.id, authCtx));
      case 'deleteFoodExpenseAPI':return runIdempotentMutation_(requestId, action, () => FoodExpenseService.remove(requestData.id, authCtx));

      // Fund Receipts (เอกสารรับเงินทุนประจำเดือน)
      case 'getFundReceipts':     return FundReceiptService.getList(filters, authCtx);
      case 'saveFundReceipt':     return runIdempotentMutation_(requestId, action, () => FundReceiptService.save(data, authCtx));
      case 'deleteFundReceipt':   return runIdempotentMutation_(requestId, action, () => FundReceiptService.remove(requestData.id, authCtx));

      // QR Verification (ตรวจสอบเอกสารย้อนกลับ)
      case 'verifyDocument':          return VerifyService.verifyDocument(data);
      case 'getFoodMonthVerifyCode':  return VerifyService.getOrCreateFoodMonthCode(data, authCtx);
      case 'getExportVerifyCode':     return VerifyService.getOrCreateExportVerifyCode(data, authCtx);
      case 'getReportArchiveStatus':  return ReportArchiveService.getStatus(data, authCtx);
      case 'reserveReportArchive':    return runIdempotentMutation_(requestId, action, () => ReportArchiveService.reserve(data, authCtx));
      case 'saveReportArchiveFile':   return runIdempotentMutation_(requestId, action, () => ReportArchiveService.saveFile(data, authCtx));

      default:
        return respond(false, null, ERROR.UNKNOWN_ACTION,
          `ไม่รู้จัก action: "${action}"`);
    }

  } catch (err) {
    console.error('doPost error:', err);
    const isAdmin = authCtx && authCtx.role === 'admin';
    const rawErrorMessage = String(err && err.message ? err.message : err || '');
    const isDriveAuthorizationError = /driveapp|permission[^\n]*drive|access denied[^\n]*drive/i.test(rawErrorMessage);
    const errorDef = isDriveAuthorizationError
      ? { code: 'DRIVE_AUTH_REQUIRED', msg: 'Apps Script ยังไม่ได้รับสิทธิ์ Google Drive' }
      : ERROR.SERVER_ERROR;
    const publicMessage = isDriveAuthorizationError
      ? 'ระบบแนบไฟล์ยังไม่ได้รับสิทธิ์ Google Drive กรุณาแจ้งผู้ดูแลระบบ'
      : 'ระบบไม่สามารถดำเนินการได้ชั่วคราว กรุณาลองใหม่อีกครั้งหรือติดต่อผู้ดูแลระบบ';
    const adminMessage = isDriveAuthorizationError
      ? 'Apps Script ยังไม่ได้รับสิทธิ์ DriveApp: ให้เจ้าของ deployment รัน authorizeRequiredServices แล้วอนุมัติสิทธิ์ จากนั้นสร้าง deployment เวอร์ชันใหม่'
      : `เกิดข้อผิดพลาดใน ${requestAction}: ${rawErrorMessage}`;
    return respond(
      false,
      null,
      errorDef,
      isAdmin ? adminMessage : publicMessage,
      isAdmin ? {
        action: requestAction,
        driveFolderId: isDriveAuthorizationError ? CONFIG.DRIVE_FOLDER_ID : '',
        requiredFunction: isDriveAuthorizationError ? 'authorizeRequiredServices' : '',
        errorName: err && err.name ? err.name : 'Error',
        stack: err && err.stack ? err.stack : '',
        occurredAt: new Date().toISOString()
      } : null
    );
  }
}

// รองรับ GET (ตรวจสอบว่า API ทำงานอยู่)
// Prevent duplicate rows/files when the browser resends a mutation after a
// gateway timeout. The same client operation ID always receives the first
// completed response for six hours.
function runIdempotentMutation_(requestId, action, operation) {
  const normalizedId = String(requestId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(normalizedId)) {
    return operation();
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = `idem_${String(action || 'write').replace(/[^A-Za-z0-9_-]/g, '')}_${normalizedId}`.slice(0, 240);
  const cached = cache.get(cacheKey);
  if (cached) {
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error(`IDEMPOTENCY_LOCK_TIMEOUT:${action}`);
  }

  try {
    const completedWhileWaiting = cache.get(cacheKey);
    if (completedWhileWaiting) {
      return ContentService.createTextOutput(completedWhileWaiting).setMimeType(ContentService.MimeType.JSON);
    }

    const response = operation();
    if (response && typeof response.getContent === 'function') {
      const content = response.getContent();
      try {
        if (Utilities.newBlob(content).getBytes().length <= 90000) {
          cache.put(cacheKey, content, 21600);
        }
      } catch (cacheError) {
        console.warn(`Idempotency cache write failed for ${action}:`, cacheError);
      }
    }
    return response;
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  return respond(true, {
    service: 'RDF Foundation API',
    version: '1.0',
    status: 'online',
    timestamp: new Date().toISOString(),
  });
}

// ฟังก์ชัน respond กลาง — ใช้ทุก Service
function respond(success, data, errorDef, customMsg, meta) {
  const payload = { success };
  if (success) {
    payload.data = data || null;
    if (meta) payload.meta = meta;
    payload.error = null;
  } else {
    payload.data = null;
    payload.error = {
      code: (errorDef || ERROR.SERVER_ERROR).code,
      message: customMsg || (errorDef || ERROR.SERVER_ERROR).msg,
    };
    if (meta) payload.error.details = meta;
  }
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// Utility — สร้าง UUID สั้น
function generateId(prefix, length = 6) {
  const num = String(Math.floor(Math.random() * Math.pow(10, length)))
    .padStart(length, '0');
  return `${prefix}${num}`;
}
