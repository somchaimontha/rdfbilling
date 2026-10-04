// ==========================================================================
// RDF Expense & Claim Management System — v4.0 (GAS Cloud Integration)
// Master Data + Full Expense Schema
// ==========================================================================

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwxEEhfMfU8hjiR-iijOqcdPbRR-UOQOf4CMD34B0qVlhjgJYEpFXzGkopJ4inI5RyRnA/exec';
const API_URL = ['127.0.0.1', 'localhost'].includes(window.location.hostname) ? '/api' : GAS_API_URL;
const PUBLIC_APP_URL = 'https://somchaimontha.github.io/rdfbilling/';
// Keep background reads short.  Temporary Apps Script cold starts are retried
// automatically; the non-blocking status bar still offers a manual fallback.
const API_READ_REQUEST_TIMEOUT_MS = 12000;
// Food records are assembled from both the food document and item sheets.
// On a cold Apps Script execution that read can legitimately exceed the
// lightweight background-read budget, so do not abort it at 12 seconds.
const API_SLOW_READ_REQUEST_TIMEOUT_MS = 30000;
const API_WRITE_REQUEST_TIMEOUT_MS = 45000;
const API_READ_RETRY_ATTEMPTS = 2;
const API_WRITE_RETRY_ATTEMPTS = 3;
const API_RETRY_DELAY_MS = 700;
const API_WRITE_RETRY_DELAY_MS = 1000;
const DATABASE_AUTO_RETRY_LIMIT = 2;
const DATABASE_AUTO_RETRY_DELAY_MS = 2000;
const SLOW_READ_API_ACTIONS = new Set([
    'getFoodExpenses'
]);
const RETRYABLE_READ_API_ACTIONS = new Set([
    'getAttachmentDataUrl',
    'getAttachments',
    'getCarryOverAmount',
    'getClaims',
    'getExpenses',
    'getFoodExpenseById',
    'getFoodExpenses',
    'getFundReceipts',
    'getMasterData',
    'getMonthStatuses',
    'getRuntimeConfig',
    'getSignatures',
    'getSignatureDataUrl',
    'getSystemConfig',
    'getUsers'
]);
const MUTATING_API_ACTIONS = new Set([
    'logout',
    'createProject',
    'updateProject',
    'disableProject',
    'createVendor',
    'updateVendor',
    'disableVendor',
    'createFundSource',
    'updateFundSource',
    'disableFundSource',
    'createCategory',
    'updateCategory',
    'disableCategory',
    'createOrganization',
    'updateOrganization',
    'disableOrganization',
    'createExpense',
    'updateExpense',
    'deleteExpense',
    'uploadAttachment',
    'deleteAttachment',
    'uploadSignature',
    'deleteSignature',
    'createClaim',
    'cancelClaimDraft',
    'submitClaim',
    'approveClaim',
    'rejectClaim',
    'addExpenseToClaim',
    'removeExpenseFromClaim',
    'recordReimbursement',
    'toggleMonthStatus',
    'createUser',
    'updateUser',
    'updateProfile',
    'changePassword',
    'updateSystemConfig',
    'createFoodExpense',
    'updateFoodExpense',
    'deleteFoodExpenseAPI',
    'uploadFoodAttachment',
    'saveFundReceipt',
    'deleteFundReceipt',
]);
let lastApiDiagnostic = null;

function isApiWriteAction(action) {
    return MUTATING_API_ACTIONS.has(action);
}

function canSafelyRetryWrite(action) {
    // Every mutation carries one operation ID. The Apps Script router caches the
    // completed response for that ID, so a retry cannot create a duplicate row/file.
    return MUTATING_API_ACTIONS.has(action);
}

function getApiActionDisplayName(action) {
    const labels = {
        createExpense: 'เพิ่มรายการบิล', updateExpense: 'แก้ไขรายการบิล', deleteExpense: 'ลบรายการบิล',
        createFoodExpense: 'เพิ่มค่าอาหาร', updateFoodExpense: 'แก้ไขค่าอาหาร', deleteFoodExpenseAPI: 'ลบค่าอาหาร',
        uploadAttachment: 'อัปโหลดหลักฐาน', uploadFoodAttachment: 'อัปโหลดหลักฐานค่าอาหาร',
        saveFundReceipt: 'บันทึกเอกสารรับเงินทุน', updateSystemConfig: 'บันทึกการตั้งค่า',
        createClaim: 'สร้างชุดส่งเบิก', cancelClaimDraft: 'ยกเลิกชุดส่งเบิก',
        createProject: 'เพิ่มโครงการ', createUser: 'เพิ่มผู้ใช้', updateUser: 'แก้ไขผู้ใช้'
    };
    return labels[action] || action;
}

function renderGlobalWriteStatus(detail) {
    if (!detail || !detail.action) return;
    let container = document.getElementById('api-write-status-tray');
    if (!container) {
        container = document.createElement('div');
        container.id = 'api-write-status-tray';
        container.className = 'api-write-status-tray';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }
    const key = String(detail.requestId || detail.action).replace(/[^a-zA-Z0-9_-]/g, '');
    let item = document.getElementById(`api-write-status-${key}`);
    if (!item) {
        item = document.createElement('div');
        item.id = `api-write-status-${key}`;
        item.className = 'api-write-status-item';
        container.appendChild(item);
    }
    const status = detail.status || 'sending';
    const icon = status === 'success' ? 'circle-check' : status === 'failed' ? 'circle-x' : status === 'retrying' ? 'refresh-cw' : 'cloud-upload';
    const text = status === 'success'
        ? 'บันทึกสำเร็จ'
        : status === 'failed'
            ? 'บันทึกไม่สำเร็จ'
            : status === 'retrying'
                ? `กำลังส่งซ้ำ ${detail.attempt}/${detail.maxAttempts}`
                : `กำลังบันทึก ${detail.attempt || 1}/${detail.maxAttempts || 1}`;
    item.className = `api-write-status-item is-${status}`;
    item.innerHTML = `<i data-lucide="${icon}"></i><span><strong>${escapeHTML(getApiActionDisplayName(detail.action))}</strong><small>${escapeHTML(text)}</small></span>`;
    initializeLucide();
    if (item._removeTimer) window.clearTimeout(item._removeTimer);
    if (status === 'success') item._removeTimer = window.setTimeout(() => item.remove(), 3500);
    if (status === 'failed') item._removeTimer = window.setTimeout(() => item.remove(), 10000);
}

function reportApiRequestStatus(options, detail) {
    if (typeof options.onStatus === 'function') {
        try { options.onStatus(detail); } catch (error) { console.warn('API status callback failed:', error); }
    }
    if (detail.isWrite) renderGlobalWriteStatus(detail);
}

function rememberApiDiagnostic(action, error, attempt, maxAttempts, timeoutMs) {
    const diagnostic = {
        id: createClientRequestId('error'),
        action: String(action || 'unknown'),
        message: String((error && error.message) || error || 'Unknown error'),
        errorCode: String((error && error.errorCode) || ''),
        statusCode: Number(error && error.statusCode) || 0,
        attempt: Number(attempt) || 1,
        maxAttempts: Number(maxAttempts) || 1,
        timeoutMs: Number(timeoutMs) || 0,
        occurredAt: new Date().toISOString(),
        stack: String((error && error.stack) || ''),
        details: error && error.details ? error.details : null
    };
    lastApiDiagnostic = diagnostic;
    return diagnostic;
}

function waitForApiRetry(ms, signal) {
    return new Promise((resolve, reject) => {
        const cancel = () => {
            window.clearTimeout(timer);
            reject(createApiError('ยกเลิกการโหลดชุดเดิม', { name: 'AbortError' }));
        };
        const timer = window.setTimeout(() => {
            if (signal) signal.removeEventListener('abort', cancel);
            resolve();
        }, ms);
        if (signal) {
            if (signal.aborted) cancel();
            else signal.addEventListener('abort', cancel, { once: true });
        }
    });
}

function createApiError(message, options = {}) {
    const error = new Error(message);
    Object.assign(error, options);
    return error;
}

function isTransientApiStatus(status) {
    return status === 0 || status === 404 || status === 408 || status === 429 || status >= 500;
}

function isRetryableReadAction(action) {
    return RETRYABLE_READ_API_ACTIONS.has(action);
}

function getReadRequestTimeoutMs(action) {
    return SLOW_READ_API_ACTIONS.has(action)
        ? API_SLOW_READ_REQUEST_TIMEOUT_MS
        : API_READ_REQUEST_TIMEOUT_MS;
}

// API request router (CORS friendly via text/plain payload)
async function apiCall(action, data = null, filters = null, pagination = null, options = {}) {
    const token = localStorage.getItem('rdf_session_token');
    const isRead = isRetryableReadAction(action);
    const isWrite = isApiWriteAction(action);
    const canRetry = isRead || (isWrite && canSafelyRetryWrite(action));
    const maxAttempts = isRead ? API_READ_RETRY_ATTEMPTS : canRetry ? API_WRITE_RETRY_ATTEMPTS : 1;
    const requestTimeoutMs = isRead ? getReadRequestTimeoutMs(action) : API_WRITE_REQUEST_TIMEOUT_MS;
    const statusRequestId = options.requestId || createClientRequestId('api');
    const requestBody = JSON.stringify({ action, token, data, filters, pagination, requestId: statusRequestId });
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (options.signal && options.signal.aborted) {
            throw createApiError('ยกเลิกการโหลดชุดเดิม', { name: 'AbortError' });
        }
        const controller = new AbortController();
        const cancel = () => controller.abort();
        if (options.signal) options.signal.addEventListener('abort', cancel, { once: true });
        let timeoutId = null;

        try {
            reportApiRequestStatus(options, { action, isWrite, requestId: statusRequestId, status: attempt > 1 ? 'retrying' : 'sending', attempt, maxAttempts });
            timeoutId = window.setTimeout(() => controller.abort(), requestTimeoutMs);
            const response = await fetch(API_URL, {
                method: 'POST',
                mode: 'cors',
                cache: 'no-store',
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8'
                },
                body: requestBody,
                signal: controller.signal
            });
            const responseText = await response.text();
            const contentType = response.headers.get('content-type') || 'unknown content type';
            let result;

            try {
                result = JSON.parse(responseText);
            } catch (_) {
                const looksLikeHtml = /^\s*(?:<!doctype html|<html)/i.test(responseText);
                const detail = looksLikeHtml
                    ? 'Apps Script ตอบกลับเป็นหน้า HTML แทนข้อมูล API'
                    : 'Apps Script ตอบกลับในรูปแบบที่อ่านไม่ได้';
                throw createApiError(`${detail} (HTTP ${response.status}, ${contentType})`, {
                    retryable: true,
                    connectionIssue: true,
                    statusCode: response.status
                });
            }

            if (!response.ok && isTransientApiStatus(response.status)) {
                throw createApiError(`Apps Script ขัดข้องชั่วคราว (HTTP ${response.status})`, {
                    retryable: true,
                    connectionIssue: true,
                    statusCode: response.status
                });
            }

            if (result.status !== 'success' && !result.success) {
                const isUnauthorized = (result.error && result.error.code === 'UNAUTHORIZED')
                    || result.message === 'Token ไม่ถูกต้อง'
                    || result.message === 'Unauthorized. Please login again.';
                if (isUnauthorized) {
                    handleSessionExpired();
                    throw createApiError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', { isAuthenticationError: true });
                }
                const validationMessages = (result.error && Array.isArray(result.error.fields))
                    ? result.error.fields.map(field => field.message).filter(Boolean)
                    : [];
                const apiMessage = result.message || (result.error ? result.error.message : 'API call failed');
                throw createApiError([apiMessage, ...validationMessages].filter(Boolean).join(' — '), {
                    action,
                    errorCode: result.error && result.error.code,
                    statusCode: response.status,
                    details: result.error && result.error.details
                });
            }
            reportApiRequestStatus(options, { action, isWrite, requestId: statusRequestId, status: 'success', attempt, maxAttempts });
            return result.data || result;
        } catch (err) {
            if (options.signal && options.signal.aborted) throw err;
            let requestError = err;
            if (err && err.name === 'AbortError') {
                requestError = createApiError(
                    `ใช้เวลาติดต่อ Apps Script เกิน ${Math.round(requestTimeoutMs / 1000)} วินาที`,
                    { retryable: true, connectionIssue: true }
                );
            } else if (!err || (!err.retryable && !err.isAuthenticationError && !err.message)) {
                requestError = createApiError('ไม่สามารถเชื่อมต่อ Apps Script ได้ชั่วคราว', {
                    retryable: true,
                    connectionIssue: true
                });
            } else if (err instanceof TypeError && !err.isAuthenticationError) {
                requestError = createApiError(`ไม่สามารถเชื่อมต่อ Apps Script ได้ชั่วคราว: ${err.message}`, {
                    retryable: true,
                    connectionIssue: true
                });
            }

            lastError = requestError;
            const shouldRetry = canRetry && requestError.retryable && attempt < maxAttempts;
            if (!shouldRetry) {
                rememberApiDiagnostic(action, requestError, attempt, maxAttempts, requestTimeoutMs);
                reportApiRequestStatus(options, { action, isWrite, requestId: statusRequestId, status: 'failed', attempt, maxAttempts, error: requestError });
                console.error(`API Call [${action}] failed:`, requestError);
                throw requestError;
            }

            console.warn(`API Call [${action}] attempt ${attempt}/${maxAttempts} failed; retrying.`, requestError);
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            if (options.onRetry) options.onRetry({ action, attempt: attempt + 1, maxAttempts, error: requestError });
            reportApiRequestStatus(options, { action, isWrite, requestId: statusRequestId, status: 'retrying', attempt: attempt + 1, maxAttempts, error: requestError });
            const retryDelay = isRead ? API_RETRY_DELAY_MS : API_WRITE_RETRY_DELAY_MS;
            await waitForApiRetry(retryDelay * attempt, options.signal);
        } finally {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            if (options.signal) options.signal.removeEventListener('abort', cancel);
        }
    }

    throw lastError || new Error('ไม่สามารถเชื่อมต่อ Apps Script ได้');
}

// API list helpers ---------------------------------------------------------
// รายการธุรกรรมอาจเกิน 1 หน้าได้ จึงต้องใช้ helper กลางที่อ่านครบทุกหน้า
// พร้อมจำกัดจำนวน request พร้อมกัน เพื่อไม่ให้ Apps Script ถูกโหลดหนักเกินไป.
const API_LIST_PAGE_SIZE = 200;
const API_LIST_CONCURRENCY = 3;
const INITIAL_DATABASE_LOAD_CONCURRENCY = 3;
const ATTACHMENT_LOAD_CONCURRENCY = 3;
const REPORT_EMBEDDED_IMAGE_MAX_WIDTH = 1280;
const REPORT_EMBEDDED_IMAGE_MAX_HEIGHT = 1680;
const REPORT_EMBEDDED_IMAGE_QUALITY = 0.82;
let authorizedExpenseRecordCache = { token: '', loaded: false, records: [] };

function cacheAuthorizedExpenseRecords(records) {
    authorizedExpenseRecordCache = {
        token: localStorage.getItem('rdf_session_token') || '',
        loaded: true,
        records: Array.isArray(records) ? records : []
    };
    return authorizedExpenseRecordCache.records;
}

function getCachedAuthorizedExpenseRecords() {
    const token = localStorage.getItem('rdf_session_token') || '';
    return authorizedExpenseRecordCache.loaded && authorizedExpenseRecordCache.token === token
        ? authorizedExpenseRecordCache.records
        : null;
}

async function mapWithConcurrency(items, limit, worker) {
    const queue = Array.isArray(items) ? items : [];
    if (queue.length === 0) return [];

    const results = new Array(queue.length);
    const workerCount = Math.min(Math.max(1, Number(limit) || 1), queue.length);
    let nextIndex = 0;

    async function runWorker() {
        while (nextIndex < queue.length) {
            const index = nextIndex++;
            results[index] = await worker(queue[index], index);
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}

async function fetchAllPagedRecords(fetchPage, getRecords, options = {}) {
    const pageSize = options.pageSize || API_LIST_PAGE_SIZE;
    const firstResponse = await fetchPage(1);
    const firstRecords = getRecords(firstResponse) || [];
    const pageInfo = firstResponse && firstResponse.pagination;

    // Compatibility with a backend version before pagination is deployed.
    // Food used to return all rows in one response, while expenses were already
    // paged without exposing their total in data.
    if (!pageInfo || !Number.isFinite(Number(pageInfo.total))) {
        if (options.legacyUnpaged) return firstRecords;

        const all = [...firstRecords];
        for (let page = 2; page <= 50 && firstRecords.length === pageSize; page++) {
            const response = await fetchPage(page);
            const batch = getRecords(response) || [];
            all.push(...batch);
            if (batch.length < pageSize) break;
        }
        return all;
    }

    const total = Number(pageInfo.total) || 0;
    const limit = Number(pageInfo.limit) || pageSize;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    if (totalPages <= 1) return firstRecords;

    const remainingPages = Array.from({ length: totalPages - 1 }, (_, index) => index + 2);
    const remainingResponses = await mapWithConcurrency(
        remainingPages,
        options.concurrency || API_LIST_CONCURRENCY,
        page => fetchPage(page)
    );
    return firstRecords.concat(...remainingResponses.map(response => getRecords(response) || []));
}

async function fetchAllExpensesForMonth(month, options = {}) {
    // Filter in the browser until every deployed Apps Script version handles
    // Google Sheets Date cells consistently. Server-side month filtering in an
    // older deployment can otherwise return an empty list for valid records.
    const allRecords = await fetchAllPagedRecords(
        page => apiCall('getExpenses', null, null, { page, limit: API_LIST_PAGE_SIZE }, options),
        response => response.expenses || []
    );
    cacheAuthorizedExpenseRecords(allRecords);
    return allRecords.filter(expense => getExpensePostingMonth(expense) === month);
}

async function fetchAllExpensesForYear(year) {
    const cachedRecords = getCachedAuthorizedExpenseRecords();
    const allRecords = cachedRecords || cacheAuthorizedExpenseRecords(await fetchAllPagedRecords(
        page => apiCall('getExpenses', null, null, { page, limit: API_LIST_PAGE_SIZE }),
        response => response.expenses || []
    ));
    const yearPrefix = `${String(year)}-`;
    return allRecords.filter(expense => getExpensePostingMonth(expense).startsWith(yearPrefix));
}

async function fetchAllFoodExpensesForMonth(month, options = {}) {
    return fetchAllPagedRecords(
        page => apiCall('getFoodExpenses', null, { month }, { page, limit: API_LIST_PAGE_SIZE }, options),
        response => response.foodExpenses || [],
        { legacyUnpaged: true }
    );
}

// SHA-256 Hashing helper
async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// XSS Prevention Helper
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Language-aware wrapping for generated documents. Thai has no spaces between
// words, so add invisible break opportunities after browser-native word
// segmentation. English, numbers, file references, and URLs remain unchanged.
const DOCUMENT_ZWSP = '\u200B';
let thaiDocumentSegmenter = null;

function addDocumentBreakOpportunities(value) {
    const text = String(value ?? '');
    if (!/[\u0E00-\u0E7F]/.test(text) || typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
        return text;
    }
    if (!thaiDocumentSegmenter) {
        thaiDocumentSegmenter = new Intl.Segmenter('th', { granularity: 'word' });
    }
    const preserveUrls = /(https?:\/\/[^\s]+|www\.[^\s]+|mailto:[^\s]+)/giu;
    return text.split(preserveUrls).map(part => {
        if (/^(?:https?:\/\/|www\.|mailto:)/iu.test(part)) return part;
        return part.replace(/[\u0E00-\u0E7F]+/g, thaiRun =>
            Array.from(thaiDocumentSegmenter.segment(thaiRun), segment => segment.segment).join(DOCUMENT_ZWSP)
        );
    }).join('');
}

function preparePdfDocumentText(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
        value.forEach(item => preparePdfDocumentText(item, seen));
        return value;
    }
    Object.entries(value).forEach(([key, child]) => {
        if (key === 'text' && typeof child === 'string') {
            value[key] = addDocumentBreakOpportunities(child);
        } else if (key !== 'images') {
            preparePdfDocumentText(child, seen);
        }
    });
    return value;
}

function preparePrintDocumentText(targetDocument) {
    if (!targetDocument || !targetDocument.body || typeof targetDocument.createTreeWalker !== 'function') return;
    const showText = targetDocument.defaultView?.NodeFilter?.SHOW_TEXT || 4;
    const walker = targetDocument.createTreeWalker(targetDocument.body, showText);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);
    textNodes.forEach(textNode => {
        const tagName = textNode.parentElement?.tagName || '';
        if (!['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE'].includes(tagName)) {
            textNode.nodeValue = addDocumentBreakOpportunities(textNode.nodeValue);
        }
    });
    targetDocument.body.style.overflowWrap = 'anywhere';
    targetDocument.body.style.wordBreak = 'normal';
    targetDocument.body.style.lineBreak = 'auto';
}

// ==========================================================================
// Lazy-load ไลบรารีหนักที่ใช้เฉพาะตอน "ส่งออกรายงาน" (pdfmake + sarabun + xlsx ~2.4MB)
// ย้ายออกจาก <head> (เดิม blocking ทำให้หน้าแรกโหลดช้า) → โหลดครั้งแรกที่ต้องใช้จริง
// ไม่โหลด vfs_fonts.js (Roboto ~834KB) เพราะเราใช้ Sarabun ล้วน — พิสูจน์ด้วย pdfmake 0.3.11 จริงแล้วว่า
// createPdf ทำงานได้โดยไม่ต้องมี Roboto เมื่อ defaultStyle.font='Sarabun' (ดู [[project_preview_export_report_overhaul]])
// - เบราว์เซอร์ HTTP-cache สคริปต์เหล่านี้อยู่แล้ว → เข้าครั้งต่อไปดึงจากแคช ไม่โหลดซ้ำ
// - หลังหน้าแรกแสดงเสร็จ จะ "แอบโหลดเบื้องหลัง" ตอนเบราว์เซอร์ว่าง (ดู window 'load' ท้ายไฟล์)
//   เพื่อให้กดส่งออกครั้งแรกได้ทันที โดยไม่บล็อกการโหลดหน้าแรก
// ==========================================================================
let _exportLibsPromise = null;
let _spreadsheetLibPromise = null;

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('โหลดไม่สำเร็จ: ' + src));
        document.head.appendChild(s);
    });
}

// แถบสถานะเล็กๆ กลางล่างจอ (ไม่บังการใช้งาน) — แจ้งความคืบหน้าการโหลดเบื้องหลัง
function showLibStatus(text, state) {
    if (!document.getElementById('lib-status-style')) {
        const st = document.createElement('style');
        st.id = 'lib-status-style';
        st.textContent = '@keyframes libpulse{0%,100%{opacity:1}50%{opacity:.3}}';
        document.head.appendChild(st);
    }
    let bar = document.getElementById('lib-status-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'lib-status-bar';
        bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;display:flex;align-items:center;gap:9px;background:rgba(30,41,59,.94);color:#fff;font-size:13px;padding:8px 16px;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:0;transition:opacity .25s;pointer-events:none;max-width:90vw;';
        bar.innerHTML = '<span class="lib-status-dot" style="width:9px;height:9px;border-radius:50%;background:#38bdf8;flex:none;"></span><span class="lib-status-text"></span>';
        document.body.appendChild(bar);
    }
    const dot = bar.querySelector('.lib-status-dot');
    bar.querySelector('.lib-status-text').textContent = text;
    dot.style.background = state === 'error' ? '#f87171' : state === 'done' ? '#4ade80' : '#38bdf8';
    dot.style.animation = state === 'loading' ? 'libpulse 1s ease-in-out infinite' : 'none';
    bar.style.opacity = '1';
    clearTimeout(bar._hideTimer);
    if (state === 'done' || state === 'error') {
        bar._hideTimer = setTimeout(() => { bar.style.opacity = '0'; }, state === 'error' ? 4500 : 1600);
    }
}

// โหลดไลบรารีส่งออกครั้งเดียว (cache promise) — เรียกซ้ำได้ปลอดภัย, resolve ทันทีถ้าโหลดไว้แล้ว
async function ensureExportLibs(label) {
    if (_exportLibsPromise) return _exportLibsPromise;
    _exportLibsPromise = (async () => {
        showLibStatus(label || 'กำลังเตรียมเครื่องมือส่งออกรายงาน...', 'loading');
        try {
            // pdfmake ต้องมาก่อน เพราะ sarabun-vfs.js เรียก pdfMake.addVirtualFileSystem()/addFonts() ตอนโหลด
            await loadScriptOnce('https://cdn.jsdelivr.net/npm/pdfmake@0.3.11/build/pdfmake.min.js');
            await Promise.all([
                loadScriptOnce('fonts/sarabun-vfs.js'),
                loadScriptOnce('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'),
            ]);
            showLibStatus('พร้อมส่งออกรายงานแล้ว', 'done');
        } catch (err) {
            _exportLibsPromise = null;   // ให้ลองใหม่ได้ครั้งหน้า
            showLibStatus('โหลดเครื่องมือส่งออกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'error');
            throw err;
        }
    })();
    return _exportLibsPromise;
}

async function ensureSpreadsheetLib(label) {
    if (window.XLSX) return window.XLSX;
    if (_spreadsheetLibPromise) return _spreadsheetLibPromise;
    _spreadsheetLibPromise = (async () => {
        showLibStatus(label || 'กำลังเตรียมเครื่องมืออ่านตาราง...', 'loading');
        try {
            await loadScriptOnce('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
            showLibStatus('พร้อมอ่านไฟล์ตารางแล้ว', 'done');
            return window.XLSX;
        } catch (error) {
            _spreadsheetLibPromise = null;
            showLibStatus('โหลดเครื่องมืออ่านตารางไม่สำเร็จ', 'error');
            throw error;
        }
    })();
    return _spreadsheetLibPromise;
}

// สร้าง QR code ตรวจสอบเอกสารย้อนกลับ — ทำงานฝั่ง client ล้วนๆ (ไลบรารี qrcode จาก CDN)
// ข้อมูลไม่ออกจากเบราว์เซอร์เลยตอนสร้างรูป ต่างจากการเรียก API ภายนอกสร้าง QR image
function buildVerifyUrl(type, code) {
    if (!type || !code) return '';
    const baseUrl = PUBLIC_APP_URL.replace(/\/+$/, '/') || PUBLIC_APP_URL;
    return type === 'export'
        ? `${baseUrl}?v=${encodeURIComponent(code)}`
        : `${baseUrl}?verify_type=${encodeURIComponent(type)}&verify_code=${encodeURIComponent(code)}`;
}

async function generateVerifyQR(type, code) {
    if (typeof QRCode === 'undefined' || !code) return '';
    const verifyUrl = buildVerifyUrl(type, code);
    try {
        return await QRCode.toDataURL(verifyUrl, { width: 160, margin: 1 });
    } catch (err) {
        console.error('QR generation failed:', err);
        return '';
    }
}
window.buildVerifyUrl = buildVerifyUrl;
window.generateVerifyQR = generateVerifyQR;

// ไลบรารี QRCode โหลดแบบ ESM (async) — ถ้าโหลดเสร็จตอนมอดัล Export เปิดค้างอยู่พอดี ให้ render พรีวิวใหม่
// เพื่อให้ QR ที่เพิ่งใช้งานได้โผล่ขึ้นมา (กรณีปกติ QRCode พร้อมก่อนผู้ใช้เปิด export นานแล้ว)
document.addEventListener('qrcode-ready', () => {
    const modal = document.getElementById('modal-export-pdf');
    if (modal && modal.classList.contains('active') && typeof renderExportPreview === 'function') {
        renderExportPreview();
    }
});

// SweetAlert2 wrappers
async function appConfirm(message, title = 'ยืนยัน', options = {}) {
    const result = await Swal.fire({
        title: title,
        text: message,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: options.confirmButtonText || 'ตกลง',
        cancelButtonText: options.cancelButtonText || 'ยกเลิก',
        confirmButtonColor: '#3b82f6',
        cancelButtonColor: '#ef4444'
    });
    return result.isConfirmed;
}

function getRelevantApiDiagnostic(message) {
    if (!lastApiDiagnostic) return null;
    const ageMs = Date.now() - new Date(lastApiDiagnostic.occurredAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 60000) return null;
    const alertMessage = String(message || '');
    const diagnosticMessage = String(lastApiDiagnostic.message || '');
    const messagesMatch = alertMessage.includes(diagnosticMessage) || diagnosticMessage.includes(alertMessage);
    return messagesMatch || ageMs < 2500 ? lastApiDiagnostic : null;
}

function getAlertGuidance(message, diagnostic) {
    const text = `${message || ''} ${(diagnostic && diagnostic.message) || ''}`.toLowerCase();
    if (/drive_auth_required|driveapp|ไม่ได้รับอนุญาตให้เข้าถึง[^\n]*drive/.test(text)) {
        return {
            cause: 'Apps Script deployment ยังไม่ได้รับ OAuth scope สำหรับ Google Drive ไม่ใช่ปัญหาชนิดไฟล์หรืออินเทอร์เน็ต',
            userSteps: ['ข้อมูลรายการยังอยู่ กรุณาแจ้งผู้ดูแลระบบให้อนุมัติสิทธิ์ Google Drive แล้วลองแนบไฟล์อีกครั้ง'],
            adminSteps: [
                'เปิด Apps Script ด้วยบัญชีที่เป็นเจ้าของ deployment แล้วรันฟังก์ชัน authorizeRequiredServices หนึ่งครั้ง',
                'อนุมัติสิทธิ์ Google Sheets, Google Drive และการเชื่อมต่อบริการภายนอกให้ครบ',
                'ไปที่ Deploy > Manage deployments แล้วสร้างเวอร์ชันใหม่ โดยตั้ง Execute as เป็นบัญชีผู้ deploy',
                'ทดสอบแนบไฟล์อีกครั้ง และตรวจว่า Folder ID คือ 146sp7FoRNOyTyclbJ4Q5qqw07e4ZnSSG'
            ]
        };
    }
    if (/504|timeout|เกิน \d+ วินาที|ใช้เวลาติดต่อ/.test(text)) {
        return {
            cause: 'Apps Script ตอบกลับช้ากว่าเวลาที่ระบบกำหนด หรือกำลังมีงานจำนวนมาก',
            userSteps: ['ข้อมูลในแบบฟอร์มยังอยู่ กรุณารอสักครู่แล้วกดบันทึกอีกครั้ง', 'หากยังเกิดซ้ำ ให้ตรวจสอบอินเทอร์เน็ตแล้วแจ้งผู้ดูแลระบบ'],
            adminSteps: ['ตรวจหน้า Apps Script > Executions ว่ามีงาน Timeout หรือทำงานค้าง', 'ตรวจโควตา Google Apps Script และ Google Sheets', 'ลองทำรายการซ้ำจากแถวที่ขึ้นสถานะผิดพลาด โดยไม่สร้างแถวใหม่', 'หากเกิดซ้ำ ให้ใช้รหัสตรวจสอบและชื่อ API ด้านล่างค้นหาในบันทึกระบบ']
        };
    }
    if (/429|rate.?limit|บ่อยเกินไป/.test(text)) {
        return {
            cause: 'มีการเรียกใช้งานระบบถี่เกินข้อจำกัดชั่วคราว',
            userSteps: ['รอประมาณ 1 นาทีแล้วลองใหม่อีกครั้ง'],
            adminSteps: ['ตรวจอัตราการเรียก API และงานที่ทำซ้ำ', 'ตรวจค่า Rate Limit และ Apps Script Executions ก่อนปรับเพิ่มขีดจำกัด']
        };
    }
    if (/unauthorized|session|token|เซสชัน|เข้าสู่ระบบใหม่/.test(text)) {
        return {
            cause: 'เซสชันหมดอายุหรือข้อมูลการเข้าสู่ระบบไม่ถูกต้อง',
            userSteps: ['ออกจากระบบแล้วเข้าสู่ระบบใหม่'],
            adminSteps: ['ตรวจ token expiry และเวลาเครื่อง', 'ตรวจ LoginLogs และสิทธิ์ของบัญชีผู้ใช้']
        };
    }
    if (/forbidden|permission|ไม่มีสิทธิ์|สำหรับผู้ดูแล/.test(text)) {
        return {
            cause: 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการดังกล่าว',
            userSteps: ['ติดต่อผู้ดูแลระบบเพื่อตรวจสอบสิทธิ์'],
            adminSteps: ['ตรวจบทบาทผู้ใช้และ Permission Matrix', 'ตรวจ organizationId ของผู้ใช้และรายการข้อมูล']
        };
    }
    if (/แนบ|อัปโหลด|ไฟล์|drive/.test(text)) {
        return {
            cause: 'ไฟล์อาจไม่ตรงชนิดหรือขนาดที่กำหนด หรือการเชื่อมต่อ Drive ขัดข้อง',
            userSteps: ['ตรวจชนิดและขนาดไฟล์ แล้วลองแนบอีกครั้ง'],
            adminSteps: ['ตรวจสิทธิ์โฟลเดอร์ Google Drive และพื้นที่คงเหลือ', 'ตรวจ max_upload_size_mb และ Apps Script Executions']
        };
    }
    if (/กรุณา|ไม่ครบ|อย่างน้อย|ไม่ถูกต้อง/.test(text)) {
        return {
            cause: 'ข้อมูลที่จำเป็นยังไม่ครบหรือไม่ผ่านเงื่อนไขตรวจสอบ',
            userSteps: ['ตรวจช่องที่ระบบไฮไลต์ แล้วกรอกข้อมูลให้ครบ'],
            adminSteps: ['ตรวจชื่อช่องและค่าที่แจ้งในข้อความ', 'หากกรอกครบแล้วแต่ยังเกิดซ้ำ ให้ตรวจ validation ฝั่งหน้าเว็บและ Apps Script']
        };
    }
    if (/fetch|network|เชื่อมต่อ|ขัดข้อง|502|503|5\d\d/.test(text)) {
        return {
            cause: 'การเชื่อมต่อกับ Apps Script หรือบริการ Google ขัดข้องชั่วคราว',
            userSteps: ['ตรวจอินเทอร์เน็ต รอสักครู่ แล้วลองใหม่อีกครั้ง'],
            adminSteps: ['ตรวจ Apps Script deployment และ Executions', 'ตรวจ local proxy หรือ CORS หากทดสอบผ่าน localhost', 'ตรวจสถานะบริการ Google Workspace']
        };
    }
    return {
        cause: 'ระบบไม่สามารถดำเนินการตามคำขอได้',
        userSteps: ['ลองดำเนินการอีกครั้ง หากยังไม่สำเร็จให้แจ้งผู้ดูแลระบบ'],
        adminSteps: ['ตรวจ Console และ Apps Script Executions', 'ตรวจข้อมูลนำเข้า สิทธิ์ผู้ใช้ และสถานะการเชื่อมต่อฐานข้อมูล']
    };
}

function inferAlertIcon(message, requestedIcon = 'info') {
    if (requestedIcon && requestedIcon !== 'info') return requestedIcon;
    const text = String(message || '').toLowerCase();
    if (/ไม่สำเร็จ|ล้มเหลว|ผิดพลาด|ไม่สามารถ|ขัดข้อง|error|failed|failure|http 5\d\d/.test(text)) return 'error';
    if (/กรุณา|โปรด|ไม่พบ|อย่างน้อย|จำกัด|ยังไม่มี|ตรวจสอบ/.test(text)) return 'warning';
    if (/สำเร็จ|เรียบร้อย/.test(text)) return 'success';
    return requestedIcon || 'info';
}

function buildRoleAwareAlertPresentation(message, icon = 'info', title = '') {
    const messageText = String((message && message.message) || message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
    const resolvedIcon = inferAlertIcon(messageText, icon);
    const enhanced = resolvedIcon === 'error' || resolvedIcon === 'warning';
    const admin = isAdminUser();
    const diagnostic = enhanced ? getRelevantApiDiagnostic(messageText) : null;
    const defaultTitle = resolvedIcon === 'error' ? 'เกิดข้อผิดพลาด' : resolvedIcon === 'warning' ? 'โปรดตรวจสอบ' : '';
    if (!enhanced) return { title, text: messageText, icon: resolvedIcon, isAdmin: admin, diagnostic: null };

    const guidance = getAlertGuidance(messageText, diagnostic);
    const steps = admin ? [...guidance.userSteps, ...guidance.adminSteps] : guidance.userSteps;
    const stepsHtml = steps.map(step => `<li>${escapeHTML(step)}</li>`).join('');
    const messageHtml = escapeHTML(messageText).replace(/\n/g, '<br>');
    let diagnosticHtml = '';

    if (admin) {
        const currentUser = getCurrentUser() || {};
        const diagnosticRows = [
            ['รหัสตรวจสอบ', diagnostic ? diagnostic.id : createClientRequestId('notice')],
            ['เวลา', formatSystemDate(new Date()) + ' ' + new Date().toLocaleTimeString('th-TH')],
            ['ผู้ใช้/สิทธิ์', `${currentUser.id || '-'} / ${String(currentUser.role || '-').toUpperCase()}`],
            ['หน้า', (typeof location !== 'undefined' && location.pathname) || '/'],
            ['สถานะเครือข่าย', typeof navigator !== 'undefined' && navigator.onLine === false ? 'Offline' : 'Online'],
            ['API Action', diagnostic && diagnostic.action],
            ['HTTP Status', diagnostic && diagnostic.statusCode ? diagnostic.statusCode : 'ไม่ระบุ'],
            ['Error Code', diagnostic && diagnostic.errorCode],
            ['Attempt', diagnostic ? `${diagnostic.attempt}/${diagnostic.maxAttempts}` : 'ไม่ระบุ'],
            ['Timeout', diagnostic && diagnostic.timeoutMs ? `${Math.round(diagnostic.timeoutMs / 1000)} วินาที` : 'ไม่ระบุ']
        ].filter(row => row[1]);
        const rowsHtml = diagnosticRows.map(([label, value]) => `<div><strong>${escapeHTML(label)}:</strong> ${escapeHTML(value)}</div>`).join('');
        const backendDetails = diagnostic && diagnostic.details
            ? `<pre>${escapeHTML(JSON.stringify(diagnostic.details, null, 2))}</pre>`
            : '';
        const stack = diagnostic && diagnostic.stack
            ? `<details><summary>Stack trace</summary><pre>${escapeHTML(diagnostic.stack)}</pre></details>`
            : '';
        diagnosticHtml = `
            <div class="role-aware-alert-admin-badge">รายละเอียดสำหรับผู้ดูแลระบบสูงสุด</div>
            <div class="role-aware-alert-section"><strong>สาเหตุที่เป็นไปได้</strong><p>${escapeHTML(guidance.cause)}</p></div>
            <div class="role-aware-alert-section"><strong>รายละเอียดทางเทคนิค</strong><div class="role-aware-alert-diagnostic">${rowsHtml}</div>${backendDetails}${stack}</div>`;
    }

    return {
        title: title || defaultTitle,
        html: `
            <div class="role-aware-alert-message">${messageHtml}</div>
            ${diagnosticHtml}
            <div class="role-aware-alert-section"><strong>${admin ? 'วิธีตรวจสอบและแก้ไข' : 'สิ่งที่ควรทำ'}</strong><ol>${stepsHtml}</ol></div>`,
        icon: resolvedIcon,
        isAdmin: admin,
        diagnostic
    };
}

function appAlert(message, icon = 'info', title = '') {
    const presentation = buildRoleAwareAlertPresentation(message, icon, title);
    return Swal.fire({
        title: presentation.title,
        ...(presentation.html ? { html: presentation.html } : { text: presentation.text }),
        icon: presentation.icon,
        width: presentation.isAdmin && presentation.html ? 760 : undefined,
        customClass: presentation.html ? {
            popup: `role-aware-alert-popup role-aware-alert-${presentation.icon}`,
            htmlContainer: 'role-aware-alert-content'
        } : undefined,
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#3b82f6'
    });
}

// Database status is deliberately non-blocking: users can still inspect the
// current screen while Apps Script loads or reconnects.
function setDatabaseStatus(message, status = 'loading', detail = '', canRetry = false) {
    const bar = document.getElementById('database-load-status');
    if (!bar) return;

    const messageEl = document.getElementById('database-load-status-message');
    const detailEl = document.getElementById('database-load-status-detail');
    const retryButton = document.getElementById('database-load-status-retry');
    if (messageEl) messageEl.textContent = message;
    if (detailEl) {
        detailEl.textContent = detail;
        detailEl.hidden = !detail;
    }
    if (retryButton) {
        retryButton.hidden = !canRetry;
        retryButton.disabled = !canRetry;
    }
    bar.dataset.status = status;
    bar.hidden = false;
}

function hideDatabaseStatus() {
    const bar = document.getElementById('database-load-status');
    if (bar) bar.hidden = true;
}

function showLoading(show) {
    // A save/dialog finishing must not erase a database failure or active load.
    if (appLoadProgress && (appLoadProgress.pending || appLoadProgress.failed)) return;
    if (show) {
        setDatabaseStatus('กำลังประมวลผลข้อมูล...', 'loading');
    } else {
        hideDatabaseStatus();
    }
}

function retryDatabaseLoad() {
    if (appLoadProgress && appLoadProgress.pending) return;
    return initAppWithAPI({ retryFailed: true, automaticRetry: false });
}

// Handle login session expiration
function handleSessionExpired() {
    appLoadGeneration++;
    if (appLoadProgress) {
        appLoadProgress.controller.abort();
        window.clearInterval(appLoadProgress.timer);
        appLoadProgress = null;
    }
    hideDatabaseStatus();
    localStorage.removeItem('rdf_session_token');
    localStorage.removeItem('rdf_current_user');
    
    const loginOverlay = document.getElementById('login-overlay');
    if (loginOverlay) {
        loginOverlay.style.display = 'flex';
        initLoginFloatingIcons();
    }
    
    const profileBox = document.getElementById('user-profile-box');
    if (profileBox) profileBox.style.display = 'none';
}

function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem('rdf_current_user') || 'null');
    } catch (e) {
        return null;
    }
}

function isAdminUser(user = getCurrentUser()) {
    return !!(user && user.role && user.role.toLowerCase() === 'admin');
}

function isConfigEnabled(value) {
    return value === true || String(value).toLowerCase() === 'true';
}

// Display logged in user details in sidebar + header
// (login response shape is {id, name, role, organizationId} — no "username"/"avatar" field, see Auth.gs login())
function showUserProfile(user) {
    if (!user) return;

    const profileBox = document.getElementById('user-profile-box');
    const profileName = document.getElementById('user-profile-name');
    const profileRole = document.getElementById('user-profile-role');
    const avatarChar = document.getElementById('user-avatar-char');
    if (profileBox) {
        profileBox.style.display = 'flex';
        if (profileName) profileName.textContent = user.name || user.id;
        if (profileRole) profileRole.textContent = `สิทธิ์: ${user.role || 'staff'}`;
        if (avatarChar) avatarChar.textContent = (user.name || 'U').substring(0, 1).toUpperCase();
    }

    const usernameEl = document.getElementById('header-username');
    const roleEl = document.getElementById('header-role');
    const avatarEl = document.getElementById('header-avatar');
    if (usernameEl) usernameEl.textContent = user.name || user.id || 'Guest';
    if (roleEl) roleEl.textContent = (user.role || 'User').toUpperCase();
    if (avatarEl) avatarEl.src = user.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name || user.id || 'User') + '&background=random');

    // Check Admin rights
    const isAdmin = isAdminUser(user);
    const navUserMgt = document.getElementById('nav-user-management');
    if (navUserMgt) {
        navUserMgt.style.display = isAdmin ? 'flex' : 'none';
    }
    const navSettings = document.getElementById('nav-settings');
    if (navSettings) {
        navSettings.style.display = isAdmin ? 'flex' : 'none';
    }
    const bottomAdminMenu = document.getElementById('bottom-admin-menu');
    if (bottomAdminMenu) {
        bottomAdminMenu.style.display = isAdmin ? 'flex' : 'none';
    }
    document.querySelectorAll('[data-tab="settings-view"], [data-tab="user-management"]').forEach(item => {
        if (!item.closest('.nav-menu')) item.style.display = isAdmin ? '' : 'none';
    });
    if (!isAdmin && (state.activeTab === 'settings-view' || state.activeTab === 'user-management')) {
        switchTab('dashboard');
    }
}

// Month names in Thai
const THAI_MONTH_NAMES = [
    "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

// Chart instance
let chartCategories = null;

// File attachment store (stored separately from main state)
let attachmentStore = {};

// Track whether the expense modal is opened in "Additional Project" mode
let isNewProjectExpenseMode = false;
let expenseModalSource = null;
let expenseModalOrganizationId = '';
let expenseModalDocumentPrefix = '';
let expenseCreateRequestId = '';
let attachmentCreateRequestId = '';
let attachmentModalSourceRowId = '';
let expenseModalNoteMetadata = { customFields: {}, multiItems: [] };

// Temporary attachments array for new/editing bills
let tempBillAttachments = [];
let quickExpenseRows = [];
let quickExpenseRowSequence = 0;
let quickExpenseEntryMode = 'EXP';
let quickExpenseAttachmentsByRow = {};
let quickExpenseMultiItemsByRow = {};
const quickExpenseHiddenSavedIds = new Set();
let currentQuickExpenseRowId = null;
let quickFoodRows = [];
let quickFoodRowSequence = 0;
let quickFoodAttachmentsByRow = {};
let quickExpenseFileProcessingCount = 0;
let quickFoodFileProcessingCount = 0;
let quickImportPreview = null;
let quickExpenseDraftSaveTimer = null;
const quickExpenseInlineSaveTimers = new Map();
let isRestoringQuickExpenseDraft = false;

const QUICK_EXPENSE_DRAFT_STORAGE_VERSION = 1;
const QUICK_EXPENSE_DRAFT_STORAGE_PREFIX = 'rdf_quick_expense_draft';

const QUICK_EXPENSE_BILLING_PROFILES = Object.freeze([
    { code: 'OF', name: 'office' },
    { code: 'BS', name: 'Boribhat Suksa' },
    { code: 'VC', name: 'Vocational College' },
    { code: 'P', name: 'โปรเจกต์อื่นๆ' }
]);

function createClientRequestId(scope = 'request') {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return `${scope}-${window.crypto.randomUUID()}`;
    }
    return `${scope}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function setFormControlsBusy(form, busy) {
    if (!form) return;
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
    form.querySelectorAll('input, select, textarea, button').forEach(element => {
        if (busy) {
            if (!element.disabled) {
                element.dataset.busyLocked = 'true';
                element.disabled = true;
            }
        } else if (element.dataset.busyLocked === 'true') {
            element.disabled = false;
            delete element.dataset.busyLocked;
        }
    });
}

// ==========================================================================
// Default State (v4)
// ==========================================================================
function getCurrentBangkokPeriod() {
    const now = new Date();
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Bangkok',
            year: 'numeric',
            month: 'numeric'
        }).formatToParts(now);
        const year = Number((parts.find(part => part.type === 'year') || {}).value);
        const month = Number((parts.find(part => part.type === 'month') || {}).value);
        if (year && month >= 1 && month <= 12) return { month, yearBE: year + 543 };
    } catch (error) {}
    return { month: now.getMonth() + 1, yearBE: now.getFullYear() + 543 };
}

function getDefaultState() {
    const currentPeriod = getCurrentBangkokPeriod();
    const currentMonth = currentPeriod.month;
    const currentYearBE = currentPeriod.yearBE;

    return {
        // ---- Master Data ----
        projects: [
            { id: "PJ001", name: "โครงการหอพัก", budget: 0, active: true },
            { id: "PJ002", name: "โครงการพัฒนาวิชาชีพ", budget: 0, active: true },
            { id: "PJ003", name: "โครงการพัฒนาผู้เรียน", budget: 0, active: true },
            { id: "PJ004", name: "โครงการทั่วไป", budget: 0, active: true }
        ],
        categories: [
            { id: "CAT01", name: "อาหาร" },
            { id: "CAT02", name: "วัสดุ" },
            { id: "CAT03", name: "ค่าไฟฟ้า" },
            { id: "CAT04", name: "ค่าน้ำประปา" },
            { id: "CAT05", name: "เชื้อเพลิง/แก๊ส" },
            { id: "CAT06", name: "ค่าซ่อมบำรุง" },
            { id: "CAT07", name: "ค่าเดินทาง" },
            { id: "CAT08", name: "กิจกรรม" },
            { id: "CAT09", name: "ครุภัณฑ์" },
            { id: "CAT10", name: "อื่นๆ" }
        ],
        vendors: [
            { id: "VEN001", name: "ธนาพาณิชย์แก๊ส", phone: "" },
            { id: "VEN002", name: "ห้างโลตัส (Lotus's)", phone: "" }
        ],
        fundSources: [
            { id: "FS001", name: "เงินสำรองจ่าย(เงินเก็บนักเรียน)" },
            { id: "FS002", name: "เงินสะสมหอพัก" }
        ],
        organizations: [],

        // ---- Expense Records ----
        expenses: [],

        // Utility bills (electric, water, etc.)
        attachments: [],

        // Monthly food expense records
        foodExpenses: [],

        // ---- UI State ----
        theme: "light",
        activeTab: "dashboard",
        selectedMonth: currentMonth,
        selectedYear: currentYearBE,
        calculationMode: "all",
        dateFormat: "MMM_DD_YYYY",
        monthStatuses: {}, // แคชสถานะเบิกจ่ายรายเดือน ดึงจาก backend สดทุกครั้งที่เปลี่ยนเดือน/ปี (ดู refreshCarryOverAmount)
        carryOverAmount: 0,
        carryOverStatus: "idle",
        claimsLoadStatus: "idle",
        fundReceiptsLoadStatus: "idle",

        // ---- Claims & Signatures ----
        claims: [],
        bills: [],
        claimBillMap: [],
        fundReceipts: [],
        signatures: { prepared: null, checked: null, approved: null },
        signatureLibrary: [],
        signatureSelection: { prepared: '', checked: '', approved: '' },
        columns: [
            { id: "documentNo", label: "เลขบิล", visible: true, custom: false },
            { id: "receiptNo", label: "เล่มที่ / เลขที่ใบเสร็จ", visible: true, custom: false },
            { id: "expenseDate", label: "วันที่บิล", visible: true, custom: false },
            { id: "postingMonth", label: "รอบบันทึก", visible: true, custom: false },
            { id: "projectId", label: "โครงการ", visible: true, custom: false },
            { id: "categoryId", label: "หมวดหมู่", visible: true, custom: false },
            { id: "fundSourceId", label: "แหล่งเงิน", visible: true, custom: false },
            { id: "vendorId", label: "ร้านค้า/ผู้ขาย", visible: true, custom: false },
            { id: "description", label: "รายละเอียด", visible: true, custom: false },
            { id: "quantity", label: "จำนวน", visible: true, custom: false },
            { id: "unitPrice", label: "ราคาหน่วย", visible: true, custom: false },
            { id: "amount", label: "รวม", visible: true, custom: false },
            { id: "claimable", label: "ประเภท", visible: true, custom: false },
            { id: "attachment", label: "หลักฐาน", visible: true, custom: false },
            { id: "organizationId", label: "สถานศึกษา", visible: false, custom: false }
        ],
        loginBg: "",
        loginBgMode: "slideshow"
    };
}

// Application State
let state = getDefaultState();

// Inline multi-items & custom fields temporary state
let inlineExpMultiItems = null;
let inlineAttMultiItems = null;
let currentMultiItems = [];
let currentMultiItemsTarget = null;

// ==========================================================================
// Public Document Verification (สแกน QR แล้วมาที่นี่ — ไม่ต้อง login)
// ==========================================================================
const VERIFY_TYPE_LABELS = { claim: 'ใบเบิก/ชุดส่งเบิก', food: 'รายงานค่าอาหารประจำเดือน', fundreceipt: 'เอกสารรับเงินทุนประจำเดือน', export: 'รายงานส่งออก' };

function initVerifyModeIfPresent() {
    const params = new URLSearchParams(window.location.search);
    let type = params.get('verify_type');
    let code = params.get('verify_code');
    const shortExportCode = params.get('v');
    if (shortExportCode && !type && !code) {
        type = 'export';
        code = shortExportCode;
    }
    if (!type || !code) return false;

    // รายงาน export: ไม่แสดงสรุปแบบ public แต่บังคับ login ก่อนแล้วพาไปดูรายการบิลของเดือนนั้นในระบบ
    // เก็บ pending ไว้ resolve หลัง login สำเร็จ (ดู resolvePendingExportVerify) แล้วปล่อยให้ flow ปกติทำงานต่อ
    if (type === 'export') {
        try { sessionStorage.setItem('rdf_pending_export_verify', JSON.stringify({ code })); } catch (e) {}
        try { window.history.replaceState({}, '', window.location.pathname); } catch (e) {}
    }

    const loginOverlay = document.getElementById('login-overlay');
    const appShell = document.getElementById('app-shell');
    const verifyView = document.getElementById('verify-result-view');
    if (loginOverlay) loginOverlay.style.display = 'none';
    if (appShell) appShell.style.display = 'none';
    if (!verifyView) return true;
    verifyView.style.display = 'flex';

    fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'verifyDocument', data: { type, code } })
    }).then(r => r.json()).then(result => {
        renderVerifyResult(result, type);
    }).catch(() => {
        renderVerifyResult({ success: false, error: { message: 'ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองใหม่' } }, type);
    });

    return true;
}

function renderVerifyResult(result, type) {
    const box = document.getElementById('verify-result-box');
    if (!box) return;
    const typeLabel = VERIFY_TYPE_LABELS[type] || 'เอกสาร';

    if (!result || !result.success) {
        const msg = (result && result.error && result.error.message) || 'ไม่พบเอกสารนี้ในระบบ';
        box.innerHTML = `
            <div style="text-align:center;">
                <i data-lucide="x-circle" style="width:56px;height:56px;color:#ef4444;"></i>
                <h2 style="margin:12px 0 4px;color:#ef4444;">ไม่สามารถตรวจสอบเอกสารได้</h2>
                <p style="color:#6b7280;font-size:14px;">${escapeHTML(msg)}</p>
            </div>`;
        initializeLucide();
        return;
    }

    const d = result.data || {};
    let rows = '';
    if (type === 'claim') {
        rows = `
            <div class="vr-row"><span>เลขที่เอกสาร</span><strong>${escapeHTML(d.documentNo || '-')}</strong></div>
            <div class="vr-row"><span>ชื่อชุดส่งเบิก</span><strong>${escapeHTML(d.title || '-')}</strong></div>
            <div class="vr-row"><span>เดือน</span><strong>${escapeHTML(d.month || '-')}</strong></div>
            <div class="vr-row"><span>จำนวนรายการ</span><strong>${d.itemCount ?? '-'}</strong></div>
            <div class="vr-row"><span>ยอดรวม</span><strong>${(parseFloat(d.totalAmount) || 0).toLocaleString('th-TH', {minimumFractionDigits:2})} บาท</strong></div>
            <div class="vr-row"><span>สถานะปัจจุบัน</span><strong>${escapeHTML(d.status || '-')}</strong></div>`;
    } else if (type === 'food') {
        rows = `
            <div class="vr-row"><span>เดือน</span><strong>${escapeHTML(d.month || '-')}</strong></div>
            <div class="vr-row"><span>จำนวนรายการ</span><strong>${d.recordCount ?? '-'}</strong></div>
            <div class="vr-row"><span>ยอดรวม</span><strong>${(parseFloat(d.totalAmount) || 0).toLocaleString('th-TH', {minimumFractionDigits:2})} บาท</strong></div>`;
    } else if (type === 'fundreceipt') {
        rows = `
            <div class="vr-row"><span>เดือน</span><strong>${escapeHTML(d.month || '-')}</strong></div>
            <div class="vr-row"><span>จำนวนเงิน</span><strong>${(parseFloat(d.amount) || 0).toLocaleString('th-TH', {minimumFractionDigits:2})} บาท</strong></div>
            ${d.note ? `<div class="vr-row"><span>หมายเหตุ</span><strong>${escapeHTML(d.note)}</strong></div>` : ''}`;
    } else if (type === 'export') {
        if (d.publicSummaryEnabled === false) {
            rows = `
                <div class="vr-row"><span>เลขที่เอกสาร</span><strong>${escapeHTML(d.docNumber || '-')}</strong></div>
                <div class="vr-row"><span>ข้อมูลสรุปสาธารณะ</span><strong>ปิดอยู่</strong></div>
                <p style="font-size:12px;color:#6b7280;margin:12px 0 0;">ผู้ดูแลระบบปิดการแสดงข้อมูลเบื้องต้นไว้ กรุณาเข้าสู่ระบบเพื่อดูรายละเอียดตามสิทธิ์ของผู้ใช้งาน</p>`;
        } else {
            rows = `
                <div class="vr-row"><span>เลขที่เอกสาร</span><strong>${escapeHTML(d.docNumber || '-')}</strong></div>
                <div class="vr-row"><span>เดือนรายงาน</span><strong>${escapeHTML(d.month || '-')}</strong></div>
                <div class="vr-row"><span>จำนวนรายการ</span><strong>${d.itemCount ?? '-'}</strong></div>
                <div class="vr-row"><span>ไฟล์หลักฐาน</span><strong>${d.attachmentCount ?? 0} ไฟล์</strong></div>
                <div class="vr-row"><span>ยอดรวม</span><strong>${(parseFloat(d.totalAmount) || 0).toLocaleString('th-TH', {minimumFractionDigits:2})} บาท</strong></div>`;
        }
    }

    box.innerHTML = `
        <div style="text-align:center;">
            <i data-lucide="check-circle-2" style="width:56px;height:56px;color:#10b981;"></i>
            <h2 style="margin:12px 0 4px;color:#10b981;">ตรวจสอบสำเร็จ</h2>
            <p style="color:#6b7280;font-size:13px;margin-bottom:20px;">${typeLabel} — ข้อมูลนี้ดึงจากระบบจริงแบบเรียลไทม์</p>
        </div>
        <div style="text-align:left;">${rows}</div>
        ${type === 'export' ? `
        <div style="display:flex;justify-content:center;margin-top:18px;">
            <button type="button" class="btn btn-primary" onclick="continueExportVerifyLogin(${JSON.stringify(d.verifyCode || d.docNumber || '').replace(/"/g, '&quot;')})">เข้าสู่ระบบเพื่อดูรายละเอียด</button>
        </div>` : ''}
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:20px;">RDF Expense System — วิทยาลัยการอาชีพแม่สะเรียง</p>`;
    initializeLucide();
}

function continueExportVerifyLogin(code) {
    if (code) {
        try { sessionStorage.setItem('rdf_pending_export_verify', JSON.stringify({ code })); } catch (e) {}
    }
    const verifyView = document.getElementById('verify-result-view');
    const loginOverlay = document.getElementById('login-overlay');
    const appShell = document.getElementById('app-shell');
    if (verifyView) verifyView.style.display = 'none';
    if (appShell) appShell.style.display = 'none';
    if (loginOverlay) {
        loginOverlay.style.display = 'flex';
        initLoginFloatingIcons();
    }
}
window.continueExportVerifyLogin = continueExportVerifyLogin;

// สแกน QR ของรายงาน export → หลัง login สำเร็จ พาไปดูรายการบิลของเดือนนั้นในระบบ (ตามสิทธิ์ผู้ล็อกอิน)
// เรียกจากท้าย checkUserSession() และ handleLoginSubmit() หลัง initAppWithAPI() สำเร็จ
async function resolvePendingExportVerify() {
    let pending = null;
    try { pending = JSON.parse(sessionStorage.getItem('rdf_pending_export_verify') || 'null'); } catch (e) {}
    if (!pending || !pending.code) return;
    sessionStorage.removeItem('rdf_pending_export_verify'); // กันวนลูป — ล้างก่อนเสมอ

    try {
        const res = await apiCall('verifyDocument', { type: 'export', code: pending.code });
        const month = (res && res.month) || ''; // "YYYY-MM" (ค.ศ.)
        if (!month) {
            appAlert('ไม่พบเอกสารเลขที่ ' + pending.code + ' ในระบบ — อาจถูกลบหรือรหัสไม่ถูกต้อง', 'error');
            return;
        }
        const [ceY, mm] = month.split('-');
        state.selectedYear = (parseInt(ceY, 10) || 0) + 543;
        state.selectedMonth = parseInt(mm, 10) || state.selectedMonth;
        const ys = document.getElementById('select-year'); if (ys) ys.value = state.selectedYear;
        const msel = document.getElementById('select-month'); if (msel) msel.value = state.selectedMonth;
        saveState();
        switchTab('bills-table');
        await initAppWithAPI();
        const thM = THAI_MONTH_NAMES[state.selectedMonth - 1] || '';
        appAlert('เปิดเอกสารเลขที่ ' + ((res && res.docNumber) || pending.code) + ' — แสดงรายการบิลประจำ' + thM + ' ' + state.selectedYear, 'success');
    } catch (err) {
        appAlert('ไม่สามารถเปิดเอกสารได้: ' + ((err && err.message) || 'เกิดข้อผิดพลาด'), 'error');
    }
}

// ==========================================================================
// Initialization & Lifecycle
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    if (initVerifyModeIfPresent()) return;

    loadState();
    applyLoginBackground();
    initializeLucide();
    startSystemDateInputObserver();

    const savedUser = localStorage.getItem('rdf_current_user');
    if (savedUser) {
        try {
            showUserProfile(JSON.parse(savedUser));
        } catch(e){}
    }

    setupDropdownDefaults();
    setupEventBindings();
    
    // ตั้งค่าฟอร์ม Login และปุ่มออกจากระบบ
    const loginForm = document.getElementById('form-login');
    if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);
    
    const logoutBtn = document.getElementById('nav-item-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // ตรวจสอบเซสชันผู้ใช้งาน
    checkUserSession();
});

// ตรวจสอบความถูกต้องของ Session Token
async function checkUserSession() {
    const token = localStorage.getItem('rdf_session_token');
    const userStr = localStorage.getItem('rdf_current_user');
    
    if (token && userStr) {
        try {
            const user = JSON.parse(userStr);
            const loginOverlay = document.getElementById('login-overlay');
            if (loginOverlay) loginOverlay.style.display = 'none';
            showUserProfile(user);
            await initAppWithAPI();
            await resolvePendingExportVerify(); // สแกน QR ตอน login อยู่แล้ว → เปิดเอกสาร
        } catch (e) {
            handleSessionExpired();
        }
    } else {
        handleSessionExpired();
    }
}

// ลงชื่อเข้าใช้งานส่งข้อมูลตรวจสอบสิทธิ์ผ่าน GAS API
async function handleLoginSubmit(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const errorMsg = document.getElementById('login-error-msg');
    
    if (!username || !password) return;
    
    // แฮชรหัสผ่านฝั่งหน้าบ้าน (SHA-256) ก่อนส่งมอบไประบบหลังบ้าน
    const passwordHash = await sha256(password);
    
    try {
        const submitBtn = document.getElementById('btn-login-submit');
        submitBtn.disabled = true;
        submitBtn.innerHTML = 'กำลังตรวจสอบ...';
        if (errorMsg) errorMsg.style.display = 'none';

        const response = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                action: 'login',
                data: { username, passwordHash }
            })
        });
        const result = await response.json();
        
        if (result.status === 'success' || result.success) {
            localStorage.setItem('rdf_session_token', result.data.token);
            localStorage.setItem('rdf_current_user', JSON.stringify(result.data.user));
            localStorage.setItem('rdf_login_time', new Date().toISOString());
            
            // ซ่อน Overlay ล็อกอิน
            const loginOverlay = document.getElementById('login-overlay');
            if (loginOverlay) loginOverlay.style.display = 'none';
            
            showUserProfile(result.data.user);

            // โหลดข้อมูลแอปพลิเคชันจากฐานข้อมูลจริง
            await initAppWithAPI();
            await resolvePendingExportVerify(); // สแกน QR แล้วเพิ่ง login → เปิดเอกสารเดือนนั้น
        } else {
            if (errorMsg) {
                errorMsg.textContent = result.message || (result.error && result.error.message) || 'Unknown error';
                errorMsg.style.display = 'block';
            }
        }
    } catch (err) {
        if (errorMsg) {
            errorMsg.textContent = 'การเชื่อมต่อฐานข้อมูลล้มเหลว หรือสคริปต์ยังไม่ได้เปิดให้เข้าถึง';
            errorMsg.style.display = 'block';
        }
        console.error('Login error:', err);
    } finally {
        const submitBtn = document.getElementById('btn-login-submit');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i data-lucide="log-in"></i> เข้าสู่ระบบ';
        }
        initializeLucide();
    }
}

// ออกจากระบบ
async function handleLogout() {
    if (!await appConfirm('ยืนยันออกจากระบบขอเบิกรายจ่ายใช่หรือไม่?')) return;
    showLoading(true);
    try {
        const token = localStorage.getItem('rdf_session_token');
        if (token) {
            await fetch(API_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'logout', token })
            });
        }
    } catch (e) {
        console.warn('Logout API error:', e.message);
    } finally {
        handleSessionExpired();
        showLoading(false);
        appAlert('ออกจากระบบสำเร็จแล้ว');
    }
}

let appLoadGeneration = 0;
let appLoadProgress = null;

function updateDatabaseLoadProgress(load) {
    if (appLoadProgress !== load || load.controller.signal.aborted) return;
    const completed = Object.keys(load.results).length;
    const remaining = load.tasks.filter(task => !(task.key in load.results));
    const renderErrors = Object.entries(load.errors).filter(([key]) => key === 'render' || key.startsWith('render:'));
    const elapsed = Math.floor((Date.now() - load.startedAt) / 1000);
    const clock = document.getElementById('database-load-status-elapsed');
    if (clock) {
        clock.hidden = false;
        clock.textContent = `ผ่านไป ${elapsed} วินาที`;
    }
    if (!load.pending && !load.failed) {
        hideDatabaseStatus();
        return;
    }
    const message = load.failed && !load.pending
        ? (remaining.length === 0 && renderErrors.length > 0
            ? `โหลดข้อมูลครบ ${completed}/${load.tasks.length} ส่วน — แสดงผลบางส่วนไม่สำเร็จ`
            : `โหลดข้อมูลได้ ${completed}/${load.tasks.length} ส่วน — บางส่วนยังไม่สำเร็จ`)
        : `${load.coreRendered ? 'แสดงรายการแล้ว กำลังโหลดข้อมูลประกอบ' : 'กำลังโหลดข้อมูลจากฐานข้อมูล'} (${completed}/${load.tasks.length})`;
    const uniqueRenderMessages = [...new Set(renderErrors.map(([, error]) => error?.message || 'แสดงข้อมูลไม่สำเร็จ'))];
    const detail = load.failed && !load.pending
        ? (remaining.map(task => `${task.label}: ${load.errors[task.key]?.message || 'โหลดไม่สำเร็จ'}`).join(' • ')
            || uniqueRenderMessages.join(' • ')
            || Object.values(load.errors).map(error => error?.message || 'แสดงข้อมูลไม่สำเร็จ').join(' • '))
        : `รอ: ${remaining.map(task => task.label).join(', ')}${elapsed >= 10 ? ' — การตอบกลับช้ากว่าปกติ' : ''}${load.retrying ? ' (กำลังลองเชื่อมต่อใหม่)' : ''}`;
    setDatabaseStatus(message, load.pending ? 'loading' : 'error', detail, !load.pending);
}

// โหลดฐานข้อมูลหลักแบบ real-time จาก Google Sheets
async function initAppWithAPI({ retryFailed = false, automaticRetry = false } = {}) {
    const loadGeneration = ++appLoadGeneration;
    const selectedMonth = state.selectedMonth;
    const selectedYear = state.selectedYear;
    const monthFilter = `${selectedYear - 543}-${String(selectedMonth).padStart(2, '0')}`;
    const token = localStorage.getItem('rdf_session_token');
    const previous = appLoadProgress;
    const retained = retryFailed && previous && previous.month === monthFilter && previous.token === token
        ? previous.results : {};
    if (previous) {
        previous.controller.abort();
        window.clearInterval(previous.timer);
        window.clearTimeout(previous.retryTimer);
    }
    const load = {
        month: monthFilter, token, controller: new AbortController(), startedAt: Date.now(),
        results: { ...retained }, errors: {}, pending: true, failed: false, coreRendered: false,
        tasks: [], timer: null, retryTimer: null, retrying: false,
        autoRetryCount: automaticRetry && previous ? previous.autoRetryCount + 1 : 0
    };
    appLoadProgress = load;
    const isCurrent = () => loadGeneration === appLoadGeneration && !load.controller.signal.aborted
        && localStorage.getItem('rdf_session_token') === token;
    const options = {
        signal: load.controller.signal,
        onRetry: () => { if (isCurrent()) { load.retrying = true; updateDatabaseLoadProgress(load); } }
    };
    const read = (action, data = null, filters = null) => apiCall(action, data, filters, null, options);
    // Start independent reads together. A slow claim/balance request must not
    // delay the monthly bill tables, nor discard results that already arrived.
    load.tasks = [
        { key: 'runtime', label: 'การตั้งค่า', fetch: () => read('getRuntimeConfig'), apply: value => {
            state.maxUploadSizeMb = parseFloat(value.maxUploadSizeMb) || 2;
            state.requireAttachment = isConfigEnabled(value.requireAttachment);
            state.dateFormat = normalizeSystemDateFormat(value.dateFormat);
            queueSystemDateInputRefresh();
            if (load.coreRendered) renderAll();
        } },
        { key: 'master', label: 'ข้อมูลหลัก', fetch: () => read('getMasterData') },
        { key: 'expenses', label: 'รายการบิล', fetch: () => fetchAllExpensesForMonth(monthFilter, options) },
        { key: 'food', label: 'ค่าอาหาร', fetch: () => fetchAllFoodExpensesForMonth(monthFilter, options), apply: value => {
            state.foodExpenses = value || [];
            if (load.coreRendered) renderTables();
        } },
        { key: 'claims', label: 'ชุดส่งเบิก', fetch: () => read('getClaims', null, { month: monthFilter }), apply: value => {
            state.claims = value.claims || [];
            state.claimsLoadStatus = 'ready';
            if (load.coreRendered && state.activeTab === 'claims-view') renderClaims();
        } },
        { key: 'receipts', label: 'เอกสารรับเงิน', fetch: () => read('getFundReceipts', null, { year: String(selectedYear - 543) }), apply: value => {
            state.fundReceipts = value.fundReceipts || [];
            state.fundReceiptsLoadStatus = 'ready';
            if (load.coreRendered) {
                updateFundReceiptWidget();
                if (state.activeTab === 'fund-receipts') renderFundReceiptsOverview();
            }
        } },
        { key: 'carry', label: 'ยอดยกมา', fetch: () => read('getCarryOverAmount', { beforeMonth: selectedMonth, beforeYear: selectedYear }), apply: value => {
            state.carryOverAmount = value.carryOverAmount || 0;
            state.carryOverStatus = 'ready';
            if (load.coreRendered) { updateMetricsBar(); renderSpreadsheet(); }
        } },
        { key: 'statuses', label: 'สถานะรายเดือน', fetch: () => read('getMonthStatuses', { year: selectedYear - 543 }), apply: value => {
            state.monthStatuses = value.statuses || {};
            updateMonthStatusCheckboxUI();
        } }
    ];
    if (!('carry' in load.results)) {
        state.carryOverAmount = 0;
        state.carryOverStatus = 'loading';
    }
    if (!('claims' in load.results)) {
        state.claims = [];
        state.claimsLoadStatus = 'loading';
    }
    if (!('receipts' in load.results)) {
        state.fundReceipts = [];
        state.fundReceiptsLoadStatus = 'loading';
    }
    const renderSafely = (key, callback) => {
        try {
            callback();
            delete load.errors[`render:${key}`];
        } catch (error) {
            load.errors[`render:${key}`] = error;
            console.error(`Render [${key}] failed:`, error);
        }
    };
    const applyTask = task => {
        if (!task.apply || !(task.key in load.results)) return;
        renderSafely(task.key, () => task.apply(load.results[task.key]));
    };
    const publishCore = () => {
        if (load.coreRendered || !['master', 'expenses'].every(key => key in load.results)) return;
        // Mark the core data as published before drawing it. If one optional
        // widget fails, later API responses must not rerun the whole renderer
        // and report the same UI error several times.
        load.coreRendered = true;
        renderSafely('core', () => {
            const { master, expenses } = load.results;
            state.projects = (master.projects || []).map(p => ({ ...p, name: p.projectName || p.name }));
            state.categories = (master.categories || []).map(c => ({ ...c, name: c.categoryName || c.name }));
            state.vendors = (master.vendors || []).map(v => ({ ...v, name: v.vendorName || v.name }));
            state.fundSources = (master.fundSources || []).map(f => ({ ...f, name: f.name || f.fundSourceName }));
            state.organizations = (master.organizations || []).map(o => ({ ...o, name: o.nameTh || o.name }));
            state.expenses = expenses.filter(e => e.id && e.id.startsWith('EXP'));
            state.attachments = expenses.filter(e => e.id && e.id.startsWith('ATT'));
            state.foodExpenses = load.results.food || [];
            loadAttachments();
            renderAll();
        });
    };
    try {
        // Retry only the failed resources of this same month/session.
        load.tasks.forEach(applyTask);
        publishCore();
        updateDatabaseLoadProgress(load);
        load.timer = window.setInterval(() => updateDatabaseLoadProgress(load), 1000);
        await mapWithConcurrency(load.tasks, INITIAL_DATABASE_LOAD_CONCURRENCY, async task => {
            if (task.key in load.results) return;
            try {
                const value = await task.fetch();
                if (!isCurrent()) return;
                load.results[task.key] = value;
                applyTask(task);
                publishCore();
            } catch (error) {
                if (!isCurrent()) return;
                load.errors[task.key] = error;
                if (task.key === 'carry') state.carryOverStatus = 'error';
                if (task.key === 'claims') {
                    state.claimsLoadStatus = 'error';
                    if (state.activeTab === 'claims-view') renderSafely('claims', renderClaims);
                }
                if (task.key === 'receipts') {
                    state.fundReceiptsLoadStatus = 'error';
                    if (state.activeTab === 'fund-receipts') renderSafely('receipts', renderFundReceiptsOverview);
                }
            }
            if (isCurrent()) updateDatabaseLoadProgress(load);
        });
    } catch (error) {
        if (isCurrent()) load.errors.render = error;
    } finally {
        window.clearInterval(load.timer);
        if (isCurrent()) {
            load.pending = false;
            load.failed = Object.keys(load.errors).length > 0;
            updateDatabaseLoadProgress(load);
            const failedResourceKeys = Object.keys(load.errors)
                .filter(key => key !== 'render' && !key.startsWith('render:'));
            if (failedResourceKeys.length > 0 && load.autoRetryCount < DATABASE_AUTO_RETRY_LIMIT) {
                load.retryTimer = window.setTimeout(() => {
                    if (appLoadProgress === load && !load.controller.signal.aborted) {
                        initAppWithAPI({ retryFailed: true, automaticRetry: true });
                    }
                }, DATABASE_AUTO_RETRY_DELAY_MS);
            }
        }
    }
}

// Refresh only the record resource used by the monthly bill widgets. This is
// used immediately after saving so a failure in an unrelated dashboard or
// claim request cannot hide a record that the API already saved.
async function refreshExpenseRecordsForSelectedMonth() {
    const allExpenses = await fetchAllExpensesForMonth(getSelectedPostingMonth());
    state.expenses = allExpenses.filter(expense => expense.id && expense.id.startsWith('EXP'));
    state.attachments = allExpenses.filter(expense => expense.id && expense.id.startsWith('ATT'));
}

function loadState() {
    const savedSettings = localStorage.getItem('rdf_expense_ui_settings');
    const defaults = getDefaultState();
    
    // โหลดเฉพาะ UI settings เพื่อความปลอดภัย ข้อมูลธุรกรรมหลักจะพึ่งพา Google Sheets เสมอ
    state = {
        ...defaults,
        expenses: [],
        attachments: [],
        claims: []
    };
    
    if (savedSettings) {
        try {
            const parsed = JSON.parse(savedSettings);
            state.theme = parsed.theme || 'light';
            state.activeTab = parsed.activeTab || 'dashboard';
            // Month/year always start at the current Bangkok period after a
            // new page load. User changes remain active for the current session.
            state.selectedMonth = defaults.selectedMonth;
            state.selectedYear = defaults.selectedYear;
            state.calculationMode = parsed.calculationMode || 'all';
            state.signatures = { ...defaults.signatures, ...(parsed.signatures || {}) };
            state.signatureLibrary = Array.isArray(parsed.signatureLibrary) ? parsed.signatureLibrary : [];
            state.signatureSelection = { ...defaults.signatureSelection, ...(parsed.signatureSelection || {}) };
            // Migrate signatures created by the original canvas-only implementation
            // into the selectable local library without losing the legacy data URL.
            ['prepared', 'checked', 'approved'].forEach(role => {
                const dataUrl = state.signatures[role];
                if (typeof dataUrl === 'string' && dataUrl && !state.signatureLibrary.some(item => item.dataUrl === dataUrl)) {
                    const id = `local-legacy-${role}`;
                    state.signatureLibrary.push({ id, roleInDoc: role, name: `ลายเซ็น ${role}`, fileName: `signature-${role}.png`, mimeType: 'image/png', source: 'drawn', dataUrl, createdAt: new Date().toISOString() });
                    state.signatureSelection[role] = id;
                }
            });
            state.loginBg = parsed.loginBg || '';
            state.loginBgMode = parsed.loginBgMode || 'slideshow';
            if (parsed.columns) {
                state.columns = parsed.columns;
                // เติมคอลัมน์ default ใหม่ที่ยังไม่มีใน settings เก่าที่ผู้ใช้บันทึกไว้ (เช่น organizationId ที่เพิ่งเพิ่ม)
                defaults.columns.forEach(defCol => {
                    if (!state.columns.some(c => c.id === defCol.id)) {
                        state.columns.push({ ...defCol });
                    }
                });
            }
        } catch (e) {
            console.error("Failed to parse saved UI settings", e);
        }
    }
}

function saveState() {
    const uiSettings = {
        theme: state.theme,
        activeTab: state.activeTab,
        calculationMode: state.calculationMode,
        signatures: state.signatures,
        signatureLibrary: state.signatureLibrary || [],
        signatureSelection: state.signatureSelection || { prepared: '', checked: '', approved: '' },
        columns: state.columns,
        loginBg: state.loginBg,
        loginBgMode: state.loginBgMode
    };
    localStorage.setItem('rdf_expense_ui_settings', JSON.stringify(uiSettings));
}

const LOCAL_ICON_PATHS = Object.freeze({
    generic: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    'plus-circle': '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    'circle-check': '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16.5 9"/>',
    'chevron-up': '<path d="m6 15 6-6 6 6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    paperclip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L14 3a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-3-3L15 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 13h6M9 17h6"/>',
    receipt: '<path d="M6 3v18l3-2 3 2 3-2 3 2V3l-3 2-3-2-3 2-3-2Z"/><path d="M9 9h6M9 13h6"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 4v16"/>',
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    wallet: '<path d="M4 6h14a2 2 0 0 1 2 2v11H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13"/><path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z"/>',
    package: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 8 9 5 9-5M3 8v9l9 5 9-5V8M12 13v9"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
    school: '<path d="m3 10 9-6 9 6M5 9v11h14V9M9 20v-6h6v6"/>',
    graduation: '<path d="m2 10 10-5 10 5-10 5L2 10Z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/>',
    store: '<path d="M4 10v10h16V10M3 10l2-6h14l2 6M8 20v-6h5v6"/><path d="M3 10c1.5 2 3.5 2 5 0 1.5 2 3.5 2 5 0 1.5 2 3.5 2 5 0 1 1.3 2 1.5 3 0"/>',
    shield: '<path d="M12 3 20 6v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-3Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5M12 18h.01"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8A8 8 0 0 1 20 12M17.9 16A8 8 0 0 1 4 12"/>',
    maximize: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/>',
    save: '<path d="M4 3h13l3 3v15H4z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    eraser: '<path d="m7 20-4-4L14 5l6 6-9 9H7Z"/><path d="m11 8 6 6M7 20h13"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    printer: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5h20v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8L3 12Z"/><circle cx="7.5" cy="8.5" r="1"/>',
    cloud: '<path d="M17.5 19H6a4 4 0 0 1-.5-8A7 7 0 0 1 19 9a5 5 0 0 1-1.5 10Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    camera: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="4"/>',
    calculator: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>',
    sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    smartphone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
    utensils: '<path d="M4 3v8M8 3v8M4 7h4M6 11v10M14 3v18M14 3c5 2 5 8 0 10"/>',
    'bar-chart': '<path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M2 20h20"/>',
    coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v5c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 11v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
    plug: '<path d="M9 3v6M15 3v6M7 9h10v2a5 5 0 0 1-5 5v5M9 21h6"/>',
    zap: '<path d="M13 2 3 14h8l-1 8 11-13h-8V2Z"/>',
    'log-in': '<path d="M15 3h5v18h-5M10 17l5-5-5-5M15 12H3"/>',
    'log-out': '<path d="M9 3H4v18h5M14 17l5-5-5-5M19 12H7"/>'
});

const LOCAL_ICON_ALIASES = Object.freeze({
    'edit': 'pencil', 'edit-2': 'pencil', 'pen-line': 'pencil', 'square-pen': 'pencil',
    'trash-2': 'trash', 'x-circle': 'x', 'file-x': 'file', 'file-check': 'file',
    'file-badge': 'file', 'file-down': 'file', 'file-text': 'file',
    'file-spreadsheet': 'table', 'table-2': 'table', 'layout-dashboard': 'dashboard',
    'calendar-days': 'calendar', 'user-circle': 'user', 'user-plus': 'user',
    'user-check': 'user', 'user-x': 'user', 'folder-open': 'folder', 'folder-plus': 'folder',
    'graduation-cap': 'graduation', 'shield-check': 'shield', 'check-circle': 'circle-check',
    'check-circle-2': 'circle-check',
    'alert-triangle': 'alert', 'upload-cloud': 'upload', 'refresh-cw': 'refresh',
    'rotate-ccw': 'refresh', 'external-link': 'maximize', 'maximize-2': 'maximize',
    'sliders-horizontal': 'sliders', 'list-checks': 'receipt', 'list-plus': 'plus',
    'database': 'table', 'loader': 'refresh', 'bar-chart-3': 'bar-chart'
});

function initializeLucide(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function' || typeof document.createElementNS !== 'function') return false;
    const icons = root.querySelectorAll('i[data-lucide]');
    icons.forEach(icon => {
        const name = String(icon.getAttribute('data-lucide') || 'generic');
        const pathName = LOCAL_ICON_PATHS[name] ? name : (LOCAL_ICON_ALIASES[name] || 'generic');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        Array.from(icon.attributes || []).forEach(attribute => {
            if (attribute.name !== 'data-lucide' && attribute.name !== 'size') {
                svg.setAttribute(attribute.name, attribute.value);
            }
        });
        const originalClass = icon.getAttribute('class') || '';
        svg.setAttribute('class', `${originalClass} local-icon local-icon-${name}`.trim());
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', icon.getAttribute('size') || icon.getAttribute('width') || '24');
        svg.setAttribute('height', icon.getAttribute('size') || icon.getAttribute('height') || '24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = LOCAL_ICON_PATHS[pathName];
        icon.replaceWith(svg);
    });
    return true;
}

// ==========================================================================
// ID Generator
// ==========================================================================
function generateId(prefix, existingItems) {
    const maxNum = existingItems.reduce((max, item) => {
        const num = parseInt((item.id || '').replace(prefix, ''), 10);
        return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    return prefix + String(maxNum + 1).padStart(prefix.length === 3 ? 3 : 6, '0');
}

// ==========================================================================
// Master Data Lookup Helpers
// ==========================================================================
function getProjectName(id) {
    const p = state.projects.find(x => x.id === id);
    return p ? p.name : (id || '-');
}
function getCategoryName(id) {
    const c = state.categories.find(x => x.id === id);
    return c ? c.name : (id || '-');
}
function getVendorName(id) {
    const v = state.vendors.find(x => x.id === id);
    return v ? v.name : (id || '-');
}
function getFundSourceName(id) {
    const f = state.fundSources.find(x => x.id === id);
    return f ? f.name : (id || '-');
}
function getOrgName(id) {
    const o = (state.organizations || []).find(x => x.id === id);
    return o ? o.name : (id || '-');
}

// ==========================================================================
// Setup Dropdown Defaults
// ==========================================================================
function setupDropdownDefaults() {
    const yearSelect = document.getElementById('select-year');
    if (yearSelect) {
        yearSelect.innerHTML = '';
        const currentYear = new Date().getFullYear() + 543;
        const startYear = 2566; // ปีเริ่มโครงการ
        const endYear = currentYear + 2;
        for (let y = startYear; y <= endYear; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            yearSelect.appendChild(opt);
        }
    }

    (document.getElementById('select-month') || {}).value = state.selectedMonth;
    (document.getElementById('select-year') || {}).value = state.selectedYear;
    (document.getElementById('select-calc-mode') || {}).value = state.calculationMode;
    syncSharedMonthSelectors();

    updateMonthStatusCheckboxUI();
}

function syncSharedMonthSelectors() {
    const postingMonth = getSelectedPostingMonth();
    const foodOverviewMonth = document.getElementById('food-overview-month');
    if (foodOverviewMonth) foodOverviewMonth.value = postingMonth;
}

// ==========================================================================
// Event Bindings
// ==========================================================================
function setupEventBindings() {
    // Navigation Tabs
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const targetTab = item.getAttribute('data-tab');
            if (targetTab) switchTab(targetTab);
        });
    });

    // Theme Toggle
    (document.getElementById('theme-toggle') || {}).addEventListener?.('click', toggleTheme);

    // Main Export Options
    const exportBtn = document.getElementById('btn-export-main');
    if (exportBtn) exportBtn.addEventListener('click', () => {
        openExportModal(state.activeTab);
    });

    // Month / Year / Calculation Mode
    (document.getElementById('select-month') || {}).addEventListener?.('change', async (e) => {
        state.selectedMonth = parseInt(e.target.value, 10);
        syncSharedMonthSelectors();
        updateMonthStatusCheckboxUI();
        saveState();
        await initAppWithAPI();
    });
    (document.getElementById('select-year') || {}).addEventListener?.('change', async (e) => {
        state.selectedYear = parseInt(e.target.value, 10);
        syncSharedMonthSelectors();
        updateMonthStatusCheckboxUI();
        saveState();
        await initAppWithAPI();
    });
    (document.getElementById('select-calc-mode') || {}).addEventListener?.('change', (e) => {
        state.calculationMode = e.target.value;
        saveState();
        renderAll();
    });

    // Month Status Checkbox — สถานะนี้ใช้ร่วมกันทุกคน จึงบันทึกที่ backend ไม่ใช่แค่เครื่องนี้
    (document.getElementById('month-status-unclaimed') || {}).addEventListener?.('change', async (e) => {
        const ceYear = state.selectedYear - 543;
        const monthKey = `${ceYear}-${String(state.selectedMonth).padStart(2, '0')}`;
        e.target.disabled = true;
        try {
            await apiCall('toggleMonthStatus', { month: monthKey });
            await refreshCarryOverAmount();
            renderAll();
        } catch (err) {
            e.target.checked = !e.target.checked; // ย้อนกลับถ้าบันทึกไม่สำเร็จ
            appAlert('บันทึกสถานะไม่สำเร็จ: ' + err.message, 'error');
        } finally {
            e.target.disabled = false;
        }
    });

    // Bill Modal
    const btnAddBill = document.getElementById('btn-add-bill');
    if (btnAddBill) {
        btnAddBill.addEventListener('click', () => openExpenseModal());
    }
    
    const btnAddProjExp = document.getElementById('btn-add-project-expense');
    if (btnAddProjExp) {
        btnAddProjExp.addEventListener('click', () => openExpenseModal(null, true));
    }
    
    // Legacy separated buttons removed; logic moved directly to widget headers

    (document.getElementById('modal-bill-close') || {}).addEventListener?.('click', closeExpenseModal);
    (document.getElementById('btn-bill-cancel') || {}).addEventListener?.('click', closeExpenseModal);
    (document.getElementById('form-bill') || {}).addEventListener?.('submit', handleExpenseSubmit);

    // Attachment Modal
    const btnAddAttachment = document.getElementById('btn-add-attachment');
    if (btnAddAttachment) {
        btnAddAttachment.addEventListener('click', () => openAttachmentModal());
    }
    (document.getElementById('modal-attachment-close') || {}).addEventListener?.('click', closeAttachmentModal);
    (document.getElementById('btn-attach-cancel') || {}).addEventListener?.('click', closeAttachmentModal);
    (document.getElementById('form-attachment') || {}).addEventListener?.('submit', handleAttachmentSubmit);

    // Filters on Full Tables
    (document.getElementById('filter-search') || {}).addEventListener?.('input', renderTables);
    (document.getElementById('filter-project') || {}).addEventListener?.('change', renderTables);

    // View All Dashboard button
    (document.getElementById('btn-view-all-dashboard') || {}).addEventListener?.('click', () => switchTab('bills-table'));

    // Summary year selector
    (document.getElementById('summary-year') || {}).addEventListener?.('change', async (e) => {
        state.selectedYear = parseInt(e.target.value, 10);
        (document.getElementById('select-year') || {}).value = state.selectedYear;
        saveState();
        await initAppWithAPI();
    });

    // Excel Export Event
    const excelBtn = document.getElementById('btn-export-excel');
    if (excelBtn) excelBtn.addEventListener('click', exportExcelXLSX);

    // Claims Events
    (document.getElementById('btn-create-claim') || {}).addEventListener?.('click', () => openClaimModal());
    (document.getElementById('btn-claim-save') || {}).addEventListener?.('click', saveClaimPackage);
    (document.getElementById('btn-claim-cancel') || {}).addEventListener?.('click', closeClaimModal);
    (document.getElementById('claim-select-all') || {}).addEventListener?.('change', toggleClaimSelectorAll);

    // Signature Modal events
    (document.getElementById('btn-sig-clear') || {}).addEventListener?.('click', clearSignatureCanvas);
    (document.getElementById('btn-sig-save') || {}).addEventListener?.('click', saveSignatureCanvas);
    (document.getElementById('btn-sig-cancel') || {}).addEventListener?.('click', closeSignatureModal);

    // Column settings binding
    const btnAddColumn = document.getElementById('btn-add-column');
    if (btnAddColumn) {
        btnAddColumn.addEventListener('click', () => {
            const labelInput = document.getElementById('new-column-label');
            if (labelInput) {
                addNewColumn(labelInput.value);
                labelInput.value = '';
            }
        });
    }

    // Login Screen Settings bindings
    const btnSaveLoginBg = document.getElementById('btn-save-login-bg');
    if (btnSaveLoginBg) {
        btnSaveLoginBg.addEventListener('click', () => {
            const bgUrlInput = document.getElementById('login-bg-url');
            if (bgUrlInput) {
                const url = bgUrlInput.value.trim();
                if (url) {
                    state.loginBg = url;
                    saveState();
                    applyLoginBackground();
                    appAlert('บันทึกรูปภาพพื้นหลังเรียบร้อยแล้ว!');
                } else {
                    appAlert('กรุณากรอก URL ลิงก์รูปภาพ');
                }
            }
        });
    }

    const btnUploadBgTrigger = document.getElementById('btn-upload-login-bg-trigger');
    const inputBgFile = document.getElementById('input-login-bg-file');
    if (btnUploadBgTrigger && inputBgFile) {
        btnUploadBgTrigger.addEventListener('click', () => {
            inputBgFile.click();
        });
        
        inputBgFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (file.size > 1.5 * 1024 * 1024) {
                appAlert('รูปภาพมีขนาดใหญ่เกินไป (จำกัดไม่เกิน 1.5 MB) เพื่อป้องกันปัญหาระบบจัดเก็บข้อมูลของเบราว์เซอร์เต็ม');
                inputBgFile.value = '';
                return;
            }
            
            const reader = new FileReader();
            reader.onload = function(evt) {
                state.loginBg = evt.target.result;
                saveState();
                applyLoginBackground();
                
                const bgUrlInput = document.getElementById('login-bg-url');
                if (bgUrlInput) {
                    bgUrlInput.value = '';
                    bgUrlInput.placeholder = 'รูปภาพจากการอัปโหลด (Upload)';
                }
                appAlert('อัปโหลดและเปิดใช้งานรูปภาพพื้นหลังเรียบร้อยแล้ว!');
            };
            reader.readAsDataURL(file);
        });
    }

    const btnResetLoginBg = document.getElementById('btn-reset-login-bg');
    if (btnResetLoginBg) {
        btnResetLoginBg.addEventListener('click', async () => {
            if (await appConfirm('ต้องการรีเซ็ตภาพพื้นหลังกลับเป็นค่าเริ่มต้นใช่หรือไม่?')) {
                state.loginBg = '';
                saveState();
                applyLoginBackground();
                
                const bgUrlInput = document.getElementById('login-bg-url');
                if (bgUrlInput) {
                    bgUrlInput.value = '';
                    bgUrlInput.placeholder = 'เช่น https://example.com/image.jpg';
                }
                const inputBgFile = document.getElementById('input-login-bg-file');
                if (inputBgFile) inputBgFile.value = '';
                
                appAlert('รีเซ็ตเป็นค่าเริ่มต้นเรียบร้อยแล้ว');
            }
        });
    }

    // Login background mode (slideshow vs animation) radio bindings
    const loginBgModeRadios = document.querySelectorAll('input[name="login-bg-mode"]');
    loginBgModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            state.loginBgMode = e.target.value;
            saveState();
            applyLoginBackground();
            renderLoginBgSettingsUI();
        });
    });

    // Sidebar responsive toggle and close events
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggleBtn = document.getElementById('btn-sidebar-toggle');
    const closeBtn = document.getElementById('btn-sidebar-close');
    
    if (toggleBtn && sidebar && overlay) {
        toggleBtn.addEventListener('click', () => {
            if (window.innerWidth <= 900) {
                sidebar.classList.add('open');
                overlay.classList.add('active');
            } else {
                sidebar.classList.toggle('collapsed');
            }
        });
    }
    
    if (closeBtn && sidebar && overlay) {
        closeBtn.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }
    
    if (overlay && sidebar) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }
}

function updateMonthStatusCheckboxUI() {
    const ceYear = state.selectedYear - 543;
    const statusKey = `${ceYear}-${String(state.selectedMonth).padStart(2, '0')}`;
    const status = state.monthStatuses[statusKey] || 'claimed';
    const checkbox = document.getElementById('month-status-unclaimed');
    if (checkbox) checkbox.checked = (status === 'unclaimed');
}

function getBottomNavGroupForTab(tabName) {
    if (['bills-table', 'claims-view', 'spreadsheet-view'].includes(tabName)) return 'expenses';
    if (['summary-view', 'fund-receipts'].includes(tabName)) return 'reports';
    if (['settings-view', 'user-management'].includes(tabName)) return 'admin';
    return null;
}

function syncNavigationActiveState(tabName) {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-tab') === tabName);
    });

    const activeGroup = getBottomNavGroupForTab(tabName);
    document.querySelectorAll('.bottom-nav-item').forEach(item => {
        const directMatch = item.getAttribute('data-tab') === tabName;
        const groupMatch = activeGroup && item.getAttribute('data-nav-group') === activeGroup;
        item.classList.toggle('active', !!(directMatch || groupMatch));
    });

    document.querySelectorAll('.submenu-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-tab') === tabName);
    });
}

// ดึงยอดยกไปจากเดือนก่อนหน้า + สถานะเบิกจ่ายรายเดือนของปีนี้จาก backend เสมอ
// (คำนวณฝั่ง client ไม่ได้ เพราะ state.expenses มีแค่ข้อมูลเดือนที่เลือกอยู่เดือนเดียว)
let carryOverRefreshGeneration = 0;
async function refreshCarryOverAmount(targetMonth = state.selectedMonth, targetYear = state.selectedYear) {
    const refreshGeneration = ++carryOverRefreshGeneration;
    const token = localStorage.getItem('rdf_session_token');
    const isCurrent = () => refreshGeneration === carryOverRefreshGeneration
        && targetMonth === state.selectedMonth
        && targetYear === state.selectedYear
        && token === localStorage.getItem('rdf_session_token');
    state.carryOverStatus = 'loading';
    const [carryResult, statusesResult] = await Promise.allSettled([
        apiCall('getCarryOverAmount', { beforeMonth: targetMonth, beforeYear: targetYear }),
        apiCall('getMonthStatuses', { year: targetYear - 543 })
    ]);
    if (!isCurrent()) return;
    if (carryResult.status === 'fulfilled') {
        state.carryOverAmount = carryResult.value.carryOverAmount || 0;
        state.carryOverStatus = 'ready';
    } else {
        state.carryOverAmount = 0;
        state.carryOverStatus = 'error';
    }
    if (statusesResult.status === 'fulfilled') {
        state.monthStatuses = statusesResult.value.statuses || {};
    }
    if (isCurrent()) {
        updateMonthStatusCheckboxUI();
    }
}
window.refreshCarryOverAmount = refreshCarryOverAmount;

// ==========================================================================
// Annual Summary Report
// ==========================================================================
function setupSummaryYearDropdown() {
    const yearSelect = document.getElementById('summary-year-select');
    if (!yearSelect || yearSelect.options.length) return;
    const currentYear = new Date().getFullYear() + 543;
    const startYear = 2566; // ปีเริ่มโครงการ
    for (let y = startYear; y <= currentYear + 1; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        yearSelect.appendChild(opt);
    }
    yearSelect.value = state.selectedYear;
}

async function fetchAllExpensesForSummary(year) {
    return fetchAllExpensesForYear(year);
}

async function renderSummaryView() {
    setupSummaryYearDropdown();
    const yearSelect = document.getElementById('summary-year-select');
    const selectedYear = parseInt((yearSelect && yearSelect.value) || state.selectedYear, 10);
    const ceYear = selectedYear - 543;

    // ตัวกรององค์กร — เห็นเฉพาะ admin เพราะมีแค่ admin ที่เห็นข้อมูลข้ามสถานศึกษา
    const orgFilterWrap = document.getElementById('summary-org-filter-wrap');
    const orgFilterSel = document.getElementById('summary-org-filter');
    let orgFilter = '';
    if (orgFilterWrap && orgFilterSel) {
        if (getCurrentUserRole() === 'admin') {
            orgFilterWrap.style.display = 'flex';
            if (orgFilterSel.options.length === 0) {
                orgFilterSel.innerHTML = '<option value="">ทั้งหมด (รวมทุกสถานศึกษา)</option>' +
                    (state.organizations || []).map(o => `<option value="${o.id}">${escapeHTML(o.name)}</option>`).join('');
            }
            orgFilter = orgFilterSel.value;
        } else {
            orgFilterWrap.style.display = 'none';
        }
    }

    const monthTbody = document.getElementById('summary-by-month-tbody');
    const projectTbody = document.getElementById('summary-by-project-tbody');
    const totalEl = document.getElementById('summary-year-total');
    if (!monthTbody || !projectTbody) return;

    monthTbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    projectTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';

    let allExpenses;
    let monthStatuses = {};
    try {
        allExpenses = await fetchAllExpensesForSummary(ceYear);
    } catch (err) {
        appAlert('ไม่สามารถโหลดข้อมูลรายงานสรุปได้: ' + err.message, 'error');
        monthTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--danger);">โหลดข้อมูลไม่สำเร็จ</td></tr>';
        projectTbody.innerHTML = '';
        return;
    }
    try {
        const statusRes = await apiCall('getMonthStatuses', { year: ceYear, organizationId: orgFilter || undefined });
        monthStatuses = statusRes.statuses || {};
    } catch (err) {
        // โหลดสถานะไม่สำเร็จ — แสดงเป็น "เบิกแล้ว" (ค่าเริ่มต้น) ไปก่อน ไม่ล้มทั้งหน้า
    }

    const yearExpenses = allExpenses.filter(e =>
        getExpensePostingMonth(e).startsWith(String(ceYear)) &&
        (!orgFilter || e.organizationId === orgFilter));

    const thMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const byMonth = Array.from({ length: 12 }, () => ({ count: 0, amount: 0 }));
    const byProject = {};
    let yearTotal = 0;

    yearExpenses.forEach(e => {
        const amount = parseFloat(e.amount) || 0;
        yearTotal += amount;

        const monthIdx = Number(getExpensePostingMonth(e).slice(5, 7)) - 1;
        if (monthIdx >= 0 && monthIdx < 12) {
            byMonth[monthIdx].count++;
            byMonth[monthIdx].amount += amount;
        }

        const projectId = e.projectId || '-';
        if (!byProject[projectId]) byProject[projectId] = { count: 0, amount: 0 };
        byProject[projectId].count++;
        byProject[projectId].amount += amount;
    });

    if (totalEl) totalEl.textContent = yearTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 }) + ' บาท';

    monthTbody.innerHTML = byMonth.map((m, idx) => {
        const monthKey = `${ceYear}-${String(idx + 1).padStart(2, '0')}`;
        const status = monthStatuses[monthKey] || 'claimed';
        const isUnclaimed = status === 'unclaimed';
        return `
        <tr>
            <td>${thMonths[idx]}</td>
            <td class="text-right">${m.count}</td>
            <td class="text-right">${m.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
            <td class="text-center">
                <span class="badge ${isUnclaimed ? 'badge-non-claimable' : 'badge-claimable'}" style="cursor:pointer;" onclick="toggleMonthClaimStatus('${monthKey}')" title="คลิกเพื่อสลับสถานะ">
                    ${isUnclaimed ? 'ยังไม่เบิก (ยกยอดต่อ)' : 'เบิกแล้ว'}
                </span>
            </td>
        </tr>`;
    }).join('');

    const projectRows = Object.entries(byProject).sort((a, b) => b[1].amount - a[1].amount);
    projectTbody.innerHTML = projectRows.length
        ? projectRows.map(([projectId, v]) => `
            <tr>
                <td>${escapeHTML(getProjectName(projectId))}</td>
                <td class="text-right">${v.count}</td>
                <td class="text-right">${v.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
            </tr>
        `).join('')
        : '<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">ไม่มีข้อมูลในปีงบประมาณนี้</td></tr>';
}

// สลับสถานะเบิกจ่ายของเดือนใดก็ได้จากหน้ารายงานสรุปรายปี (monthKey = ค.ศ. "YYYY-MM")
async function toggleMonthClaimStatus(monthKey) {
    try {
        const orgFilterSel = document.getElementById('summary-org-filter');
        const orgFilter = (orgFilterSel && getCurrentUserRole() === 'admin') ? orgFilterSel.value : '';
        await apiCall('toggleMonthStatus', { month: monthKey, organizationId: orgFilter || undefined });
        await renderSummaryView();

        // ถ้าเดือนที่สลับอยู่ก่อนเดือนที่กำลังเลือกอยู่บนหน้าบันทึกบิล ให้รีเฟรชยอดยกไปที่นั่นด้วย
        const [ceYear, ceMonth] = monthKey.split('-').map(Number);
        const beYear = ceYear + 543;
        const isBeforeSelected = beYear < state.selectedYear || (beYear === state.selectedYear && ceMonth < state.selectedMonth);
        if (isBeforeSelected) {
            await refreshCarryOverAmount();
            updateMetricsBar();
        }
    } catch (err) {
        appAlert('บันทึกสถานะไม่สำเร็จ: ' + err.message, 'error');
    }
}
window.toggleMonthClaimStatus = toggleMonthClaimStatus;

// ==========================================================================
// Fund Receipt Documents (เอกสารรับเงินทุนประจำเดือน)
// ==========================================================================
let fundReceiptFile = null; // {base64, mimeType, filename, sizeBytes} จาก processUploadFile ระหว่างรอบันทึก

function selectedMonthKey() {
    const gYear = state.selectedYear - 543;
    const mStr = String(state.selectedMonth).padStart(2, '0');
    return `${gYear}-${mStr}`;
}

function getFundReceiptByMonth(monthKey) {
    return (state.fundReceipts || []).find(r => r.month === monthKey);
}

async function loadFundReceiptsForYear(yearBE) {
    const ceYear = Number(yearBE) - 543;
    state.fundReceiptsLoadStatus = 'loading';
    try {
        const res = await apiCall('getFundReceipts', null, { year: String(ceYear) });
        state.fundReceipts = res.fundReceipts || [];
        state.fundReceiptsLoadStatus = 'ready';
        return state.fundReceipts;
    } catch (error) {
        state.fundReceiptsLoadStatus = 'error';
        throw error;
    }
}

window.onFundReceiptYearChange = async function() {
    const yearSelect = document.getElementById('fund-receipt-year-select');
    const yearBE = Number(yearSelect && yearSelect.value) || state.selectedYear;
    try {
        await loadFundReceiptsForYear(yearBE);
        renderFundReceiptsOverview();
    } catch (err) {
        appAlert('ไม่สามารถโหลดเอกสารรับเงินทุนของปีที่เลือกได้: ' + err.message, 'error');
    }
};

function updateFundReceiptWidget() {
    const badge = document.getElementById('fund-receipt-widget-month-badge');
    const body = document.getElementById('fund-receipt-widget-body');
    if (!badge || !body) return;

    const thShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    badge.textContent = thShort[state.selectedMonth - 1] + ' ' + state.selectedYear;

    if (state.fundReceiptsLoadStatus === 'loading') {
        body.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">กำลังโหลดเอกสารรับเงินทุน...</div>`;
        return;
    }

    const rec = getFundReceiptByMonth(selectedMonthKey());
    if (rec) {
        body.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <div style="font-size:20px; font-weight:700; color:var(--primary);">${(parseFloat(rec.amount) || 0).toLocaleString('th-TH', {minimumFractionDigits:2})} บาท</div>
                    <a href="${rec.fileUrl}" target="_blank" style="font-size:13px;"><i data-lucide="paperclip" style="width:14px;height:14px;vertical-align:middle;"></i> ${escapeHTML(rec.fileName || 'ดูไฟล์แนบ')}</a>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span class="badge" style="background:#10b98122;color:#10b981;">มีเอกสารแล้ว</span>
                    <button class="btn btn-outline btn-sm" onclick="exportFundReceiptSlip()" style="display:flex; align-items:center; gap:6px;" title="พิมพ์เอกสารยืนยัน พร้อม QR ตรวจสอบ">
                        <i data-lucide="printer" style="width:14px;height:14px;"></i> พิมพ์เอกสารยืนยัน
                    </button>
                </div>
            </div>`;
    } else {
        body.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">ยังไม่มีเอกสารรับเงินทุนของเดือนนี้</div>`;
    }
    initializeLucide();
}

// สร้างเอกสารยืนยันการรับเงินทุน 1 หน้า (สรุป+QR) — ไม่ฝังไฟล์แนบต้นฉบับซ้ำ (ยังเป็นลิงก์แยกเหมือนเดิม)
async function exportFundReceiptSlip(monthKey) {
    const month = monthKey || selectedMonthKey();
    const rec = getFundReceiptByMonth(month);
    if (!rec) { appAlert('ยังไม่มีเอกสารรับเงินทุนของเดือนนี้'); return; }

    const qrDataUrl = rec.verifyCode ? await generateVerifyQR('fundreceipt', rec.verifyCode) : '';
    const [ceYear, m] = month.split('-').map(Number);
    const thYear = ceYear + 543;
    const monthName = THAI_MONTH_NAMES[m - 1];

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>เอกสารยืนยันการรับเงินทุน — ${monthName} ${thYear}</title>
<style>
    body { font-family:'Sarabun',sans-serif; padding:32px; color:#111; }
    .page { max-width:640px; margin:0 auto; }
    .org-header{text-align:center;border-bottom:2.5px double #111;padding-bottom:14px;margin-bottom:20px;}
    .org-header .eng-title{font-size:16px;font-weight:700;}
    .org-header .thai-title{font-size:14px;font-weight:600;margin:4px 0;}
    .amount-box{border:1.5px solid #334155;border-radius:8px;padding:20px;margin:20px 0;text-align:center;}
    .amount-box .amount{font-size:28px;font-weight:700;color:#065f46;}
    .info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #ddd;font-size:14px;}
    .doc-footer{margin-top:32px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:11px;color:#777;}
    @media print { button { display:none; } }
</style>
</head>
<body onload="window.print();">
<div class="page">
    <div class="org-header">
        <div class="eng-title">DR. ROBERT DYCKERHOFF FOUNDATION</div>
        <div class="thai-title">มูลนิธิ ดร. โรเบิร์ต ดีคเคอร์ฮอฟฟ์</div>
        <div style="font-size:12px;color:#444;">เอกสารยืนยันการรับเงินทุนประจำเดือน ${monthName} พ.ศ. ${thYear}</div>
    </div>
    <div class="amount-box">
        <div style="font-size:12px;color:#555;">จำนวนเงินที่รับทั้งหมด</div>
        <div class="amount">${(parseFloat(rec.amount) || 0).toLocaleString('th-TH', {minimumFractionDigits:2})} บาท</div>
    </div>
    <div class="info-row"><span>เดือน</span><span>${monthName} พ.ศ. ${thYear}</span></div>
    ${rec.note ? `<div class="info-row"><span>หมายเหตุ</span><span>${escapeHTML(rec.note)}</span></div>` : ''}
    <div class="info-row"><span>ไฟล์แนบต้นฉบับ</span><span>${escapeHTML(rec.fileName || '-')}</span></div>
    ${qrDataUrl ? `
    <div class="doc-footer">
        <img src="${qrDataUrl}" style="width:64px;height:64px;">
        <div style="text-align:left;">สแกนเพื่อตรวจสอบเอกสารนี้กับระบบ<br>พิมพ์เมื่อ: ${formatSystemDate(new Date())}</div>
    </div>` : `
    <div class="doc-footer">พิมพ์เมื่อ: ${formatSystemDate(new Date())}</div>`}
</div>
</body></html>`;

    const printWin = window.open('', '_blank', 'width=720,height=800');
    if (!printWin) {
        appAlert('กรุณาอนุญาต Popup ในเบราว์เซอร์ก่อนใช้งาน Export PDF');
        return;
    }
    printWin.document.write(html);
    preparePrintDocumentText(printWin.document);
    printWin.document.close();
}
window.exportFundReceiptSlip = exportFundReceiptSlip;

function renderFundReceiptFilePreview(existingRec) {
    const el = document.getElementById('fund-receipt-file-preview');
    if (!el) return;
    if (fundReceiptFile) {
        el.textContent = 'ไฟล์ที่เลือก: ' + fundReceiptFile.filename;
    } else if (existingRec && existingRec.fileName) {
        el.innerHTML = 'ไฟล์เดิม: <a href="' + existingRec.fileUrl + '" target="_blank">' + escapeHTML(existingRec.fileName) + '</a> (เลือกไฟล์ใหม่เพื่อแทนที่)';
    } else {
        el.textContent = '';
    }
}

function openFundReceiptModal(monthKey) {
    const month = monthKey || selectedMonthKey();
    const rec = getFundReceiptByMonth(month);

    document.getElementById('fund-receipt-id').value = rec ? rec.id : '';
    document.getElementById('fund-receipt-month').value = month;
    document.getElementById('fund-receipt-amount').value = rec ? rec.amount : '';
    document.getElementById('fund-receipt-note').value = rec ? (rec.note || '') : '';
    document.getElementById('fund-receipt-file').value = '';
    fundReceiptFile = null;
    renderFundReceiptFilePreview(rec);

    document.getElementById('modal-fund-receipt').classList.add('active');
    initializeLucide();
}

function closeFundReceiptModal() {
    document.getElementById('modal-fund-receipt').classList.remove('active');
}

async function handleFundReceiptFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
        fundReceiptFile = await processUploadFile(file, state.maxUploadSizeMb || 2);
        renderFundReceiptFilePreview(null);
    } catch (err) {
        appAlert('ไม่สามารถแนบไฟล์นี้ได้: ' + err.message, 'error');
    }
}

async function saveFundReceipt() {
    const month = document.getElementById('fund-receipt-month').value;
    const amount = parseFloat(document.getElementById('fund-receipt-amount').value);
    const note = document.getElementById('fund-receipt-note').value.trim();
    const existingRec = getFundReceiptByMonth(month);

    if (!amount || amount <= 0) {
        appAlert('กรุณาระบุจำนวนเงินให้ถูกต้อง', 'error');
        return;
    }
    if (!fundReceiptFile && !existingRec) {
        appAlert('กรุณาแนบไฟล์เอกสาร', 'error');
        return;
    }

    const payload = { month, amount, note };
    if (fundReceiptFile) {
        payload.fileData = {
            base64: (fundReceiptFile.base64 || '').split(',')[1] || fundReceiptFile.base64,
            mimeType: fundReceiptFile.mimeType,
            filename: fundReceiptFile.filename
        };
    }

    showLoading(true);
    try {
        await apiCall('saveFundReceipt', payload);
        appAlert('บันทึกเอกสารรับเงินทุนสำเร็จ!', 'success');
        closeFundReceiptModal();

        const overviewYear = Number((document.getElementById('fund-receipt-year-select') || {}).value) || state.selectedYear;
        await loadFundReceiptsForYear(overviewYear);
        updateFundReceiptWidget();
        if (state.activeTab === 'fund-receipts') renderFundReceiptsOverview();
    } catch (err) {
        appAlert('บันทึกไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function deleteFundReceipt(id) {
    if (!await appConfirm('ต้องการลบเอกสารรับเงินทุนนี้ใช่หรือไม่?')) return;

    showLoading(true);
    try {
        await apiCall('deleteFundReceipt', { id });
        appAlert('ลบเอกสารสำเร็จ', 'success');

        const overviewYear = Number((document.getElementById('fund-receipt-year-select') || {}).value) || state.selectedYear;
        await loadFundReceiptsForYear(overviewYear);
        updateFundReceiptWidget();
        renderFundReceiptsOverview();
    } catch (err) {
        appAlert('ลบไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

function setupFundReceiptYearDropdown() {
    const yearSelect = document.getElementById('fund-receipt-year-select');
    if (!yearSelect || yearSelect.options.length) return;
    const currentYear = new Date().getFullYear() + 543;
    const startYear = 2566; // ปีเริ่มโครงการ
    for (let y = startYear; y <= currentYear + 1; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        yearSelect.appendChild(opt);
    }
    yearSelect.value = state.selectedYear;
}

function renderFundReceiptsOverview() {
    setupFundReceiptYearDropdown();
    const yearSelect = document.getElementById('fund-receipt-year-select');
    const selectedYear = parseInt((yearSelect && yearSelect.value) || state.selectedYear, 10);
    const ceYear = selectedYear - 543;

    const tbody = document.getElementById('fund-receipts-tbody');
    const totalEl = document.getElementById('fund-receipts-year-total');
    if (!tbody) return;

    if (state.fundReceiptsLoadStatus === 'loading' || state.fundReceiptsLoadStatus === 'error') {
        const failed = state.fundReceiptsLoadStatus === 'error';
        tbody.innerHTML = `<tr><td colspan="4" class="text-center" style="padding:24px; color:var(--text-muted);">${failed ? 'โหลดเอกสารรับเงินทุนไม่สำเร็จ กรุณากดลองใหม่จากแถบสถานะ' : 'กำลังโหลดเอกสารรับเงินทุน...'}</td></tr>`;
        if (totalEl) totalEl.textContent = '-';
        return;
    }

    let total = 0;
    const rows = THAI_MONTH_NAMES.map((name, idx) => {
        const monthKey = `${ceYear}-${String(idx + 1).padStart(2, '0')}`;
        const rec = getFundReceiptByMonth(monthKey);
        if (rec) total += parseFloat(rec.amount) || 0;
        return `
            <tr>
                <td>${name}</td>
                <td class="text-right">${rec ? (parseFloat(rec.amount) || 0).toLocaleString('th-TH', {minimumFractionDigits:2}) : '-'}</td>
                <td class="text-center">${rec
                    ? `<a href="${rec.fileUrl}" target="_blank"><i data-lucide="paperclip" style="width:14px;height:14px;vertical-align:middle;"></i> ${escapeHTML(rec.fileName || 'ไฟล์')}</a>`
                    : '<span style="color:var(--text-muted);">ไม่มีเอกสาร</span>'}</td>
                <td class="text-center">${rec
                    ? `<button class="btn btn-icon btn-sm" title="แก้ไข" onclick="openFundReceiptModal('${monthKey}')"><i data-lucide="edit" style="width:14px;height:14px;"></i></button> <button class="btn btn-icon btn-sm text-danger" title="ลบ" onclick="deleteFundReceipt('${rec.id}')"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>`
                    : `<button class="btn btn-icon btn-sm" title="เพิ่ม" onclick="openFundReceiptModal('${monthKey}')"><i data-lucide="plus" style="width:14px;height:14px;"></i></button>`}</td>
            </tr>`;
    }).join('');

    tbody.innerHTML = rows;
    if (totalEl) totalEl.textContent = total.toLocaleString('th-TH', {minimumFractionDigits:2}) + ' บาท';
    initializeLucide();
}

// ==========================================================================
// Tab Navigation
// ==========================================================================
function switchTab(tabName) {
    if ((tabName === 'settings-view' || tabName === 'user-management') && !isAdminUser()) {
        appAlert('เมนูนี้สำหรับผู้ดูแลระบบเท่านั้น', 'warning');
        tabName = 'dashboard';
    }
    state.activeTab = tabName;
    
    // Close sidebar on mobile after tab click
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
    }
    document.querySelectorAll('.bottom-nav-item.has-submenu.open').forEach(item => {
        item.classList.remove('open');
    });

    syncNavigationActiveState(tabName);
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.toggle('active', tab.id === `tab-${tabName}`);
    });

    const titles = {
        'user-management': ['จัดการผู้ใช้งาน', 'เพิ่ม/แก้ไขผู้ใช้งาน กำหนดสิทธิ์ และเปิด-ปิดการใช้งานบัญชี'],
        'settings-view': ['ตั้งค่าระบบ', 'จัดการ Google Login, Google Drive และการตั้งค่าความปลอดภัย'],
        'dashboard': ['แดชบอร์ดรายจ่าย', 'ภาพรวมการเงินแยกตามเดือน โครงการ และแหล่งเงิน'],
        'bills-table': ['บันทึกบิลประจำเดือน', 'ดูและจัดการรายการบิลทั้งหมดของเดือนที่เลือก'],
        'claims-view': ['จัดกลุ่มส่งเบิก (Claims)', 'รวมกลุ่มและบริหารรายการบิลส่งเบิกมูลนิธิ'],
        'spreadsheet-view': ['สเปรดชีตส่งเบิก', 'ใบขอเบิกเงินรูปแบบตาราง Excel'],
        'food-overview': ['ค่าอาหารประจำเดือน', 'ภาพรวมรายการค่าอาหารและสรุปยอด'],
        'summary-view': ['รายงานสรุปรายปี', 'สรุปยอดเงินแยกตามเดือน โครงการ และปีงบประมาณ'],
        'fund-receipts': ['เอกสารรับเงินทุน', 'หลักฐานการรับเงินทุนของนักเรียน/นักศึกษา สรุปรายเดือนและรายปี']
    };

    const [title, subtitle] = titles[tabName] || ['ระบบบันทึกรายจ่าย', ''];
    (document.getElementById('page-title-display') || {}).textContent = title;
    (document.getElementById('page-subtitle-display') || {}).textContent = subtitle;

    // Hide global headers (filter bar, metrics) for admin/settings tabs
    const isSettingsTab = (tabName === 'settings-view' || tabName === 'user-management' || tabName === 'summary-view' || tabName === 'fund-receipts');
    const filterBar = document.querySelector('.header-filters');
    const metricsBar = document.getElementById('metrics-bar');
    const carryOver = document.getElementById('carry-over-banner');
    
    if (filterBar) filterBar.style.display = isSettingsTab ? 'none' : 'flex';
    if (metricsBar) metricsBar.style.display = isSettingsTab ? 'none' : 'grid';
    
    if (carryOver && isSettingsTab) carryOver.style.display = 'none';
    else if (carryOver && !isSettingsTab && typeof renderCarryOver === 'function') {
        renderCarryOver();
    }

    
    const exportBtnMain = document.getElementById('btn-export-main');
    if (exportBtnMain) {
        if (tabName === 'settings-view' || tabName === 'user-management') {
            exportBtnMain.style.display = 'none';
        } else {
            exportBtnMain.style.display = 'flex';
        }
    }

    if (tabName === 'spreadsheet-view') renderSpreadsheet();
    if (tabName === 'claims-view') renderClaims();
    if (tabName === 'food-overview') {
        const monthInput = document.getElementById('food-overview-month');
        if (monthInput) monthInput.value = getSelectedPostingMonth();
        loadFoodOverview();
    }
    if (tabName === 'user-management') {
        renderUserManagement();
        switchUserMgmtTab('users');
    }
    if (tabName === 'settings-view') {
        renderSettingsTab();
        renderMasterData();
        renderSignaturePreviews();
        renderColumnSettingsUI();
        switchSettingsTab('master');
    }
    if (tabName === 'summary-view') renderSummaryView();
    if (tabName === 'fund-receipts') {
        renderFundReceiptsOverview();
        const yearSelect = document.getElementById('fund-receipt-year-select');
        const yearBE = Number(yearSelect && yearSelect.value) || state.selectedYear;
        loadFundReceiptsForYear(yearBE)
            .then(() => {
                if (state.activeTab === 'fund-receipts') renderFundReceiptsOverview();
            })
            .catch(err => console.error('โหลดเอกสารรับเงินทุนไม่สำเร็จ:', err));
    }

    initializeLucide();
}

// ==========================================================================
// Settings Page — Top Tab Bar
// ==========================================================================
function switchSettingsTab(tabKey) {
    const bar = document.querySelector('#tab-settings-view .settings-tabbar');
    if (!bar) return;
    bar.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-settings-tab') === tabKey);
    });
    document.querySelectorAll('#tab-settings-view .settings-tab-panel').forEach(panel => {
        panel.style.display = (panel.id === `settings-panel-${tabKey}`) ? '' : 'none';
    });
}
window.switchSettingsTab = switchSettingsTab;

// ==========================================================================
// Date Utility Functions
// ==========================================================================
function isDateInSelectedMonth(dateStr) {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const m = date.getMonth() + 1;
    const y = date.getFullYear() + 543;
    return m === state.selectedMonth && y === state.selectedYear;
}

function getExpensePostingMonth(expense) {
    if (!expense) return '';
    const toBangkokMonthKey = value => {
        const text = String(value || '').trim();
        const plainMatch = text.match(/^(\d{4})-(\d{2})(?:$|-(?:\d{2})$)/);
        if (plainMatch) return `${plainMatch[1]}-${plainMatch[2]}`;
        if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
            const date = new Date(text);
            if (!Number.isNaN(date.getTime())) {
                const bangkok = new Date(date.getTime() + (7 * 60 * 60 * 1000));
                return `${bangkok.getUTCFullYear()}-${String(bangkok.getUTCMonth() + 1).padStart(2, '0')}`;
            }
        }
        const isoMatch = text.match(/^(\d{4})-(\d{2})/);
        return isoMatch ? `${isoMatch[1]}-${isoMatch[2]}` : '';
    };
    return toBangkokMonthKey(expense.postingMonth) || toBangkokMonthKey(expense.expenseDate);
}

function getFoodPostingMonth(item) {
    if (!item) return '';
    const explicit = String(item.postingMonth || '').trim();
    if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
    if (item.year && item.month) return `${item.year}-${String(item.month).padStart(2, '0')}`;
    const fallback = String(item.date || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(fallback) ? fallback : '';
}

function getSelectedPostingMonth() {
    return `${state.selectedYear - 543}-${String(state.selectedMonth).padStart(2, '0')}`;
}

function isExpenseInSelectedMonth(expense) {
    return getExpensePostingMonth(expense) === getSelectedPostingMonth();
}

function formatPostingMonth(monthKey) {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) return '-';
    const [year, month] = String(monthKey).split('-').map(Number);
    return `${THAI_MONTH_NAMES[month - 1] || month} ${year + 543}`;
}

function getBudDateInfo(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return { month: date.getMonth() + 1, year: date.getFullYear() + 543 };
}

const ENGLISH_MONTH_ABBR = Object.freeze(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);
const SYSTEM_DATE_FORMATS = Object.freeze(['MMM_DD_YYYY', 'DD_MMM_YYYY', 'YYYY_MMM_DD', 'MMM_DD_BBBB']);

function normalizeSystemDateFormat(value) {
    const format = String(value || '').trim().toUpperCase();
    return SYSTEM_DATE_FORMATS.includes(format) ? format : 'MMM_DD_YYYY';
}

function getSystemDateParts(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
        return { year: dateValue.getFullYear(), month: dateValue.getMonth() + 1, day: dateValue.getDate() };
    }
    const text = String(dateValue).trim();
    const exactIso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (exactIso) {
        return { year: Number(exactIso[1]), month: Number(exactIso[2]), day: Number(exactIso[3]) };
    }
    const numericDate = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (numericDate) {
        let year = Number(numericDate[3]);
        if (year > 2400) year -= 543;
        return { year, month: Number(numericDate[2]), day: Number(numericDate[1]) };
    }
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

function formatSystemDate(dateValue, requestedFormat = state.dateFormat) {
    const parts = getSystemDateParts(dateValue);
    if (!parts || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return '';
    const format = normalizeSystemDateFormat(requestedFormat);
    const month = ENGLISH_MONTH_ABBR[parts.month - 1];
    const day = String(parts.day).padStart(2, '0');
    const year = format.endsWith('BBBB') ? parts.year + 543 : parts.year;
    if (format === 'DD_MMM_YYYY') return `${day} ${month} ${year}`;
    if (format === 'YYYY_MMM_DD') return `${year} ${month} ${day}`;
    return `${month} ${day} ${year}`;
}

function formatThaiDate(dateStr) {
    return formatSystemDate(dateStr);
}

function formatDateToShort(dateStr) {
    return formatThaiDate(dateStr);
}

function formatDateThai(dateStr) {
    return formatThaiDate(dateStr);
}

function getSystemDatePlaceholder() {
    const format = normalizeSystemDateFormat(state.dateFormat);
    if (format === 'DD_MMM_YYYY') return 'DD MMM YYYY';
    if (format === 'YYYY_MMM_DD') return 'YYYY MMM DD';
    if (format === 'MMM_DD_BBBB') return 'MMM DD BBBB';
    return 'MMM DD YYYY';
}

function updateSystemDateInputDisplay(input) {
    if (!input) return;
    const wrapper = input.closest && input.closest('.system-date-control');
    const display = wrapper && wrapper.querySelector('.system-date-display');
    if (!display) return;
    const displayText = input.value ? (formatSystemDate(input.value) || input.value) : getSystemDatePlaceholder();
    if (display.textContent !== displayText) display.textContent = displayText;
    display.classList.toggle('is-placeholder', !input.value);
    display.disabled = input.disabled;
    display.setAttribute('aria-label', input.value
        ? `วันที่ ${display.textContent} คลิกเพื่อเปลี่ยน`
        : `เลือกวันที่ รูปแบบ ${getSystemDatePlaceholder()}`);
}

function enhanceSystemDateInputs(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function' || typeof document.createElement !== 'function') return;
    root.querySelectorAll('input[type="date"]').forEach(input => {
        if (input.dataset.systemDateReady !== 'true') {
            const parent = input.parentNode;
            if (!parent) return;
            const wrapper = document.createElement('span');
            wrapper.className = 'system-date-control';
            const display = document.createElement('button');
            display.type = 'button';
            display.className = 'form-input system-date-display';
            display.addEventListener('click', () => {
                if (input.disabled) return;
                updateSystemDateInputDisplay(input);
                try {
                    if (typeof input.showPicker === 'function') input.showPicker();
                    else input.click();
                } catch (error) {
                    input.focus();
                }
            });
            input.addEventListener('input', () => updateSystemDateInputDisplay(input));
            input.addEventListener('change', () => updateSystemDateInputDisplay(input));
            parent.insertBefore(wrapper, input);
            wrapper.appendChild(display);
            wrapper.appendChild(input);
            input.dataset.systemDateReady = 'true';
            input.classList.add('system-date-native');
        }
        updateSystemDateInputDisplay(input);
    });
}

let systemDateRefreshQueued = false;
function queueSystemDateInputRefresh() {
    if (systemDateRefreshQueued) return;
    systemDateRefreshQueued = true;
    const refresh = () => {
        systemDateRefreshQueued = false;
        enhanceSystemDateInputs();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(refresh);
    } else {
        refresh();
    }
}

function startSystemDateInputObserver() {
    enhanceSystemDateInputs();
    if (typeof MutationObserver === 'undefined' || !document.body || document.body.dataset.systemDateObserver === 'true') return;
    document.body.dataset.systemDateObserver = 'true';
    const observer = new MutationObserver(queueSystemDateInputRefresh);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'class'] });
}

function formatNumber(num) {
    return (parseFloat(num) || 0).toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

// ==========================================================================
// Carry-over Balance — คำนวณที่ backend เสมอ (ดู refreshCarryOverAmount, state.carryOverAmount)
// ==========================================================================

// ==========================================================================
// Calculations Engine
// ==========================================================================
function calculateTotals() {
    let activeClaimable = 0;
    let activeNonClaimable = 0;

    state.expenses.forEach(exp => {
        if (isExpenseInSelectedMonth(exp)) {
            if (exp.claimable) activeClaimable += exp.amount;
            else activeNonClaimable += exp.amount;
        }
    });
    state.attachments.forEach(a => {
        if (isExpenseInSelectedMonth(a)) {
            if (a.claimable) activeClaimable += a.amount;
            else activeNonClaimable += a.amount;
        }
    });

    const carryOver = state.carryOverStatus === 'ready' ? (state.carryOverAmount || 0) : 0;
    let displayClaimable, displayNonClaimable, displayGrand;

    if (state.calculationMode === 'claim') {
        displayClaimable = activeClaimable + carryOver;
        displayNonClaimable = 0;
        displayGrand = displayClaimable;
    } else if (state.calculationMode === 'no-claim') {
        displayClaimable = 0;
        displayNonClaimable = activeNonClaimable;
        displayGrand = displayNonClaimable;
    } else {
        displayClaimable = activeClaimable + carryOver;
        displayNonClaimable = activeNonClaimable;
        displayGrand = displayClaimable + displayNonClaimable;
    }

    return {
        grandTotal: displayGrand,
        totalClaimable: displayClaimable,
        totalNonClaimable: displayNonClaimable,
        carryOver,
        activeClaimable,
        activeNonClaimable,
        activeTotal: activeClaimable + activeNonClaimable
    };
}

function updateMetricsBar() {
    const totals = calculateTotals();

    const banner = document.getElementById('carry-over-banner');
    if (banner) {
        if (state.carryOverStatus === 'loading') {
            banner.style.display = 'flex';
            (document.getElementById('carry-over-text') || {}).textContent = 'กำลังคำนวณยอดยกมาจากเดือนก่อน...';
        } else if (totals.carryOver > 0) {
            banner.style.display = 'flex';
            (document.getElementById('carry-over-text') || {}).textContent =
                `ยอดยกมาจากเดือนก่อน: ฿${totals.carryOver.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (สมทบเข้ากับยอดเบิกในเดือนนี้)`;
        } else {
            banner.style.display = 'none';
        }
    }

    const claimCard = document.getElementById('metric-claimable-card');
    const nonClaimCard = document.getElementById('metric-non-claimable-card');
    if (claimCard) claimCard.style.opacity = state.calculationMode === 'no-claim' ? '0.4' : '1';
    if (nonClaimCard) nonClaimCard.style.opacity = state.calculationMode === 'claim' ? '0.4' : '1';

    const fmt = v => '฿' + v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    (document.getElementById('metric-total-expense') || {}).textContent = fmt(totals.grandTotal);
    (document.getElementById('metric-total-claimable') || {}).textContent = fmt(totals.totalClaimable);
    (document.getElementById('metric-total-non-claimable') || {}).textContent = fmt(totals.totalNonClaimable);
    (document.getElementById('metric-total-expense-thai') || {}).textContent = thaiBahtText(totals.grandTotal);
    (document.getElementById('metric-total-claimable-thai') || {}).textContent = thaiBahtText(totals.totalClaimable);
    (document.getElementById('metric-total-non-claimable-thai') || {}).textContent = thaiBahtText(totals.totalNonClaimable);

    // KPI counts
    const monthExpenses = state.expenses.filter(isExpenseInSelectedMonth);
    const monthAttachments = state.attachments.filter(isExpenseInSelectedMonth);
    const kpiCount = document.getElementById('metric-bill-count');
    if (kpiCount) kpiCount.textContent = monthExpenses.length + monthAttachments.length + ' รายการ';
}

// ==========================================================================
// Render All
// ==========================================================================
function renderAll() {
    const renderSection = (name, callback) => {
        try {
            callback();
        } catch (error) {
            // A missing/older optional panel must not stop the database data
            // that already loaded from appearing in every other section.
            console.error(`UI section [${name}] failed:`, error);
        }
    };
    renderSection('metrics', updateMetricsBar);
    renderSection('tables', renderTables);
    renderSection('charts', renderCharts);
    renderSection('dashboard-year-summary', renderDashboardAnnualSummary);
    renderSection('spreadsheet', renderSpreadsheet);
    renderSection('project-filter', renderProjectFilterDropdown);
    renderSection('fund-receipt-widget', updateFundReceiptWidget);
    if (state.activeTab === 'settings-view') {
        renderSection('master-data', renderMasterData);
        renderSection('signature-previews', renderSignaturePreviews);
        renderSection('column-settings', renderColumnSettingsUI);
    }
    if (state.activeTab === 'claims-view') renderSection('claims', renderClaims);
    if (state.activeTab === 'fund-receipts') renderSection('fund-receipts', renderFundReceiptsOverview);
}

// ==========================================================================
// Dynamic Project Filter Dropdown
// ==========================================================================
function renderProjectFilterDropdown() {
    const sel = document.getElementById('filter-project');
    if (!sel) return;
    const curVal = sel.value;
    if(sel) sel.innerHTML = '<option value="all">ทั้งหมด</option>';
    state.projects.filter(p => p.active).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
    if (curVal) sel.value = curVal;
}

// ==========================================================================
// TAB 1: Dashboard Charts
// ==========================================================================
function recordMatchesCalculationMode(record) {
    if (state.calculationMode === 'claim') return Boolean(record.claimable);
    if (state.calculationMode === 'no-claim') return !record.claimable;
    return true;
}

function renderDashboardAnnualSummary() {
    const tbody = document.getElementById('dashboard-year-summary-body');
    if (!tbody) return;
    const title = document.getElementById('dashboard-year-summary-title');
    const totalElement = document.getElementById('dashboard-year-total');
    const ceYear = Number(state.selectedYear) - 543;
    const currentPeriod = getCurrentBangkokPeriod();
    const cachedRecords = getCachedAuthorizedExpenseRecords();
    const source = cachedRecords || [...(state.expenses || []), ...(state.attachments || [])];
    const byMonth = Array.from({ length: 12 }, () => ({ count: 0, claimable: 0, nonClaimable: 0, total: 0 }));

    source.forEach(record => {
        if (!record || record.status === 'cancelled' || !recordMatchesCalculationMode(record)) return;
        const monthKey = getExpensePostingMonth(record);
        if (!monthKey.startsWith(`${ceYear}-`)) return;
        const monthIndex = Number(monthKey.slice(5, 7)) - 1;
        if (monthIndex < 0 || monthIndex > 11) return;
        const amount = Number(record.amount || record.totalAmount || 0) || 0;
        byMonth[monthIndex].count += 1;
        byMonth[monthIndex].total += amount;
        if (record.claimable) byMonth[monthIndex].claimable += amount;
        else byMonth[monthIndex].nonClaimable += amount;
    });

    const annualTotal = byMonth.reduce((sum, month) => sum + month.total, 0);
    const maxMonthTotal = Math.max(0, ...byMonth.map(month => month.total));
    const modeLabel = state.calculationMode === 'claim'
        ? 'เฉพาะยอดเบิกมูลนิธิ'
        : state.calculationMode === 'no-claim' ? 'เฉพาะยอดไม่เบิก' : 'ข้อมูลทั้งหมด';
    if (title) title.textContent = `สรุปรายจ่ายรายเดือน พ.ศ. ${state.selectedYear} — ${modeLabel}`;
    if (totalElement) totalElement.textContent = `฿${annualTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    tbody.innerHTML = byMonth.map((month, index) => {
        const monthNumber = index + 1;
        const share = maxMonthTotal > 0 ? Math.max(3, Math.round((month.total / maxMonthTotal) * 100)) : 0;
        const isSelected = monthNumber === Number(state.selectedMonth);
        const isCurrentCalendarMonth = state.selectedYear === currentPeriod.yearBE && monthNumber === currentPeriod.month;
        return `<tr class="${isSelected ? 'is-selected-month' : ''} ${isCurrentCalendarMonth ? 'is-current-calendar-month' : ''}">
            <td>
                <button type="button" class="dashboard-year-month-button" onclick="selectDashboardMonth(${monthNumber})" ${isSelected ? 'aria-current="true"' : ''} title="แสดงข้อมูลเดือน${THAI_MONTH_NAMES[index]}">
                    <span>${THAI_MONTH_NAMES[index]}</span>
                    ${month.total > 0 ? `<span class="dashboard-year-month-bar" style="--month-share:${share}%" aria-hidden="true"></span>` : ''}
                </button>
            </td>
            <td class="text-right">${month.count.toLocaleString('th-TH')}</td>
            <td class="text-right">฿${month.claimable.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-right">฿${month.nonClaimable.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="text-right font-bold">฿${month.total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>`;
    }).join('');
}

async function selectDashboardMonth(month) {
    const normalizedMonth = Number(month);
    if (!Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) return;
    state.selectedMonth = normalizedMonth;
    const monthSelect = document.getElementById('select-month');
    if (monthSelect) monthSelect.value = String(normalizedMonth);
    syncSharedMonthSelectors();
    updateMonthStatusCheckboxUI();
    saveState();
    await initAppWithAPI();
    const filterBar = document.querySelector('main > .header-filters, .main-content > .header-filters');
    if (filterBar) filterBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window.selectDashboardMonth = selectDashboardMonth;

function renderCharts() {
    const isDark = state.theme === 'dark';
    const textColor = isDark ? '#e5e7eb' : '#374151';

    // 1. Project breakdown table (dynamic from state.projects)
    const projectMap = {};
    state.projects.forEach(p => {
        projectMap[p.id] = { name: p.name, claimable: 0, nonClaimable: 0 };
    });

    state.expenses.forEach(exp => {
        if (!isExpenseInSelectedMonth(exp)) return;
        const key = projectMap[exp.projectId] ? exp.projectId : null;
        if (key) {
            if (exp.claimable) projectMap[key].claimable += exp.amount;
            else projectMap[key].nonClaimable += exp.amount;
        }
    });
    state.attachments.forEach(a => {
        if (!isExpenseInSelectedMonth(a)) return;
        const key = projectMap[a.projectId] ? a.projectId : null;
        if (key) {
            if (a.claimable) projectMap[key].claimable += a.amount;
            else projectMap[key].nonClaimable += a.amount;
        }
    });

    const tbodyProj = document.querySelector('#dashboard-project-table tbody');
    tbodyProj.innerHTML = '';
    Object.values(projectMap).forEach(p => {
        const total = p.claimable + p.nonClaimable;
        if (total > 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-semibold">${p.name}</td>
                <td class="text-right text-success font-semibold">฿${p.claimable.toFixed(2)}</td>
                <td class="text-right text-secondary">฿${p.nonClaimable.toFixed(2)}</td>
                <td class="text-right font-bold">฿${total.toFixed(2)}</td>
            `;
            tbodyProj.appendChild(tr);
        }
    });
    if (tbodyProj && tbodyProj.children.length === 0) {
        tbodyProj.innerHTML = `<tr><td colspan="4" class="empty-state">ไม่มีรายจ่ายในเดือนนี้</td></tr>`;
    }

    // 2. Fund Source breakdown table
    const fundMap = {};
    state.fundSources.forEach(f => { fundMap[f.id] = { name: f.name, total: 0 }; });

    state.expenses.forEach(exp => {
        if (!isExpenseInSelectedMonth(exp)) return;
        if (fundMap[exp.fundSourceId]) fundMap[exp.fundSourceId].total += exp.amount;
    });
    state.attachments.forEach(a => {
        if (!isExpenseInSelectedMonth(a)) return;
        if (fundMap[a.fundSourceId]) fundMap[a.fundSourceId].total += a.amount;
    });

    

    const tbodyFund = document.querySelector('#dashboard-fund-table tbody');
    tbodyFund.innerHTML = '';
    Object.values(fundMap).forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-semibold">${f.name}</td>
            <td class="text-right font-bold">฿${f.total.toFixed(2)}</td>
        `;
        tbodyFund.appendChild(tr);
    });

    // 3. Category Doughnut Chart
    const ctxCat = document.getElementById('chart-categories');
    if (!ctxCat) return;
    if (chartCategories) { chartCategories.destroy(); chartCategories = null; }

    const catMap = {};
    state.expenses.forEach(exp => {
        if (!isExpenseInSelectedMonth(exp)) return;
        const catName = getCategoryName(exp.categoryId);
        catMap[catName] = (catMap[catName] || 0) + exp.amount;
    });
    state.attachments.forEach(a => {
        if (!isExpenseInSelectedMonth(a)) return;
        const catName = getCategoryName(a.categoryId);
        catMap[catName] = (catMap[catName] || 0) + a.amount;
    });

    const labels = Object.keys(catMap);
    const data = Object.values(catMap);
    const colors = ['#10b981', '#38bdf8', '#fbbf24', '#f87171', '#a78bfa', '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#6366f1'];

    chartCategories = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
            labels: labels.length > 0 ? labels : ['ไม่มีรายจ่าย'],
            datasets: [{
                data: data.length > 0 ? data : [1],
                backgroundColor: colors.slice(0, Math.max(1, labels.length)),
                borderWidth: isDark ? 2 : 1,
                borderColor: isDark ? '#111827' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { color: textColor, padding: 8, font: { size: 10 } } }
            }
        }
    });

    // 4. Recent Bills table in Dashboard
    const tbodyRecent = document.querySelector('#dashboard-recent-table tbody');
    tbodyRecent.innerHTML = '';
    const monthExpenses = state.expenses.filter(isExpenseInSelectedMonth).slice().reverse();

    if (monthExpenses.length === 0) {
        tbodyRecent.innerHTML = `<tr><td colspan="9" class="empty-state">ไม่มีข้อมูลบิลในเดือนนี้</td></tr>`;
        return;
    }
    monthExpenses.slice(0, 5).forEach(exp => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-semibold">${exp.documentNo}</td>
            <td>${formatThaiDate(exp.expenseDate)}</td>
            <td><span class="badge-project">${getProjectName(exp.projectId)}</span></td>
            <td><span class="badge-cat">${getCategoryName(exp.categoryId)}</span></td>
            <td><span class="badge-fund">${getFundSourceName(exp.fundSourceId)}</span></td>
            <td>${getVendorName(exp.vendorId)} — ${exp.description}</td>
            <td class="text-right">฿${exp.unitPrice.toFixed(2)}</td>
            <td class="text-right font-semibold">฿${exp.amount.toFixed(2)}</td>
            <td><span class="badge ${exp.claimable ? 'badge-claimable' : 'badge-non-claimable'}">${exp.claimable ? 'เบิกมูลนิธิ' : 'ไม่เบิก'}</span></td>
        `;
        tbodyRecent.appendChild(tr);
    });
}

// ==========================================================================
// TAB 2: Full Bills Table
// ==========================================================================
function renderTables() {
    const searchVal = document.getElementById('filter-search').value.toLowerCase();
    const projFilter = document.getElementById('filter-project').value;

    // Dynamic headings — show selected month/year
    const monthYear = `${THAI_MONTH_NAMES[state.selectedMonth - 1]} พ.ศ. ${state.selectedYear}`;
    updateBillsWidgetMonthBadge();
    const billsTitle = document.getElementById('bills-widget-title');
    const attachTitle = document.getElementById('attach-widget-title');
    const additionalTitle = document.getElementById('additional-bills-widget-title');
    if (billsTitle) billsTitle.textContent = `รายการบิลประจำเดือน — ${monthYear}`;
    if (attachTitle) attachTitle.textContent = `รายการบิลแนบ / ค่าสาธารณูปโภค — เดือน${monthYear}`;
    if (additionalTitle) additionalTitle.textContent = `รายการใช้จ่าย (โครงการเพิ่มเติม) — เดือน${monthYear}`;

    // Update page subtitle too if on this tab
    if (state.activeTab === 'bills-table') {
        const sub = document.getElementById('page-subtitle-display');
        if (sub) sub.textContent = `บันทึกและจัดการบิลประจำเดือน${monthYear}`;
    }

    // 1. Render Table Headers
    renderTableHeaders('full-bills-table');
    renderTableHeaders('attached-bills-table');

    // 2. Expense records (EXP)
    const tbodyBills = document.querySelector('#full-bills-table tbody');
    tbodyBills.innerHTML = '';

    const filteredExp = state.expenses.filter(exp => {
        if (!isExpenseInSelectedMonth(exp)) return false;
        const matchSearch = [exp.documentNo, exp.receiptNo, exp.description, getVendorName(exp.vendorId), getCategoryName(exp.categoryId), exp.note]
            .join(' ').toLowerCase().includes(searchVal);
        const matchProj = projFilter === 'all' || exp.projectId === projFilter;
        return matchSearch && matchProj;
    });

    if (filteredExp.length === 0) {
        tbodyBills.innerHTML = '<tr><td colspan="6" class="empty-state">ไม่พบรายการบิลในเดือนนี้</td></tr>';
    } else {
        filteredExp.forEach(exp => {
            const idx = state.expenses.findIndex(e => e === exp);
            renderExpenseRow(exp, idx, tbodyBills);
        });
    }

    // 3. Attachment records (ATT)
    const tbodyAttach = document.querySelector('#attached-bills-table tbody');
    tbodyAttach.innerHTML = '';

    const filteredAttach = state.attachments.filter(a => {
        if (!isExpenseInSelectedMonth(a)) return false;
        const matchSearch = [a.description, getVendorName(a.vendorId), getCategoryName(a.categoryId), a.note]
            .join(' ').toLowerCase().includes(searchVal);
        const matchProj = projFilter === 'all' || a.projectId === projFilter;
        return matchSearch && matchProj;
    });

    if (filteredAttach.length === 0) {
        tbodyAttach.innerHTML = '<tr><td colspan="6" class="empty-state">ไม่พบบิลแนบ / ค่าสาธารณูปโภคในเดือนนี้</td></tr>';
    } else {
        filteredAttach.forEach(a => {
            const idx = state.attachments.findIndex(x => x === a);
            renderAttachmentRow(a, idx, tbodyAttach);
        });
    }

    // Keep quick-entry rows aligned with the selected month. Saved cloud rows
    // are restored into the quick table after reload; pending rows stay local.
    syncQuickExpenseEntryPeriod();
    syncQuickExpenseSavedRows();
    renderFoodBillsTable();
    syncQuickFoodEntryPeriod();
    bindTableActionButtons();
    initializeLucide();
    hydrateVisibleAttachmentThumbnails();
}

function bindTableActionButtons() {
    // Attachment button
    document.querySelectorAll('.btn-icon-attach').forEach(btn => {
        btn.addEventListener('click', () => {
            const expId = btn.getAttribute('data-exp-id');
            openExpenseAttachmentModal(expId);
        });
    });
    document.querySelectorAll('.btn-icon-edit').forEach(btn => {
        btn.addEventListener('click', () => openExpenseModal(parseInt(btn.getAttribute('data-idx'), 10)));
    });
    document.querySelectorAll('.btn-icon-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = parseInt(btn.getAttribute('data-idx'), 10);
            const exp = state.expenses[idx];
            if (!exp) return;
            if (await appConfirm(getExpenseDeleteConfirmationMessage(exp), 'ยืนยันลบรายการ', {
                confirmButtonText: 'ลบออกจากระบบ',
                cancelButtonText: 'ย้อนกลับ'
            })) {
                showLoading(true);
                try {
                    const result = await deleteExpenseRecordAndSync(exp.id);
                    const cleanupFailed = Number(result && result.attachmentCleanup && result.attachmentCleanup.driveTrashFailed) || 0;
                    appAlert(
                        cleanupFailed
                            ? `ลบรายการแล้ว แต่มีไฟล์หลักฐาน ${cleanupFailed} ไฟล์ที่ย้ายไปถังขยะไม่สำเร็จ`
                            : `ลบรายการ ${exp.documentNo || exp.id} ออกจากฐานข้อมูลและตารางทั้งหมดแล้ว`,
                        cleanupFailed ? 'warning' : 'success'
                    );
                } catch (err) {
                    appAlert('ลบล้มเหลว: ' + err.message, 'error');
                } finally {
                    showLoading(false);
                }
            }
        });
    });
    document.querySelectorAll('.btn-icon-edit-attach').forEach(btn => {
        btn.addEventListener('click', () => openAttachmentModal(parseInt(btn.getAttribute('data-idx'), 10)));
    });
    document.querySelectorAll('.btn-icon-delete-attach').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = parseInt(btn.getAttribute('data-idx'), 10);
            const att = state.attachments[idx];
            if (!att) return;
            if (await appConfirm(getExpenseDeleteConfirmationMessage(att), 'ยืนยันลบรายการ', {
                confirmButtonText: 'ลบออกจากระบบ',
                cancelButtonText: 'ย้อนกลับ'
            })) {
                showLoading(true);
                try {
                    const result = await deleteExpenseRecordAndSync(att.id);
                    const cleanupFailed = Number(result && result.attachmentCleanup && result.attachmentCleanup.driveTrashFailed) || 0;
                    appAlert(
                        cleanupFailed
                            ? `ลบรายการแล้ว แต่มีไฟล์หลักฐาน ${cleanupFailed} ไฟล์ที่ย้ายไปถังขยะไม่สำเร็จ`
                            : `ลบรายการ ${att.documentNo || att.id} ออกจากฐานข้อมูลและตารางทั้งหมดแล้ว`,
                        cleanupFailed ? 'warning' : 'success'
                    );
                } catch (err) {
                    appAlert('ลบล้มเหลว: ' + err.message, 'error');
                } finally {
                    showLoading(false);
                }
            }
        });
    });
}

// ==========================================================================
// TAB 3: Spreadsheet View
// ==========================================================================
function renderSpreadsheet() {
    const table = document.getElementById('excel-grid');
    if (!table) return;

    (document.getElementById('sheet-month-name') || {}).textContent = THAI_MONTH_NAMES[state.selectedMonth - 1];
    (document.getElementById('sheet-year-val') || {}).textContent = state.selectedYear;

    table.innerHTML = '';
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

    const headRow = document.createElement('tr');
    headRow.appendChild(document.createElement('th'));
    cols.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        headRow.appendChild(th);
    });
    table.appendChild(headRow);

    const monthlyExp = state.expenses.filter(isExpenseInSelectedMonth);
    const monthlyAttach = state.attachments.filter(isExpenseInSelectedMonth);

    let expSum = 0;
    monthlyExp.forEach(e => {
        if (state.calculationMode === 'all' || (state.calculationMode === 'claim' && e.claimable) || (state.calculationMode === 'no-claim' && !e.claimable)) {
            expSum += e.amount;
        }
    });

    const carryOver = state.carryOverStatus === 'ready' ? (state.carryOverAmount || 0) : 0;
    const totals = calculateTotals();
    const rowsCount = Math.max(20, 12 + monthlyExp.length + monthlyAttach.length);

    let expRowIdx = 0;
    let attachRowIdx = 0;

    for (let r = 1; r <= rowsCount; r++) {
        const tr = document.createElement('tr');
        const rowNumTh = document.createElement('th');
        rowNumTh.className = 'row-num';
        rowNumTh.textContent = r;
        tr.appendChild(rowNumTh);

        if (r === 1) {
            createMergedCell(tr, 7, "");
            createCell(tr, "พิมพ์", "header-cell");
            createCell(tr, `${state.selectedMonth}/${state.selectedYear}`, "header-cell");
            createCell(tr, "");
        } else if (r === 2) {
            createMergedCell(tr, 9, "รายการบิล RDF วก.แม่สะเรียง", "header-cell", "font-weight: bold; font-size: 15px; text-align: center;");
            createCell(tr, "");
        } else if (r === 3) {
            let label = `บิลรายการค่าใช้จ่ายรอบเดือน ${THAI_MONTH_NAMES[state.selectedMonth - 1]} พ.ศ. ${state.selectedYear}`;
            if (state.calculationMode === 'claim') label += " (เฉพาะเบิกมูลนิธิ)";
            if (state.calculationMode === 'no-claim') label += " (เฉพาะไม่เบิกมูลนิธิ)";
            createMergedCell(tr, 9, label, "header-cell", "font-size: 12px; text-align: left; padding-left: 10px;");
            createCell(tr, "");
        } else if (r === 4) {
            createCell(tr, "เลขบิล", "header-cell");
            createCell(tr, "วันที่บิล", "header-cell");
            createMergedCell(tr, 3, "ร้าน + หมวดหมู่ + รายการ", "header-cell", "text-align: center; font-weight: bold;");
            createCell(tr, "โครงการ", "header-cell");
            createCell(tr, "จำนวน", "header-cell");
            createCell(tr, "ราคาหน่วย", "header-cell");
            createCell(tr, "รวม", "header-cell");
            createCell(tr, "แหล่งเงิน / Note", "header-cell");
        } else if (r >= 5 && r < 5 + monthlyExp.length) {
            const exp = monthlyExp[expRowIdx];
            const origIdx = state.expenses.findIndex(e => e === exp);
            const descLabel = `[${getCategoryName(exp.categoryId)}] ${getVendorName(exp.vendorId)} — ${exp.description}`;

            createCell(tr, exp.documentNo, "editable", `data-type="exp-docno" data-idx="${origIdx}"`);
            createCell(tr, formatDateToShort(exp.expenseDate), "editable", `data-type="exp-date" data-idx="${origIdx}"`);
            createMergedCell(tr, 3, descLabel, "editable", "text-align: left;", `data-type="exp-desc" data-idx="${origIdx}"`);
            createCell(tr, getProjectName(exp.projectId), "");
            createCell(tr, exp.quantity, "editable text-right", `data-type="exp-qty" data-idx="${origIdx}"`);
            createCell(tr, exp.unitPrice.toFixed(2), "editable text-right", `data-type="exp-price" data-idx="${origIdx}"`);
            createCell(tr, exp.amount.toFixed(2), "text-right font-semibold");
            const noteVal = `[${getFundSourceName(exp.fundSourceId)}]${exp.note ? ' ' + exp.note : ''}`;
            createCell(tr, noteVal, "");
            expRowIdx++;
        } else if (r === 5 + monthlyExp.length) {
            createCell(tr, "");
            createCell(tr, "");
            createCell(tr, "รวมบิลเดือนนี้", "font-semibold text-center");
            createMergedCell(tr, 3, thaiBahtText(expSum), "text-center", "font-style: italic;");
            createCell(tr, "");
            createCell(tr, "");
            createCell(tr, expSum.toFixed(2), "font-semibold text-right");
            createCell(tr, "");
        } else if (r === 6 + monthlyExp.length) {
            const showCarry = (state.calculationMode === 'all' || state.calculationMode === 'claim') && carryOver > 0;
            const carryVal = showCarry ? carryOver : 0;
            createCell(tr, "");
            createCell(tr, "");
            createCell(tr, "ยอดยกมาจากเดือนก่อน", "font-semibold text-center", "color: var(--warning);");
            createMergedCell(tr, 3, thaiBahtText(carryVal), "text-center", "font-style: italic;");
            createCell(tr, "");
            createCell(tr, "");
            createCell(tr, carryVal.toFixed(2), "font-semibold text-right");
            createCell(tr, "");
        } else if (r === 7 + monthlyExp.length) {
            createEmptyRowCells(tr, 10);
        } else if (r === 8 + monthlyExp.length) {
            createMergedCell(tr, 3, "รายการบิลแนบมาด้วยประจำเดือน", "font-semibold", "text-align: left; padding-left: 10px;");
            createEmptyRowCells(tr, 7);
        } else if (r > 8 + monthlyExp.length && r <= 8 + monthlyExp.length + monthlyAttach.length) {
            const a = monthlyAttach[attachRowIdx];
            const origIdx = state.attachments.findIndex(x => x === a);
            const isVisible = state.calculationMode === 'all' || (state.calculationMode === 'claim' && a.claimable) || (state.calculationMode === 'no-claim' && !a.claimable);
            const amt = isVisible ? a.amount : 0;
            const descLabel = `[${getCategoryName(a.categoryId)}] ${a.description}`;

            createCell(tr, "");
            createCell(tr, formatDateToShort(a.expenseDate), "editable", `data-type="attach-date" data-idx="${origIdx}"`);
            createMergedCell(tr, 4, descLabel, "editable", "text-align: left;", `data-type="attach-desc" data-idx="${origIdx}"`);
            createCell(tr, "");
            createCell(tr, "");
            createCell(tr, amt.toFixed(2), "editable text-right font-semibold", `data-type="attach-amount" data-idx="${origIdx}"`);
            createCell(tr, `[${getFundSourceName(a.fundSourceId)}]`, "");
            attachRowIdx++;
        } else if (r === 9 + monthlyExp.length + monthlyAttach.length) {
            createCell(tr, "");
            createCell(tr, "รวมสะสมสุทธิ", "font-semibold text-center");
            createMergedCell(tr, 4, "");
            createCell(tr, "");
            createCell(tr, "");
            createCell(tr, totals.grandTotal.toFixed(2), "font-semibold text-right");
            createCell(tr, "");
        } else if (r === 10 + monthlyExp.length + monthlyAttach.length) {
            createCell(tr, "");
            createMergedCell(tr, 7, thaiBahtText(totals.grandTotal), "text-center", "font-weight: bold; font-style: italic;");
            createCell(tr, "");
            createCell(tr, "");
        } else {
            createEmptyRowCells(tr, 10);
        }

        table.appendChild(tr);
    }

    bindSpreadsheetEditHandlers();
}

function bindSpreadsheetEditHandlers() {
    document.querySelectorAll('.spreadsheet-table td.editable').forEach(cell => {
        cell.addEventListener('blur', () => {
            const type = cell.getAttribute('data-type');
            const idx = parseInt(cell.getAttribute('data-idx'), 10);
            const rawVal = cell.textContent.trim();
            if (isNaN(idx)) return;

            if (type && type.startsWith('exp-')) {
                const exp = state.expenses[idx];
                if (!exp) return;
                if (type === 'exp-docno') exp.documentNo = rawVal;
                else if (type === 'exp-date') exp.expenseDate = parseSpreadsheetDate(rawVal);
                else if (type === 'exp-desc') exp.description = rawVal;
                else if (type === 'exp-qty') { exp.quantity = Math.max(0.01, parseFloat(rawVal) || 1); exp.amount = exp.quantity * exp.unitPrice; }
                else if (type === 'exp-price') { exp.unitPrice = Math.max(0, parseFloat(rawVal) || 0); exp.amount = exp.quantity * exp.unitPrice; }
            } else if (type && type.startsWith('attach-')) {
                const a = state.attachments[idx];
                if (!a) return;
                if (type === 'attach-date') a.expenseDate = parseSpreadsheetDate(rawVal);
                else if (type === 'attach-desc') a.description = rawVal;
                else if (type === 'attach-amount') a.amount = Math.max(0, parseFloat(rawVal) || 0);
            }

            saveState();
            updateMetricsBar();
            setTimeout(() => renderSpreadsheet(), 100);
        });
        cell.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); cell.blur(); }
        });
    });
}

function parseSpreadsheetDate(val) {
    if (!val) return new Date().toISOString().split('T')[0];
    const clean = val.replace(/\//g, '-');
    const parts = clean.split('-');
    if (parts.length === 3) {
        let day = parseInt(parts[0], 10);
        let month = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);
        if (year > 2400) year -= 543;
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return val;
}

// Spreadsheet cell creation helpers
function createCell(tr, content, className = "", extraAttrs = "", inlineStyle = "") {
    const td = document.createElement('td');
    if (className) td.className = className;
    if (extraAttrs) {
        extraAttrs.split(' ').forEach(attr => {
            const [key, val] = attr.split('=');
            if (key && val) td.setAttribute(key, val.replace(/"/g, ''));
        });
    }
    if (inlineStyle) td.style.cssText = inlineStyle;
    td.textContent = String(content ?? '');
    if (className && className.includes('editable')) td.contentEditable = 'true';
    tr.appendChild(td);
}

function createMergedCell(tr, colspan, content, className = "", inlineStyle = "", extraAttrs = "") {
    const td = document.createElement('td');
    td.colSpan = colspan;
    if (className) td.className = className;
    if (inlineStyle) td.style.cssText = inlineStyle;
    if (extraAttrs) {
        extraAttrs.split(' ').forEach(attr => {
            const [key, val] = attr.split('=');
            if (key && val) td.setAttribute(key, val.replace(/"/g, ''));
        });
    }
    td.textContent = String(content ?? '');
    if (className && className.includes('editable')) td.contentEditable = 'true';
    tr.appendChild(td);
}

function createEmptyRowCells(tr, count) {
    for (let i = 0; i < count; i++) {
        tr.appendChild(document.createElement('td'));
    }
}

// ==========================================================================
// TAB 5: Master Data Management
// ==========================================================================
function renderMasterData() {
    renderMasterProjects();
    renderMasterCategories();
    renderMasterVendors();
    renderMasterFundSources();
    renderMasterOrganizations();
    renderLoginBgSettingsUI();
    initializeLucide();
}

function renderMasterProjects() {
    const tbody = document.querySelector('#master-projects-table tbody');
    if (!tbody) return;
    const countEl = document.getElementById('master-projects-count');
    if (countEl) countEl.textContent = state.projects.length;
    tbody.innerHTML = '';
    state.projects.forEach((p, idx) => {
        const tr = document.createElement('tr');
        const meta = [p.id, p.budget ? `งบ ฿${p.budget.toLocaleString('th-TH')}` : null].filter(Boolean).join(' · ');
        tr.innerHTML = `
            <td>
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <span style="font-weight:600;">${p.name}</span>
                    <span class="badge ${p.active ? 'badge-claimable' : 'badge-non-claimable'}" style="font-size:10px;">${p.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>
                </div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${meta}</div>
            </td>
            <td class="text-center">
                <div class="action-buttons" style="justify-content:center;">
                    <button class="btn-icon btn-icon-edit" data-master="project" data-idx="${idx}"><i data-lucide="edit"></i></button>
                    <button class="btn-icon btn-icon-delete" data-master="project" data-idx="${idx}"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    bindMasterActionButtons();
}

function renderMasterCategories() {
    const tbody = document.querySelector('#master-categories-table tbody');
    if (!tbody) return;
    const countEl = document.getElementById('master-categories-count');
    if (countEl) countEl.textContent = state.categories.length;
    tbody.innerHTML = '';
    state.categories.forEach((c, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="font-weight:600;">${c.name}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${c.id}</div>
            </td>
            <td class="text-center">
                <div class="action-buttons" style="justify-content:center;">
                    <button class="btn-icon btn-icon-edit" data-master="category" data-idx="${idx}"><i data-lucide="edit"></i></button>
                    <button class="btn-icon btn-icon-delete" data-master="category" data-idx="${idx}"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    bindMasterActionButtons();
}

function renderMasterVendors() {
    const tbody = document.querySelector('#master-vendors-table tbody');
    if (!tbody) return;
    const countEl = document.getElementById('master-vendors-count');
    if (countEl) countEl.textContent = state.vendors.length;
    tbody.innerHTML = '';
    state.vendors.forEach((v, idx) => {
        const tr = document.createElement('tr');
        const meta = [v.id, v.phone || null].filter(Boolean).join(' · ');
        tr.innerHTML = `
            <td>
                <div style="font-weight:600;">${v.name}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${meta}</div>
            </td>
            <td class="text-center">
                <div class="action-buttons" style="justify-content:center;">
                    <button class="btn-icon btn-icon-edit" data-master="vendor" data-idx="${idx}"><i data-lucide="edit"></i></button>
                    <button class="btn-icon btn-icon-delete" data-master="vendor" data-idx="${idx}"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    bindMasterActionButtons();
}

function renderMasterFundSources() {
    const tbody = document.querySelector('#master-fundsources-table tbody');
    if (!tbody) return;
    const countEl = document.getElementById('master-fundsources-count');
    if (countEl) countEl.textContent = state.fundSources.length;
    tbody.innerHTML = '';
    state.fundSources.forEach((f, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div style="font-weight:600;">${f.name}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${f.id}</div>
            </td>
            <td class="text-center">
                <div class="action-buttons" style="justify-content:center;">
                    <button class="btn-icon btn-icon-edit" data-master="fundsource" data-idx="${idx}"><i data-lucide="edit"></i></button>
                    <button class="btn-icon btn-icon-delete" data-master="fundsource" data-idx="${idx}"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    bindMasterActionButtons();
}

function renderMasterOrganizations() {
    const tbody = document.querySelector('#master-organizations-table tbody');
    if (!tbody) return;
    const countEl = document.getElementById('master-organizations-count');
    if (countEl) countEl.textContent = (state.organizations || []).length;
    tbody.innerHTML = '';
    (state.organizations || []).forEach((o, idx) => {
        const tr = document.createElement('tr');
        const meta = [o.id, o.shortName ? `รหัส ${o.shortName}` : null].filter(Boolean).join(' · ');
        tr.innerHTML = `
            <td>
                <div style="font-weight:600;">${o.name}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${meta}</div>
            </td>
            <td class="text-center">
                <div class="action-buttons" style="justify-content:center;">
                    <button class="btn-icon btn-icon-edit" data-master="organization" data-idx="${idx}"><i data-lucide="edit"></i></button>
                    <button class="btn-icon btn-icon-delete" data-master="organization" data-idx="${idx}"><i data-lucide="trash-2"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    bindMasterActionButtons();
}

function bindMasterActionButtons() {
    document.querySelectorAll('[data-master]').forEach(btn => {
        // Avoid re-binding
        btn.replaceWith(btn.cloneNode(true));
    });
    document.querySelectorAll('[data-master]').forEach(btn => {
        btn.addEventListener('click', () => {
            const master = btn.getAttribute('data-master');
            const idx = parseInt(btn.getAttribute('data-idx'), 10);
            const isEdit = btn.classList.contains('btn-icon-edit');
            const isDelete = btn.classList.contains('btn-icon-delete');

            if (isDelete) {
                handleMasterDelete(master, idx);
            } else if (isEdit) {
                openMasterModal(master, idx);
            }
        });
    });
}

// ==========================================================================
// Master Data Modal (Single reusable modal)
// ==========================================================================
function getMasterCollection(master) {
    const map = {
        project: state.projects,
        category: state.categories,
        vendor: state.vendors,
        fundsource: state.fundSources,
        organization: state.organizations || []
    };
    return map[master] || [];
}

function getMasterAction(master, mode) {
    const map = {
        project: { update: 'updateProject', disable: 'disableProject' },
        category: { update: 'updateCategory', disable: 'disableCategory' },
        vendor: { update: 'updateVendor', disable: 'disableVendor' },
        fundsource: { update: 'updateFundSource', disable: 'disableFundSource' },
        organization: { update: 'updateOrganization', disable: 'disableOrganization' }
    };
    return map[master] && map[master][mode];
}

function masterFieldValue(item, key, fallback = '') {
    return escapeHTML(item ? (item[key] ?? fallback) : fallback);
}

async function handleMasterDelete(master, idx) {
    const item = getMasterCollection(master)[idx];
    if (!item || !item.id) return;
    const confirmed = await appConfirm('ยืนยันการปิดใช้งานรายการนี้? รายการเดิมในประวัติจะยังคงอยู่ แต่จะไม่แสดงให้เลือกในรายการใหม่', 'ปิดใช้งานข้อมูลหลัก');
    if (!confirmed) return;
    const action = getMasterAction(master, 'disable');
    if (!action) return appAlert('ยังไม่รองรับการปิดใช้งานรายการนี้', 'error');
    showLoading(true);
    try {
        await apiCall(action, { id: item.id });
        appAlert('ปิดใช้งานข้อมูลหลักเรียบร้อยแล้ว', 'success');
        await initAppWithAPI();
    } catch (err) {
        appAlert('ปิดใช้งานไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

function openMasterModal(master, editIdx = null) {
    const modal = document.getElementById('modal-master');
    const title = document.getElementById('modal-master-title');
    const body = document.getElementById('modal-master-body');
    modal.setAttribute('data-master', master);
    modal.setAttribute('data-edit-idx', editIdx !== null ? editIdx : '');

    const titles = { project: 'โครงการ', category: 'หมวดหมู่', vendor: 'ผู้ขาย/ร้านค้า', fundsource: 'แหล่งเงิน', organization: 'สถานศึกษา' };
    title.textContent = (editIdx !== null ? 'แก้ไข' : 'เพิ่ม') + titles[master];

    body.innerHTML = '';

    if (master === 'project') {
        const item = editIdx !== null ? state.projects[editIdx] : null;
        body.innerHTML = `
            <div class="form-group"><label class="form-label">ชื่อโครงการ</label><input type="text" id="mf-name" class="form-input" value="${masterFieldValue(item, 'name')}" required></div>
            <div class="form-group"><label class="form-label">งบประมาณ (฿)</label><input type="number" id="mf-budget" class="form-input" value="${masterFieldValue(item, 'budget', 0)}" min="0"></div>
            <div class="form-group"><label class="form-label">สถานะ</label>
                <select id="mf-active" class="form-select w-full" style="padding:10px;" ${item ? 'disabled' : ''}>
                    <option value="true" ${!item || item.active ? 'selected' : ''}>ใช้งาน</option>
                    <option value="false" ${item && !item.active ? 'selected' : ''}>ปิดใช้งาน</option>
                </select>
            </div>
        `;
    } else if (master === 'category') {
        const item = editIdx !== null ? state.categories[editIdx] : null;
        body.innerHTML = `<div class="form-group"><label class="form-label">ชื่อหมวดหมู่</label><input type="text" id="mf-name" class="form-input" value="${masterFieldValue(item, 'name')}" required></div>`;
    } else if (master === 'vendor') {
        const item = editIdx !== null ? state.vendors[editIdx] : null;
        body.innerHTML = `
            <div class="form-group"><label class="form-label">ชื่อร้าน / ผู้ขาย</label><input type="text" id="mf-name" class="form-input" value="${masterFieldValue(item, 'name')}" required></div>
            <div class="form-group"><label class="form-label">เบอร์โทรศัพท์</label><input type="text" id="mf-phone" class="form-input" value="${masterFieldValue(item, 'phone')}"></div>
        `;
    } else if (master === 'fundsource') {
        const item = editIdx !== null ? state.fundSources[editIdx] : null;
        body.innerHTML = `<div class="form-group"><label class="form-label">ชื่อแหล่งเงิน</label><input type="text" id="mf-name" class="form-input" value="${masterFieldValue(item, 'name')}" required></div>`;
    } else if (master === 'organization') {
        const item = editIdx !== null ? state.organizations[editIdx] : null;
        body.innerHTML = `
            <div class="form-group"><label class="form-label">ชื่อสถานศึกษา</label><input type="text" id="mf-name" class="form-input" value="${masterFieldValue(item, 'name')}" required></div>
            <div class="form-group"><label class="form-label">รหัสย่อ (ใช้ขึ้นต้นเลขที่เอกสาร เช่น MSB)</label><input type="text" id="mf-shortname" class="form-input" value="${masterFieldValue(item, 'shortName')}" required></div>
            <div class="form-group"><label class="form-label">ที่อยู่</label><input type="text" id="mf-address" class="form-input" value="${masterFieldValue(item, 'addressTh')}"></div>
            <div class="form-group"><label class="form-label">เบอร์โทรศัพท์</label><input type="text" id="mf-phone" class="form-input" value="${masterFieldValue(item, 'phone')}"></div>
            <div class="form-group"><label class="form-label">ชื่อผู้อำนวยการ/ผู้บริหาร</label><input type="text" id="mf-director" class="form-input" value="${masterFieldValue(item, 'directorName')}"></div>
        `;
    }

    modal.classList.add('active');
}

function closeMasterModal() {
    document.getElementById('modal-master').classList.remove('active');
}

// ==========================================================================
// Expense Modal (Bill Form)
// ==========================================================================
async function handleMasterSubmit(e) {
    e.preventDefault();
    const modal = document.getElementById('modal-master');
    const master = modal.getAttribute('data-master');
    const editIdx = modal.getAttribute('data-edit-idx');
    const idx = editIdx !== '' ? parseInt(editIdx, 10) : null;
    const currentItem = idx !== null ? getMasterCollection(master)[idx] : null;
    const name = document.getElementById('mf-name').value.trim();
    if (!name) return;

    showLoading(true);
    try {
        if (master === 'project') {
            const budget = parseFloat(document.getElementById('mf-budget').value) || 0;
            await apiCall(idx !== null ? 'updateProject' : 'createProject', {
                id: currentItem && currentItem.id,
                projectName: name,
                budget
            });
        } else if (master === 'category') {
            await apiCall(idx !== null ? 'updateCategory' : 'createCategory', {
                id: currentItem && currentItem.id,
                categoryName: name
            });
        } else if (master === 'vendor') {
            const phone = (document.getElementById('mf-phone') || {}).value || '';
            await apiCall(idx !== null ? 'updateVendor' : 'createVendor', {
                id: currentItem && currentItem.id,
                vendorName: name,
                phone
            });
        } else if (master === 'fundsource') {
            await apiCall(idx !== null ? 'updateFundSource' : 'createFundSource', {
                id: currentItem && currentItem.id,
                fundSourceName: name
            });
        } else if (master === 'organization') {
            const shortName = (document.getElementById('mf-shortname') || {}).value.trim();
            if (!shortName) {
                showLoading(false);
                return appAlert('กรุณาระบุรหัสย่อ', 'error');
            }
            const addressTh = (document.getElementById('mf-address') || {}).value.trim();
            const phone = (document.getElementById('mf-phone') || {}).value.trim();
            const directorName = (document.getElementById('mf-director') || {}).value.trim();
            await apiCall(idx !== null ? 'updateOrganization' : 'createOrganization', {
                id: currentItem && currentItem.id,
                nameTh: name,
                shortName,
                addressTh,
                phone,
                directorName
            });
        }
        appAlert(idx !== null ? 'บันทึกการแก้ไขข้อมูลหลักสำเร็จ' : 'เพิ่มข้อมูลหลักสำเร็จ!', 'success');
        closeMasterModal();
        await initAppWithAPI();
    } catch (err) {
        appAlert('บันทึกข้อมูลหลักไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

function populateDropdown(selectId, items, valueKey, labelKey, selectedVal = null) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    if(sel) sel.innerHTML = '';
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item[valueKey];
        opt.textContent = item[labelKey];
        if (item[valueKey] === selectedVal) opt.selected = true;
        sel.appendChild(opt);
    });
}

function normalizeMasterName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getExpenseMasterConfig(type) {
    const map = {
        category: {
            stateKey: 'categories',
            hiddenId: 'bill-category',
            inputId: 'bill-category-input',
            listId: 'bill-category-list',
            createAction: 'createCategory',
            createField: 'categoryName',
            label: 'หมวดหมู่รายจ่าย'
        },
        vendor: {
            stateKey: 'vendors',
            hiddenId: 'bill-vendor',
            inputId: 'bill-vendor-input',
            listId: 'bill-vendor-list',
            createAction: 'createVendor',
            createField: 'vendorName',
            label: 'ผู้ขาย / ร้านค้า'
        },
        fundSource: {
            stateKey: 'fundSources',
            hiddenId: 'bill-fund-source',
            inputId: 'bill-fund-source-input',
            listId: 'bill-fund-source-list',
            createAction: 'createFundSource',
            createField: 'fundSourceName',
            label: 'แหล่งเงินสำรองจ่าย'
        }
    };
    return map[type];
}

function findMasterByName(items, name) {
    const normalized = normalizeMasterName(name);
    if (!normalized) return null;
    return (items || []).find(item => normalizeMasterName(item.name) === normalized) || null;
}

function getExpenseMasterElementIds(type, context = 'bill') {
    const cfg = getExpenseMasterConfig(type);
    if (!cfg) return null;
    const suffixMap = {
        category: 'category',
        vendor: 'vendor',
        fundSource: (context === 'bill' || context === 'attach') ? 'fund-source' : 'fund'
    };
    const suffix = suffixMap[type];
    return {
        hiddenId: context === 'bill' ? cfg.hiddenId : `${context}-${suffix}`,
        inputId: context === 'bill' ? cfg.inputId : `${context}-${suffix}-input`,
        listId: context === 'bill' ? cfg.listId : `${context}-${suffix}-list`
    };
}

function buildMasterInputHTML(type, context, placeholder, style = 'font-size:12px; padding:4px 8px; width:100%;') {
    const ids = getExpenseMasterElementIds(type, context);
    if (!ids) return '';
    return `
        <input type="hidden" id="${ids.hiddenId}">
        <input type="text" id="${ids.inputId}" class="form-input" list="${ids.listId}" placeholder="${escapeHTML(placeholder || 'พิมพ์หรือเลือก...')}" style="${escapeHTML(style)}" required>
        <datalist id="${ids.listId}"></datalist>
    `;
}

function setupExpenseMasterInput(type, selectedId = '', context = 'bill') {
    const cfg = getExpenseMasterConfig(type);
    const ids = getExpenseMasterElementIds(type, context);
    if (!cfg || !ids) return;
    const input = document.getElementById(ids.inputId);
    const hidden = document.getElementById(ids.hiddenId);
    const list = document.getElementById(ids.listId);
    const items = state[cfg.stateKey] || [];
    if (!input || !hidden || !list) return;

    list.innerHTML = items
        .filter(item => item && item.id && item.name)
        .map(item => `<option value="${escapeHTML(item.name)}"></option>`)
        .join('');

    const selected = items.find(item => item.id === selectedId) || items[0] || null;
    hidden.value = selected ? selected.id : '';
    input.value = selected ? selected.name : '';

    input.oninput = () => {
        const match = findMasterByName(items, input.value);
        hidden.value = match ? match.id : '';
    };
    input.onchange = input.oninput;
}

function appendLocalMasterItem(type, item) {
    const cfg = getExpenseMasterConfig(type);
    if (!cfg || !item || !item.id) return;
    const list = state[cfg.stateKey] || [];
    if (!list.some(existing => existing.id === item.id)) {
        list.push({ ...item, active: true });
        state[cfg.stateKey] = list;
    }
}

async function resolveExpenseMasterName(type, rawName) {
    const cfg = getExpenseMasterConfig(type);
    if (!cfg) return '';
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (!name) throw new Error(`กรุณาระบุ${cfg.label}`);

    const existing = findMasterByName(state[cfg.stateKey] || [], name);
    if (existing) return existing.id;

    const result = await apiCall(cfg.createAction, { [cfg.createField]: name });
    const id = result && result.id;
    if (!id) throw new Error(`เพิ่ม${cfg.label}ใหม่ไม่สำเร็จ`);
    appendLocalMasterItem(type, { id, name });
    if (type === 'vendor') populateQuickExpenseVendorOptions();
    return id;
}

async function resolveExpenseMasterSelection(type, context = 'bill') {
    const cfg = getExpenseMasterConfig(type);
    const ids = getExpenseMasterElementIds(type, context);
    if (!cfg || !ids) return '';
    const input = document.getElementById(ids.inputId);
    const hidden = document.getElementById(ids.hiddenId);
    const name = input ? input.value.trim().replace(/\s+/g, ' ') : '';
    const items = state[cfg.stateKey] || [];

    if (!name) {
        throw new Error(`กรุณาระบุ${cfg.label}`);
    }

    const selectedById = hidden && hidden.value
        ? items.find(item => item.id === hidden.value)
        : null;
    if (selectedById && normalizeMasterName(selectedById.name) === normalizeMasterName(name)) {
        return selectedById.id;
    }

    const id = await resolveExpenseMasterName(type, name);
    setupExpenseMasterInput(type, id, context);
    return id;
}

// ==========================================================================
// Quick Add Project (Directly from bill modals)
// ==========================================================================
async function quickAddProject(target) {
    const name = prompt("กรุณาระบุชื่อโครงการ / กิจกรรมใหม่ที่ต้องการเพิ่ม:");
    if (!name) return;
    const nameTrimmed = name.trim();
    if (!nameTrimmed) return;
    
    const existing = (state.projects || []).find(project => normalizeMasterName(project.name) === normalizeMasterName(nameTrimmed));
    if (existing) {
        if (target === 'bill') populateDropdown('bill-project', state.projects.filter(p => p.active), 'id', 'name', existing.id);
        else if (target === 'attach') populateDropdown('attach-project', state.projects.filter(p => p.active), 'id', 'name', existing.id);
        else if (target === 'inline-exp') populateQuickExpenseProjectOptions(existing.id);
        return;
    }

    showLoading(true);
    try {
        const result = await apiCall('createProject', { projectName: nameTrimmed, budget: 0 });
        if (!result || !result.id) throw new Error('ระบบไม่ส่งรหัสโครงการใหม่กลับมา');
        const newProj = { id: result.id, name: nameTrimmed, active: true };
        state.projects.push(newProj);
        appAlert('เพิ่มโครงการสำเร็จ!');
        const activeProjects = state.projects.filter(p => p.active);
        const selectedVal = newProj.id;
        
        if (target === 'bill') {
            populateDropdown('bill-project', activeProjects, 'id', 'name', selectedVal);
        } else if (target === 'attach') {
            populateDropdown('attach-project', activeProjects, 'id', 'name', selectedVal);
        } else if (target === 'inline-exp') {
            populateQuickExpenseProjectOptions(selectedVal);
        }
    } catch (err) {
        appAlert('บันทึกโครงการล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
    }
}
window.quickAddProject = quickAddProject;

function openExpenseModal(editIdx = null, isNewProject = false) {
    expenseModalSource = null;
    expenseModalOrganizationId = '';
    expenseModalDocumentPrefix = '';
    expenseCreateRequestId = editIdx === null ? createClientRequestId('expense') : '';
    expenseModalNoteMetadata = { customFields: {}, multiItems: [] };
    isNewProjectExpenseMode = isNewProject;
    const modal = document.getElementById('modal-bill');
    const form = document.getElementById('form-bill');
    
    // Set up project visibility based on mode
    const selectGroup = document.getElementById('bill-project-select-group');
    const newGroup = document.getElementById('bill-project-new-group');
    const newNameInput = document.getElementById('bill-project-new-name');
    
    if (isNewProject) {
        (document.getElementById('modal-bill-title') || {}).textContent = 'เพิ่มบิลโครงการเพิ่มเติม';
        if (selectGroup) selectGroup.style.display = 'none';
        if (newGroup) newGroup.style.display = 'block';
        if (newNameInput) {
            newNameInput.required = true;
            newNameInput.value = '';
        }
    } else {
        (document.getElementById('modal-bill-title') || {}).textContent = editIdx !== null ? 'แก้ไขรายการรายจ่าย' : 'เพิ่มรายการรายจ่ายใหม่';
        if (selectGroup) selectGroup.style.display = 'block';
        if (newGroup) newGroup.style.display = 'none';
        if (newNameInput) {
            newNameInput.required = false;
            newNameInput.value = '';
        }
    }

    form.reset();
    const billQtyInput = document.getElementById('bill-qty');
    const billPriceInput = document.getElementById('bill-price');
    if (billQtyInput) billQtyInput.disabled = false;
    if (billPriceInput) billPriceInput.disabled = false;
    // reset() also clears hidden inputs. Set the edit index afterwards so an
    // existing record is updated instead of being accidentally created again.
    (document.getElementById('bill-edit-index') || {}).value = editIdx !== null ? editIdx : '';
    tempBillAttachments = [];

    const activeProjects = state.projects.filter(p => p.active);
    populateDropdown('bill-project', activeProjects, 'id', 'name');
    setupExpenseMasterInput('category');
    setupExpenseMasterInput('vendor');
    setupExpenseMasterInput('fundSource');

    if (editIdx !== null) {
        const exp = state.expenses[editIdx];
        expenseModalOrganizationId = exp.organizationId || '';
        expenseModalDocumentPrefix = exp.documentPrefix || '';
        const parsedNote = parseNoteData(exp.note);
        expenseModalNoteMetadata = {
            customFields: { ...(parsedNote.customFields || {}) },
            multiItems: (parsedNote.multiItems || []).map(item => ({ ...item }))
        };
        (document.getElementById('bill-docno') || {}).value = exp.documentNo;
        (document.getElementById('bill-receipt-no') || {}).value = exp.receiptNo || '';
        (document.getElementById('bill-date') || {}).value = exp.expenseDate;
        (document.getElementById('bill-posting-month') || {}).value = getExpensePostingMonth(exp);
        (document.getElementById('bill-project') || {}).value = exp.projectId;
        setupExpenseMasterInput('category', exp.categoryId);
        setupExpenseMasterInput('vendor', exp.vendorId);
        setupExpenseMasterInput('fundSource', exp.fundSourceId);
        (document.getElementById('bill-desc') || {}).value = exp.description;
        (document.getElementById('bill-qty') || {}).value = exp.quantity;
        (document.getElementById('bill-unit') || {}).value = exp.unit || 'รายการ';
        (document.getElementById('bill-price') || {}).value = exp.unitPrice;
        if (expenseModalNoteMetadata.multiItems.length > 1) {
            if (billQtyInput) billQtyInput.disabled = true;
            if (billPriceInput) billPriceInput.disabled = true;
        }
        (document.getElementById('bill-claim-type') || {}).value = exp.claimable ? 'claim' : 'no-claim';
        (document.getElementById('bill-note') || {}).value = parsedNote.text || '';
    } else {
        (document.getElementById('bill-docno') || {}).value = 'สร้างเมื่อบันทึก';
        (document.getElementById('bill-receipt-no') || {}).value = '';
        const gYear = state.selectedYear - 543;
        const mStr = String(state.selectedMonth).padStart(2, '0');
        (document.getElementById('bill-date') || {}).value = `${gYear}-${mStr}-01`;
        (document.getElementById('bill-posting-month') || {}).value = `${gYear}-${mStr}`;
        (document.getElementById('bill-unit') || {}).value = 'รายการ';
    }

    const expId = editIdx !== null && state.expenses[editIdx] ? state.expenses[editIdx].id : null;
    updateExpenseModalMultiItemsSummary();
    renderTempBillAttachmentsPreview(expId);
    const modalBody = modal.querySelector('.modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    modal.classList.add('active');
}

function closeExpenseModal() {
    isNewProjectExpenseMode = false;
    expenseModalSource = null;
    expenseModalOrganizationId = '';
    expenseModalDocumentPrefix = '';
    tempBillAttachments.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    tempBillAttachments = [];
    document.getElementById('modal-bill').classList.remove('active');
}

async function handleExpenseSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget || document.getElementById('form-bill');
    if (form && form.getAttribute('aria-busy') === 'true') return;
    const editIdx = document.getElementById('bill-edit-index').value;
    const claimable = (document.getElementById('bill-claim-type') || {}).value === 'claim';
    const receiptNo = String((document.getElementById('bill-receipt-no') || {}).value || '').trim();
    const qty = Math.max(0.01, parseFloat(document.getElementById('bill-qty').value) || 1);
    const unit = String((document.getElementById('bill-unit') || {}).value || '').trim();
    const unitPrice = Math.max(0, parseFloat(document.getElementById('bill-price').value) || 0);

    const user = JSON.parse(localStorage.getItem('rdf_current_user') || '{}');
    const orgId = isAdminUser(user) && expenseModalOrganizationId
        ? expenseModalOrganizationId
        : user.organizationId;
    if (state.requireAttachment && editIdx === '' && tempBillAttachments.length === 0) {
        appAlert('ระบบกำหนดให้แนบหลักฐานอย่างน้อย 1 ไฟล์ก่อนบันทึกรายการใหม่', 'error');
        return;
    }
    if (!orgId) {
        appAlert('ไม่พบข้อมูลหน่วยงานของผู้ใช้ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่', 'error');
        return;
    }

    setFormControlsBusy(form, true);
    showLoading(true);
    try {
        let projectId = document.getElementById('bill-project').value;

        if (isNewProjectExpenseMode && editIdx === '') {
            const newProjName = document.getElementById('bill-project-new-name').value.trim();
            if (!newProjName) {
                throw new Error('กรุณาระบุชื่อโครงการใหม่');
            }
            // Create the new project first
            await apiCall('createProject', { projectName: newProjName, budget: 0 });
            // Refresh main application state to fetch the new project list
            await initAppWithAPI();
            // Find the newly created project ID from the state
            const newProj = state.projects.find(p => p.name === newProjName);
            if (!newProj) {
                throw new Error('ไม่พบรหัสโครงการใหม่ที่เพิ่งสร้างขึ้น');
            }
            projectId = newProj.id;
        }

        const expenseDate = document.getElementById('bill-date').value;
        const postingMonth = document.getElementById('bill-posting-month').value;
        const description = document.getElementById('bill-desc').value.trim();
        if (!receiptNo) throw new Error('กรุณาระบุเลขที่ใบเสร็จ');
        if (!expenseDate) throw new Error('กรุณาระบุวันที่บิล');
        if (!/^\d{4}-\d{2}$/.test(postingMonth)) throw new Error('กรุณาระบุรอบเดือนที่บันทึก');
        if (!projectId) throw new Error('กรุณาเลือกโครงการก่อนบันทึก');
        if (!description) throw new Error('กรุณาระบุรายละเอียดรายการ');
        if (!unit) throw new Error('กรุณาระบุหน่วย');
        if (unitPrice <= 0) throw new Error('ราคาต่อหน่วยต้องมากกว่า 0 บาท');

        const categoryId = await resolveExpenseMasterSelection('category');
        const vendorId = await resolveExpenseMasterSelection('vendor');
        const fundSourceId = await resolveExpenseMasterSelection('fundSource');
        if (expenseModalNoteMetadata.multiItems.length === 1) {
            expenseModalNoteMetadata.multiItems = [{
                desc: description,
                qty,
                price: unitPrice
            }];
        }

        const expData = {
            ...(editIdx === '' && { requestId: expenseCreateRequestId || createClientRequestId('expense') }),
            receiptNo: receiptNo,
            expenseDate: expenseDate,
            postingMonth: postingMonth,
            organizationId: orgId,
            ...(expenseModalDocumentPrefix && { documentPrefix: expenseModalDocumentPrefix }),
            projectId: projectId,
            categoryId: categoryId,
            vendorId: vendorId,
            fundSourceId: fundSourceId,
            description: description,
            quantity: qty,
            unit: unit,
            unitPrice: unitPrice,
            claimable: claimable,
            note: formatNoteData(
                document.getElementById('bill-note').value.trim(),
                expenseModalNoteMetadata.customFields,
                expenseModalNoteMetadata.multiItems
            )
        };

        let finalExpId = null;
        let savedExpense = null;
        if (editIdx !== '') {
            const existingExp = state.expenses[parseInt(editIdx, 10)];
            expData.id = existingExp.id;
            await apiCall('updateExpense', expData);
            finalExpId = existingExp.id;
            savedExpense = {
                ...existingExp,
                ...expData,
                amount: qty * unitPrice,
                totalAmount: qty * unitPrice
            };
            appAlert('แก้ไขรายจ่ายเรียบร้อย!');
        } else {
            const result = await apiCall('createExpense', expData);
            finalExpId = result.id;
            savedExpense = result.expense || {
                id: result.id,
                documentNo: result.documentNo,
                ...expData,
                amount: qty * unitPrice,
                totalAmount: qty * unitPrice,
                status: 'draft'
            };
            upsertExpenseRecord(savedExpense);
            appAlert('เพิ่มรายจ่ายใหม่เรียบร้อย!');
        }
        
        let attachmentFailures = [];
        // Handle uploading temporary attachments if any
        if (tempBillAttachments.length > 0 && finalExpId) {
            Swal.fire({ title: 'กำลังอัปโหลดไฟล์แนบ...', text: 'กรุณารอสักครู่', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); }});
            const uploadResult = await uploadQuickExpenseAttachments(finalExpId, tempBillAttachments);
            uploadResult.uploaded.forEach(uploaded => {
                if (uploaded.attachment.previewUrl) URL.revokeObjectURL(uploaded.attachment.previewUrl);
            });
            attachmentFailures = uploadResult.failed.map(failure => failure.attachment);
            tempBillAttachments = attachmentFailures;
            try {
                const res = await apiCall('getAttachments', { expenseId: finalExpId });
                attachmentStore[finalExpId] = res.attachments || attachmentStore[finalExpId] || [];
                saveAttachments();
            } catch (attachmentRefreshError) {
                console.warn('Attachments uploaded but the attachment list could not refresh:', attachmentRefreshError);
            }
        }

        const modalSource = expenseModalSource;
        if (attachmentFailures.length && !modalSource) {
            renderTempBillAttachmentsPreview(finalExpId);
        } else {
            closeExpenseModal();
        }
        if (modalSource && modalSource.startsWith('quick-row:')) {
            const rowId = modalSource.slice('quick-row:'.length);
            quickExpenseAttachmentsByRow[rowId] = attachmentFailures;
            renderQuickExpenseRowFiles(rowId);
            markQuickExpenseRowSaved(rowId, savedExpense && savedExpense.documentNo, attachmentFailures.length, finalExpId);
            if (!quickExpenseRows.some(id => {
                const row = getQuickExpenseRowElement(id);
                return row && row.dataset.saved !== 'true' && isQuickExpenseDraftEmpty(getQuickExpenseRowDraft(id));
            })) addQuickExpenseRow();
        }
        clearMonthlyRecordFilters();
        try {
            await refreshExpenseRecordsForSelectedMonth();
            if (savedExpense && getExpensePostingMonth(savedExpense) === getSelectedPostingMonth()) {
                upsertExpenseRecord(savedExpense);
            }
            renderAll();
        } catch (refreshErr) {
            console.error('Expense saved but the bill list could not refresh:', refreshErr);
            if (savedExpense && getExpensePostingMonth(savedExpense) === getSelectedPostingMonth()) {
                upsertExpenseRecord(savedExpense);
                renderAll();
            }
            appAlert('บันทึกสำเร็จแล้ว ตารางจะแสดงข้อมูลที่บันทึกทันที และระบบจะซิงก์ข้อมูลอีกครั้งเมื่อเชื่อมต่อพร้อม', 'warning');
        }
        if (attachmentFailures.length) {
            appAlert(`บันทึกรายการสำเร็จแล้ว แต่มีหลักฐาน ${attachmentFailures.length} ไฟล์ที่ยังอัปโหลดไม่สำเร็จ${modalSource ? ' กดปุ่มลองใหม่ที่แถวรายการได้ทันที' : ' ฟอร์มยังเปิดอยู่และสามารถกดบันทึกอีกครั้งเพื่อลองอัปโหลดใหม่ได้'}`, 'warning');
        }
    } catch (err) {
        appAlert('บันทึกรายจ่ายล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
        setFormControlsBusy(form, false);
    }
}

function setAttachmentDropZoneState(event, active) {
    if (!event) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    const zone = event.currentTarget || (event.target && event.target.closest('[data-attachment-drop-zone]'));
    if (!zone) return;
    if (!active && event.relatedTarget && zone.contains(event.relatedTarget)) return;
    zone.classList.toggle('is-dragover', Boolean(active));
}

function getDroppedAttachmentFiles(event) {
    setAttachmentDropZoneState(event, false);
    return Array.from((event && event.dataTransfer && event.dataTransfer.files) || []);
}

function normalizePastedAttachmentFile(file, index) {
    if (!file || file.name) return file;
    const extensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'application/pdf': 'pdf',
        'text/csv': 'csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
    };
    const extension = extensions[file.type] || 'bin';
    return new File([file], `clipboard-${Date.now()}-${index + 1}.${extension}`, {
        type: file.type,
        lastModified: file.lastModified || Date.now()
    });
}

function getPastedAttachmentFiles(event) {
    const clipboard = event && event.clipboardData;
    if (!clipboard) return [];
    let files = Array.from(clipboard.files || []);
    if (!files.length && clipboard.items) {
        files = Array.from(clipboard.items)
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter(Boolean);
    }
    if (!files.length) return [];
    event.preventDefault();
    event.stopPropagation();
    const zone = event.currentTarget || (event.target && event.target.closest('[data-attachment-drop-zone]'));
    if (zone) {
        zone.classList.add('is-pasting');
        window.setTimeout(() => zone.classList.remove('is-pasting'), 700);
    }
    return files.map(normalizePastedAttachmentFile);
}

function createAttachmentFileEvent(files) {
    return { target: { files, value: '' } };
}

async function handleSavedAttachmentDrop(event) {
    const files = getDroppedAttachmentFiles(event);
    if (!files.length || !currentExpAttId) return;
    stageExpenseAttachmentFiles(currentExpAttId, files);
}

async function handleSavedAttachmentPaste(event) {
    const files = getPastedAttachmentFiles(event);
    if (!files.length || !currentExpAttId) return;
    stageExpenseAttachmentFiles(currentExpAttId, files);
}

async function handleBillAttachmentDrop(event) {
    const files = getDroppedAttachmentFiles(event);
    if (!files.length) return;
    await handleBillAttachmentSelect(createAttachmentFileEvent(files));
}

async function handleBillAttachmentPaste(event) {
    const files = getPastedAttachmentFiles(event);
    if (!files.length) return;
    await handleBillAttachmentSelect(createAttachmentFileEvent(files));
}

async function handleQuickExpenseRowDrop(rowId, event) {
    const files = getDroppedAttachmentFiles(event);
    if (!files.length) return;
    await handleQuickExpenseRowFiles(rowId, createAttachmentFileEvent(files));
}

async function handleQuickExpenseRowPaste(rowId, event) {
    const files = getPastedAttachmentFiles(event);
    if (!files.length) return;
    await handleQuickExpenseRowFiles(rowId, createAttachmentFileEvent(files));
}

async function handleQuickFoodRowDrop(rowId, event) {
    const files = getDroppedAttachmentFiles(event);
    if (!files.length) return;
    await handleQuickFoodRowFiles(rowId, createAttachmentFileEvent(files));
}

async function handleQuickFoodRowPaste(rowId, event) {
    const files = getPastedAttachmentFiles(event);
    if (!files.length) return;
    await handleQuickFoodRowFiles(rowId, createAttachmentFileEvent(files));
}

async function handleFoodFilesDrop(event) {
    const files = getDroppedAttachmentFiles(event);
    if (!files.length) return;
    await window.handleFoodFiles(createAttachmentFileEvent(files));
}

async function handleFoodFilesPaste(event) {
    const files = getPastedAttachmentFiles(event);
    if (!files.length) return;
    await window.handleFoodFiles(createAttachmentFileEvent(files));
}

// File Validation Helpers
async function validateFile(file) {
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'xlsx', 'docx', 'csv'];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!allowedExts.includes(ext)) {
        throw new Error('รูปแบบไฟล์ไม่ถูกต้อง รองรับเฉพาะ: JPG, PNG, WEBP, PDF, XLSX, DOCX และ CSV');
    }
    
    const buffer = await file.slice(0, 4).arrayBuffer();
    const arr = new Uint8Array(buffer);
    const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    
    let valid = false;
    if (ext === 'csv') valid = true;
    else if ((ext === 'jpg' || ext === 'jpeg') && hex.startsWith('FFD8')) valid = true;
    else if (ext === 'png' && hex === '89504E47') valid = true;
    else if (ext === 'pdf' && hex === '25504446') valid = true;
    else if ((ext === 'docx' || ext === 'xlsx') && hex === '504B0304') valid = true;
    else if (ext === 'webp' && hex.startsWith('52494646')) valid = true;

    if (!valid) throw new Error('โครงสร้างไฟล์ไม่ถูกต้อง หรืออาจมีการปลอมแปลงนามสกุลไฟล์');
    return true;
}

// Image Compression
function compressImage(file, maxSizeMB = 2) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) return resolve({ file, compressed: false, originalSize: file.size });
        if (file.size <= maxSizeMB * 1024 * 1024) return resolve({ file, compressed: false, originalSize: file.size });
        
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxDim = 1920;
                
                if (width > height) {
                    if (width > maxDim) { height *= maxDim / width; width = maxDim; }
                } else {
                    if (height > maxDim) { width *= maxDim / height; height = maxDim; }
                }
                
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                canvas.toBlob(blob => {
                    const jpegName = /\.jpe?g$/i.test(file.name)
                        ? file.name
                        : `${String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image'}.jpg`;
                    const newFile = new File([blob], jpegName, { type: 'image/jpeg', lastModified: Date.now() });
                    resolve({ file: newFile, compressed: true, originalSize: file.size });
                }, 'image/jpeg', 0.7);
            };
        };
        reader.onerror = error => reject(error);
    });
}

function getEnhancedReceiptFileName(fileName) {
    const name = String(fileName || 'receipt').replace(/\.[^.]+$/, '') || 'receipt';
    return `${name}-enhanced.jpg`;
}

// Receipt photos often have uneven lighting from the phone or a nearby hand.
// This keeps processing local to the browser: normalize the blurred background,
// add modest contrast, then apply a light four-neighbour sharpen. The original
// Drive file is not touched because this runs before the new upload starts.
function enhanceReceiptImage(file) {
    return new Promise((resolve, reject) => {
        if (!file || !String(file.type || '').startsWith('image/')) {
            resolve(file);
            return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('ไม่สามารถอ่านภาพเพื่อปรับความคมชัดได้'));
        reader.onload = event => {
            const image = new Image();
            image.onerror = () => reject(new Error('ไม่สามารถประมวลผลภาพที่เลือกได้'));
            image.onload = () => {
                try {
                    const maxDimension = 1800;
                    const naturalWidth = image.naturalWidth || image.width;
                    const naturalHeight = image.naturalHeight || image.height;
                    const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
                    const width = Math.max(1, Math.round(naturalWidth * scale));
                    const height = Math.max(1, Math.round(naturalHeight * scale));
                    const canvas = document.createElement('canvas');
                    const shadowCanvas = document.createElement('canvas');
                    canvas.width = shadowCanvas.width = width;
                    canvas.height = shadowCanvas.height = height;
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    const shadowContext = shadowCanvas.getContext('2d', { willReadFrequently: true });
                    if (!context || !shadowContext) throw new Error('อุปกรณ์นี้ไม่รองรับการปรับภาพเอกสาร');

                    context.fillStyle = '#ffffff';
                    context.fillRect(0, 0, width, height);
                    context.drawImage(image, 0, 0, width, height);
                    shadowContext.fillStyle = '#ffffff';
                    shadowContext.fillRect(0, 0, width, height);
                    shadowContext.filter = `blur(${Math.max(12, Math.round(Math.min(width, height) / 55))}px)`;
                    shadowContext.drawImage(image, 0, 0, width, height);
                    shadowContext.filter = 'none';

                    const source = context.getImageData(0, 0, width, height);
                    const background = shadowContext.getImageData(0, 0, width, height).data;
                    const corrected = new Uint8ClampedArray(source.data);
                    for (let i = 0; i < corrected.length; i += 4) {
                        const backgroundLuma = (0.2126 * background[i]) + (0.7152 * background[i + 1]) + (0.0722 * background[i + 2]);
                        const shadowGain = Math.min(1.55, Math.max(0.9, 238 / Math.max(105, backgroundLuma)));
                        let red = source.data[i] * shadowGain;
                        let green = source.data[i + 1] * shadowGain;
                        let blue = source.data[i + 2] * shadowGain;
                        const grey = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
                        red = (red * 0.9) + (grey * 0.1);
                        green = (green * 0.9) + (grey * 0.1);
                        blue = (blue * 0.9) + (grey * 0.1);
                        corrected[i] = Math.max(0, Math.min(255, ((red - 128) * 1.1) + 128));
                        corrected[i + 1] = Math.max(0, Math.min(255, ((green - 128) * 1.1) + 128));
                        corrected[i + 2] = Math.max(0, Math.min(255, ((blue - 128) * 1.1) + 128));
                    }

                    const sharpened = new Uint8ClampedArray(corrected);
                    for (let y = 1; y < height - 1; y++) {
                        for (let x = 1; x < width - 1; x++) {
                            const offset = (y * width + x) * 4;
                            const left = offset - 4;
                            const right = offset + 4;
                            const above = offset - (width * 4);
                            const below = offset + (width * 4);
                            for (let channel = 0; channel < 3; channel++) {
                                const value = (corrected[offset + channel] * 1.4)
                                    - (corrected[left + channel] * 0.1)
                                    - (corrected[right + channel] * 0.1)
                                    - (corrected[above + channel] * 0.1)
                                    - (corrected[below + channel] * 0.1);
                                sharpened[offset + channel] = Math.max(0, Math.min(255, value));
                            }
                        }
                    }
                    source.data.set(sharpened);
                    context.putImageData(source, 0, 0);
                    canvas.toBlob(blob => {
                        if (!blob) {
                            reject(new Error('ไม่สามารถสร้างภาพเอกสารที่ปรับแล้วได้'));
                            return;
                        }
                        resolve(new File([blob], getEnhancedReceiptFileName(file.name), {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        }));
                    }, 'image/jpeg', 0.9);
                } catch (error) {
                    reject(error);
                }
            };
            image.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleBillAttachmentSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    Swal.fire({ title: 'กำลังตรวจสอบไฟล์...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); }});

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
            await validateFile(file);
            
            // Compression
            let processedFile = file;
            let origSize = file.size;
            let compressedSize = file.size;
            
            if (file.type.startsWith('image/') && file.size > 2 * 1024 * 1024) {
                const compResult = await compressImage(file, 2);
                processedFile = compResult.file;
                compressedSize = processedFile.size;
                const savedMB = ((origSize - compressedSize) / (1024*1024)).toFixed(2);
                const pct = Math.round((origSize - compressedSize) / origSize * 100);
                Swal.fire({ title: 'บีบอัดรูปภาพสำเร็จ', text: `ลดขนาดจาก ${(origSize/(1024*1024)).toFixed(2)}MB เหลือ ${(compressedSize/(1024*1024)).toFixed(2)}MB (ลดลง ${pct}%)`, icon: 'success', timer: 2000, showConfirmButton: false });
            } else if (!file.type.startsWith('image/') && file.size > 10 * 1024 * 1024) {
                throw new Error('ไฟล์เอกสารต้องมีขนาดไม่เกิน 10MB');
            }
            
            // Read as ArrayBuffer for SHA256 (read processedFile)
            const arrayBuf = await processedFile.arrayBuffer();
            const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuf);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            
            const previewUrl = URL.createObjectURL(processedFile);
            tempBillAttachments.push({ 
                file: processedFile, 
                previewUrl, 
                originalFileName: file.name,
                originalSize: origSize,
                compressedSize: compressedSize,
                sha256Hash: hashHex
            });
            
        } catch(e) {
            appAlert(`ไม่สามารถแนบไฟล์ "${file.name}" ได้\nสาเหตุ: ${e.message}`);
        }
    }
    
    if (Swal.isVisible()) Swal.close();
    
    const editIdx = document.getElementById('bill-edit-index').value;
    const expId = editIdx !== '' ? state.expenses[parseInt(editIdx, 10)].id : null;
    renderTempBillAttachmentsPreview(expId);
    event.target.value = ''; // Reset input
}

function removeTempBillAttachment(index) {
    tempBillAttachments.splice(index, 1);
    const editIdx = document.getElementById('bill-edit-index').value;
    const expId = editIdx !== '' ? state.expenses[parseInt(editIdx, 10)].id : null;
    renderTempBillAttachmentsPreview(expId);
}

function renderTempBillAttachmentsPreview(expId) {
    const container = document.getElementById('bill-attachments-preview');
    if (!container) return;
    if(container) container.innerHTML = '';
    
    // Render existing attachments if any (for edit mode)
    if (expId && attachmentStore[expId]) {
        const existingArr = attachmentStore[expId] || [];
        existingArr.forEach(att => {
            const div = document.createElement('div');
            div.style = 'position:relative; width:48px; height:48px; border:1px solid var(--border-color); border-radius:4px; overflow:hidden; opacity:0.7;';
            div.title = "ไฟล์แนบที่มีอยู่แล้วในระบบ";
            if (inferAttachmentMime(att).startsWith('image/')) {
                div.innerHTML = `<img src="${ATTACHMENT_PREVIEW_PLACEHOLDER}" class="is-loading" alt="${escapeHTML(getAttachmentDisplayName(att))}" style="width:100%; height:100%; object-fit:cover;">`;
            } else {
                div.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-size:9px;font-weight:700;color:var(--text-secondary);">FILE</div>';
            }
            if (container) container.appendChild(div);
            const image = div.querySelector('img');
            if (image) getAttachmentImageDataUrl(att).then(dataUrl => {
                if (!dataUrl) throw new Error('preview unavailable');
                image.src = dataUrl;
                image.classList.remove('is-loading');
            }).catch(() => {
                div.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f1f5f9;font-size:9px;font-weight:700;color:var(--text-secondary);">IMAGE</div>';
            });
        });
    }

    // Render newly selected temporary files
    tempBillAttachments.forEach((item, idx) => {
        const div = document.createElement('div');
        div.style = 'position:relative; width:48px; height:48px; border:2px solid var(--primary); border-radius:4px; overflow:hidden;';
        
        let content = `<img src="${item.previewUrl}" style="width:100%; height:100%; object-fit:cover;">`;
        if (!item.file.type.startsWith('image/')) {
             content = `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#f1f5f9; font-size:10px; font-weight:bold; color:var(--text-secondary); text-align:center;">DOC</div>`;
        }
        
        div.innerHTML = `
            ${content}
            <button type="button" onclick="removeTempBillAttachment(${idx})" style="position:absolute; top:2px; right:2px; background:var(--danger); color:white; border:none; border-radius:50%; width:16px; height:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:10px;">
                <i data-lucide="x" style="width:10px; height:10px;"></i>
            </button>
        `;
        if(container) container.appendChild(div);
    });
    
    initializeLucide();
}

// ==========================================================================
// Attachment Modal
// ==========================================================================
function openAttachmentModal(editIdx = null) {
    attachmentModalSourceRowId = '';
    attachmentCreateRequestId = editIdx === null ? createClientRequestId('attachment') : '';
    const modal = document.getElementById('modal-attachment');
    const form = document.getElementById('form-attachment');
    (document.getElementById('modal-attachment-title') || {}).textContent = editIdx !== null ? 'แก้ไขบิลแนบ' : 'เพิ่มบิลแนบ / ค่าสาธารณูปโภค';
    form.reset();
    // reset() clears hidden fields. Restore this after reset so clicking edit
    // updates the selected attachment instead of silently creating a new one.
    (document.getElementById('attachment-edit-index') || {}).value = editIdx !== null ? editIdx : '';

    const activeProjects = state.projects.filter(p => p.active);
    populateDropdown('attach-project', activeProjects, 'id', 'name');
    setupExpenseMasterInput('category', '', 'attach');
    setupExpenseMasterInput('fundSource', '', 'attach');

    if (editIdx !== null) {
        const a = state.attachments[editIdx];
        (document.getElementById('attach-date') || {}).value = a.expenseDate;
        (document.getElementById('attach-posting-month') || {}).value = getExpensePostingMonth(a);
        (document.getElementById('attach-project') || {}).value = a.projectId;
        setupExpenseMasterInput('category', a.categoryId, 'attach');
        setupExpenseMasterInput('fundSource', a.fundSourceId, 'attach');
        (document.getElementById('attach-desc') || {}).value = a.description;
        (document.getElementById('attach-amount') || {}).value = a.amount || a.unitPrice;
        (document.getElementById('attach-claim-type') || {}).value = a.claimable ? 'claim' : 'no-claim';
    } else {
        const gYear = state.selectedYear - 543;
        const mStr = String(state.selectedMonth).padStart(2, '0');
        (document.getElementById('attach-date') || {}).value = `${gYear}-${mStr}-01`;
        (document.getElementById('attach-posting-month') || {}).value = `${gYear}-${mStr}`;
    }

    const modalBody = modal.querySelector('.modal-body');
    if (modalBody) modalBody.scrollTop = 0;
    modal.classList.add('active');
}

function closeAttachmentModal() {
    document.getElementById('modal-attachment').classList.remove('active');
    attachmentModalSourceRowId = '';
}

async function handleAttachmentSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget || document.getElementById('form-attachment');
    if (form && form.getAttribute('aria-busy') === 'true') return;
    const editIdx = document.getElementById('attachment-edit-index').value;
    const claimable = (document.getElementById('attach-claim-type') || {}).value === 'claim';
    const amount = Math.max(0, parseFloat(document.getElementById('attach-amount').value) || 0);

    const user = JSON.parse(localStorage.getItem('rdf_current_user') || '{}');
    const orgId = user.organizationId;
    const expenseDate = document.getElementById('attach-date').value;
    const postingMonth = document.getElementById('attach-posting-month').value;
    const projectId = document.getElementById('attach-project').value;
    const description = document.getElementById('attach-desc').value.trim();
    if (!orgId) {
        appAlert('ไม่พบข้อมูลหน่วยงานของผู้ใช้ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่', 'error');
        return;
    }
    if (!expenseDate || !/^\d{4}-\d{2}$/.test(postingMonth) || !projectId || !description || amount <= 0) {
        appAlert('กรุณาระบุวันที่ รอบเดือน โครงการ รายละเอียด และจำนวนเงินที่มากกว่า 0', 'error');
        return;
    }

    setFormControlsBusy(form, true);
    showLoading(true);
    try {
        const categoryId = await resolveExpenseMasterSelection('category', 'attach');
        const fundSourceId = await resolveExpenseMasterSelection('fundSource', 'attach');
        const editingAttachment = editIdx !== '' ? state.attachments[parseInt(editIdx, 10)] : null;
        const sourceRow = attachmentModalSourceRowId ? getQuickExpenseRowElement(attachmentModalSourceRowId) : null;
        const sourceDraft = sourceRow ? getQuickExpenseRowDraft(attachmentModalSourceRowId) : null;
        const preserveSourceCalculation = sourceDraft && Math.abs(sourceDraft.amount - amount) < 0.001;
        const preserveExistingCalculation = editingAttachment && Math.abs(Number(editingAttachment.amount || 0) - amount) < 0.001;
        const sourceVendorId = sourceDraft ? await resolveExpenseMasterName('vendor', sourceDraft.vendorName) : '';
        const attachData = {
            idPrefix: 'ATT',
            ...(editIdx === '' && { requestId: attachmentCreateRequestId || createClientRequestId('attachment') }),
            receiptNo: sourceDraft ? sourceDraft.receiptNo : (editingAttachment && editingAttachment.receiptNo) || '',
            expenseDate: expenseDate,
            postingMonth: postingMonth,
            organizationId: orgId,
            projectId: projectId,
            categoryId: categoryId,
            vendorId: sourceVendorId || (editingAttachment && editingAttachment.vendorId) || '',
            fundSourceId: fundSourceId,
            description: description,
            quantity: preserveSourceCalculation ? sourceDraft.quantity : preserveExistingCalculation ? Number(editingAttachment.quantity) || 1 : 1,
            unit: preserveSourceCalculation ? sourceDraft.unit : preserveExistingCalculation ? editingAttachment.unit || 'รายการ' : 'รายการ',
            unitPrice: preserveSourceCalculation ? sourceDraft.unitPrice : preserveExistingCalculation ? Number(editingAttachment.unitPrice) || amount : amount,
            claimable: claimable,
            note: ''
        };

        if (editIdx !== '') {
            const existingAtt = editingAttachment;
            attachData.id = existingAtt.id;
            await apiCall('updateExpense', attachData);
            appAlert('แก้ไขบิลแนบสำเร็จ!');
        } else {
            const result = await apiCall('createExpense', attachData);
            const sourceRowId = attachmentModalSourceRowId;
            if (sourceRowId) {
                const savedAttachment = result.expense || {
                    id: result.id,
                    documentNo: result.documentNo,
                    ...attachData,
                    receiptNo: sourceDraft ? sourceDraft.receiptNo : '',
                    vendorName: sourceDraft ? sourceDraft.vendorName : '',
                    amount,
                    totalAmount: amount,
                    status: 'draft'
                };
                upsertQuickExpenseRecord(savedAttachment);
                const pendingFiles = sourceDraft ? sourceDraft.attachments : [];
                const attachmentResult = result.id
                    ? await uploadQuickExpenseAttachments(result.id, pendingFiles)
                    : { uploaded: [], failed: [] };
                attachmentResult.uploaded.forEach(item => {
                    if (item.attachment.previewUrl) URL.revokeObjectURL(item.attachment.previewUrl);
                });
                quickExpenseAttachmentsByRow[sourceRowId] = attachmentResult.failed.map(item => item.attachment);
                renderQuickExpenseRowFiles(sourceRowId);
                markQuickExpenseRowSaved(sourceRowId, savedAttachment.documentNo || result.documentNo, attachmentResult.failed.length, result.id);
            }
            appAlert(sourceRowId ? 'เพิ่มบิลแนบและอัปเดตแถวในตารางสำเร็จ!' : 'เพิ่มบิลแนบสำเร็จ!');
        }
        closeAttachmentModal();
        try {
            await refreshExpenseRecordsForSelectedMonth();
            renderAll();
        } catch (refreshErr) {
            console.error('Attachment bill saved but the list could not refresh:', refreshErr);
            appAlert('บันทึกสำเร็จ แต่ยังโหลดตารางรายการใหม่ไม่ได้ กรุณารีเฟรชหน้าเว็บ', 'warning');
        }
    } catch (err) {
        appAlert('บันทึกบิลแนบล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
        setFormControlsBusy(form, false);
    }
}

// ==========================================================================
// Theme
// ==========================================================================
function toggleTheme() {
    state.theme = state.theme === 'light' ? 'dark' : 'light';
    saveState();
    updateThemeUI();
    if (chartCategories) { chartCategories.destroy(); chartCategories = null; }
    renderCharts();
}

function updateThemeUI() {
    const isDark = state.theme === 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    (document.getElementById('theme-text') || {}).textContent = isDark ? 'โหมดสว่าง' : 'โหมดมืด';

    const darkIcon = document.querySelector('.theme-icon-dark');
    const lightIcon = document.querySelector('.theme-icon-light');
    if (darkIcon) darkIcon.style.display = isDark ? 'none' : 'inline';
    if (lightIcon) lightIcon.style.display = isDark ? 'inline' : 'none';
}

// ==========================================================================
// PHASE 2: Attachment Store
// ==========================================================================
function loadAttachments() {
    try {
        const saved = localStorage.getItem('rdf_attachments_v4');
        attachmentStore = saved ? JSON.parse(saved) : {};
    } catch (e) { attachmentStore = {}; }
}

function saveAttachments() {
    try {
        localStorage.setItem('rdf_attachments_v4', JSON.stringify(attachmentStore));
    } catch (e) {
        appAlert('⚠️ พื้นที่จัดเก็บเต็ม กรุณาลบหลักฐานบางส่วนก่อน');
    }
}

function getStorageUsageKB() {
    try {
        const raw = localStorage.getItem('rdf_attachments_v4') || '';
        return Math.round(raw.length * 2 / 1024);
    } catch (e) { return 0; }
}

// ==========================================================================
// PHASE 2: Expense Attachment Modal
// ==========================================================================
let currentExpAttId = null;
let pendingExpenseAttachmentFiles = [];
let expenseAttachmentUploadInProgress = false;
const ATTACHMENT_PREVIEW_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

function getExpenseAttachmentRecord(expId) {
    return [...(state.expenses || []), ...(state.attachments || [])]
        .find(item => String(item && item.id) === String(expId)) || null;
}

function getAttachmentDisplayName(attachment) {
    return String((attachment && (attachment.originalFileName || attachment.fileName || attachment.storedFileName || attachment.name)) || 'ไฟล์หลักฐาน');
}

function renderExpenseAttachmentRecordSummary(expId) {
    const tbody = document.getElementById('att-record-summary-body');
    if (!tbody) return;
    const expense = getExpenseAttachmentRecord(expId);
    if (!expense) {
        tbody.innerHTML = '<tr><td colspan="4">ไม่พบข้อมูลรายการสำหรับตรวจสอบ</td></tr>';
        return;
    }
    const amount = Number(expense.amount || expense.totalAmount || 0) || 0;
    const quantity = Number(expense.quantity || 0) || 0;
    const unitPrice = Number(expense.unitPrice || 0) || 0;
    const vendorName = expense.vendorId ? getVendorName(expense.vendorId) : '';
    const calculation = quantity && unitPrice
        ? `${quantity.toLocaleString('th-TH')} ${expense.unit || 'รายการ'} × ฿${unitPrice.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '';
    tbody.innerHTML = `
        <tr>
            <td>
                <span class="attachment-summary-primary">${escapeHTML(expense.documentNo || 'รอเลขบิล')}</span>
                <span class="attachment-summary-secondary">เล่มที่ / เลขที่ ${escapeHTML(expense.receiptNo || '-')}</span>
            </td>
            <td>
                <span class="attachment-summary-primary">${escapeHTML(formatThaiDate(expense.expenseDate) || '-')}</span>
                <span class="attachment-summary-secondary">รอบ ${escapeHTML(formatPostingMonth(getExpensePostingMonth(expense)))}</span>
            </td>
            <td>
                <span class="attachment-summary-primary">${escapeHTML(expense.description || '-')}</span>
                ${vendorName || calculation ? `<span class="attachment-summary-secondary">${[vendorName, calculation].filter(Boolean).map(escapeHTML).join(' · ')}</span>` : ''}
            </td>
            <td class="text-right">
                <span class="attachment-summary-primary">฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </td>
        </tr>`;
}

function clearPendingExpenseAttachmentFiles() {
    pendingExpenseAttachmentFiles.forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    pendingExpenseAttachmentFiles = [];
    renderPendingExpenseAttachmentFiles();
}

function stageExpenseAttachmentFiles(expId, files) {
    if (!expId || String(expId) !== String(currentExpAttId)) return;
    Array.from(files || []).forEach(file => {
        if (!file) return;
        const duplicate = pendingExpenseAttachmentFiles.some(item =>
            item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified
        );
        if (duplicate) return;
        pendingExpenseAttachmentFiles.push({
            file,
            previewUrl: String(file.type || '').startsWith('image/') ? URL.createObjectURL(file) : '',
            error: ''
        });
    });
    renderPendingExpenseAttachmentFiles();
}

function removePendingExpenseAttachmentFile(index) {
    if (expenseAttachmentUploadInProgress) return;
    const removed = pendingExpenseAttachmentFiles.splice(index, 1)[0];
    if (removed && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    renderPendingExpenseAttachmentFiles();
}

function renderPendingExpenseAttachmentFiles() {
    const container = document.getElementById('att-upload-queue');
    if (!container) return;
    if (!pendingExpenseAttachmentFiles.length) {
        container.hidden = true;
        container.innerHTML = '';
        return;
    }
    container.hidden = false;
    const errorMessages = pendingExpenseAttachmentFiles.map(item => item.error).filter(Boolean);
    container.innerHTML = `
        <div class="attachment-upload-queue-header">
            <strong>ตรวจสอบไฟล์ก่อนอัปโหลด (${pendingExpenseAttachmentFiles.length})</strong>
            <span class="attachment-summary-secondary">ภาพจะยังไม่ถูกส่งจนกว่าจะกดยืนยัน</span>
        </div>
        <div class="attachment-upload-queue-list">
            ${pendingExpenseAttachmentFiles.map((item, index) => {
                const name = getAttachmentDisplayName(item.file);
                const preview = item.previewUrl
                    ? `<img src="${escapeHTML(item.previewUrl)}" alt="ตัวอย่าง ${escapeHTML(name)}">`
                    : `<div class="att-icon-file"><i data-lucide="file-text"></i><span>${escapeHTML(name.split('.').pop().toUpperCase())}</span></div>`;
                return `<div class="attachment-upload-queue-item">
                    <div class="attachment-upload-queue-preview">${preview}</div>
                    <span class="attachment-upload-queue-name" title="${escapeHTML(name)}">${escapeHTML(name)}</span>
                    <button type="button" class="attachment-upload-queue-remove" onclick="removePendingExpenseAttachmentFile(${index})" ${expenseAttachmentUploadInProgress ? 'disabled' : ''} title="นำไฟล์นี้ออก" aria-label="นำไฟล์ ${escapeHTML(name)} ออก"><i data-lucide="x"></i></button>
                </div>`;
            }).join('')}
        </div>
        <div class="attachment-upload-queue-actions">
            <span class="attachment-summary-secondary">${expenseAttachmentUploadInProgress ? 'กำลังประมวลผลและอัปโหลด กรุณารอสักครู่...' : 'ตรวจเลขบิลและรายละเอียดด้านบนก่อนยืนยัน'}</span>
            <div class="attachment-upload-actions">
                <button type="button" class="btn btn-secondary btn-sm" onclick="clearPendingExpenseAttachmentFiles()" ${expenseAttachmentUploadInProgress ? 'disabled' : ''}>ยกเลิก</button>
                <button type="button" class="btn btn-primary btn-sm" onclick="confirmExpenseAttachmentUpload()" ${expenseAttachmentUploadInProgress ? 'disabled' : ''}><i data-lucide="upload-cloud"></i> ยืนยันอัปโหลด ${pendingExpenseAttachmentFiles.length} ไฟล์</button>
            </div>
        </div>
        ${errorMessages.length ? `<p class="attachment-upload-queue-error">${errorMessages.map(escapeHTML).join('<br>')}</p>` : ''}`;
    initializeLucide();
}

async function confirmExpenseAttachmentUpload() {
    if (!currentExpAttId || !pendingExpenseAttachmentFiles.length || expenseAttachmentUploadInProgress) return;
    await handleAttachmentUpload(currentExpAttId, pendingExpenseAttachmentFiles.map(item => item.file));
}

async function openExpenseAttachmentModal(expId) {
    currentExpAttId = expId;
    clearPendingExpenseAttachmentFiles();
    const exp = getExpenseAttachmentRecord(expId);
    const docNo = exp ? exp.documentNo : '';
    const desc = exp ? exp.description : '';
    (document.getElementById('modal-att-title') || {}).textContent =
        `หลักฐานแนบ — ${docNo}${desc ? ' (' + desc.substring(0, 30) + (desc.length > 30 ? '…' : '') + ')' : ''}`;

    const storageEl = document.getElementById('att-storage-info');
    if (storageEl) storageEl.textContent = `ระบบจัดเก็บบน Google Drive คลาวด์`;
    renderExpenseAttachmentRecordSummary(expId);

    // Wire file inputs. Mobile browsers open the rear camera for the camera input.
    const fileInput = document.getElementById('att-file-input');
    if (fileInput) {
        fileInput.value = '';
        fileInput.onchange = () => {
            stageExpenseAttachmentFiles(expId, fileInput.files);
            fileInput.value = '';
        };
    }
    const cameraInput = document.getElementById('att-camera-input');
    if (cameraInput) {
        cameraInput.value = '';
        cameraInput.onchange = () => {
            stageExpenseAttachmentFiles(expId, cameraInput.files);
            cameraInput.value = '';
        };
    }

    const body = document.getElementById('modal-att-body');
    if (body) body.innerHTML = '<div class="att-empty"><p>กำลังโหลดหลักฐานแนบ...</p></div>';
    document.getElementById('modal-attachments').classList.add('active');

    showLoading(true);
    try {
        const res = await apiCall('getAttachments', { expenseId: expId });
        attachmentStore[expId] = res.attachments || [];
        renderExpenseAttachmentModal(expId);
    } catch (err) {
        if (body) body.innerHTML = '<div class="att-empty"><p>โหลดรายการหลักฐานไม่สำเร็จ</p><small>ยังสามารถเลือกไฟล์ไว้ก่อนได้ แล้วลองเปิดรายการใหม่อีกครั้ง</small></div>';
        appAlert('ดึงข้อมูลไฟล์แนบล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function closeExpenseAttachmentModal() {
    if (expenseAttachmentUploadInProgress) return;
    document.getElementById('modal-attachments').classList.remove('active');
    clearPendingExpenseAttachmentFiles();
    currentExpAttId = null;
    renderTables();
}

function renderExpenseAttachmentModal(expId) {
    const attachments = attachmentStore[expId] || [];
    const body = document.getElementById('modal-att-body');
    if (!body) return;

    if (attachments.length === 0) {
        body.innerHTML = `
            <div class="att-empty">
                <i data-lucide="file-x" style="width:52px;height:52px;color:var(--text-muted);margin-bottom:12px;"></i>
                <p style="font-size:15px;color:var(--text-secondary);font-weight:600;">ยังไม่มีหลักฐานแนบ</p>
                <p style="font-size:13px;color:var(--text-muted);margin-top:4px;">กดปุ่ม <strong>เพิ่มหลักฐาน</strong> เพื่ออัปโหลดรูปบิล หรือ PDF ไปยัง Google Drive</p>
            </div>`;
        initializeLucide();
        return;
    }

    body.innerHTML = `<div class="att-grid">${attachments.map((att, i) => {
        const fileName = getAttachmentDisplayName(att);
        const mimeType = inferAttachmentMime(att);
        return `
        <div class="att-item">
            <div class="att-preview" onclick="previewAttachmentFile('${expId}',${i})">
                ${mimeType.startsWith('image/')
                    ? `<img src="${ATTACHMENT_PREVIEW_PLACEHOLDER}" class="att-thumb is-loading" data-att-preview-index="${i}" alt="${escapeHTML(fileName)}">`
                    : `<div class="att-icon-file"><i data-lucide="file-text"></i><span>${escapeHTML(fileName.split('.').pop().toUpperCase())}</span></div>`
                }
            </div>
            <div class="att-info">
                <div class="att-name" title="${escapeHTML(fileName)}">${escapeHTML(fileName)}</div>
                <div class="att-date">${att.uploadedAt ? formatThaiDate(att.uploadedAt) : ''}</div>
            </div>
            <div class="att-item-actions">
                <button class="btn-icon" onclick="previewAttachmentFile('${expId}',${i})" title="เปิดใน Google Drive">
                    <i data-lucide="external-link"></i>
                </button>
                <button class="btn-icon btn-icon-delete" onclick="deleteExpenseAttachment('${expId}',${i})" title="ลบ">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        </div>`;
    }).join('')}</div>`;
    initializeLucide();
    hydrateExpenseAttachmentPreviewImages(expId, attachments);
}

function hydrateExpenseAttachmentPreviewImages(expId, attachments) {
    const body = document.getElementById('modal-att-body');
    if (!body) return;
    body.querySelectorAll('img[data-att-preview-index]').forEach(image => {
        const index = Number(image.dataset.attPreviewIndex);
        const attachment = attachments[index];
        if (!attachment) return;
        getAttachmentImageDataUrl(attachment).then(dataUrl => {
            if (!dataUrl || String(currentExpAttId) !== String(expId)) throw new Error('preview unavailable');
            image.src = dataUrl;
            image.classList.remove('is-loading');
        }).catch(() => {
            const preview = image.closest('.att-preview');
            if (!preview) return;
            preview.classList.add('is-unavailable');
            preview.innerHTML = '<div class="att-preview-error"><i data-lucide="image-off"></i><span>ไม่สามารถแสดงตัวอย่างได้<br>กดปุ่มเปิดไฟล์เพื่อดูใน Drive</span></div>';
            initializeLucide();
        });
    });
}

function hydrateVisibleAttachmentThumbnails() {
    document.querySelectorAll('img[data-attachment-preview-exp-id][data-attachment-preview-index]').forEach(image => {
        const expId = image.dataset.attachmentPreviewExpId;
        const index = Number(image.dataset.attachmentPreviewIndex);
        const attachment = (attachmentStore[expId] || [])[index];
        if (!attachment || !inferAttachmentMime(attachment).startsWith('image/')) return;
        getAttachmentImageDataUrl(attachment).then(dataUrl => {
            if (!dataUrl) throw new Error('preview unavailable');
            image.src = dataUrl;
            image.style.opacity = '1';
        }).catch(() => {
            image.style.opacity = '0.45';
            image.title = 'ไม่สามารถแสดงตัวอย่างได้ กดเพื่อเปิดไฟล์จาก Google Drive';
        });
    });
}

async function prepareSavedExpenseAttachment(file, enhanceImages) {
    await validateFile(file);
    const originalSize = file.size;
    let processedFile = file;
    if (enhanceImages && String(file.type || '').startsWith('image/')) {
        try {
            processedFile = await enhanceReceiptImage(file);
        } catch (enhancementError) {
            console.warn('Receipt enhancement unavailable; uploading the original image:', enhancementError);
            processedFile = file;
        }
    }
    const maxSizeMb = Math.max(1, Number(state.maxUploadSizeMb) || 2);
    if (String(processedFile.type || '').startsWith('image/') && processedFile.size > maxSizeMb * 1024 * 1024) {
        processedFile = (await compressImage(processedFile, maxSizeMb)).file;
    } else if (!String(processedFile.type || '').startsWith('image/') && processedFile.size > 10 * 1024 * 1024) {
        throw new Error('ไฟล์เอกสารต้องมีขนาดไม่เกิน 10MB');
    }
    const bytes = await processedFile.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const sha256Hash = Array.from(new Uint8Array(hashBuffer))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    return {
        file: processedFile,
        originalFileName: file.name,
        uploadFileName: processedFile.name || file.name,
        originalSize,
        compressedSize: processedFile.size,
        sha256Hash
    };
}

async function handleAttachmentUpload(expId, files) {
    if (!files || files.length === 0) return;
    expenseAttachmentUploadInProgress = true;
    pendingExpenseAttachmentFiles.forEach(item => { item.error = ''; });
    renderPendingExpenseAttachmentFiles();
    showLoading(true);
    const failed = [];
    const uploadedPreviews = new Map();
    const uploadedRecords = [];
    try {
        const enhanceImages = Boolean((document.getElementById('att-enhance-image') || {}).checked);
        for (const file of files) {
            try {
                const prepared = await prepareSavedExpenseAttachment(file, enhanceImages);
                const base64Data = await fileAsBase64(prepared.file);
                const result = await apiCall('uploadAttachment', {
                    expenseId: expId,
                    fileName: prepared.uploadFileName,
                    mimeType: prepared.file.type,
                    base64Data,
                    originalSize: prepared.originalSize,
                    compressedSize: prepared.compressedSize,
                    sha256Hash: prepared.sha256Hash
                });
                if (result && result.id && prepared.file.type.startsWith('image/')) {
                    uploadedPreviews.set(String(result.id), `data:${prepared.file.type};base64,${base64Data}`);
                }
                if (result && result.id) {
                    const uploadedRecord = {
                        id: result.id,
                        expenseId: expId,
                        originalFileName: prepared.uploadFileName,
                        fileName: result.fileName || prepared.uploadFileName,
                        fileType: prepared.file.type,
                        fileSize: prepared.originalSize,
                        compressedSize: prepared.compressedSize,
                        sha256Hash: prepared.sha256Hash,
                        driveFileId: result.driveFileId || '',
                        fileUrl: result.viewUrl || '',
                        viewUrl: result.viewUrl || ''
                    };
                    const cachedPreview = uploadedPreviews.get(String(result.id));
                    if (cachedPreview) Object.defineProperty(uploadedRecord, '_cachedImageDataUrl', {
                        value: cachedPreview,
                        writable: true,
                        configurable: true
                    });
                    uploadedRecords.push(uploadedRecord);
                }
            } catch (error) {
                failed.push({ file, error });
            }
        }
        if (files.length > failed.length) {
            try {
                const res = await apiCall('getAttachments', { expenseId: expId });
                attachmentStore[expId] = (res.attachments || []).map(attachment => {
                    const cachedPreview = uploadedPreviews.get(String(attachment.id || attachment.attachmentId));
                    if (cachedPreview) Object.defineProperty(attachment, '_cachedImageDataUrl', {
                        value: cachedPreview,
                        writable: true,
                        configurable: true
                    });
                    return attachment;
                });
            } catch (refreshError) {
                console.warn('Attachment upload succeeded but refresh failed:', refreshError);
                if (!attachmentStore[expId]) attachmentStore[expId] = [];
                uploadedRecords.forEach(record => {
                    if (!attachmentStore[expId].some(item => String(item.id) === String(record.id))) {
                        attachmentStore[expId].push(record);
                    }
                });
            }
            renderExpenseAttachmentModal(expId);
        }
    } finally {
        showLoading(false);
        expenseAttachmentUploadInProgress = false;
        clearPendingExpenseAttachmentFiles();
        failed.forEach(item => {
            pendingExpenseAttachmentFiles.push({
                file: item.file,
                previewUrl: String(item.file.type || '').startsWith('image/') ? URL.createObjectURL(item.file) : '',
                error: `${item.file.name}: ${item.error.message}`
            });
        });
        renderPendingExpenseAttachmentFiles();
    }
    const successCount = files.length - failed.length;
    if (successCount && !failed.length) {
        appAlert(`อัปโหลดหลักฐาน ${successCount} ไฟล์ และแสดงตัวอย่างเรียบร้อย!`, 'success');
    } else if (successCount) {
        appAlert(`อัปโหลดสำเร็จ ${successCount} ไฟล์ และไม่สำเร็จ ${failed.length} ไฟล์ กรุณาตรวจสอบข้อความแล้วลองอีกครั้ง`, 'warning');
    } else if (failed.length) {
        appAlert('การอัปโหลดไฟล์ล้มเหลว: ' + failed[0].error.message, 'error');
    }
}

async function deleteExpenseAttachment(expId, idx) {
    const att = (attachmentStore[expId] || [])[idx];
    if (!att) return;
    if (!await appConfirm(`ลบหลักฐานไฟล์ "${att.fileName}" ใช่หรือไม่?`)) return;

    showLoading(true);
    try {
        await apiCall('deleteAttachment', { id: att.id });
        appAlert('ลบไฟล์แนบสำเร็จ!');
        // ดึงข้อมูลและอัปเดต Modal อีกครั้ง
        const res = await apiCall('getAttachments', { expenseId: expId });
        attachmentStore[expId] = res.attachments || [];
        renderExpenseAttachmentModal(expId);
    } catch (err) {
        appAlert('การลบไฟล์ล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function previewAttachmentFile(expId, idx) {
    const att = (attachmentStore[expId] || [])[idx];
    if (!att) return;
    
    const url = att.fileUrl || att.viewUrl;
    if (url) {
        window.open(url, '_blank');
    } else {
        appAlert('ไม่พบลิงก์สำหรับเข้าดูไฟล์นี้');
    }
}

// ==========================================================================
// Phase 3.5: Custom Columns, Note Parsing & Inline Adding Helper Functions
// ==========================================================================

function parseNoteData(noteStr) {
    let text = noteStr || '';
    let customFields = {};
    let multiItems = [];

    if (text.includes('__custom_fields__:')) {
        const parts = text.split('__custom_fields__:');
        text = parts[0].trim();
        const remaining = parts[1];
        
        let jsonStr = remaining;
        if (remaining.includes('__multi_items__:')) {
            const subParts = remaining.split('__multi_items__:');
            jsonStr = subParts[0].trim();
        }
        
        try {
            customFields = JSON.parse(jsonStr.trim());
        } catch (e) {
            console.error('Failed to parse custom fields JSON', e);
        }
    }

    if (noteStr && noteStr.includes('__multi_items__:')) {
        const parts = noteStr.split('__multi_items__:');
        const remaining = parts[1];
        let jsonStr = remaining;
        if (remaining.includes('__custom_fields__:')) {
            const subParts = remaining.split('__custom_fields__:');
            jsonStr = subParts[0].trim();
        }
        try {
            multiItems = JSON.parse(jsonStr.trim());
        } catch (e) {
            console.error('Failed to parse multi items JSON', e);
        }
        
        if (!noteStr.includes('__custom_fields__:')) {
            text = parts[0].trim();
        }
    }

    return { text, customFields, multiItems };
}

function formatNoteData(text, customFields, multiItems) {
    let result = text || '';
    if (customFields && Object.keys(customFields).length > 0) {
        result += ` __custom_fields__:${JSON.stringify(customFields)}`;
    }
    if (multiItems && multiItems.length > 0) {
        result += ` __multi_items__:${JSON.stringify(multiItems)}`;
    }
    return result.trim();
}

function renderColumnSettingsUI() {
    const container = document.getElementById('column-toggles-container');
    if (!container) return;
    if(container) container.innerHTML = '';
    
    state.columns.forEach((col, index) => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'space-between';
        div.style.gap = '8px';
        div.style.padding = '6px 10px';
        div.style.background = 'var(--surface-solid, #f1f5f9)';
        div.style.borderRadius = '6px';
        div.style.border = '1px solid var(--border-color, #e2e8f0)';
        
        // Left wrapper
        const leftWrap = document.createElement('div');
        leftWrap.style.display = 'flex';
        leftWrap.style.alignItems = 'center';
        leftWrap.style.gap = '6px';
        leftWrap.style.flex = '1';
        leftWrap.style.overflow = 'hidden';
        
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = `col-toggle-${col.id}`;
        cb.checked = col.visible;
        cb.addEventListener('change', () => {
            col.visible = cb.checked;
            saveState();
            renderTables();
        });
        
        const lbl = document.createElement('label');
        lbl.htmlFor = `col-toggle-${col.id}`;
        lbl.textContent = col.label;
        lbl.style.fontSize = '13px';
        lbl.style.cursor = 'pointer';
        lbl.style.whiteSpace = 'nowrap';
        lbl.style.overflow = 'hidden';
        lbl.style.textOverflow = 'ellipsis';
        
        leftWrap.appendChild(cb);
        leftWrap.appendChild(lbl);
        
        // Right wrapper (Controls)
        const rightWrap = document.createElement('div');
        rightWrap.style.display = 'flex';
        rightWrap.style.alignItems = 'center';
        rightWrap.style.gap = '6px';
        
        // Up arrow button
        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.innerHTML = '▲';
        upBtn.style.border = 'none';
        upBtn.style.background = 'none';
        upBtn.style.fontSize = '10px';
        upBtn.style.cursor = index > 0 ? 'pointer' : 'default';
        upBtn.style.color = index > 0 ? 'var(--text-secondary, #475569)' : 'var(--border-color, #cbd5e1)';
        upBtn.title = 'เลื่อนขึ้น';
        if (index > 0) {
            upBtn.addEventListener('click', () => moveColumn(index, -1));
        }
        
        // Down arrow button
        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.innerHTML = '▼';
        downBtn.style.border = 'none';
        downBtn.style.background = 'none';
        downBtn.style.fontSize = '10px';
        downBtn.style.cursor = index < state.columns.length - 1 ? 'pointer' : 'default';
        downBtn.style.color = index < state.columns.length - 1 ? 'var(--text-secondary, #475569)' : 'var(--border-color, #cbd5e1)';
        downBtn.title = 'เลื่อนลง';
        if (index < state.columns.length - 1) {
            downBtn.addEventListener('click', () => moveColumn(index, 1));
        }
        
        rightWrap.appendChild(upBtn);
        rightWrap.appendChild(downBtn);
        
        if (col.custom) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.innerHTML = '×';
            delBtn.style.border = 'none';
            delBtn.style.background = 'none';
            delBtn.style.color = 'var(--danger)';
            delBtn.style.cursor = 'pointer';
            delBtn.style.fontWeight = 'bold';
            delBtn.style.padding = '0 2px';
            delBtn.style.fontSize = '14px';
            delBtn.title = 'ลบคอลัมน์นี้';
            delBtn.addEventListener('click', async () => {
                if (await appConfirm(`ต้องการลบคอลัมน์กำหนดเอง "${col.label}" หรือไม่? ข้อมูลที่เคยกรอกในคอลัมน์นี้จะยังอยู่ในระบบแต่จะไม่แสดงผล`)) {
                    state.columns = state.columns.filter(c => c.id !== col.id);
                    saveState();
                    renderColumnSettingsUI();
                    renderTables();
                }
            });
            rightWrap.appendChild(delBtn);
        }
        
        div.appendChild(leftWrap);
        div.appendChild(rightWrap);
        
        if(container) container.appendChild(div);
    });
}

function moveColumn(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= state.columns.length) return;
    
    // Swap columns
    const temp = state.columns[index];
    state.columns[index] = state.columns[targetIndex];
    state.columns[targetIndex] = temp;
    
    saveState();
    renderColumnSettingsUI();
    renderTables();
}

function addNewColumn(label) {
    if (!label) return;
    const cleanLabel = label.trim();
    if (state.columns.some(c => c.label === cleanLabel)) {
        appAlert('มีคอลัมน์ชื่อนี้อยู่แล้ว!');
        return;
    }
    const id = 'custom_' + Date.now();
    state.columns.push({
        id: id,
        label: cleanLabel,
        visible: true,
        custom: true
    });
    saveState();
    renderColumnSettingsUI();
    renderTables();
}

function renderTableHeaders(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const isCompactExpenseTable = ['full-bills-table', 'attached-bills-table'].includes(tableId);
    const isResponsiveRecordTable = ['full-bills-table', 'attached-bills-table', 'food-bills-table'].includes(tableId);
    table.classList.toggle('responsive-record-table', isResponsiveRecordTable);
    if (isResponsiveRecordTable) {
        const container = table.closest('.table-container');
        if (container) container.classList.add('responsive-record-container');
    }
    const thead = table.querySelector('thead tr');
    if (!thead) return;
    
    thead.innerHTML = '';

    if (isCompactExpenseTable) {
        ['เลขบิล / ใบเสร็จ', 'วันที่ / รอบ', 'รายละเอียดรายการ', 'จำนวนเงิน', 'หลักฐาน / ประเภท', 'เครื่องมือ']
            .forEach((label, index) => {
                const th = document.createElement('th');
                th.textContent = label;
                if (index === 3) th.className = 'text-right';
                if (index === 5) th.className = 'text-center';
                thead.appendChild(th);
            });
        return;
    }
    
    state.columns.forEach(col => {
        if (!col.visible) return;
        const th = document.createElement('th');
        th.textContent = col.label;
        if (col.id === 'quantity' || col.id === 'unitPrice' || col.id === 'amount') {
            th.className = 'text-right';
        }
        thead.appendChild(th);
    });
    
    const actionTh = document.createElement('th');
    actionTh.textContent = 'เครื่องมือ';
    actionTh.className = 'text-center';
    thead.appendChild(actionTh);
}

function renderExpenseRow(exp, idx, tbody) {
    const recordTable = tbody && tbody.closest('table');
    if (recordTable && recordTable.id === 'full-bills-table') {
        renderCompactExpenseRow(exp, idx, tbody);
        return;
    }

    const tr = document.createElement('tr');
    tr.id = `row-exp-${exp.id}`;
    
    const parsedNote = parseNoteData(exp.note);
    
    state.columns.forEach(col => {
        if (!col.visible) return;
        const td = document.createElement('td');
        td.dataset.label = col.label;
        
        switch (col.id) {
            case 'documentNo':
                td.innerHTML = `<span style="cursor:pointer; color:var(--primary); margin-right:6px;" onclick="openExpenseModal(${idx})" title="แก้ไขรายการนี้"><i data-lucide="edit-2" style="width:14px; height:14px;"></i></span>${exp.documentNo || ''}`;
                td.style.fontWeight = '600';
                break;
            case 'receiptNo':
                td.textContent = exp.receiptNo || '-';
                td.classList.add('receipt-reference');
                break;
            case 'expenseDate':
                td.textContent = formatThaiDate(exp.expenseDate);
                break;
            case 'postingMonth':
                td.textContent = formatPostingMonth(getExpensePostingMonth(exp));
                break;
            case 'projectId':
                td.innerHTML = `<span class="badge-project">${getProjectName(exp.projectId)}</span>`;
                break;
            case 'categoryId':
                td.innerHTML = `<span class="badge-cat">${getCategoryName(exp.categoryId)}</span>`;
                break;
            case 'fundSourceId':
                td.innerHTML = `<span class="badge-fund">${getFundSourceName(exp.fundSourceId)}</span>`;
                break;
            case 'vendorId':
                td.textContent = getVendorName(exp.vendorId);
                break;
            case 'description':
                let descHTML = exp.description;
                if (parsedNote.multiItems && parsedNote.multiItems.length > 0) {
                    descHTML += `<div class="itemized-list" style="margin-top: 4px; font-size: 11px; color: var(--text-secondary); background: rgba(0,0,0,0.03); padding: 4px 8px; border-radius: 4px; border-left: 2px solid var(--primary);">`;
                    parsedNote.multiItems.forEach((item, itemIdx) => {
                        descHTML += `<div style="display: flex; justify-content: space-between; gap: 8px; padding: 2px 0;">
                            <span>${itemIdx + 1}. ${item.desc}</span>
                            <span>${item.qty} × ฿${item.price.toFixed(2)} = ฿${(item.qty * item.price).toFixed(2)}</span>
                        </div>`;
                    });
                    descHTML += `</div>`;
                }
                if (parsedNote.text) {
                    descHTML += `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">หมายเหตุ: ${parsedNote.text}</div>`;
                }
                td.innerHTML = descHTML;
                break;
            case 'quantity':
                td.textContent = exp.quantity;
                td.className = 'text-right';
                break;
            case 'unitPrice':
                td.textContent = `฿${exp.unitPrice.toFixed(2)}`;
                td.className = 'text-right';
                break;
            case 'amount':
                td.textContent = `฿${exp.amount.toFixed(2)}`;
                td.className = 'text-right';
                td.style.fontWeight = '600';
                break;
            case 'claimable':
                td.innerHTML = `<span class="badge ${exp.claimable ? 'badge-claimable' : 'badge-non-claimable'}">${exp.claimable ? 'เบิกมูลนิธิ' : 'ไม่เบิก'}</span>`;
                break;
            case 'attachment':
                const attachments = attachmentStore[exp.id] || [];
                if (attachments.length > 0) {
                    let attachHtml = `<div style="display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:4px;">`;
                    attachments.forEach((fileData, i) => {
                        attachHtml += `<img src="${ATTACHMENT_PREVIEW_PLACEHOLDER}" class="attachment-thumbnail" data-attachment-preview-exp-id="${escapeHTML(exp.id)}" data-attachment-preview-index="${i}" onclick="previewAttachmentFile('${exp.id}', ${i})" title="ดูหลักฐาน" alt="${escapeHTML(getAttachmentDisplayName(fileData))}"/>`;
                    });
                    attachHtml += `<button class="btn btn-icon btn-icon-attach" data-exp-id="${exp.id}" title="แนบไฟล์เพิ่มเติม/แก้ไข" style="margin-left:4px;"><i data-lucide="upload-cloud" style="width:14px; height:14px;"></i></button></div>`;
                    td.innerHTML = attachHtml;
                } else {
                    td.innerHTML = `<button class="btn btn-icon btn-icon-attach" data-exp-id="${exp.id}" title="แนบไฟล์หลักฐาน"><i data-lucide="upload-cloud" style="width:14px; height:14px;"></i></button>`;
                }
                break;
            case 'organizationId':
                td.textContent = getOrgName(exp.organizationId);
                break;
            default:
                if (col.custom) {
                    td.textContent = parsedNote.customFields[col.label] || '-';
                }
                break;
        }

        tr.appendChild(td);
    });

    const toolsTd = document.createElement('td');
    toolsTd.className = 'text-center';
    toolsTd.dataset.label = 'เครื่องมือ';
    toolsTd.innerHTML = `
        <div class="action-buttons" style="justify-content:center;">
            <button class="btn btn-icon btn-icon-edit" data-idx="${idx}" title="แก้ไข"><i data-lucide="edit-2" style="width:14px; height:14px;"></i></button>
            <button class="btn btn-icon btn-icon-delete" data-idx="${idx}" title="ลบ"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>
        </div>
    `;
    tr.appendChild(toolsTd);
    
    tbody.appendChild(tr);
}

function renderCompactExpenseRow(exp, idx, tbody) {
    const tr = document.createElement('tr');
    tr.id = `row-exp-${exp.id}`;
    tr.className = 'compact-expense-row';

    const attachments = attachmentStore[exp.id] || [];
    const amount = Number(exp.amount || exp.totalAmount || 0) || 0;
    const quantity = Number(exp.quantity || 0) || 0;
    const unitPrice = Number(exp.unitPrice || 0) || 0;
    const meta = [
        `<span class="badge-project">${escapeHTML(getProjectName(exp.projectId) || '-')}</span>`,
        `<span class="badge-cat">${escapeHTML(getCategoryName(exp.categoryId) || '-')}</span>`,
        `<span class="badge-fund">${escapeHTML(getFundSourceName(exp.fundSourceId) || '-')}</span>`,
        `<span class="badge">${escapeHTML(getVendorName(exp.vendorId) || '-')}</span>`
    ].join('');

    tr.innerHTML = `
        <td data-label="เลขบิล / ใบเสร็จ">
            <span class="record-primary">${escapeHTML(exp.documentNo || 'รอเลขบิล')}</span>
            <span class="record-secondary receipt-reference">เล่มที่/เลขที่ ${escapeHTML(exp.receiptNo || '-')}</span>
        </td>
        <td data-label="วันที่ / รอบ">
            <span class="record-primary">${escapeHTML(formatThaiDate(exp.expenseDate) || '-')}</span>
            <span class="record-secondary">รอบ ${escapeHTML(formatPostingMonth(getExpensePostingMonth(exp)))}</span>
        </td>
        <td data-label="รายละเอียดรายการ">
            <span class="record-primary">${escapeHTML(exp.description || '-')}</span>
            <div class="record-meta">${meta}</div>
        </td>
        <td class="text-right" data-label="จำนวนเงิน">
            <span class="record-secondary">${quantity.toLocaleString('th-TH')} ${escapeHTML(exp.unit || 'รายการ')} × ฿${unitPrice.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span class="record-amount">฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </td>
        <td data-label="หลักฐาน / ประเภท">
            <div class="record-meta" style="margin-top:0;">
                <span class="badge ${exp.claimable ? 'badge-claimable' : 'badge-non-claimable'}">${exp.claimable ? 'เบิกมูลนิธิ' : 'ไม่เบิก'}</span>
                <button type="button" class="btn btn-icon btn-icon-attach" data-exp-id="${escapeHTML(exp.id)}" title="จัดการหลักฐาน"><i data-lucide="paperclip" style="width:14px;height:14px;"></i><span style="font-size:11px;">${attachments.length}</span></button>
            </div>
        </td>
        <td class="text-center" data-label="เครื่องมือ">
            <div class="record-tools">
                <button type="button" class="btn btn-icon btn-icon-edit" data-idx="${idx}" title="แก้ไขรายการ" aria-label="แก้ไขรายการ"><i data-lucide="square-pen"></i></button>
                <button type="button" class="btn btn-icon btn-icon-delete" data-idx="${idx}" title="ลบรายการ" aria-label="ลบรายการ"><i data-lucide="trash-2"></i></button>
            </div>
        </td>
    `;
    tbody.appendChild(tr);
}

function renderAttachmentRow(a, idx, tbody) {
    {
        const tr = document.createElement('tr');
        tr.id = `row-att-${a.id}`;
        tr.className = 'compact-expense-row compact-attachment-row';
        const quantity = Number(a.quantity) || 1;
        const unitPrice = Number(a.unitPrice) || Number(a.amount) || 0;
        const amount = Number(a.amount) || quantity * unitPrice;
        const attachments = attachmentStore[a.id] || [];
        const meta = [
            `<span class="badge badge-project">${escapeHTML(getProjectName(a.projectId))}</span>`,
            `<span class="badge badge-cat">${escapeHTML(getCategoryName(a.categoryId))}</span>`,
            `<span class="badge badge-fund">${escapeHTML(getFundSourceName(a.fundSourceId))}</span>`,
            a.vendorId ? `<span>${escapeHTML(getVendorName(a.vendorId))}</span>` : ''
        ].filter(Boolean).join('');
        tr.innerHTML = `
            <td data-label="เลขบิล / ใบเสร็จ">
                <span class="record-primary">${escapeHTML(a.documentNo || 'รอเลขบิล')}</span>
                <span class="record-secondary receipt-reference">เล่มที่/เลขที่ ${escapeHTML(a.receiptNo || '-')}</span>
            </td>
            <td data-label="วันที่ / รอบ">
                <span class="record-primary">${escapeHTML(formatThaiDate(a.expenseDate) || '-')}</span>
                <span class="record-secondary">รอบ ${escapeHTML(formatPostingMonth(getExpensePostingMonth(a)))}</span>
            </td>
            <td data-label="รายละเอียดรายการ">
                <span class="record-primary">${escapeHTML(a.description || '-')}</span>
                <div class="record-meta">${meta}</div>
            </td>
            <td class="text-right" data-label="จำนวนเงิน">
                <span class="record-secondary">${quantity.toLocaleString('th-TH')} ${escapeHTML(a.unit || 'รายการ')} × ฿${unitPrice.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span class="record-amount">฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </td>
            <td data-label="หลักฐาน / ประเภท">
                <div class="record-meta" style="margin-top:0;">
                    <span class="badge ${a.claimable ? 'badge-claimable' : 'badge-non-claimable'}">${a.claimable ? 'เบิกมูลนิธิ' : 'ไม่เบิก'}</span>
                    <button type="button" class="btn btn-icon btn-icon-attach" data-exp-id="${escapeHTML(a.id)}" title="จัดการหลักฐาน"><i data-lucide="paperclip"></i><span>${attachments.length}</span></button>
                </div>
            </td>
            <td class="text-center" data-label="เครื่องมือ">
                <div class="record-tools">
                    <button type="button" class="btn btn-icon btn-icon-edit-attach" data-idx="${idx}" title="แก้ไขรายการ" aria-label="แก้ไขรายการ"><i data-lucide="square-pen"></i></button>
                    <button type="button" class="btn btn-icon btn-icon-delete-attach" data-idx="${idx}" title="ลบรายการ" aria-label="ลบรายการ"><i data-lucide="trash-2"></i></button>
                </div>
            </td>`;
        tbody.appendChild(tr);
        return;
    }
    const tr = document.createElement('tr');
    tr.id = `row-att-${a.id}`;
    
    const parsedNote = parseNoteData(a.note);
    
    state.columns.forEach(col => {
        if (!col.visible) return;
        const td = document.createElement('td');
        td.dataset.label = col.label;
        
        switch (col.id) {
            case 'documentNo':
                td.innerHTML = `<span style="cursor:pointer; color:var(--primary); margin-right:6px;" onclick="openAttachmentModal(${idx})" title="แก้ไขรายการนี้"><i data-lucide="edit-2" style="width:14px; height:14px;"></i></span>${a.documentNo || '—'}`;
                td.style.fontWeight = '600';
                break;
            case 'expenseDate':
                td.textContent = formatThaiDate(a.expenseDate);
                break;
            case 'postingMonth':
                td.textContent = formatPostingMonth(getExpensePostingMonth(a));
                break;
            case 'projectId':
                td.innerHTML = `<span class="badge-project">${getProjectName(a.projectId)}</span>`;
                break;
            case 'categoryId':
                td.innerHTML = `<span class="badge-cat">${getCategoryName(a.categoryId)}</span>`;
                break;
            case 'fundSourceId':
                td.innerHTML = `<span class="badge-fund">${getFundSourceName(a.fundSourceId)}</span>`;
                break;
            case 'vendorId':
                td.textContent = getVendorName(a.vendorId) || '—';
                break;
            case 'description':
                let descHTML = a.description;
                if (parsedNote.multiItems && parsedNote.multiItems.length > 0) {
                    descHTML += `<div class="itemized-list" style="margin-top: 4px; font-size: 11px; color: var(--text-secondary); background: rgba(0,0,0,0.03); padding: 4px 8px; border-radius: 4px; border-left: 2px solid var(--primary);">`;
                    parsedNote.multiItems.forEach((item, itemIdx) => {
                        descHTML += `<div style="display: flex; justify-content: space-between; gap: 8px; padding: 2px 0;">
                            <span>${itemIdx + 1}. ${item.desc}</span>
                            <span>${item.qty} × ฿${item.price.toFixed(2)} = ฿${(item.qty * item.price).toFixed(2)}</span>
                        </div>`;
                    });
                    descHTML += `</div>`;
                }
                if (parsedNote.text) {
                    descHTML += `<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">หมายเหตุ: ${parsedNote.text}</div>`;
                }
                td.innerHTML = descHTML;
                break;
            case 'quantity':
                td.textContent = a.quantity || '1';
                td.className = 'text-right';
                break;
            case 'unitPrice':
                td.textContent = `฿${(a.unitPrice || a.amount || 0).toFixed(2)}`;
                td.className = 'text-right';
                break;
            case 'amount':
                td.textContent = `฿${(a.amount || 0).toFixed(2)}`;
                td.className = 'text-right';
                td.style.fontWeight = '600';
                break;
            case 'claimable':
                td.innerHTML = `<span class="badge ${a.claimable ? 'badge-claimable' : 'badge-non-claimable'}">${a.claimable ? 'เบิกมูลนิธิ' : 'ไม่เบิก'}</span>`;
                break;
            case 'attachment':
                const attachmentsAttach = attachmentStore[a.id] || [];
                if (attachmentsAttach.length > 0) {
                    let attachHtml = `<div style="display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:4px;">`;
                    attachmentsAttach.forEach((fileData, i) => {
                        attachHtml += `<img src="${fileData.viewUrl}" class="attachment-thumbnail" onclick="previewAttachmentFile('${a.id}', ${i})" title="ดูหลักฐาน" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'32\\' height=\\'32\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\'><path d=\\'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z\\'/></svg>'; this.style.opacity='0.5';"/>`;
                    });
                    attachHtml += `<button class="btn btn-icon btn-icon-attach" data-exp-id="${a.id}" title="แนบไฟล์เพิ่มเติม/แก้ไข" style="margin-left:4px;"><i data-lucide="upload-cloud" style="width:14px; height:14px;"></i></button></div>`;
                    td.innerHTML = attachHtml;
                } else {
                    td.innerHTML = `<button class="btn btn-icon btn-icon-attach" data-exp-id="${a.id}" title="แนบไฟล์หลักฐาน"><i data-lucide="upload-cloud" style="width:14px; height:14px;"></i></button>`;
                }
                break;
            case 'organizationId':
                td.textContent = getOrgName(a.organizationId);
                break;
            default:
                if (col.custom) {
                    td.textContent = parsedNote.customFields[col.label] || '-';
                }
                break;
        }
        tr.appendChild(td);
    });

    const toolsTd = document.createElement('td');
    toolsTd.className = 'text-center';
    toolsTd.dataset.label = 'เครื่องมือ';
    toolsTd.innerHTML = `
        <div class="action-buttons" style="justify-content:center;">
            <button class="btn btn-icon btn-icon-edit-attach" data-idx="${idx}" title="แก้ไข"><i data-lucide="edit-2" style="width:14px; height:14px;"></i></button>
            <button class="btn btn-icon btn-icon-delete-attach" data-idx="${idx}" title="ลบ"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>
        </div>
    `;
    tr.appendChild(toolsTd);
    
    tbody.appendChild(tr);
}

function getSelectedMonthDefaultDateStr() {
    const today = new Date();
    const currentYearBE = today.getFullYear() + 543;
    const currentMonth = today.getMonth() + 1;
    
    let year = state.selectedYear - 543;
    let month = state.selectedMonth;
    let day = today.getDate();
    
    if (state.selectedYear !== currentYearBE || state.selectedMonth !== currentMonth) {
        day = 1;
    }
    
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getQuickDefaultProjectId() {
    const projects = (state.projects || []).filter(project => project && project.id && project.active !== false);
    const dormitoryProject = projects.find(project => /หอพัก|ค่าซ่อมแซม/i.test(String(project.name || '')));
    return (dormitoryProject || projects[0] || {}).id || '';
}

function populateQuickExpenseProjectOptions(selectedId = '') {
    const select = document.getElementById('inline-exp-project');
    if (!select) return;
    const projects = (state.projects || []).filter(project => project && project.id && project.active !== false);
    const defaultId = selectedId || getQuickDefaultProjectId();
    select.innerHTML = [
        '<option value="">เลือกโครงการ</option>',
        ...projects.map(project => `<option value="${escapeHTML(project.id)}" ${project.id === defaultId ? 'selected' : ''}>${escapeHTML(project.name || project.id)}</option>`)
    ].join('');
}

function getOrganizationShortName(organizationId) {
    const organization = (state.organizations || []).find(item => String(item.id) === String(organizationId));
    const shortName = organization && (organization.shortName || organization.short_name);
    return String(shortName || 'MIS').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'MIS';
}

function getQuickExpenseSharedBillingCode() {
    const currentUser = getCurrentUser() || {};
    const select = document.getElementById('inline-exp-billing-profile');
    if (isAdminUser(currentUser) && select) {
        return String(select.value || QUICK_EXPENSE_BILLING_PROFILES[0].code).trim().toUpperCase();
    }
    return getOrganizationShortName(currentUser.organizationId);
}

function getQuickExpenseOrganizationId(billingCode) {
    const currentUser = getCurrentUser() || {};
    if (!isAdminUser(currentUser)) return String(currentUser.organizationId || '');
    const matchingOrganization = (state.organizations || []).find(item =>
        item && item.id && item.active !== false && getOrganizationShortName(item.id) === String(billingCode || '').toUpperCase()
    );
    return String((matchingOrganization && matchingOrganization.id) || currentUser.organizationId || '');
}

function getQuickExpenseBillingProfileOptions(selectedCode = '', compact = false) {
    return QUICK_EXPENSE_BILLING_PROFILES
        .map(profile => {
            const selected = profile.code === String(selectedCode).toUpperCase() ? ' selected' : '';
            const label = compact ? profile.code : `${profile.code} — ${profile.name}`;
            return `<option value="${escapeHTML(profile.code)}"${selected}>${escapeHTML(label)}</option>`;
        })
        .join('');
}

function populateQuickExpenseBillingProfileContext(selectedCode = '') {
    const wrapper = document.getElementById('quick-expense-admin-context');
    const select = document.getElementById('inline-exp-billing-profile');
    if (!wrapper || !select) return '';
    const currentUser = getCurrentUser() || {};
    if (!isAdminUser(currentUser)) {
        wrapper.hidden = true;
        select.innerHTML = '';
        return getOrganizationShortName(currentUser.organizationId);
    }

    const billingCode = String(selectedCode || select.value || QUICK_EXPENSE_BILLING_PROFILES[0].code).toUpperCase();
    select.innerHTML = getQuickExpenseBillingProfileOptions(billingCode, false);
    wrapper.hidden = false;
    return billingCode;
}

function buildQuickExpenseRowBillingProfileControl(selectedCode, followsShared = true) {
    if (!isAdminUser()) return '';
    const billingCode = String(selectedCode || QUICK_EXPENSE_BILLING_PROFILES[0].code).toUpperCase();
    const profileItems = QUICK_EXPENSE_BILLING_PROFILES
        .map(profile => {
            const selected = profile.code === billingCode;
            const fullLabel = `${profile.code} — ${profile.name}`;
            return `<button type="button" class="quick-expense-billing-option${selected ? ' is-selected' : ''}" role="option" aria-label="${escapeHTML(fullLabel)}" aria-selected="${selected ? 'true' : 'false'}" title="${escapeHTML(fullLabel)}" data-billing-code="${escapeHTML(profile.code)}" onclick="selectQuickExpenseRowBillingProfile(this, '${escapeHTML(profile.code)}')"><strong>${escapeHTML(profile.code)}</strong><span>${escapeHTML(profile.name)}</span></button>`;
        })
        .join('');
    const selectedProfile = QUICK_EXPENSE_BILLING_PROFILES.find(profile => profile.code === billingCode);
    const selectedName = selectedProfile ? selectedProfile.name : billingCode;
    return `<div class="quick-expense-billing-select-wrap"><input type="hidden" data-field="documentPrefix" data-follow-shared="${followsShared ? 'true' : 'false'}" value="${escapeHTML(billingCode)}"><details class="quick-expense-billing-menu"><summary class="quick-expense-billing-trigger" aria-label="รหัสผู้ออกบิล ${escapeHTML(selectedName)}" title="${escapeHTML(selectedName)}"><span class="quick-expense-billing-code" data-role="billing-code">${escapeHTML(billingCode)}</span><i data-lucide="chevron-down"></i></summary><div class="quick-expense-billing-options" role="listbox">${profileItems}</div></details></div>`;
}

function syncQuickExpenseRowBillingCode(input) {
    const wrapper = input && input.closest ? input.closest('.quick-expense-billing-select-wrap') : null;
    const code = wrapper && wrapper.querySelector('[data-role="billing-code"]');
    const billingCode = String((input && input.value) || '');
    const selectedProfile = QUICK_EXPENSE_BILLING_PROFILES.find(profile => profile.code === billingCode);
    if (code) code.textContent = billingCode;
    const trigger = wrapper && wrapper.querySelector('.quick-expense-billing-trigger');
    if (trigger) {
        const selectedName = selectedProfile ? selectedProfile.name : billingCode;
        trigger.setAttribute('aria-label', `รหัสผู้ออกบิล ${selectedName}`);
        trigger.title = selectedName;
    }
    if (wrapper) {
        wrapper.querySelectorAll('.quick-expense-billing-option').forEach(option => {
            const selected = option.dataset.billingCode === billingCode;
            option.classList.toggle('is-selected', selected);
            option.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
    }
}

function selectQuickExpenseRowBillingProfile(option, billingCode) {
    const wrapper = option && option.closest ? option.closest('.quick-expense-billing-select-wrap') : null;
    const input = wrapper && wrapper.querySelector('[data-field="documentPrefix"]');
    if (!input) return;
    input.value = String(billingCode || '').toUpperCase();
    input.dataset.followShared = 'false';
    syncQuickExpenseRowBillingCode(input);
    const menu = wrapper.querySelector('.quick-expense-billing-menu');
    if (menu) menu.open = false;
    refreshQuickExpenseDocumentPreviews();
}

function onQuickExpenseBillingProfileChange(billingCode) {
    quickExpenseRows.forEach(rowId => {
        const row = getQuickExpenseRowElement(rowId);
        if (!row || row.dataset.saved === 'true') return;
        const input = row.querySelector('[data-field="documentPrefix"]');
        if (input && input.dataset.followShared !== 'false') {
            input.value = billingCode;
            syncQuickExpenseRowBillingCode(input);
        }
    });
    refreshQuickExpenseDocumentPreviews();
}
window.onQuickExpenseBillingProfileChange = onQuickExpenseBillingProfileChange;
window.selectQuickExpenseRowBillingProfile = selectQuickExpenseRowBillingProfile;

function getQuickExpenseDraftStorageKey() {
    const currentUser = getCurrentUser() || {};
    const owner = currentUser.id || currentUser.username || currentUser.organizationId || 'anonymous';
    return `${QUICK_EXPENSE_DRAFT_STORAGE_PREFIX}:${quickExpenseEntryMode}:${encodeURIComponent(String(owner))}`;
}

function getQuickExpenseDataSource() {
    return quickExpenseEntryMode === 'ATT' ? (state.attachments || []) : (state.expenses || []);
}

function findQuickExpenseRecord(expenseId) {
    return getQuickExpenseDataSource().find(item => String(item.id || '') === String(expenseId || '')) || null;
}

function upsertQuickExpenseRecord(expense) {
    if (!expense || !expense.id) return;
    const target = quickExpenseEntryMode === 'ATT' ? state.attachments : state.expenses;
    const index = target.findIndex(item => item.id === expense.id);
    if (index >= 0) target[index] = expense;
    else target.unshift(expense);
}

function loadQuickExpenseLocalDraft() {
    try {
        const saved = JSON.parse(localStorage.getItem(getQuickExpenseDraftStorageKey()) || 'null');
        return saved && saved.version === QUICK_EXPENSE_DRAFT_STORAGE_VERSION ? saved : null;
    } catch (error) {
        console.warn('อ่านรายการใบเสร็จที่บันทึกอัตโนมัติไม่สำเร็จ:', error);
        return null;
    }
}

function clearQuickExpenseLocalDraft() {
    try {
        localStorage.removeItem(getQuickExpenseDraftStorageKey());
    } catch (error) {
        console.warn('ล้างรายการใบเสร็จที่บันทึกอัตโนมัติไม่สำเร็จ:', error);
    }
}

function collectQuickExpenseLocalDraft() {
    const value = id => String((document.getElementById(id) || {}).value || '').trim();
    const rows = quickExpenseRows
        .map(rowId => ({ row: getQuickExpenseRowElement(rowId), draft: getQuickExpenseRowDraft(rowId) }))
        .filter(item => item.row && item.row.dataset.saved !== 'true' && !isQuickExpenseDraftEmpty(item.draft))
        .map(item => {
            const { attachments, amount, rowId, ...draft } = item.draft;
            return draft;
        });
    return {
        version: QUICK_EXPENSE_DRAFT_STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        shared: {
            documentPrefix: value('inline-exp-billing-profile'),
            projectId: value('inline-exp-project'),
            categoryId: value('inline-exp-category'),
            categoryName: value('inline-exp-category-input'),
            fundSourceId: value('inline-exp-fund'),
            fundSourceName: value('inline-exp-fund-input'),
            claimable: value('inline-exp-claimable'),
            postingMonth: value('inline-exp-posting-month')
        },
        rows
    };
}

function persistQuickExpenseLocalDraft() {
    if (isRestoringQuickExpenseDraft) return;
    try {
        const draft = collectQuickExpenseLocalDraft();
        if (!draft.rows.length) {
            clearQuickExpenseLocalDraft();
            return;
        }
        localStorage.setItem(getQuickExpenseDraftStorageKey(), JSON.stringify(draft));
        quickExpenseRows.forEach(rowId => {
            const row = getQuickExpenseRowElement(rowId);
            if (!row || row.dataset.saved === 'true' || row.classList.contains('is-saving') || row.classList.contains('has-error')) return;
            const rowDraft = getQuickExpenseRowDraft(rowId);
            if (isQuickExpenseDraftEmpty(rowDraft)) return;
            row.classList.add('is-local-draft');
            const status = row.querySelector('[data-role="row-status"]');
            if (status) status.textContent = 'ฉบับร่าง · บันทึกอัตโนมัติแล้ว';
        });
    } catch (error) {
        console.warn('บันทึกรายการใบเสร็จอัตโนมัติไม่สำเร็จ:', error);
    }
}

function scheduleQuickExpenseDraftSave() {
    if (isRestoringQuickExpenseDraft) return;
    if (quickExpenseDraftSaveTimer) window.clearTimeout(quickExpenseDraftSaveTimer);
    quickExpenseDraftSaveTimer = window.setTimeout(() => {
        quickExpenseDraftSaveTimer = null;
        persistQuickExpenseLocalDraft();
    }, 250);
}

function ensureQuickExpenseTrailingRow(sourceRowId) {
    const pendingRows = quickExpenseRows.filter(rowId => {
        const row = getQuickExpenseRowElement(rowId);
        return row && row.dataset.saved !== 'true';
    });
    if (!pendingRows.length || pendingRows[pendingRows.length - 1] !== sourceRowId) return;
    const draft = getQuickExpenseRowDraft(sourceRowId);
    if (isQuickExpenseDraftEmpty(draft)) return;
    addQuickExpenseRow({}, { focus: false, persist: false });
}

function validateQuickExpenseInlineEdit(draft) {
    if (quickExpenseEntryMode === 'EXP' && !draft.receiptNo) return 'กรุณาระบุเลขที่ใบเสร็จ';
    if (!draft.expenseDate) return 'กรุณาระบุวันที่บิล';
    if (!draft.vendorName) return 'กรุณาระบุร้านค้า/ผู้ขาย';
    if (!draft.description) return 'กรุณาระบุรายละเอียด';
    if (draft.quantity <= 0) return 'จำนวนต้องมากกว่า 0';
    if (!draft.unit) return 'กรุณาระบุหน่วย';
    if (draft.unitPrice <= 0) return 'ราคาต่อหน่วยต้องมากกว่า 0';
    return '';
}

function scheduleQuickExpenseInlineSave(rowId, delay = 120) {
    const previousTimer = quickExpenseInlineSaveTimers.get(rowId);
    if (previousTimer) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
        quickExpenseInlineSaveTimers.delete(rowId);
        saveQuickExpenseInlineEdit(rowId);
    }, delay);
    quickExpenseInlineSaveTimers.set(rowId, timer);
}

async function saveQuickExpenseInlineEdit(rowId) {
    const row = getQuickExpenseRowElement(rowId);
    const expenseId = row && row.dataset.expenseId;
    if (!row || row.dataset.saved !== 'true' || !expenseId) return;
    if (row.dataset.inlineSaving === 'true') {
        row.dataset.inlineSavePending = 'true';
        return;
    }

    const draft = getQuickExpenseRowDraft(rowId);
    const validationError = validateQuickExpenseInlineEdit(draft);
    if (validationError) {
        row.dataset.inlineSaveError = 'true';
        setQuickExpenseRowStatus(rowId, validationError, 'error');
        return false;
    }

    const existingExpense = findQuickExpenseRecord(expenseId);
    if (!existingExpense) {
        row.dataset.inlineSaveError = 'true';
        setQuickExpenseRowStatus(rowId, 'ไม่พบรายการเดิม กรุณาโหลดข้อมูลอีกครั้ง', 'error');
        return false;
    }

    row.dataset.inlineSaving = 'true';
    row.dataset.inlineSavePending = 'false';
    row.dataset.inlineSaveError = 'false';
    setQuickExpenseRowStatus(rowId, 'กำลังบันทึกการแก้ไข...', 'saving');
    try {
        const vendorId = await resolveExpenseMasterName('vendor', draft.vendorName);
        const parsedNote = parseNoteData(existingExpense.note || '');
        const updatedMultiItems = draft.multiItems.length === 1
            ? [{ desc: draft.description, qty: draft.quantity, price: draft.unitPrice }]
            : draft.multiItems;
        quickExpenseMultiItemsByRow[rowId] = updatedMultiItems.map(item => ({ ...item }));
        const payload = {
            id: expenseId,
            receiptNo: draft.receiptNo,
            expenseDate: draft.expenseDate,
            vendorId,
            description: draft.description,
            quantity: draft.quantity,
            unit: draft.unit,
            unitPrice: draft.unitPrice,
            note: formatNoteData(draft.note, parsedNote.customFields || {}, updatedMultiItems)
        };
        await apiCall('updateExpense', payload, null, null, {
            onStatus: detail => {
                if (detail.status === 'retrying') {
                    setQuickExpenseRowStatus(rowId, `การเชื่อมต่อสะดุด · กำลังส่งซ้ำ ${detail.attempt}/${detail.maxAttempts}`, 'saving');
                } else if (detail.status === 'sending') {
                    setQuickExpenseRowStatus(rowId, `กำลังบันทึกการแก้ไข ${detail.attempt}/${detail.maxAttempts}`, 'saving');
                }
            }
        });
        Object.assign(existingExpense, payload, {
            vendorName: draft.vendorName,
            amount: draft.amount,
            totalAmount: draft.amount
        });
        row.classList.remove('is-saving', 'has-error');
        delete row.dataset.inlineSaveError;
        const status = row.querySelector('[data-role="row-status"]');
        if (status) status.textContent = 'บันทึกการแก้ไขแล้ว';
        renderTables();
        return true;
    } catch (error) {
        row.dataset.inlineSaveError = 'true';
        setQuickExpenseRowStatus(rowId, `บันทึกไม่สำเร็จ: ${error.message || error}`, 'error');
        return false;
    } finally {
        row.dataset.inlineSaving = 'false';
        if (row.dataset.inlineSavePending === 'true') {
            row.dataset.inlineSavePending = 'false';
            scheduleQuickExpenseInlineSave(rowId, 0);
        }
    }
}
window.saveQuickExpenseInlineEdit = saveQuickExpenseInlineEdit;

function bindQuickExpenseDraftAutosave() {
    const form = document.getElementById('quick-expense-form');
    if (!form || form.dataset.autosaveBound === 'true') return;
    form.dataset.autosaveBound = 'true';
    const handleDraftChange = event => {
        const target = event.target;
        const row = target && target.closest ? target.closest('.quick-expense-batch-row') : null;
        if (row && target.dataset && target.dataset.field) {
            clearQuickExpenseTableValidation();
        }
        if (row && row.dataset.saved === 'true' && target.dataset && target.dataset.field) {
            if (event.type === 'change') {
                scheduleQuickExpenseInlineSave(row.dataset.rowId);
            } else {
                const status = row.querySelector('[data-role="row-status"]');
                if (status) status.textContent = 'กำลังแก้ไข · ออกจากช่องเพื่อบันทึก';
            }
            return;
        }
        const autoAddFields = ['receiptNo', 'vendorName', 'description', 'unitPrice', 'note'];
        if (row && target.dataset && autoAddFields.includes(target.dataset.field)) {
            ensureQuickExpenseTrailingRow(row.dataset.rowId);
        }
        scheduleQuickExpenseDraftSave();
    };
    form.addEventListener('input', handleDraftChange);
    form.addEventListener('change', handleDraftChange);
    window.addEventListener('pagehide', persistQuickExpenseLocalDraft);
}

function syncQuickExpenseEntryPeriod(force = false) {
    const postingMonth = document.getElementById('inline-exp-posting-month');
    if (!postingMonth) return;
    if (force || postingMonth.dataset.autoPeriod !== 'false' || !postingMonth.value) {
        postingMonth.value = getSelectedPostingMonth();
        postingMonth.dataset.autoPeriod = 'true';
    }
}

function syncQuickFoodEntryPeriod() {
    const postingMonth = document.getElementById('quick-food-posting-month');
    const label = document.getElementById('quick-food-posting-month-label');
    const selectedMonth = getSelectedPostingMonth();
    if (postingMonth) postingMonth.value = selectedMonth;
    if (label) label.textContent = formatPostingMonth(selectedMonth);
}

function createQuickFoodRowId() {
    quickFoodRowSequence += 1;
    return `quick-food-${Date.now()}-${quickFoodRowSequence}`;
}

function getQuickFoodRowElement(rowId) {
    return document.querySelector(`.quick-food-batch-row[data-row-id="${rowId}"]`);
}

function getQuickFoodRowDraft(rowId) {
    const row = getQuickFoodRowElement(rowId);
    const value = field => String((row && row.querySelector(`[data-field="${field}"]`) || {}).value || '').trim();
    const quantity = Number(value('quantity')) || 0;
    const unitPrice = Number(value('unitPrice')) || 0;
    return {
        requestId: (row && row.dataset.requestId) || createClientRequestId('food'),
        expenseDate: value('expenseDate'),
        name: value('name'),
        quantity,
        unit: value('unit') || 'รายการ',
        unitPrice,
        amount: quantity * unitPrice,
        attachments: quickFoodAttachmentsByRow[rowId] || []
    };
}

function isQuickFoodDraftEmpty(draft) {
    return !draft.name && !draft.unitPrice && draft.attachments.length === 0;
}

function buildQuickFoodRowHTML(rowId, initial = {}) {
    const expenseDate = initial.expenseDate || initial.date || getSelectedMonthDefaultDateStr();
    const name = initial.name || '';
    const quantity = Number(initial.quantity) > 0 ? Number(initial.quantity) : 1;
    const unit = String(initial.unit || 'รายการ');
    const unitPrice = Number(initial.unitPrice || initial.price) || '';
    const amount = (Number(quantity) || 0) * (Number(unitPrice) || 0);
    return `
        <td class="quick-food-col-index" data-label="ลำดับ"><span data-role="row-number"></span></td>
        <td data-label="วันที่ซื้อ"><input type="date" class="form-input" data-field="expenseDate" value="${escapeHTML(expenseDate)}" required></td>
        <td data-label="รายการ"><input type="text" class="form-input" data-field="name" list="food-item-suggestions" value="${escapeHTML(name)}" placeholder="เช่น หมูสด ผัก ไข่ไก่" oninput="handleQuickFoodRowInput('${rowId}', 'name')" required></td>
        <td data-label="จำนวน"><input type="number" class="form-input" data-field="quantity" min="0.01" step="any" value="${quantity}" oninput="handleQuickFoodRowInput('${rowId}', 'quantity')" required></td>
        <td data-label="ราคา/หน่วย"><input type="number" class="form-input" data-field="unitPrice" min="0.01" step="any" value="${unitPrice}" oninput="handleQuickFoodRowInput('${rowId}', 'unitPrice')" required></td>
        <td class="text-right" data-label="รวม"><strong data-role="row-total">${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
        <td data-label="หน่วย / หลักฐาน">
            <details class="quick-food-row-details">
                <summary data-role="extra-summary">หน่วย: ${escapeHTML(unit)}</summary>
                <div class="quick-food-row-extra attachment-drop-zone" data-attachment-drop-zone tabindex="0" ondragover="setAttachmentDropZoneState(event, true)" ondragleave="setAttachmentDropZoneState(event, false)" ondrop="handleQuickFoodRowDrop('${rowId}', event)" onpaste="handleQuickFoodRowPaste('${rowId}', event)">
                    <label>หน่วย<input type="text" class="form-input" data-field="unit" value="${escapeHTML(unit)}" oninput="handleQuickFoodRowInput('${rowId}', 'unit')" required></label>
                    <label>หลักฐาน<input type="file" class="form-input" accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.docx,.csv" multiple onchange="handleQuickFoodRowFiles('${rowId}', event)"></label>
                    <span class="attachment-drop-hint"><i data-lucide="clipboard-paste"></i> ลากไฟล์ หรือกด Ctrl+V</span>
                    <div class="quick-file-list" data-role="file-list" aria-live="polite"></div>
                </div>
            </details>
        </td>
        <td class="quick-food-col-actions" data-label="เครื่องมือ">
            <button type="button" class="btn btn-icon btn-sm btn-icon-delete" onclick="removeQuickFoodRow('${rowId}')" title="ลบแถว" aria-label="ลบแถว"><i data-lucide="trash-2"></i></button>
            <small data-role="row-status"></small>
        </td>`;
}

function addQuickFoodRow(initial = {}, options = {}) {
    const tbody = document.getElementById('quick-food-rows');
    if (!tbody) return '';
    const rowId = createQuickFoodRowId();
    quickFoodRows.push(rowId);
    quickFoodAttachmentsByRow[rowId] = Array.isArray(initial.attachments) ? [...initial.attachments] : [];
    const row = document.createElement('tr');
    row.className = 'quick-food-batch-row';
    row.dataset.rowId = rowId;
    row.dataset.requestId = initial.requestId || createClientRequestId('food');
    row.innerHTML = buildQuickFoodRowHTML(rowId, initial);
    tbody.appendChild(row);
    renderQuickFoodRowFiles(rowId);
    renumberQuickFoodRows();
    if (options.focus !== false) {
        const input = row.querySelector('[data-field="name"]');
        if (input) input.focus();
    }
    initializeLucide();
    return rowId;
}

function renumberQuickFoodRows() {
    quickFoodRows = quickFoodRows.filter(rowId => Boolean(getQuickFoodRowElement(rowId)));
    quickFoodRows.forEach((rowId, index) => {
        const row = getQuickFoodRowElement(rowId);
        const number = row && row.querySelector('[data-role="row-number"]');
        if (number) number.textContent = String(index + 1);
    });
    updateQuickFoodBatchSummary();
}

function updateQuickFoodBatchSummary() {
    const drafts = quickFoodRows.map(getQuickFoodRowDraft).filter(draft => !isQuickFoodDraftEmpty(draft));
    const summary = document.getElementById('quick-food-row-summary');
    const total = document.getElementById('quick-food-grand-total');
    if (summary) summary.textContent = `${drafts.length} รายการรอบันทึก`;
    if (total) total.textContent = drafts.reduce((sum, draft) => sum + draft.amount, 0)
        .toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ensureQuickFoodTrailingRow(sourceRowId) {
    const sourceIndex = quickFoodRows.indexOf(sourceRowId);
    if (sourceIndex !== quickFoodRows.length - 1) return;
    const draft = getQuickFoodRowDraft(sourceRowId);
    if (!isQuickFoodDraftEmpty(draft)) addQuickFoodRow({}, { focus: false });
}

function handleQuickFoodRowInput(rowId, field) {
    const row = getQuickFoodRowElement(rowId);
    if (!row) return;
    const draft = getQuickFoodRowDraft(rowId);
    const total = row.querySelector('[data-role="row-total"]');
    const summary = row.querySelector('[data-role="extra-summary"]');
    const attachmentCount = draft.attachments.length;
    if (total) total.textContent = draft.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (summary) summary.textContent = `หน่วย: ${draft.unit}${attachmentCount ? ` · หลักฐาน ${attachmentCount}` : ''}`;
    if (field === 'name' || field === 'unitPrice') ensureQuickFoodTrailingRow(rowId);
    updateQuickFoodBatchSummary();
}

function populateQuickFoodSuggestions() {
    const categoryList = document.getElementById('quick-food-category-list');
    const itemList = document.getElementById('food-item-suggestions');
    const rows = state.foodExpenses || [];
    if (categoryList) {
        const categories = [...new Set(['อาหารประจำเดือน', ...rows.map(row => String(row.category || '').trim()).filter(Boolean)])];
        categoryList.innerHTML = categories.map(value => `<option value="${escapeHTML(value)}"></option>`).join('');
    }
    if (itemList) {
        const names = [...new Set(rows.map(row => String(row.name || '').trim()).filter(Boolean))];
        itemList.innerHTML = names.map(value => `<option value="${escapeHTML(value)}"></option>`).join('');
    }
}

function populateQuickExpenseVendorOptions() {
    const list = document.getElementById('quick-expense-vendor-options');
    if (!list) return;
    list.innerHTML = (state.vendors || [])
        .filter(item => item && item.id && item.name && item.active !== false)
        .map(item => `<option value="${escapeHTML(item.name)}"></option>`)
        .join('');
}

function getQuickExpenseDescriptionSuggestions(query, limit = 8) {
    const normalizedQuery = normalizeMasterName(query);
    if (!normalizedQuery) return [];
    const queryParts = normalizedQuery.split(' ').filter(Boolean);
    const unique = new Map();
    getQuickExpenseDataSource().forEach((expense, index) => {
        const description = String(expense.description || '').trim();
        const normalizedDescription = normalizeMasterName(description);
        if (!description || !normalizedDescription) return;
        const containsQuery = normalizedDescription.includes(normalizedQuery);
        const containsAllParts = queryParts.length > 1 && queryParts.every(part => normalizedDescription.includes(part));
        if (!containsQuery && !containsAllParts) return;
        const unit = String(expense.unit || 'รายการ').trim() || 'รายการ';
        const key = `${normalizedDescription}|${normalizeMasterName(unit)}`;
        const score = normalizedDescription === normalizedQuery ? 0 : (normalizedDescription.startsWith(normalizedQuery) ? 1 : 2);
        const existing = unique.get(key);
        if (!existing || score < existing.score) unique.set(key, { description, unit, score, index });
    });
    return Array.from(unique.values())
        .sort((a, b) => a.score - b.score || a.index - b.index || a.description.localeCompare(b.description, 'th'))
        .slice(0, limit)
        .map(({ description, unit }) => ({ description, unit }));
}

function hideQuickExpenseDescriptionSuggestions(rowId) {
    const row = getQuickExpenseRowElement(rowId);
    const list = row && row.querySelector('[data-role="description-suggestions"]');
    if (list) {
        list.hidden = true;
        list.innerHTML = '';
    }
}

function handleQuickExpenseDescriptionInput(rowId) {
    const row = getQuickExpenseRowElement(rowId);
    const input = getQuickExpenseRowField(rowId, 'description');
    const list = row && row.querySelector('[data-role="description-suggestions"]');
    if (!input || !list) return;
    const suggestions = getQuickExpenseDescriptionSuggestions(input.value);
    if (!suggestions.length) {
        hideQuickExpenseDescriptionSuggestions(rowId);
        return;
    }
    list.innerHTML = suggestions.map(item => `
        <button type="button" class="quick-expense-description-option" data-description="${escapeHTML(item.description)}" data-unit="${escapeHTML(item.unit)}" onclick="selectQuickExpenseDescriptionSuggestion('${rowId}', this)">
            <span>${escapeHTML(item.description)}</span>
            <small>หน่วย: ${escapeHTML(item.unit)}</small>
        </button>
    `).join('');
    list.hidden = false;
}

function selectQuickExpenseDescriptionSuggestion(rowId, option) {
    const descriptionInput = getQuickExpenseRowField(rowId, 'description');
    const unitInput = getQuickExpenseRowField(rowId, 'unit');
    if (descriptionInput) descriptionInput.value = String((option && option.dataset.description) || '');
    if (unitInput) unitInput.value = String((option && option.dataset.unit) || 'รายการ');
    hideQuickExpenseDescriptionSuggestions(rowId);
    ensureQuickExpenseTrailingRow(rowId);
    scheduleQuickExpenseDraftSave();
}
window.handleQuickExpenseDescriptionInput = handleQuickExpenseDescriptionInput;
window.hideQuickExpenseDescriptionSuggestions = hideQuickExpenseDescriptionSuggestions;
window.selectQuickExpenseDescriptionSuggestion = selectQuickExpenseDescriptionSuggestion;

function getQuickExpenseRowElement(rowId) {
    return document.querySelector(`.quick-expense-batch-row[data-row-id="${rowId}"]`);
}

function getQuickExpenseRowField(rowId, field) {
    const row = getQuickExpenseRowElement(rowId);
    return row ? row.querySelector(`[data-field="${field}"]`) : null;
}

function getQuickExpenseRowDraft(rowId) {
    const row = getQuickExpenseRowElement(rowId);
    const value = field => String((getQuickExpenseRowField(rowId, field) || {}).value || '').trim();
    const sharedPostingMonth = String((document.getElementById('inline-exp-posting-month') || {}).value || '').trim();
    const quantity = Number(value('quantity')) || 0;
    const unitPrice = Number(value('unitPrice')) || 0;
    const documentPrefix = value('documentPrefix') || getQuickExpenseSharedBillingCode();
    return {
        rowId,
        requestId: (row && row.dataset.requestId) || createClientRequestId(quickExpenseEntryMode === 'ATT' ? 'attachment' : 'expense'),
        organizationId: getQuickExpenseOrganizationId(documentPrefix),
        documentPrefix,
        postingMonth: sharedPostingMonth || value('postingMonth'),
        receiptNo: value('receiptNo'),
        expenseDate: value('expenseDate'),
        vendorName: value('vendorName'),
        description: value('description'),
        quantity,
        unit: value('unit'),
        unitPrice,
        amount: quantity * unitPrice,
        note: value('note'),
        multiItems: (quickExpenseMultiItemsByRow[rowId] || []).map(item => ({ ...item })),
        attachments: (quickExpenseAttachmentsByRow[rowId] || []).map(item => ({ ...item }))
    };
}

function getQuickExpenseDocumentPreview(postingMonth, documentPrefix = getQuickExpenseSharedBillingCode()) {
    const match = String(postingMonth || '').match(/^(\d{4})-(\d{2})$/);
    const prefix = String(documentPrefix || 'MIS').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'MIS';
    if (!match) return `${prefix}MMMYY_1`;
    const monthCodes = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${prefix}${monthCodes[Number(match[2]) - 1] || 'MMM'}${match[1].slice(-2)}_1`;
}

function buildQuickExpenseRowHTML(rowId, initial = {}) {
    const requestId = initial.requestId || createClientRequestId(quickExpenseEntryMode === 'ATT' ? 'attachment' : 'expense');
    const postingMonth = initial.postingMonth || getSelectedPostingMonth();
    const expenseDate = initial.expenseDate || getSelectedMonthDefaultDateStr();
    const receiptNo = initial.receiptNo || '';
    const vendorName = initial.vendorName || '';
    const description = initial.description || '';
    const quantity = initial.quantity || 1;
    const unit = initial.unit || 'รายการ';
    const unitPrice = initial.unitPrice || '';
    const note = initial.note || '';
    const documentPrefix = initial.documentPrefix || getQuickExpenseSharedBillingCode();
    const billingProfileControl = buildQuickExpenseRowBillingProfileControl(documentPrefix, !initial.documentPrefix);
    return `
        <tr class="quick-expense-batch-row" data-row-id="${rowId}" data-request-id="${escapeHTML(requestId)}" data-saved="false">
            <td class="quick-expense-row-index">
                <div class="quick-expense-row-order">
                    <button type="button" class="quick-expense-order-button" data-order="up" onclick="moveQuickExpenseRow('${rowId}', -1)" title="เลื่อนขึ้น" aria-label="เลื่อนรายการขึ้น"><i data-lucide="chevron-up"></i></button>
                    <strong data-role="row-number">1</strong>
                    <button type="button" class="quick-expense-order-button" data-order="down" onclick="moveQuickExpenseRow('${rowId}', 1)" title="เลื่อนลง" aria-label="เลื่อนรายการลง"><i data-lucide="chevron-down"></i></button>
                </div>
            </td>
            <td class="quick-expense-doc-cell" data-role="document-number">
                <strong class="quick-expense-doc-preview">${escapeHTML(getQuickExpenseDocumentPreview(postingMonth, documentPrefix))}</strong>
                ${billingProfileControl}
            </td>
            <td><input type="text" class="form-input" data-field="receiptNo" value="${escapeHTML(receiptNo)}" placeholder="${quickExpenseEntryMode === 'ATT' ? 'ระบุได้ (ถ้ามี)' : 'เล่ม 1 / เลขที่ 001'}"></td>
            <td><input type="date" class="form-input" data-field="expenseDate" value="${escapeHTML(expenseDate)}"></td>
            <td><input type="text" class="form-input" data-field="vendorName" list="quick-expense-vendor-options" value="${escapeHTML(vendorName)}" placeholder="พิมพ์หรือเลือกผู้ขาย"></td>
            <td>
                <div class="quick-expense-description-wrap">
                    <input type="text" class="form-input" data-field="description" value="${escapeHTML(description)}" placeholder="รายละเอียดรายการ" autocomplete="off" aria-autocomplete="list" aria-controls="${rowId}-description-suggestions" oninput="handleQuickExpenseDescriptionInput('${rowId}')" onfocus="handleQuickExpenseDescriptionInput('${rowId}')" onblur="window.setTimeout(() => hideQuickExpenseDescriptionSuggestions('${rowId}'), 180)">
                    <div class="quick-expense-description-suggestions" id="${rowId}-description-suggestions" data-role="description-suggestions" role="listbox" hidden></div>
                    <button type="button" class="btn btn-outline quick-expense-subitems-button" onclick="openQuickExpenseMultiItems('${rowId}')">
                        <i data-lucide="list-plus"></i> เพิ่มรายการย่อย
                    </button>
                </div>
            </td>
            <td><input type="number" class="form-input text-right" data-field="quantity" min="0.01" step="any" value="${escapeHTML(quantity)}" oninput="updateQuickExpenseRowTotal('${rowId}')"></td>
            <td><input type="text" class="form-input" data-field="unit" value="${escapeHTML(unit)}" placeholder="หน่วย"></td>
            <td><input type="number" class="form-input text-right" data-field="unitPrice" min="0.01" step="any" value="${escapeHTML(unitPrice)}" oninput="updateQuickExpenseRowTotal('${rowId}')"></td>
            <td><span class="quick-expense-row-total" data-role="row-total">0.00</span></td>
            <td>
                <details class="quick-expense-row-details attachment-drop-zone" data-attachment-drop-zone tabindex="0" ondragover="setAttachmentDropZoneState(event, true)" ondragleave="setAttachmentDropZoneState(event, false)" ondrop="handleQuickExpenseRowDrop('${rowId}', event)" onpaste="handleQuickExpenseRowPaste('${rowId}', event)">
                    <summary data-role="extra-summary">หมายเหตุ / หลักฐาน</summary>
                    <textarea class="form-input" data-field="note" rows="2" placeholder="รายละเอียดเพิ่มเติม">${escapeHTML(note)}</textarea>
                    <label class="btn btn-outline btn-sm quick-expense-file-button">
                        <i data-lucide="paperclip"></i> แนบหลักฐาน
                        <input type="file" hidden multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.docx,.csv" onchange="handleQuickExpenseRowFiles('${rowId}', event)">
                    </label>
                    <span class="attachment-drop-hint"><i data-lucide="clipboard-paste"></i> ลากไฟล์ หรือกด Ctrl+V</span>
                    <div class="quick-file-list" data-role="file-list" aria-live="polite"></div>
                </details>
            </td>
            <td>
                <div class="quick-expense-row-actions">
                    <button type="button" class="btn btn-icon quick-expense-open-full" onclick="openExpenseModalFromQuickExpenseRow('${rowId}')" title="เปิดรายการแบบป๊อปอัป" aria-label="เปิดรายการแบบป๊อปอัป"><i data-lucide="square-pen"></i></button>
                    <button type="button" class="btn btn-icon quick-expense-retry-attachments" data-row-retry-attachments onclick="retryQuickExpenseRowAttachments('${rowId}')" title="ลองอัปโหลดหลักฐานอีกครั้ง" hidden disabled><i data-lucide="refresh-cw"></i></button>
                    <button type="button" class="btn btn-icon quick-expense-remove-row" data-row-remove onclick="removeQuickExpenseRow('${rowId}')" title="ลบแถว" aria-label="ลบแถว"><i data-lucide="trash-2"></i></button>
                </div>
                <span class="quick-expense-row-status" data-role="row-status">รอบันทึก</span>
            </td>
        </tr>
    `;
}

function refreshQuickExpenseDocumentPreviews() {
    const postingMonth = String((document.getElementById('inline-exp-posting-month') || {}).value || '').trim();
    quickExpenseRows.forEach(rowId => {
        const row = getQuickExpenseRowElement(rowId);
        if (!row || row.dataset.saved === 'true') return;
        const preview = row.querySelector('.quick-expense-doc-preview');
        const documentPrefix = String((row.querySelector('[data-field="documentPrefix"]') || {}).value || getQuickExpenseSharedBillingCode());
        if (preview) preview.textContent = getQuickExpenseDocumentPreview(postingMonth, documentPrefix);
    });
}

function addQuickExpenseRow(initial = {}, options = {}) {
    const tbody = document.getElementById('quick-expense-rows');
    if (!tbody) return '';
    const shouldFocus = options.focus !== false;
    const shouldPersist = options.persist !== false;
    const rowId = `quick-exp-${++quickExpenseRowSequence}`;
    quickExpenseRows.push(rowId);
    quickExpenseAttachmentsByRow[rowId] = [];
    quickExpenseMultiItemsByRow[rowId] = Array.isArray(initial.multiItems) ? initial.multiItems.map(item => ({ ...item })) : [];
    tbody.insertAdjacentHTML('beforeend', buildQuickExpenseRowHTML(rowId, initial));
    enhanceSystemDateInputs(tbody);
    updateQuickExpenseRowTotal(rowId);
    renumberQuickExpenseRows();
    initializeLucide();
    if (shouldFocus) {
        window.setTimeout(() => {
            const focusInput = getQuickExpenseRowField(rowId, quickExpenseEntryMode === 'ATT' ? 'description' : 'receiptNo');
            if (focusInput && typeof focusInput.focus === 'function') focusInput.focus();
        }, 0);
    }
    if (shouldPersist) scheduleQuickExpenseDraftSave();
    return rowId;
}

function renumberQuickExpenseRows() {
    quickExpenseRows = quickExpenseRows.filter(rowId => !!getQuickExpenseRowElement(rowId));
    quickExpenseRows.forEach((rowId, index) => {
        const row = getQuickExpenseRowElement(rowId);
        const number = row && row.querySelector('[data-role="row-number"]');
        if (number) number.textContent = String(index + 1);
        const upButton = row && row.querySelector('[data-order="up"]');
        const downButton = row && row.querySelector('[data-order="down"]');
        if (upButton) upButton.disabled = index === 0;
        if (downButton) downButton.disabled = index === quickExpenseRows.length - 1;
    });
    updateQuickExpenseBatchSummary();
}

function moveQuickExpenseRow(rowId, direction) {
    const currentIndex = quickExpenseRows.indexOf(rowId);
    const targetIndex = currentIndex + Number(direction || 0);
    const row = getQuickExpenseRowElement(rowId);
    if (!row || currentIndex < 0 || targetIndex < 0 || targetIndex >= quickExpenseRows.length) return;
    const targetRow = getQuickExpenseRowElement(quickExpenseRows[targetIndex]);
    if (!targetRow) return;
    const [movedRowId] = quickExpenseRows.splice(currentIndex, 1);
    quickExpenseRows.splice(targetIndex, 0, movedRowId);
    const tbody = document.getElementById('quick-expense-rows');
    if (tbody) {
        quickExpenseRows.forEach(id => {
            const item = getQuickExpenseRowElement(id);
            if (item) tbody.appendChild(item);
        });
    }
    renumberQuickExpenseRows();
    scheduleQuickExpenseDraftSave();
    row.classList.remove('is-reordered');
    window.requestAnimationFrame(() => row.classList.add('is-reordered'));
}
window.moveQuickExpenseRow = moveQuickExpenseRow;

function updateQuickExpenseRowTotal(rowId) {
    const row = getQuickExpenseRowElement(rowId);
    if (!row) return;
    const draft = getQuickExpenseRowDraft(rowId);
    const total = row.querySelector('[data-role="row-total"]');
    if (total) total.textContent = draft.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    updateQuickExpenseBatchSummary();
}

function updateQuickExpenseBatchSummary() {
    const visibleRows = quickExpenseRows
        .map(getQuickExpenseRowElement)
        .filter(Boolean)
        .filter(row => !isQuickExpenseDraftEmpty(getQuickExpenseRowDraft(row.dataset.rowId)));
    const pendingRows = visibleRows.filter(row => row.dataset.saved !== 'true');
    const total = visibleRows.reduce((sum, row) => sum + getQuickExpenseRowDraft(row.dataset.rowId).amount, 0);
    const summary = document.getElementById('quick-expense-row-summary');
    const totalElement = document.getElementById('quick-expense-grand-total');
    if (summary) summary.textContent = `${pendingRows.length} รายการรอบันทึก`;
    if (totalElement) totalElement.textContent = total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function releaseQuickExpenseRowFiles(rowId) {
    (quickExpenseAttachmentsByRow[rowId] || []).forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
}

function getExpenseDeleteConfirmationMessage(expense = {}, fallbackDescription = '') {
    const documentNo = String(expense.documentNo || '-').trim() || '-';
    const receiptNo = String(expense.receiptNo || '').trim();
    const description = String(expense.description || fallbackDescription || '-').trim() || '-';
    return [
        'ต้องการลบรายการนี้ออกจากระบบหรือไม่?',
        `เลขบิล: ${documentNo}`,
        receiptNo ? `เล่มที่ / เลขที่ใบเสร็จ: ${receiptNo}` : '',
        `รายละเอียด: ${description}`,
        'รายการจะถูกลบจากฐานข้อมูล และหายจากเมนู “แสดงรายการเดิม”'
    ].filter(Boolean).join('\n');
}

function applyExpenseDeletionToClientState(expenseId) {
    const normalizedId = String(expenseId || '');
    state.expenses = (state.expenses || []).filter(item => String(item.id || '') !== normalizedId);
    state.attachments = (state.attachments || []).filter(item => String(item.id || '') !== normalizedId);
    delete attachmentStore[normalizedId];
    quickExpenseHiddenSavedIds.delete(normalizedId);
}

async function deleteExpenseRecordAndSync(expenseId) {
    const normalizedId = String(expenseId || '').trim();
    if (!normalizedId) throw new Error('ไม่พบรหัสรายการที่ต้องการลบ');
    const result = await apiCall('deleteExpense', { id: normalizedId });
    applyExpenseDeletionToClientState(normalizedId);
    renderAll();
    if (!quickExpenseRows.some(id => {
        const item = getQuickExpenseRowElement(id);
        return item && item.dataset.saved !== 'true';
    })) addQuickExpenseRow({}, { focus: false });
    scheduleQuickExpenseDraftSave();
    return result;
}

async function removeQuickExpenseRow(rowId) {
    const row = getQuickExpenseRowElement(rowId);
    if (!row) return;
    const draft = getQuickExpenseRowDraft(rowId);
    const saved = row.dataset.saved === 'true';
    const expenseId = String(row.dataset.expenseId || '');
    const expense = saved ? findQuickExpenseRecord(expenseId) : null;
    const displayedDocumentNo = String((row.querySelector('[data-role="document-number"] strong') || {}).textContent || '').trim();
    const documentNo = (expense && expense.documentNo) || displayedDocumentNo || getQuickExpenseDocumentPreview(draft.postingMonth, draft.documentPrefix);
    const confirmationMessage = saved
        ? getExpenseDeleteConfirmationMessage({ ...expense, documentNo, description: draft.description, receiptNo: draft.receiptNo }, draft.description)
        : [
            'ต้องการลบแถวฉบับร่างนี้หรือไม่?',
            `เลขบิล: ${documentNo || '-'}`,
            `รายละเอียด: ${draft.description || '-'}`,
            'ข้อมูลฉบับร่างในแถวนี้จะถูกลบ'
        ].join('\n');
    const confirmed = await appConfirm(confirmationMessage, saved ? 'ยืนยันลบรายการ' : 'ยืนยันลบแถว', {
        confirmButtonText: saved ? 'ลบออกจากระบบ' : 'ลบแถว',
        cancelButtonText: 'ย้อนกลับ'
    });
    if (!confirmed) return;

    if (saved) {
        if (!expenseId) return appAlert('ไม่พบรหัสรายการที่ต้องการลบ กรุณาโหลดข้อมูลอีกครั้ง', 'error');
        if (!['admin', 'manager'].includes(getCurrentUserRole())) {
            return appAlert('บัญชีนี้ไม่มีสิทธิ์ลบรายการที่บันทึกแล้ว กรุณาติดต่อผู้ดูแลระบบ', 'warning');
        }
        setQuickExpenseRowStatus(rowId, 'กำลังลบออกจากฐานข้อมูล...', 'saving');
        showLoading(true);
        try {
            const result = await deleteExpenseRecordAndSync(expenseId);
            const cleanupFailed = Number(result && result.attachmentCleanup && result.attachmentCleanup.driveTrashFailed) || 0;
            appAlert(
                cleanupFailed
                    ? `ลบรายการ ${documentNo || expenseId} แล้ว แต่มีไฟล์หลักฐาน ${cleanupFailed} ไฟล์ที่ย้ายไปถังขยะไม่สำเร็จ`
                    : `ลบรายการ ${documentNo || expenseId} ออกจากฐานข้อมูลและตารางทั้งหมดแล้ว`,
                cleanupFailed ? 'warning' : 'success'
            );
        } catch (error) {
            setQuickExpenseRowStatus(rowId, `ลบไม่สำเร็จ: ${error.message || error}`, 'error');
            appAlert(`ลบรายการ ${documentNo || expenseId} ไม่สำเร็จ: ${error.message || error}`, 'error');
        } finally {
            showLoading(false);
        }
        return;
    }

    const inlineSaveTimer = quickExpenseInlineSaveTimers.get(rowId);
    if (inlineSaveTimer) window.clearTimeout(inlineSaveTimer);
    quickExpenseInlineSaveTimers.delete(rowId);
    row.remove();
    releaseQuickExpenseRowFiles(rowId);
    delete quickExpenseAttachmentsByRow[rowId];
    delete quickExpenseMultiItemsByRow[rowId];
    quickExpenseRows = quickExpenseRows.filter(id => id !== rowId);
    if (!quickExpenseRows.some(id => {
        const item = getQuickExpenseRowElement(id);
        return item && item.dataset.saved !== 'true';
    })) addQuickExpenseRow();
    renumberQuickExpenseRows();
    scheduleQuickExpenseDraftSave();
}
window.addQuickExpenseRow = addQuickExpenseRow;
window.removeQuickExpenseRow = removeQuickExpenseRow;

function setQuickExpenseRowStatus(rowId, message, status = '') {
    const row = getQuickExpenseRowElement(rowId);
    if (!row) return;
    row.classList.toggle('is-saving', status === 'saving');
    row.classList.toggle('has-error', status === 'error');
    const element = row.querySelector('[data-role="row-status"]');
    if (element) element.textContent = message;
}

function clearQuickExpenseTableValidation() {
    const alert = document.getElementById('quick-expense-table-alert');
    const container = document.querySelector('.quick-expense-batch-container');
    if (alert) {
        alert.hidden = true;
        alert.classList.remove('is-warning', 'is-error');
    }
    if (container) container.classList.remove('has-validation-warning', 'has-validation-error');
    document.querySelectorAll('.quick-expense-batch-row.is-validation-target').forEach(row => {
        row.classList.remove('is-validation-target', 'is-validation-warning', 'is-validation-error');
    });
}

function showQuickExpenseTableValidation(message, rowIds = [], tone = 'error') {
    clearQuickExpenseTableValidation();
    const alert = document.getElementById('quick-expense-table-alert');
    const messageElement = document.getElementById('quick-expense-table-alert-message');
    const container = document.querySelector('.quick-expense-batch-container');
    const normalizedTone = tone === 'warning' ? 'warning' : 'error';
    if (messageElement) messageElement.textContent = message;
    if (alert) {
        alert.hidden = false;
        alert.classList.add(`is-${normalizedTone}`);
    }
    if (container) container.classList.add(`has-validation-${normalizedTone}`);
    rowIds.forEach(rowId => {
        const row = getQuickExpenseRowElement(rowId);
        if (row) row.classList.add('is-validation-target', `is-validation-${normalizedTone}`);
    });
    initializeLucide();

    const firstRow = rowIds.length ? getQuickExpenseRowElement(rowIds[0]) : null;
    const firstInput = firstRow && firstRow.querySelector(`[data-field="${quickExpenseEntryMode === 'ATT' ? 'description' : 'receiptNo'}"]`);
    if (firstInput && !firstInput.disabled) {
        window.setTimeout(() => {
            try { firstInput.focus({ preventScroll: true }); } catch (error) { firstInput.focus(); }
        }, 0);
    }
    if (alert && typeof alert.scrollIntoView === 'function') {
        alert.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function markQuickExpenseRowSaved(rowId, documentNo, attachmentErrorCount = 0, expenseId = '') {
    const row = getQuickExpenseRowElement(rowId);
    if (!row) return;
    row.dataset.saved = 'true';
    if (expenseId) row.dataset.expenseId = expenseId;
    row.classList.remove('is-saving', 'has-error', 'is-local-draft');
    row.classList.add('is-saved');
    const docCell = row.querySelector('[data-role="document-number"]');
    if (docCell) docCell.innerHTML = `<button type="button" class="quick-expense-doc-edit" data-role="document-edit" onclick="editQuickExpenseDocumentNo('${rowId}')" title="คลิกเพื่อแก้ไขเลขบิล"><strong>${escapeHTML(documentNo || 'บันทึกแล้ว')}</strong><small>คลิกเพื่อแก้ไข</small></button>`;
    row.querySelectorAll('input, select, textarea, button:not([data-role="document-edit"])').forEach(element => {
        element.disabled = true;
        delete element.dataset.busyLocked;
    });
    row.querySelectorAll([
        '[data-field="receiptNo"]',
        '[data-field="expenseDate"]',
        '[data-field="vendorName"]',
        '[data-field="description"]',
        '[data-field="quantity"]',
        '[data-field="unit"]',
        '[data-field="unitPrice"]',
        '[data-field="note"]'
    ].join(', ')).forEach(element => {
        element.disabled = false;
        element.title = 'คลิกเพื่อแก้ไข ระบบจะบันทึกเมื่อออกจากช่อง';
    });
    const documentEditButton = row.querySelector('[data-role="document-edit"]');
    if (documentEditButton) documentEditButton.disabled = false;
    row.querySelectorAll('.quick-expense-open-full, [data-row-remove]').forEach(button => {
        const savedDeleteWithoutPermission = button.matches('[data-row-remove]') && !['admin', 'manager'].includes(getCurrentUserRole());
        button.disabled = savedDeleteWithoutPermission;
        if (savedDeleteWithoutPermission) button.title = 'บัญชีนี้ไม่มีสิทธิ์ลบรายการที่บันทึกแล้ว';
    });
    const retryButton = row.querySelector('[data-row-retry-attachments]');
    if (retryButton) {
        retryButton.hidden = attachmentErrorCount === 0;
        retryButton.disabled = attachmentErrorCount === 0;
    }
    const status = row.querySelector('[data-role="row-status"]');
    if (status) status.textContent = attachmentErrorCount
        ? `บันทึกแล้ว · แนบไฟล์ไม่สำเร็จ ${attachmentErrorCount} ไฟล์`
        : 'บันทึกแล้ว · คลิกช่องข้อมูลเพื่อแก้ไข';
    updateQuickExpenseBatchSummary();
    scheduleQuickExpenseDraftSave();
}

async function editQuickExpenseDocumentNo(rowId) {
    const row = getQuickExpenseRowElement(rowId);
    const expenseId = row && row.dataset.expenseId;
    const current = row && row.querySelector('[data-role="document-edit"] strong');
    if (!expenseId || !current) return;
    const next = window.prompt('แก้ไขเลขบิล', current.textContent.trim());
    if (next === null) return;
    const documentNo = String(next).trim();
    if (!documentNo) return appAlert('กรุณาระบุเลขบิล', 'warning');
    if (documentNo.length > 60) return appAlert('เลขบิลยาวเกิน 60 ตัวอักษร', 'warning');
    if (documentNo === current.textContent.trim()) return;
    const editButton = row.querySelector('[data-role="document-edit"]');
    if (editButton) editButton.disabled = true;
    setQuickExpenseRowStatus(rowId, 'กำลังบันทึกเลขบิล...', 'saving');
    try {
        await apiCall('updateExpense', { id: expenseId, documentNo }, null, null, {
            onStatus: detail => {
                if (detail.status === 'retrying') {
                    setQuickExpenseRowStatus(rowId, `การเชื่อมต่อสะดุด · กำลังส่งซ้ำ ${detail.attempt}/${detail.maxAttempts}`, 'saving');
                } else if (detail.status === 'sending') {
                    setQuickExpenseRowStatus(rowId, `กำลังบันทึกเลขบิล ${detail.attempt}/${detail.maxAttempts}`, 'saving');
                }
            }
        });
        current.textContent = documentNo;
        const match = findQuickExpenseRecord(expenseId);
        if (match) match.documentNo = documentNo;
        row.classList.remove('is-saving', 'has-error');
        setQuickExpenseRowStatus(rowId, 'บันทึกเลขบิลสำเร็จแล้ว', 'success');
        appAlert('แก้ไขเลขบิลเรียบร้อยแล้ว', 'success');
    } catch (error) {
        setQuickExpenseRowStatus(rowId, 'ยังไม่บันทึกเลขบิล · ระบบลองส่งซ้ำแล้ว', 'error');
        appAlert('แก้ไขเลขบิลไม่สำเร็จ: ' + (error.message || error), 'error');
    } finally {
        if (editButton) editButton.disabled = false;
    }
}
window.editQuickExpenseDocumentNo = editQuickExpenseDocumentNo;

function getQuickExpenseSavedRowInitial(expense) {
    const parsedNote = parseNoteData(expense.note || '');
    const vendorName = expense.vendorName || (expense.vendorId ? getVendorName(expense.vendorId) : '');
    return {
        requestId: expense.requestId || '',
        postingMonth: getExpensePostingMonth(expense),
        documentPrefix: expense.documentPrefix || getOrganizationShortName(expense.organizationId),
        receiptNo: expense.receiptNo || '',
        expenseDate: String(expense.expenseDate || '').slice(0, 10),
        vendorName: vendorName === '-' ? '' : vendorName,
        description: expense.description || '',
        quantity: Number(expense.quantity) || 1,
        unit: expense.unit || 'รายการ',
        unitPrice: Number(expense.unitPrice) || 0,
        note: parsedNote.text || '',
        multiItems: Array.isArray(parsedNote.multiItems) ? parsedNote.multiItems : []
    };
}

function addQuickExpenseSavedRow(expense) {
    if (!expense || !expense.id) return '';
    const rowId = addQuickExpenseRow(getQuickExpenseSavedRowInitial(expense), { focus: false, persist: false });
    const row = getQuickExpenseRowElement(rowId);
    if (row) {
        row.dataset.postingMonth = getExpensePostingMonth(expense);
        row.dataset.documentNo = String(expense.documentNo || '');
    }
    markQuickExpenseRowSaved(rowId, expense.documentNo || 'บันทึกแล้ว', 0, expense.id);
    const removeButton = row && row.querySelector('[data-row-remove]');
    const status = String(expense.status || 'draft').toLowerCase();
    const canDeleteSaved = ['admin', 'manager'].includes(getCurrentUserRole()) && status === 'draft' && !expense.claimId;
    if (removeButton && !canDeleteSaved) {
        removeButton.disabled = true;
        removeButton.title = expense.claimId
            ? 'รายการนี้อยู่ในชุดส่งเบิกแล้ว จึงไม่สามารถลบได้'
            : status !== 'draft'
                ? `ลบไม่ได้ในสถานะ ${status}`
                : 'บัญชีนี้ไม่มีสิทธิ์ลบรายการที่บันทึกแล้ว';
    }
    return rowId;
}

function syncQuickExpenseSavedRows() {
    if (quickExpenseRows.length === 0) return;
    const savedExpenses = getQuickExpenseDataSource().filter(expense =>
        isExpenseInSelectedMonth(expense) && !quickExpenseHiddenSavedIds.has(String(expense.id || ''))
    );
    const expectedIds = new Set(savedExpenses.map(expense => String(expense.id || '')));

    quickExpenseRows.slice().forEach(rowId => {
        const row = getQuickExpenseRowElement(rowId);
        if (!row || row.dataset.saved !== 'true' || expectedIds.has(String(row.dataset.expenseId || ''))) return;
        row.remove();
        releaseQuickExpenseRowFiles(rowId);
        delete quickExpenseAttachmentsByRow[rowId];
        delete quickExpenseMultiItemsByRow[rowId];
        quickExpenseRows = quickExpenseRows.filter(id => id !== rowId);
    });

    const rowIdByExpenseId = new Map();
    quickExpenseRows.forEach(rowId => {
        const row = getQuickExpenseRowElement(rowId);
        if (row && row.dataset.saved === 'true' && row.dataset.expenseId) {
            rowIdByExpenseId.set(String(row.dataset.expenseId), rowId);
        }
    });
    const savedRowIds = savedExpenses.map(expense => {
        const expenseId = String(expense.id);
        const existingRowId = rowIdByExpenseId.get(expenseId);
        return existingRowId || addQuickExpenseSavedRow(expense);
    }).filter(Boolean);
    const pendingRowIds = quickExpenseRows.filter(rowId => {
        const row = getQuickExpenseRowElement(rowId);
        return row && row.dataset.saved !== 'true';
    });
    quickExpenseRows = [...savedRowIds, ...pendingRowIds];
    const tbody = document.getElementById('quick-expense-rows');
    if (tbody) {
        quickExpenseRows.forEach(rowId => {
            const row = getQuickExpenseRowElement(rowId);
            if (row) tbody.appendChild(row);
        });
    }
    renumberQuickExpenseRows();
}

function initializeQuickExpenseEntry(options = {}) {
    const form = document.getElementById('quick-expense-form');
    if (!form) return;
    isRestoringQuickExpenseDraft = true;
    try {
        quickExpenseInlineSaveTimers.forEach(timer => window.clearTimeout(timer));
        quickExpenseInlineSaveTimers.clear();
        quickExpenseRows.forEach(releaseQuickExpenseRowFiles);
        form.reset();
        quickExpenseRows = [];
        quickExpenseAttachmentsByRow = {};
        quickExpenseMultiItemsByRow = {};
        quickExpenseFileProcessingCount = 0;
        const tbody = document.getElementById('quick-expense-rows');
        if (tbody) tbody.innerHTML = '';

        const savedDraft = options.ignoreSaved ? null : loadQuickExpenseLocalDraft();
        const shared = (savedDraft && savedDraft.shared) || {};
        populateQuickExpenseBillingProfileContext(shared.documentPrefix || '');
        populateQuickExpenseProjectOptions(shared.projectId || '');
        populateQuickExpenseVendorOptions();
        syncQuickExpenseEntryPeriod(true);
        setupExpenseMasterInput('category', shared.categoryId || '', 'inline-exp');
        setupExpenseMasterInput('fundSource', shared.fundSourceId || '', 'inline-exp');

        const setValue = (id, value) => {
            const element = document.getElementById(id);
            if (element && value !== undefined && value !== null && value !== '') element.value = value;
        };
        setValue('inline-exp-category-input', shared.categoryName);
        setValue('inline-exp-fund-input', shared.fundSourceName);
        setValue('inline-exp-claimable', shared.claimable);
        setValue('inline-exp-posting-month', shared.postingMonth);

        getQuickExpenseDataSource()
            .filter(expense => isExpenseInSelectedMonth(expense) && !quickExpenseHiddenSavedIds.has(String(expense.id || '')))
            .forEach(addQuickExpenseSavedRow);
        const rows = savedDraft && Array.isArray(savedDraft.rows) ? savedDraft.rows : [];
        const restoredRowIds = rows.map(row => addQuickExpenseRow(row, { focus: false, persist: false }));
        addQuickExpenseRow({}, { focus: false, persist: false });
        if (rows.length) {
            restoredRowIds.forEach(rowId => {
                const element = getQuickExpenseRowElement(rowId);
                if (element) element.classList.add('is-local-draft');
                const status = element && element.querySelector('[data-role="row-status"]');
                if (status) status.textContent = 'ฉบับร่าง · กู้คืนอัตโนมัติแล้ว';
            });
        }
        renumberQuickExpenseRows();
        bindQuickExpenseDraftAutosave();
    } finally {
        isRestoringQuickExpenseDraft = false;
    }
}

async function resetQuickExpenseEntry() {
    const confirmed = await appConfirm(
        'ต้องการล้างแถวทั้งหมดในตารางนี้หรือไม่? ฉบับร่างจะถูกล้าง แต่รายการที่บันทึกแล้วจะยังอยู่ในฐานข้อมูล',
        'ยืนยันล้างตาราง'
    );
    if (!confirmed) return;

    quickExpenseRows.forEach(rowId => {
        const row = getQuickExpenseRowElement(rowId);
        if (row && row.dataset.saved === 'true' && row.dataset.expenseId) {
            quickExpenseHiddenSavedIds.add(row.dataset.expenseId);
        }
    });
    if (quickExpenseDraftSaveTimer) {
        window.clearTimeout(quickExpenseDraftSaveTimer);
        quickExpenseDraftSaveTimer = null;
    }
    clearQuickExpenseLocalDraft();
    initializeQuickExpenseEntry({ ignoreSaved: true });
}

async function resetQuickFoodEntry(options = {}) {
    const form = document.getElementById('quick-food-form');
    if (!form) return;
    const hasDrafts = quickFoodRows.some(rowId => !isQuickFoodDraftEmpty(getQuickFoodRowDraft(rowId)));
    if (hasDrafts && options.confirm !== false) {
        const confirmed = await appConfirm(
            'ต้องการล้างรายการค่าอาหารที่รอบันทึกทั้งหมดหรือไม่?',
            'ยืนยันล้างตาราง',
            { confirmButtonText: 'ล้างตาราง', cancelButtonText: 'ย้อนกลับ' }
        );
        if (!confirmed) return;
    }
    Object.values(quickFoodAttachmentsByRow).flat().forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    quickFoodRows = [];
    quickFoodAttachmentsByRow = {};
    quickFoodFileProcessingCount = 0;
    setBatchUploadProgress('quick-food-save', 0, 0, { hidden: true });
    const tbody = document.getElementById('quick-food-rows');
    if (tbody) tbody.innerHTML = '';
    const category = document.getElementById('quick-food-category');
    if (category) category.value = 'อาหารประจำเดือน';
    syncQuickFoodEntryPeriod();
    populateQuickFoodSuggestions();
    addQuickFoodRow({}, { focus: false });
}

function toggleMonthlyBillsRecords(force) {
    const records = document.getElementById('monthly-bills-records');
    const toggle = document.getElementById('monthly-bills-records-toggle');
    if (!records) return;
    const show = typeof force === 'boolean' ? force : records.hidden;
    records.hidden = !show;
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(show));
        toggle.dataset.collapsed = show ? 'false' : 'true';
        toggle.title = show ? 'ซ่อนรายการบิลที่บันทึกแล้ว' : 'แสดงรายการบิลที่บันทึกแล้ว';
        const label = toggle.querySelector('[data-role="label"]');
        if (label) label.textContent = show ? 'ซ่อนรายการเดิม' : 'แสดงรายการเดิม';
    }
}
window.toggleMonthlyBillsRecords = toggleMonthlyBillsRecords;

function toggleAttachmentBillsRecords(force) {
    const records = document.getElementById('attachment-bills-records');
    const toggle = document.getElementById('attachment-bills-records-toggle');
    if (!records) return;
    const show = typeof force === 'boolean' ? force : records.hidden;
    records.hidden = !show;
    if (toggle) {
        toggle.setAttribute('aria-expanded', String(show));
        toggle.dataset.collapsed = show ? 'false' : 'true';
        toggle.title = show ? 'ซ่อนรายการบิลแนบที่บันทึกแล้ว' : 'แสดงรายการบิลแนบที่บันทึกแล้ว';
        const label = toggle.querySelector('[data-role="label"]');
        if (label) label.textContent = show ? 'ซ่อนรายการเดิม' : 'แสดงรายการเดิม';
    }
}
window.toggleAttachmentBillsRecords = toggleAttachmentBillsRecords;

function updateQuickExpenseEntryModeUI() {
    const isAttachmentMode = quickExpenseEntryMode === 'ATT';
    const panel = document.getElementById('quick-expense-entry');
    const host = document.getElementById(isAttachmentMode ? 'quick-attachment-entry-host' : 'quick-expense-entry-host');
    if (panel && host && panel.parentElement !== host) host.appendChild(panel);
    const title = document.getElementById('quick-expense-title');
    const description = title && title.nextElementSibling;
    const pendingTitle = document.querySelector('#quick-expense-form .quick-batch-toolbar strong');
    const receiptHeader = document.querySelector('#quick-expense-batch-table thead th:nth-child(3)');
    const saveButton = document.getElementById('quick-exp-save-btn');
    if (title) title.textContent = isAttachmentMode ? 'เพิ่มบิลแนบ / ค่าสาธารณูปโภคในตาราง' : 'เพิ่มรายการบิลในตาราง';
    if (description) description.textContent = isAttachmentMode
        ? 'กำหนดข้อมูลร่วมครั้งเดียว แล้วเพิ่มบิลแนบหลายรายการต่อเนื่อง เลขบิลจะสร้างอัตโนมัติหลังบันทึก'
        : 'กำหนดข้อมูลร่วมครั้งเดียว แล้วเพิ่มใบเสร็จหลายรายการต่อเนื่อง เลขบิลจะสร้างอัตโนมัติหลังบันทึก';
    if (pendingTitle) pendingTitle.textContent = isAttachmentMode ? 'รายการบิลแนบที่รอบันทึก' : 'รายการใบเสร็จที่รอบันทึก';
    if (receiptHeader) receiptHeader.textContent = isAttachmentMode ? 'เลขอ้างอิง / ใบเสร็จ (ถ้ามี)' : 'เล่มที่ / เลขที่ใบเสร็จ';
    if (saveButton) saveButton.innerHTML = `<i data-lucide="save"></i> ${isAttachmentMode ? 'บันทึกบิลแนบที่รอทั้งหมด' : 'บันทึกใบเสร็จที่รอทั้งหมด'}`;
}

function setQuickExpenseEntryMode(mode) {
    const nextMode = mode === 'ATT' ? 'ATT' : 'EXP';
    if (nextMode === quickExpenseEntryMode) {
        updateQuickExpenseEntryModeUI();
        return false;
    }
    if (quickExpenseRows.length) persistQuickExpenseLocalDraft();
    quickExpenseEntryMode = nextMode;
    updateQuickExpenseEntryModeUI();
    initializeQuickExpenseEntry();
    return true;
}

function toggleQuickExpenseEntry(force, mode = quickExpenseEntryMode) {
    const panel = document.getElementById('quick-expense-entry');
    if (!panel) return;
    const modeChanged = setQuickExpenseEntryMode(mode);
    const open = modeChanged ? true : (typeof force === 'boolean' ? force : panel.hidden);
    panel.hidden = !open;
    if (open) {
        if (quickExpenseEntryMode === 'ATT') toggleAttachmentBillsRecords(false);
        else toggleMonthlyBillsRecords(false);
        if (quickExpenseRows.length === 0) initializeQuickExpenseEntry();
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        if (quickExpenseEntryMode === 'ATT') toggleAttachmentBillsRecords(true);
        else toggleMonthlyBillsRecords(true);
    }
    initializeLucide();
}
window.toggleQuickExpenseEntry = toggleQuickExpenseEntry;

function openQuickExpenseFullForm() {
    if (quickExpenseEntryMode === 'ATT') openAttachmentModal();
    else openExpenseModal();
}
window.openQuickExpenseFullForm = openQuickExpenseFullForm;

function openExpenseModalFromQuickExpenseRow(rowId) {
    const sourceRow = getQuickExpenseRowElement(rowId);
    if (!sourceRow) {
        appAlert('ไม่พบแถวรายการที่ต้องการเปิด', 'warning');
        return;
    }
    if (sourceRow.dataset.saved === 'true' && sourceRow.dataset.expenseId) {
        const source = quickExpenseEntryMode === 'ATT' ? (state.attachments || []) : (state.expenses || []);
        const expenseIndex = source.findIndex(item => item.id === sourceRow.dataset.expenseId);
        if (expenseIndex >= 0) {
            if (quickExpenseEntryMode === 'ATT') openAttachmentModal(expenseIndex);
            else openExpenseModal(expenseIndex);
            return;
        }
        appAlert('ไม่พบรายการที่บันทึกไว้ กรุณาโหลดข้อมูลอีกครั้ง', 'warning');
        return;
    }

    const value = id => String((document.getElementById(id) || {}).value || '');
    const rowDraft = getQuickExpenseRowDraft(rowId);
    const vendor = findMasterByName(state.vendors || [], rowDraft.vendorName);
    const draft = {
        ...rowDraft,
        projectId: value('inline-exp-project'),
        categoryId: value('inline-exp-category'),
        categoryName: value('inline-exp-category-input'),
        fundSourceId: value('inline-exp-fund'),
        fundSourceName: value('inline-exp-fund-input'),
        vendorId: vendor ? vendor.id : '',
        claimable: value('inline-exp-claimable') === 'true'
    };

    if (quickExpenseEntryMode === 'ATT') {
        openAttachmentModal();
        attachmentModalSourceRowId = rowId;
        const setAttachmentValue = (id, nextValue) => {
            const element = document.getElementById(id);
            if (element) element.value = nextValue;
        };
        setAttachmentValue('attach-date', draft.expenseDate);
        setAttachmentValue('attach-posting-month', draft.postingMonth);
        setAttachmentValue('attach-project', draft.projectId);
        setupExpenseMasterInput('category', draft.categoryId, 'attach');
        setupExpenseMasterInput('fundSource', draft.fundSourceId, 'attach');
        setAttachmentValue('attach-category-input', draft.categoryName);
        setAttachmentValue('attach-fund-source-input', draft.fundSourceName);
        setAttachmentValue('attach-desc', draft.description);
        setAttachmentValue('attach-amount', draft.amount);
        setAttachmentValue('attach-claim-type', draft.claimable ? 'claim' : 'no-claim');
        return;
    }

    openExpenseModal();
    expenseModalSource = `quick-row:${rowId}`;
    expenseModalOrganizationId = rowDraft.organizationId;
    expenseModalDocumentPrefix = rowDraft.documentPrefix;
    expenseCreateRequestId = rowDraft.requestId;
    expenseModalNoteMetadata = {
        customFields: {},
        multiItems: rowDraft.multiItems.map(item => ({ ...item }))
    };
    const set = (id, nextValue) => {
        const element = document.getElementById(id);
        if (element) element.value = nextValue;
    };
    set('bill-date', draft.expenseDate);
    set('bill-receipt-no', draft.receiptNo);
    set('bill-posting-month', draft.postingMonth);
    set('bill-project', draft.projectId);
    set('bill-category', draft.categoryId);
    set('bill-category-input', draft.categoryName);
    set('bill-fund-source', draft.fundSourceId);
    set('bill-fund-source-input', draft.fundSourceName);
    set('bill-vendor', draft.vendorId);
    set('bill-vendor-input', draft.vendorName);
    set('bill-desc', draft.description);
    set('bill-qty', draft.quantity || '1');
    set('bill-unit', draft.unit || 'รายการ');
    set('bill-price', draft.unitPrice);
    const billQtyInput = document.getElementById('bill-qty');
    const billPriceInput = document.getElementById('bill-price');
    if (draft.multiItems.length > 1) {
        if (billQtyInput) billQtyInput.disabled = true;
        if (billPriceInput) billPriceInput.disabled = true;
    }
    set('bill-claim-type', draft.claimable ? 'claim' : 'no-claim');
    set('bill-note', rowDraft.note);
    updateExpenseModalMultiItemsSummary();

    tempBillAttachments = draft.attachments.map(item => ({
        ...item,
        previewUrl: item.previewUrl || URL.createObjectURL(item.file)
    }));
    renderTempBillAttachmentsPreview(null);
}

function openExpenseModalFromQuickEntry() {
    const firstPendingRowId = quickExpenseRows.find(rowId => {
        const row = getQuickExpenseRowElement(rowId);
        return row && row.dataset.saved !== 'true';
    });
    if (firstPendingRowId) openExpenseModalFromQuickExpenseRow(firstPendingRowId);
}
window.openExpenseModalFromQuickExpenseRow = openExpenseModalFromQuickExpenseRow;
window.openExpenseModalFromQuickEntry = openExpenseModalFromQuickEntry;

function toggleQuickFoodEntry(force) {
    const panel = document.getElementById('quick-food-entry');
    if (!panel) return;
    const open = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !open;
    if (open) {
        syncQuickFoodEntryPeriod();
        populateQuickFoodSuggestions();
        if (!quickFoodRows.length) addQuickFoodRow({}, { focus: false });
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    initializeLucide();
}

function renderQuickFileList(containerId, files, removeFunctionName) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = files.map((file, index) => `
        <span class="quick-file-chip">
            <i data-lucide="paperclip" style="width:13px;height:13px;"></i>
            <span title="${escapeHTML(file.originalFileName)}">${escapeHTML(file.originalFileName)}</span>
            <button type="button" onclick="${removeFunctionName}(${index})" aria-label="ลบไฟล์ ${escapeHTML(file.originalFileName)}"><i data-lucide="x" style="width:13px;height:13px;"></i></button>
        </span>
    `).join('');
    initializeLucide();
}

function renderQuickExpenseRowFiles(rowId) {
    const row = getQuickExpenseRowElement(rowId);
    const container = row && row.querySelector('[data-role="file-list"]');
    const summary = row && row.querySelector('[data-role="extra-summary"]');
    const files = quickExpenseAttachmentsByRow[rowId] || [];
    if (!container) return;
    container.innerHTML = files.map((file, index) => `
        <span class="quick-file-chip">
            <i data-lucide="paperclip" style="width:13px;height:13px;"></i>
            <span title="${escapeHTML(file.originalFileName)}">${escapeHTML(file.originalFileName)}</span>
            <button type="button" onclick="removeQuickExpenseRowFile('${rowId}', ${index})" aria-label="ลบไฟล์ ${escapeHTML(file.originalFileName)}"><i data-lucide="x" style="width:13px;height:13px;"></i></button>
        </span>
    `).join('');
    if (summary) summary.textContent = files.length ? `หมายเหตุ / หลักฐาน (${files.length})` : 'หมายเหตุ / หลักฐาน';
    initializeLucide();
}

function renderQuickFoodRowFiles(rowId) {
    const row = getQuickFoodRowElement(rowId);
    const container = row && row.querySelector('[data-role="file-list"]');
    const summary = row && row.querySelector('[data-role="extra-summary"]');
    const files = quickFoodAttachmentsByRow[rowId] || [];
    if (!container) return;
    container.innerHTML = files.map((file, index) => `
        <span class="quick-file-chip">
            <i data-lucide="paperclip"></i>
            <span title="${escapeHTML(file.originalFileName)}">${escapeHTML(file.originalFileName)}</span>
            <button type="button" onclick="removeQuickFoodRowFile('${rowId}', ${index})" aria-label="ลบไฟล์ ${escapeHTML(file.originalFileName)}"><i data-lucide="x"></i></button>
        </span>
    `).join('');
    const draft = getQuickFoodRowDraft(rowId);
    if (summary) summary.textContent = `หน่วย: ${draft.unit}${files.length ? ` · หลักฐาน ${files.length}` : ''}`;
    updateQuickFoodBatchSummary();
    initializeLucide();
}

function removeQuickExpenseRowFile(rowId, index) {
    const files = quickExpenseAttachmentsByRow[rowId] || [];
    const removed = files.splice(index, 1)[0];
    if (removed && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    renderQuickExpenseRowFiles(rowId);
}

function removeQuickFoodRowFile(rowId, index) {
    const files = quickFoodAttachmentsByRow[rowId] || [];
    const removed = files.splice(index, 1)[0];
    if (removed && removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    renderQuickFoodRowFiles(rowId);
}

async function removeQuickFoodRow(rowId) {
    const row = getQuickFoodRowElement(rowId);
    if (!row) return;
    const draft = getQuickFoodRowDraft(rowId);
    if (!isQuickFoodDraftEmpty(draft)) {
        const confirmed = await appConfirm(
            `ต้องการลบแถว “${draft.name || 'รายการค่าอาหาร'}” หรือไม่?`,
            'ยืนยันลบแถว',
            { confirmButtonText: 'ลบแถว', cancelButtonText: 'ย้อนกลับ' }
        );
        if (!confirmed) return;
    }
    (quickFoodAttachmentsByRow[rowId] || []).forEach(item => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    delete quickFoodAttachmentsByRow[rowId];
    quickFoodRows = quickFoodRows.filter(id => id !== rowId);
    row.remove();
    if (!quickFoodRows.length) addQuickFoodRow({}, { focus: false });
    renumberQuickFoodRows();
}

async function prepareQuickAttachment(file) {
    await validateFile(file);
    let processedFile = file;
    const originalSize = file.size;
    let compressedSize = file.size;
    const maxImageBytes = Math.max(1, Number(state.maxUploadSizeMb) || 2) * 1024 * 1024;

    if (file.type.startsWith('image/') && file.size > maxImageBytes) {
        const compressed = await compressImage(file, Math.max(1, Number(state.maxUploadSizeMb) || 2));
        processedFile = compressed.file;
        compressedSize = processedFile.size;
    } else if (!file.type.startsWith('image/') && file.size > 10 * 1024 * 1024) {
        throw new Error('ไฟล์เอกสารต้องมีขนาดไม่เกิน 10MB');
    }

    const bytes = await processedFile.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const sha256Hash = Array.from(new Uint8Array(hashBuffer))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    return {
        file: processedFile,
        previewUrl: URL.createObjectURL(processedFile),
        originalFileName: file.name,
        originalSize,
        compressedSize,
        sha256Hash
    };
}

async function handleQuickExpenseRowFiles(rowId, event) {
    const files = Array.from((event.target && event.target.files) || []);
    if (!files.length) return;
    quickExpenseFileProcessingCount++;
    const errors = [];
    try {
        if (!quickExpenseAttachmentsByRow[rowId]) quickExpenseAttachmentsByRow[rowId] = [];
        for (const file of files) {
            try {
                quickExpenseAttachmentsByRow[rowId].push(await prepareQuickAttachment(file));
            } catch (error) {
                errors.push(`${file.name}: ${error.message}`);
            }
        }
        renderQuickExpenseRowFiles(rowId);
        if (errors.length) appAlert(`มีไฟล์ที่แนบไม่สำเร็จ:\n${errors.join('\n')}`, 'warning');
    } finally {
        quickExpenseFileProcessingCount = Math.max(0, quickExpenseFileProcessingCount - 1);
        if (event.target) event.target.value = '';
    }
}

async function handleQuickFoodRowFiles(rowId, event) {
    const files = Array.from((event.target && event.target.files) || []);
    if (!files.length) return;
    quickFoodFileProcessingCount += 1;
    const errors = [];
    try {
        if (!quickFoodAttachmentsByRow[rowId]) quickFoodAttachmentsByRow[rowId] = [];
        for (const file of files) {
            try {
                quickFoodAttachmentsByRow[rowId].push(await prepareQuickAttachment(file));
            } catch (error) {
                errors.push(`${file.name}: ${error.message}`);
            }
        }
        renderQuickFoodRowFiles(rowId);
        if (errors.length) appAlert(`มีไฟล์ที่แนบไม่สำเร็จ:\n${errors.join('\n')}`, 'warning');
    } finally {
        quickFoodFileProcessingCount = Math.max(0, quickFoodFileProcessingCount - 1);
        if (event.target) event.target.value = '';
    }
}

function fileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์หลักฐานได้'));
        reader.readAsDataURL(file);
    });
}

async function uploadQuickExpenseAttachments(expenseId, attachments = []) {
    const uploaded = [];
    const failed = [];
    for (const attachment of attachments) {
        try {
            const result = await apiCall('uploadAttachment', {
                expenseId,
                fileName: attachment.originalFileName,
                mimeType: attachment.file.type,
                base64Data: await fileAsBase64(attachment.file),
                originalSize: attachment.originalSize,
                compressedSize: attachment.compressedSize,
                sha256Hash: attachment.sha256Hash
            });
            const storedAttachment = {
                id: result.id,
                expenseId,
                originalFileName: attachment.originalFileName,
                fileName: result.fileName || attachment.originalFileName,
                fileType: attachment.file.type,
                fileSize: attachment.originalSize,
                compressedSize: attachment.compressedSize,
                sha256Hash: attachment.sha256Hash,
                driveFileId: result.driveFileId || '',
                fileUrl: result.viewUrl || '',
                viewUrl: result.viewUrl || ''
            };
            if (!attachmentStore[expenseId]) attachmentStore[expenseId] = [];
            const alreadyStored = attachmentStore[expenseId].some(item =>
                (storedAttachment.id && item.id === storedAttachment.id) ||
                (storedAttachment.sha256Hash && item.sha256Hash === storedAttachment.sha256Hash)
            );
            if (!alreadyStored) attachmentStore[expenseId].push(storedAttachment);
            uploaded.push({ attachment, storedAttachment });
        } catch (error) {
            failed.push({ attachment, error });
        }
    }
    if (uploaded.length) saveAttachments();
    return { uploaded, failed };
}

async function retryQuickExpenseRowAttachments(rowId) {
    const row = getQuickExpenseRowElement(rowId);
    const expenseId = row && row.dataset.expenseId;
    const attachments = (quickExpenseAttachmentsByRow[rowId] || []).map(item => ({ ...item }));
    if (!row || !expenseId || attachments.length === 0) return;

    const retryButton = row.querySelector('[data-row-retry-attachments]');
    if (retryButton) retryButton.disabled = true;
    setQuickExpenseRowStatus(rowId, 'กำลังอัปโหลดหลักฐานอีกครั้ง...', 'saving');
    try {
        const result = await uploadQuickExpenseAttachments(expenseId, attachments);
        result.uploaded.forEach(item => {
            if (item.attachment.previewUrl) URL.revokeObjectURL(item.attachment.previewUrl);
        });
        quickExpenseAttachmentsByRow[rowId] = result.failed.map(item => item.attachment);
        renderQuickExpenseRowFiles(rowId);
        row.classList.remove('is-saving');
        row.classList.toggle('has-error', result.failed.length > 0);
        const status = row.querySelector('[data-role="row-status"]');
        if (status) status.textContent = result.failed.length
            ? `บันทึกแล้ว · แนบไฟล์ไม่สำเร็จ ${result.failed.length} ไฟล์`
            : 'บันทึกแล้ว · แนบหลักฐานครบถ้วน';
        if (retryButton) {
            retryButton.hidden = result.failed.length === 0;
            retryButton.disabled = result.failed.length === 0;
        }
        renderAll();
        appAlert(result.failed.length ? 'ยังมีหลักฐานบางไฟล์อัปโหลดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' : 'อัปโหลดหลักฐานครบถ้วนแล้ว', result.failed.length ? 'warning' : 'success');
    } catch (error) {
        setQuickExpenseRowStatus(rowId, `อัปโหลดหลักฐานไม่สำเร็จ: ${error.message}`, 'error');
        if (retryButton) retryButton.disabled = false;
    }
}
window.retryQuickExpenseRowAttachments = retryQuickExpenseRowAttachments;

async function uploadQuickFoodAttachments(foodExpenseItemId, attachments = []) {
    const uploaded = [];
    const failed = [];
    for (const attachment of attachments) {
        try {
            await apiCall('uploadFoodAttachment', {
                foodExpenseItemId,
                fileName: attachment.originalFileName,
                mimeType: attachment.file.type,
                base64Data: await fileAsBase64(attachment.file),
                originalSize: attachment.originalSize,
                compressedSize: attachment.compressedSize,
                sha256Hash: attachment.sha256Hash
            });
            uploaded.push(attachment);
        } catch (error) {
            failed.push({ attachment, error });
        }
    }
    return { uploaded, failed };
}

function upsertExpenseRecord(expense) {
    if (!expense || !expense.id) return;
    const index = state.expenses.findIndex(row => row.id === expense.id);
    if (index >= 0) state.expenses[index] = expense;
    else state.expenses.unshift(expense);
}

function upsertFoodRecord(foodExpense) {
    if (!foodExpense || !foodExpense.id) return;
    const index = state.foodExpenses.findIndex(row => row.id === foodExpense.id);
    if (index >= 0) state.foodExpenses[index] = foodExpense;
    else state.foodExpenses.unshift(foodExpense);
}

function clearMonthlyRecordFilters() {
    const search = document.getElementById('filter-search');
    const project = document.getElementById('filter-project');
    if (search) search.value = '';
    if (project) project.value = 'all';
}

function isQuickExpenseDraftEmpty(draft) {
    return !draft.receiptNo && !draft.vendorName && !draft.description && !draft.unitPrice &&
        !draft.note && draft.attachments.length === 0 && draft.multiItems.length === 0;
}

function validateQuickExpenseDraft(draft, rowNumber) {
    const missing = [];
    if (!draft.organizationId) missing.push('หน่วยงาน');
    if (!draft.documentPrefix) missing.push('รหัสผู้ออกบิล');
    if (!/^\d{4}-\d{2}$/.test(draft.postingMonth)) missing.push('รอบบันทึก');
    if (quickExpenseEntryMode === 'EXP' && !draft.receiptNo) missing.push('เลขที่ใบเสร็จ');
    if (!draft.expenseDate) missing.push('วันที่บิล');
    if (!draft.vendorName) missing.push('ร้านค้า/ผู้ขาย');
    if (!draft.description) missing.push('รายละเอียด');
    if (draft.quantity <= 0) missing.push('จำนวน');
    if (!draft.unit) missing.push('หน่วย');
    if (draft.unitPrice <= 0) missing.push('ราคา/หน่วย');
    if (state.requireAttachment && draft.attachments.length === 0) missing.push('หลักฐาน');
    return missing.length ? `แถว ${rowNumber}: ${missing.join(', ')}` : '';
}

function normalizeImportHeader(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s_\-\/().]+/g, '');
}

function getImportedValue(source, aliases) {
    const normalized = new Map(Object.entries(source || {}).map(([key, value]) => [normalizeImportHeader(key), value]));
    for (const alias of aliases) {
        const key = normalizeImportHeader(alias);
        if (normalized.has(key)) return normalized.get(key);
    }
    return '';
}

function normalizeImportedDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }
    if (typeof value === 'number' && window.XLSX && XLSX.SSF && XLSX.SSF.parse_date_code) {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parts = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (parts) {
        let year = Number(parts[3]);
        if (year > 2400) year -= 543;
        const first = Number(parts[1]);
        const second = Number(parts[2]);
        const month = first > 12 ? second : first;
        const day = first > 12 ? first : second;
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return '';
}

function createImportTemplateDate(dateValue) {
    const parts = getSystemDateParts(dateValue);
    return parts ? new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0) : '';
}

function normalizeImportedPostingMonth(value) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}$/.test(text)) return text;
    const date = normalizeImportedDate(value);
    return date ? date.slice(0, 7) : '';
}

function normalizeImportedClaimable(value) {
    const text = String(value == null ? '' : value).trim().toLowerCase();
    return !['false', '0', 'no', 'ไม่', 'ไม่เบิก', 'ไม่เบิกมูลนิธิ', 'non-claimable'].includes(text);
}

function getQuickImportTemplateRows(type) {
    const postingMonth = getSelectedPostingMonth();
    if (type === 'FOOD') {
        return [{
            'รอบบันทึก': postingMonth,
            'หมวดหมู่': String((document.getElementById('quick-food-category') || {}).value || 'อาหารประจำเดือน'),
            'วันที่ซื้อ (เดือน-วัน-ปี)': createImportTemplateDate(getSelectedMonthDefaultDateStr()),
            'รายการ': 'ตัวอย่างวัตถุดิบอาหาร',
            'จำนวน': 1,
            'หน่วย': 'รายการ',
            'ราคา/หน่วย': 100
        }];
    }
    const projectId = String((document.getElementById('inline-exp-project') || {}).value || getQuickDefaultProjectId());
    const documentPrefix = getQuickExpenseSharedBillingCode();
    return [{
        'รอบบันทึก': String((document.getElementById('inline-exp-posting-month') || {}).value || postingMonth),
        'รหัสผู้ออกบิล': documentPrefix,
        'โครงการ': getProjectName(projectId),
        'หมวดหมู่': String((document.getElementById('inline-exp-category-input') || {}).value || 'ค่าสาธารณูปโภค'),
        'แหล่งเงิน': String((document.getElementById('inline-exp-fund-input') || {}).value || ''),
        'ประเภท': (document.getElementById('inline-exp-claimable') || {}).value === 'false' ? 'ไม่เบิกมูลนิธิ' : 'เบิกมูลนิธิ',
        'เลขที่ใบเสร็จ': quickExpenseEntryMode === 'ATT' ? '' : 'เล่ม 1 / เลขที่ 001',
        'วันที่บิล (เดือน-วัน-ปี)': createImportTemplateDate(getSelectedMonthDefaultDateStr()),
        'ร้านค้า/ผู้ขาย': quickExpenseEntryMode === 'ATT' ? 'ผู้ให้บริการสาธารณูปโภค' : 'ร้านค้าตัวอย่าง',
        'รายละเอียด': quickExpenseEntryMode === 'ATT' ? 'ค่าไฟฟ้าประจำเดือน' : 'รายการตัวอย่าง',
        'จำนวน': 1,
        'หน่วย': 'รายการ',
        'ราคา/หน่วย': 100,
        'หมายเหตุ': ''
    }];
}

async function downloadQuickImportTemplate(type) {
    const importType = type === 'FOOD' ? 'FOOD' : quickExpenseEntryMode;
    const rows = getQuickImportTemplateRows(importType);
    try {
        await ensureSpreadsheetLib('กำลังสร้างไฟล์แม่แบบ...');
        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.json_to_sheet(rows, { cellDates: true });
        worksheet['!cols'] = Object.keys(rows[0]).map(key => ({ wch: Math.max(14, key.length + 6) }));
        const dateHeader = importType === 'FOOD' ? 'วันที่ซื้อ (เดือน-วัน-ปี)' : 'วันที่บิล (เดือน-วัน-ปี)';
        const dateColumnIndex = Object.keys(rows[0]).indexOf(dateHeader);
        const dateCell = dateColumnIndex >= 0 ? worksheet[XLSX.utils.encode_cell({ r: 1, c: dateColumnIndex })] : null;
        if (dateCell) dateCell.z = 'mm-dd-yyyy';
        XLSX.utils.book_append_sheet(workbook, worksheet, importType === 'FOOD' ? 'ค่าอาหาร' : importType === 'ATT' ? 'บิลแนบ' : 'บิลประจำเดือน');
        XLSX.writeFile(workbook, `RDF_${importType}_IMPORT_TEMPLATE.xlsx`);
    } catch (error) {
        appAlert('สร้างไฟล์แม่แบบไม่สำเร็จ: ' + (error.message || error), 'error');
    }
}
window.downloadQuickImportTemplate = downloadQuickImportTemplate;

function parseSimpleCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const input = String(text || '').replace(/^\uFEFF/, '');
    for (let index = 0; index < input.length; index++) {
        const char = input[index];
        if (quoted && char === '"' && input[index + 1] === '"') {
            cell += '"';
            index++;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === ',' && !quoted) {
            row.push(cell);
            cell = '';
        } else if ((char === '\n' || char === '\r') && !quoted) {
            if (char === '\r' && input[index + 1] === '\n') index++;
            row.push(cell);
            if (row.some(value => String(value).trim())) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }
    row.push(cell);
    if (row.some(value => String(value).trim())) rows.push(row);
    if (rows.length < 2) return [];
    const headers = rows[0].map(value => String(value).trim());
    return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

async function readQuickImportFile(file) {
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    if (extension === 'csv') return parseSimpleCsv(await file.text());
    await ensureSpreadsheetLib('กำลังอ่านไฟล์นำเข้า...');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return [];
    return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '', raw: true });
}

function isQuickImportHeaderRow(source, type) {
    const values = Object.values(source || {})
        .map(normalizeImportHeader)
        .filter(Boolean);
    if (!values.length) return false;
    const expectedHeaders = type === 'FOOD'
        ? ['รอบบันทึก', 'หมวดหมู่', 'วันที่ซื้อ (เดือน-วัน-ปี)', 'รายการ', 'จำนวน', 'หน่วย', 'ราคา/หน่วย']
        : ['รอบบันทึก', 'รหัสผู้ออกบิล', 'โครงการ', 'หมวดหมู่', 'แหล่งเงิน', 'ประเภท', 'เลขที่ใบเสร็จ', 'วันที่บิล (เดือน-วัน-ปี)', 'ร้านค้า/ผู้ขาย', 'รายละเอียด', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'หมายเหตุ'];
    const expected = new Set(expectedHeaders.map(normalizeImportHeader));
    const matchCount = values.filter(value => expected.has(value)).length;
    return matchCount >= 4;
}

function mapQuickImportRows(rawRows, type) {
    return (rawRows || []).flatMap((source, index) => {
        // XLSX normally consumes the first worksheet row as column names. This
        // guard also ignores a repeated header copied into the data area.
        if (isQuickImportHeaderRow(source, type)) return [];
        const common = {
            postingMonth: normalizeImportedPostingMonth(getImportedValue(source, ['รอบบันทึก', 'postingMonth', 'month'])),
            documentPrefix: String(getImportedValue(source, ['รหัสผู้ออกบิล', 'documentPrefix', 'prefix']) || '').trim().toUpperCase(),
            project: String(getImportedValue(source, ['โครงการ', 'project']) || '').trim(),
            category: String(getImportedValue(source, ['หมวดหมู่', 'category']) || '').trim(),
            fundSource: String(getImportedValue(source, ['แหล่งเงิน', 'fundSource', 'fund']) || '').trim(),
            claimable: normalizeImportedClaimable(getImportedValue(source, ['ประเภท', 'claimable', 'claimType']))
        };
        const row = type === 'FOOD' ? {
            expenseDate: normalizeImportedDate(getImportedValue(source, ['วันที่ซื้อ (เดือน-วัน-ปี)', 'วันที่ซื้อ', 'วันที่', 'expenseDate', 'date'])),
            name: String(getImportedValue(source, ['รายการ', 'ชื่อรายการ', 'name', 'ingredientName']) || '').trim(),
            quantity: Number(getImportedValue(source, ['จำนวน', 'quantity', 'qty'])) || 0,
            unit: String(getImportedValue(source, ['หน่วย', 'unit']) || 'รายการ').trim() || 'รายการ',
            unitPrice: Number(getImportedValue(source, ['ราคา/หน่วย', 'ราคาต่อหน่วย', 'unitPrice', 'price'])) || 0
        } : {
            receiptNo: String(getImportedValue(source, ['เลขที่ใบเสร็จ', 'เล่มที่/เลขที่ใบเสร็จ', 'receiptNo', 'receipt']) || '').trim(),
            expenseDate: normalizeImportedDate(getImportedValue(source, ['วันที่บิล (เดือน-วัน-ปี)', 'วันที่บิล', 'วันที่', 'expenseDate', 'date'])),
            vendorName: String(getImportedValue(source, ['ร้านค้า/ผู้ขาย', 'ผู้ขาย', 'vendorName', 'vendor']) || '').trim(),
            description: String(getImportedValue(source, ['รายละเอียด', 'รายการ', 'description']) || '').trim(),
            quantity: Number(getImportedValue(source, ['จำนวน', 'quantity', 'qty'])) || 0,
            unit: String(getImportedValue(source, ['หน่วย', 'unit']) || 'รายการ').trim() || 'รายการ',
            unitPrice: Number(getImportedValue(source, ['ราคา/หน่วย', 'ราคาต่อหน่วย', 'unitPrice', 'price'])) || 0,
            note: String(getImportedValue(source, ['หมายเหตุ', 'note']) || '').trim(),
            postingMonth: common.postingMonth,
            documentPrefix: common.documentPrefix
        };
        const errors = [];
        if (!row.expenseDate) errors.push(type === 'FOOD' ? 'วันที่ซื้อไม่ถูกต้อง' : 'วันที่บิลไม่ถูกต้อง');
        if (type === 'FOOD' && !row.name) errors.push('ไม่พบชื่อรายการ');
        if (type !== 'FOOD' && !row.description) errors.push('ไม่พบรายละเอียด');
        if (type === 'EXP' && !row.receiptNo) errors.push('ไม่พบเลขที่ใบเสร็จ');
        if (type !== 'FOOD' && !row.vendorName) errors.push('ไม่พบร้านค้า/ผู้ขาย');
        if (row.quantity <= 0) errors.push('จำนวนต้องมากกว่า 0');
        if (row.unitPrice <= 0) errors.push('ราคา/หน่วยต้องมากกว่า 0');
        return [{ sourceRow: index + 2, common, row, errors }];
    });
}

function sortQuickImportRowsByDate(rows) {
    return [...(rows || [])].sort((left, right) => {
        const leftDate = String((left.row || {}).expenseDate || '9999-12-31');
        const rightDate = String((right.row || {}).expenseDate || '9999-12-31');
        return leftDate.localeCompare(rightDate) || Number(left.sourceRow || 0) - Number(right.sourceRow || 0);
    });
}

function renderQuickImportPreview() {
    const preview = quickImportPreview;
    const modal = document.getElementById('modal-quick-import');
    if (!preview || !modal) return;
    const isFood = preview.type === 'FOOD';
    const headers = isFood
        ? ['แถว', 'วันที่ซื้อ', 'รายการ', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'รวม', 'สถานะ']
        : ['แถว', 'เลขที่ใบเสร็จ', 'วันที่บิล', 'ร้านค้า/ผู้ขาย', 'รายละเอียด', 'จำนวน', 'หน่วย', 'ราคา/หน่วย', 'รวม', 'สถานะ'];
    const table = document.getElementById('quick-import-preview-table');
    const thead = table && table.querySelector('thead');
    const tbody = table && table.querySelector('tbody');
    if (thead) thead.innerHTML = `<tr>${headers.map(label => `<th>${escapeHTML(label)}</th>`).join('')}</tr>`;
    if (tbody) tbody.innerHTML = preview.rows.map(item => {
        const row = item.row;
        const cells = isFood
            ? [item.sourceRow, formatSystemDate(row.expenseDate), row.name, row.quantity, row.unit, row.unitPrice.toFixed(2), (row.quantity * row.unitPrice).toFixed(2)]
            : [item.sourceRow, row.receiptNo || '-', formatSystemDate(row.expenseDate), row.vendorName, row.description, row.quantity, row.unit, row.unitPrice.toFixed(2), (row.quantity * row.unitPrice).toFixed(2)];
        return `<tr class="${item.errors.length ? 'has-error' : 'is-valid'}">${cells.map(value => `<td>${escapeHTML(String(value))}</td>`).join('')}<td>${item.errors.length ? `<span class="text-danger">${escapeHTML(item.errors.join(' · '))}</span>` : '<span class="badge badge-claimable">พร้อมนำเข้า</span>'}</td></tr>`;
    }).join('');
    const validCount = preview.rows.filter(item => !item.errors.length).length;
    const errorCount = preview.rows.length - validCount;
    const summary = document.getElementById('quick-import-summary');
    if (summary) summary.innerHTML = `<strong>${escapeHTML(preview.fileName)}</strong><span>ทั้งหมด ${preview.rows.length} รายการ · พร้อมนำเข้า ${validCount} · มีข้อผิดพลาด ${errorCount}</span>`;
    const errors = document.getElementById('quick-import-errors');
    if (errors) {
        errors.hidden = errorCount === 0;
        errors.textContent = errorCount ? 'กรุณาแก้ไขข้อมูลในไฟล์แล้วอัปโหลดใหม่ ระบบจะไม่บันทึกจนกว่าทุกรายการจะถูกต้อง' : '';
    }
    const confirm = document.getElementById('quick-import-confirm');
    if (confirm) confirm.disabled = preview.rows.length === 0 || errorCount > 0;
    const subtitle = document.getElementById('quick-import-subtitle');
    if (subtitle) subtitle.textContent = `ตัวอย่างก่อนยืนยัน · ${isFood ? 'ค่าอาหารประจำเดือน' : preview.type === 'ATT' ? 'บิลแนบ / ค่าสาธารณูปโภค' : 'รายการบิลประจำเดือน'}`;
    modal.classList.add('active');
    initializeLucide();
}

async function handleQuickTableImport(event, requestedType) {
    const input = event && event.target;
    const file = input && input.files && input.files[0];
    if (!file) return;
    const type = requestedType === 'FOOD' ? 'FOOD' : quickExpenseEntryMode;
    showLoading(true);
    try {
        const extension = String(file.name || '').split('.').pop().toLowerCase();
        if (!['csv', 'xlsx', 'xls'].includes(extension)) throw new Error('รองรับเฉพาะไฟล์ CSV, XLSX และ XLS');
        if (file.size > 10 * 1024 * 1024) throw new Error('ไฟล์นำเข้าต้องมีขนาดไม่เกิน 10MB');
        const rawRows = await readQuickImportFile(file);
        if (rawRows.length > 1000) throw new Error('ไฟล์หนึ่งครั้งรองรับไม่เกิน 1,000 รายการ');
        const mappedRows = mapQuickImportRows(rawRows, type);
        const rows = type === 'FOOD' ? sortQuickImportRowsByDate(mappedRows) : mappedRows;
        if (!rows.length) throw new Error('ไม่พบแถวข้อมูล กรุณาใช้ไฟล์แม่แบบของระบบ');
        const firstCommon = rows[0].common;
        rows.forEach(item => {
            ['postingMonth', 'documentPrefix', 'project', 'category', 'fundSource', 'claimable'].forEach(field => {
                if (field === 'documentPrefix' && type === 'FOOD') return;
                const current = item.common[field];
                const expected = firstCommon[field];
                if (current !== '' && expected !== '' && String(current) !== String(expected)) {
                    item.errors.push(`ข้อมูลร่วม “${field}” ต้องเหมือนกันทุกแถว`);
                }
            });
        });
        quickImportPreview = { type, fileName: file.name, rows, common: firstCommon };
        renderQuickImportPreview();
    } catch (error) {
        appAlert('อ่านไฟล์นำเข้าไม่สำเร็จ: ' + (error.message || error), 'error');
    } finally {
        showLoading(false);
        if (input) input.value = '';
    }
}
window.handleQuickTableImport = handleQuickTableImport;

function closeQuickImportPreview() {
    const modal = document.getElementById('modal-quick-import');
    if (modal) modal.classList.remove('active');
    setBatchUploadProgress('quick-import', 0, 0, { hidden: true });
    quickImportPreview = null;
}
window.closeQuickImportPreview = closeQuickImportPreview;

function setImportedExpenseCommonValues(common = {}) {
    const setValue = (id, value) => {
        const element = document.getElementById(id);
        if (element && value !== undefined && value !== null && value !== '') element.value = value;
    };
    if (common.postingMonth) {
        setValue('inline-exp-posting-month', common.postingMonth);
        const monthInput = document.getElementById('inline-exp-posting-month');
        if (monthInput) monthInput.dataset.autoPeriod = 'false';
    }
    if (common.documentPrefix) {
        setValue('inline-exp-billing-profile', common.documentPrefix);
        onQuickExpenseBillingProfileChange(common.documentPrefix);
    }
    if (common.project) {
        const project = (state.projects || []).find(item => String(item.id) === common.project || normalizeMasterName(item.name) === normalizeMasterName(common.project));
        if (project) setValue('inline-exp-project', project.id);
    }
    if (common.category) {
        const category = findMasterByName(state.categories || [], common.category);
        setValue('inline-exp-category', category ? category.id : '');
        setValue('inline-exp-category-input', common.category);
    }
    if (common.fundSource) {
        const fund = findMasterByName(state.fundSources || [], common.fundSource);
        setValue('inline-exp-fund', fund ? fund.id : '');
        setValue('inline-exp-fund-input', common.fundSource);
    }
    setValue('inline-exp-claimable', common.claimable === false ? 'false' : 'true');
}

function removeEmptyQuickFoodRowsBeforeImport() {
    const emptyRowIds = quickFoodRows.filter(rowId => isQuickFoodDraftEmpty(getQuickFoodRowDraft(rowId)));
    if (!emptyRowIds.length) return;
    const emptyRowIdSet = new Set(emptyRowIds);
    emptyRowIds.forEach(rowId => {
        const row = getQuickFoodRowElement(rowId);
        if (row) row.remove();
        delete quickFoodAttachmentsByRow[rowId];
    });
    quickFoodRows = quickFoodRows.filter(rowId => !emptyRowIdSet.has(rowId));
}

function setBatchUploadProgress(prefix, completed, total, options = {}) {
    const container = document.getElementById(`${prefix}-progress`);
    if (!container) return;
    if (options.hidden || total <= 0) {
        container.hidden = true;
        return;
    }
    const safeTotal = Math.max(1, Number(total) || 1);
    const safeCompleted = Math.min(safeTotal, Math.max(0, Number(completed) || 0));
    const percent = Math.round((safeCompleted / safeTotal) * 100);
    const label = document.getElementById(`${prefix}-progress-label`);
    const count = document.getElementById(`${prefix}-progress-count`);
    const track = document.getElementById(`${prefix}-progress-track`);
    const bar = document.getElementById(`${prefix}-progress-bar`);
    container.hidden = false;
    container.classList.toggle('is-success', options.state === 'success');
    container.classList.toggle('is-warning', options.state === 'warning');
    if (label && options.label) label.textContent = options.label;
    if (count) count.textContent = `${safeCompleted}/${safeTotal}`;
    if (bar) bar.style.width = `${percent}%`;
    if (track) {
        track.setAttribute('aria-valuemax', String(safeTotal));
        track.setAttribute('aria-valuenow', String(safeCompleted));
        track.setAttribute('aria-valuetext', `${safeCompleted} จาก ${safeTotal} รายการ`);
    }
}

function waitForNextPaint() {
    return new Promise(resolve => {
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve());
        else window.setTimeout(resolve, 0);
    });
}

async function confirmQuickTableImport() {
    const preview = quickImportPreview;
    if (!preview || !preview.rows.length || preview.rows.some(item => item.errors.length)) return;
    const confirmButton = document.getElementById('quick-import-confirm');
    const total = preview.rows.length;
    const paintEvery = Math.max(1, Math.ceil(total / 50));
    if (confirmButton) confirmButton.disabled = true;
    setBatchUploadProgress('quick-import', 0, total, { label: 'กำลังเพิ่มรายการจากไฟล์ลงตาราง' });
    try {
        if (preview.type === 'FOOD') {
            const postingMonth = preview.common.postingMonth || getSelectedPostingMonth();
            const category = preview.common.category || 'อาหารประจำเดือน';
            const postingInput = document.getElementById('quick-food-posting-month');
            const categoryInput = document.getElementById('quick-food-category');
            if (postingInput) postingInput.value = postingMonth;
            if (categoryInput) categoryInput.value = category;
            removeEmptyQuickFoodRowsBeforeImport();
        } else {
            if (quickExpenseEntryMode !== preview.type) setQuickExpenseEntryMode(preview.type);
            setImportedExpenseCommonValues(preview.common);
        }
        for (let index = 0; index < preview.rows.length; index++) {
            const item = preview.rows[index];
            if (preview.type === 'FOOD') addQuickFoodRow(item.row, { focus: false });
            else addQuickExpenseRow(item.row, { focus: false });
            const completed = index + 1;
            setBatchUploadProgress('quick-import', completed, total, { label: 'กำลังเพิ่มรายการจากไฟล์ลงตาราง' });
            if (completed % paintEvery === 0 || completed === total) await waitForNextPaint();
        }
        if (preview.type === 'FOOD') {
            renumberQuickFoodRows();
        } else {
            refreshQuickExpenseDocumentPreviews();
            scheduleQuickExpenseDraftSave();
        }
        setBatchUploadProgress('quick-import', total, total, { label: 'เพิ่มรายการจากไฟล์ครบแล้ว', state: 'success' });
        await new Promise(resolve => window.setTimeout(resolve, 350));
        closeQuickImportPreview();
        appAlert(`เพิ่มข้อมูลจากไฟล์ลงตารางแล้ว ${total} รายการ กรุณาตรวจสอบอีกครั้งก่อนกดบันทึกทั้งหมด`, 'success');
    } catch (error) {
        setBatchUploadProgress('quick-import', 0, total, { label: 'เพิ่มรายการจากไฟล์ไม่สำเร็จ', state: 'warning' });
        if (confirmButton) confirmButton.disabled = false;
        appAlert('เพิ่มข้อมูลจากไฟล์ลงตารางไม่สำเร็จ: ' + (error.message || error), 'error');
    }
}
window.confirmQuickTableImport = confirmQuickTableImport;

async function submitQuickExpenseBatch(event) {
    event.preventDefault();
    const form = event.currentTarget || document.getElementById('quick-expense-form');
    if (form && form.getAttribute('aria-busy') === 'true') return;
    if (quickExpenseFileProcessingCount > 0) {
        appAlert('กำลังเตรียมไฟล์หลักฐาน กรุณารอสักครู่', 'info');
        return;
    }

    const projectId = (document.getElementById('inline-exp-project') || {}).value || '';
    const claimable = (document.getElementById('inline-exp-claimable') || {}).value === 'true';

    if (!projectId) {
        return appAlert('กรุณาระบุโครงการในส่วนข้อมูลสำคัญให้ครบถ้วน', 'error');
    }

    const drafts = quickExpenseRows
        .map((rowId, index) => ({ rowId, rowNumber: index + 1, row: getQuickExpenseRowElement(rowId) }))
        .filter(item => item.row && item.row.dataset.saved !== 'true')
        .map(item => ({ ...item, draft: getQuickExpenseRowDraft(item.rowId) }))
        .filter(item => !isQuickExpenseDraftEmpty(item.draft));
    if (!drafts.length) {
        const failedInlineRowIds = quickExpenseRows.filter(rowId => {
            const row = getQuickExpenseRowElement(rowId);
            return row && row.dataset.saved === 'true' && row.dataset.inlineSaveError === 'true';
        });
        if (failedInlineRowIds.length) {
            showQuickExpenseTableValidation(
                `กำลังลองบันทึกการแก้ไขอีกครั้ง ${failedInlineRowIds.length} รายการ`,
                failedInlineRowIds,
                'warning'
            );
            showLoading(true);
            const failedAgain = [];
            try {
                for (const rowId of failedInlineRowIds) {
                    const saved = await saveQuickExpenseInlineEdit(rowId);
                    if (!saved) failedAgain.push(rowId);
                }
            } finally {
                showLoading(false);
            }
            if (failedAgain.length) {
                showQuickExpenseTableValidation(
                    `บันทึกการแก้ไขไม่สำเร็จ ${failedAgain.length} รายการ กรุณาตรวจสอบการเชื่อมต่อแล้วกดบันทึกอีกครั้ง`,
                    failedAgain,
                    'error'
                );
                return appAlert('บันทึกการแก้ไขยังไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง', 'error');
            }
            clearQuickExpenseTableValidation();
            return appAlert('บันทึกการแก้ไขเรียบร้อยแล้ว', 'success');
        }

        const hasSavedRows = quickExpenseRows.some(rowId => {
            const row = getQuickExpenseRowElement(rowId);
            return row && row.dataset.saved === 'true';
        });
        if (hasSavedRows) {
            showQuickExpenseTableValidation('ไม่มีรายการใหม่ที่รอบันทึก หากต้องการเพิ่มให้กรอกข้อมูลในแถวว่าง', [], 'warning');
            return appAlert('ไม่มีรายการใหม่ที่รอบันทึก', 'info');
        }

        const firstPendingRowId = quickExpenseRows.find(rowId => {
            const row = getQuickExpenseRowElement(rowId);
            return row && row.dataset.saved !== 'true';
        });
        showQuickExpenseTableValidation(
            'กรุณากรอกข้อมูลใบเสร็จอย่างน้อย 1 รายการ',
            firstPendingRowId ? [firstPendingRowId] : [],
            'warning'
        );
        return appAlert('กรุณากรอกข้อมูลใบเสร็จอย่างน้อย 1 รายการ', 'warning');
    }

    const validationErrors = [];
    const validationRowIds = [];
    drafts.forEach(item => {
        const validationError = validateQuickExpenseDraft(item.draft, item.rowNumber);
        if (validationError) {
            validationErrors.push(validationError);
            validationRowIds.push(item.rowId);
            setQuickExpenseRowStatus(item.rowId, 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ', 'error');
        }
    });
    if (validationErrors.length) {
        showQuickExpenseTableValidation(
            `กรุณากรอกข้อมูลให้ครบถ้วน: ${validationErrors.join(' · ')}`,
            validationRowIds,
            'error'
        );
        return appAlert(`กรุณากรอกข้อมูลให้ครบถ้วน\n${validationErrors.join('\n')}`, 'error');
    }

    clearQuickExpenseTableValidation();

    setFormControlsBusy(form, true);
    showLoading(true);
    const savedRows = [];
    const failedRows = [];
    let attachmentErrorCount = 0;
    try {
        const categoryId = await resolveExpenseMasterSelection('category', 'inline-exp');
        const fundSourceId = await resolveExpenseMasterSelection('fundSource', 'inline-exp');

        for (const item of drafts) {
            setQuickExpenseRowStatus(item.rowId, 'กำลังบันทึก...', 'saving');
            try {
                const vendorId = await resolveExpenseMasterName('vendor', item.draft.vendorName);
                const payload = {
                    idPrefix: quickExpenseEntryMode,
                    requestId: item.draft.requestId,
                    receiptNo: item.draft.receiptNo,
                    expenseDate: item.draft.expenseDate,
                    postingMonth: item.draft.postingMonth,
                    organizationId: item.draft.organizationId,
                    documentPrefix: item.draft.documentPrefix,
                    projectId,
                    categoryId,
                    fundSourceId,
                    vendorId,
                    description: item.draft.description,
                    quantity: item.draft.quantity,
                    unit: item.draft.unit,
                    unitPrice: item.draft.unitPrice,
                    claimable,
                    note: formatNoteData(item.draft.note, {}, item.draft.multiItems)
                };
                const result = await apiCall('createExpense', payload, null, null, {
                    onStatus: detail => {
                        if (detail.status === 'retrying') {
                            setQuickExpenseRowStatus(item.rowId, `การเชื่อมต่อสะดุด · กำลังส่งซ้ำ ${detail.attempt}/${detail.maxAttempts}`, 'saving');
                        } else if (detail.status === 'sending') {
                            setQuickExpenseRowStatus(item.rowId, `กำลังบันทึก ${detail.attempt}/${detail.maxAttempts}`, 'saving');
                        }
                    }
                });
                const savedExpense = result.expense || {
                    id: result.id,
                    documentNo: result.documentNo,
                    ...payload,
                    amount: item.draft.amount,
                    totalAmount: item.draft.amount,
                    status: 'draft'
                };
                upsertQuickExpenseRecord(savedExpense);
                const attachmentResult = result.id
                    ? await uploadQuickExpenseAttachments(result.id, item.draft.attachments)
                    : { uploaded: [], failed: [] };
                attachmentResult.uploaded.forEach(uploaded => {
                    if (uploaded.attachment.previewUrl) URL.revokeObjectURL(uploaded.attachment.previewUrl);
                });
                quickExpenseAttachmentsByRow[item.rowId] = attachmentResult.failed.map(failure => failure.attachment);
                renderQuickExpenseRowFiles(item.rowId);
                attachmentErrorCount += attachmentResult.failed.length;
                markQuickExpenseRowSaved(
                    item.rowId,
                    savedExpense.documentNo || result.documentNo,
                    attachmentResult.failed.length,
                    result.id
                );
                savedRows.push({
                    receiptNo: item.draft.receiptNo,
                    documentNo: savedExpense.documentNo || result.documentNo || '-',
                    expense: savedExpense
                });
            } catch (error) {
                failedRows.push({ rowNumber: item.rowNumber, error });
                setQuickExpenseRowStatus(item.rowId, `บันทึกไม่สำเร็จ: ${error.message}`, 'error');
            }
        }

        if (savedRows.length) {
            if (!quickExpenseRows.some(rowId => {
                const row = getQuickExpenseRowElement(rowId);
                return row && row.dataset.saved !== 'true' && isQuickExpenseDraftEmpty(getQuickExpenseRowDraft(rowId));
            })) addQuickExpenseRow();
            try {
                await refreshExpenseRecordsForSelectedMonth();
            } catch (refreshError) {
                console.warn('Batch expenses saved but list refresh failed:', refreshError);
                savedRows.forEach(item => {
                    if (getExpensePostingMonth(item.expense) === getSelectedPostingMonth()) upsertQuickExpenseRecord(item.expense);
                });
            }
            clearMonthlyRecordFilters();
            renderAll();
        }

        const references = savedRows.map(item => item.receiptNo ? `${item.receiptNo} → ${item.documentNo}` : item.documentNo).join('\n');
        const failedSummary = failedRows.map(item => `แถว ${item.rowNumber}: ${item.error.message}`).join('\n');
        const message = [
            savedRows.length ? `บันทึกสำเร็จ ${savedRows.length} รายการ\n${references}` : '',
            attachmentErrorCount ? `หลักฐานอัปโหลดไม่สำเร็จ ${attachmentErrorCount} ไฟล์` : '',
            failedRows.length ? `บันทึกไม่สำเร็จ ${failedRows.length} รายการ\n${failedSummary}` : ''
        ].filter(Boolean).join('\n\n');
        appAlert(message, failedRows.length || attachmentErrorCount ? 'warning' : 'success');
    } catch (error) {
        appAlert('ไม่สามารถเริ่มบันทึกรายการได้: ' + error.message, 'error');
    } finally {
        showLoading(false);
        setFormControlsBusy(form, false);
    }
}
window.submitQuickExpenseBatch = submitQuickExpenseBatch;

async function submitQuickExpense(event) {
    return submitQuickExpenseBatch(event);
}

async function submitQuickFoodEntry(event) {
    event.preventDefault();
    const form = event.currentTarget || document.getElementById('quick-food-form');
    if (form && form.getAttribute('aria-busy') === 'true') return;
    if (quickFoodFileProcessingCount > 0) {
        appAlert('กำลังเตรียมไฟล์หลักฐาน กรุณารอสักครู่', 'info');
        return;
    }

    const postingMonth = (document.getElementById('quick-food-posting-month') || {}).value || '';
    const category = String((document.getElementById('quick-food-category') || {}).value || 'อาหารประจำเดือน').trim();
    const saveButton = document.getElementById('quick-food-save-btn');
    const drafts = quickFoodRows
        .map((rowId, index) => ({ rowId, rowNumber: index + 1, draft: getQuickFoodRowDraft(rowId) }))
        .filter(item => !isQuickFoodDraftEmpty(item.draft));

    if (!/^\d{4}-\d{2}$/.test(postingMonth) || !category) {
        return appAlert('กรุณาตรวจสอบรอบบันทึกและหมวดหมู่ค่าอาหาร', 'error');
    }
    if (!drafts.length) {
        return appAlert('กรุณากรอกรายการค่าอาหารอย่างน้อย 1 รายการ', 'warning');
    }
    const validationErrors = [];
    drafts.forEach(item => {
        const missing = [];
        if (!item.draft.expenseDate) missing.push('วันที่ซื้อ');
        if (!item.draft.name) missing.push('รายการ');
        if (item.draft.quantity <= 0) missing.push('จำนวน');
        if (!item.draft.unit) missing.push('หน่วย');
        if (item.draft.unitPrice <= 0) missing.push('ราคา/หน่วย');
        if (state.requireAttachment && item.draft.attachments.length === 0) missing.push('หลักฐาน');
        if (missing.length) validationErrors.push(`แถว ${item.rowNumber}: ${missing.join(', ')}`);
    });
    if (validationErrors.length) {
        return appAlert(`กรุณากรอกข้อมูลให้ครบถ้วน\n${validationErrors.join('\n')}`, 'error');
    }

    if (saveButton) saveButton.disabled = true;
    if (form) form.setAttribute('aria-busy', 'true');
    showLoading(true);
    const savedRows = [];
    const failedRows = [];
    let attachmentErrorCount = 0;
    let processedCount = 0;
    setBatchUploadProgress('quick-food-save', 0, drafts.length, { label: 'กำลังอัปโหลดรายการค่าอาหาร' });
    try {
        const [year, month] = postingMonth.split('-').map(Number);
        const currentUser = getCurrentUser() || {};
        for (const item of drafts) {
            const row = getQuickFoodRowElement(item.rowId);
            const status = row && row.querySelector('[data-role="row-status"]');
            if (row) row.classList.add('is-saving');
            if (status) status.textContent = 'กำลังบันทึก...';
            try {
                const payload = {
                    requestId: item.draft.requestId,
                    month,
                    year,
                    dormitory: '',
                    responsiblePerson: currentUser.name || '',
                    note: category,
                    items: [{
                        expenseDate: item.draft.expenseDate,
                        ingredientName: item.draft.name,
                        quantity: item.draft.quantity,
                        unit: item.draft.unit,
                        unitPrice: item.draft.unitPrice
                    }]
                };
                const result = await apiCall('createFoodExpense', payload, null, null, {
                    onStatus: detail => {
                        if (!status) return;
                        if (detail.status === 'retrying') status.textContent = `การเชื่อมต่อสะดุด · กำลังส่งซ้ำ ${detail.attempt}/${detail.maxAttempts}`;
                        else if (detail.status === 'sending') status.textContent = `กำลังบันทึก ${detail.attempt}/${detail.maxAttempts}`;
                        else if (detail.status === 'success') status.textContent = 'บันทึกสำเร็จ';
                    }
                });
                const itemId = result.items && result.items[0] ? result.items[0].assignedId : '';
                const attachmentResult = itemId
                    ? await uploadQuickFoodAttachments(itemId, item.draft.attachments)
                    : { uploaded: [], failed: item.draft.attachments.map(attachment => ({ attachment, error: new Error('ไม่พบรหัสรายการย่อย') })) };
                attachmentResult.uploaded.forEach(attachment => {
                    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
                });
                attachmentErrorCount += attachmentResult.failed.length;
                const savedFood = {
                    id: result.id,
                    itemId,
                    documentNo: result.documentNo,
                    month,
                    year,
                    postingMonth,
                    date: item.draft.expenseDate,
                    name: item.draft.name,
                    quantity: item.draft.quantity,
                    unit: item.draft.unit,
                    price: item.draft.unitPrice,
                    totalAmount: item.draft.amount,
                    category,
                    files: attachmentResult.uploaded.length ? 'yes' : '',
                    status: 'pending'
                };
                upsertFoodRecord(savedFood);
                savedRows.push({ ...savedFood, attachmentFailures: attachmentResult.failed });
                if (row) row.remove();
                quickFoodRows = quickFoodRows.filter(id => id !== item.rowId);
                delete quickFoodAttachmentsByRow[item.rowId];
            } catch (error) {
                failedRows.push({ rowNumber: item.rowNumber, error });
                if (row) {
                    row.classList.remove('is-saving');
                    row.classList.add('has-error');
                }
                if (status) status.textContent = `บันทึกไม่สำเร็จ: ${error.message || error}`;
            } finally {
                processedCount += 1;
                setBatchUploadProgress('quick-food-save', processedCount, drafts.length, {
                    label: 'กำลังอัปโหลดรายการค่าอาหาร'
                });
            }
        }

        try {
            await loadFoodBillsForMonth();
        } catch (refreshError) {
            console.warn('Quick food entries saved but list refresh failed:', refreshError);
        }
        savedRows.forEach(savedFood => {
            if (getFoodPostingMonth(savedFood) === getSelectedPostingMonth()) upsertFoodRecord(savedFood);
        });
        clearMonthlyRecordFilters();
        renderFoodBillsTable();
        if (!quickFoodRows.length) addQuickFoodRow({}, { focus: false });
        renumberQuickFoodRows();
        setBatchUploadProgress('quick-food-save', processedCount, drafts.length, {
            label: failedRows.length ? 'อัปโหลดครบแล้ว โดยมีบางรายการไม่สำเร็จ' : 'อัปโหลดรายการค่าอาหารครบแล้ว',
            state: failedRows.length ? 'warning' : 'success'
        });
        const message = [
            savedRows.length ? `บันทึกค่าอาหารสำเร็จ ${savedRows.length} รายการ` : '',
            attachmentErrorCount ? `หลักฐานอัปโหลดไม่สำเร็จ ${attachmentErrorCount} ไฟล์` : '',
            failedRows.length ? `บันทึกไม่สำเร็จ ${failedRows.length} รายการ\n${failedRows.map(item => `แถว ${item.rowNumber}: ${item.error.message || item.error}`).join('\n')}` : ''
        ].filter(Boolean).join('\n\n');
        appAlert(message, failedRows.length || attachmentErrorCount ? 'warning' : 'success');
    } catch (error) {
        appAlert('ไม่สามารถเริ่มบันทึกค่าอาหารได้: ' + error.message, 'error');
    } finally {
        if (processedCount < drafts.length) {
            setBatchUploadProgress('quick-food-save', processedCount, drafts.length, {
                label: 'การอัปโหลดหยุดก่อนครบรายการ',
                state: 'warning'
            });
        }
        showLoading(false);
        if (form) form.removeAttribute('aria-busy');
        if (saveButton) saveButton.disabled = false;
    }
}

function renderExpenseInlineAddRow(tbody) {
    const tr = document.createElement('tr');
    tr.className = 'inline-add-row';
    
    const defaultProj = state.projects.find(p => (p.name || '').includes("ค่าซ่อมแซมหอพัก") || (p.name || '').includes("หอพัก"));
    const defaultProjId = defaultProj ? defaultProj.id : (state.projects[0] ? state.projects[0].id : '');
    
    state.columns.forEach(col => {
        if (!col.visible) return;
        const td = document.createElement('td');
        td.dataset.label = col.label;
        
        switch (col.id) {
            case 'documentNo':
                td.innerHTML = `<input type="text" disabled class="form-input" style="font-size:12px; padding:4px 8px; width:100%; border:none; background:transparent; font-weight:600;" value="อัตโนมัติ">`;
                break;
            case 'expenseDate':
                td.innerHTML = `<input type="date" id="inline-exp-date" class="form-input" style="font-size:12px; padding:4px 8px; width:100%;" value="${getSelectedMonthDefaultDateStr()}">`;
                break;
            case 'projectId':
                let projOptions = state.projects.filter(p => p.active).map(p => 
                    `<option value="${p.id}" ${p.id === defaultProjId ? 'selected' : ''}>${p.name}</option>`
                ).join('');
                td.innerHTML = `<select id="inline-exp-project" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">${projOptions}</select>`;
                break;
            case 'categoryId':
                td.innerHTML = buildMasterInputHTML('category', 'inline-exp', 'พิมพ์หรือเลือกหมวดหมู่...');
                break;
            case 'fundSourceId':
                td.innerHTML = buildMasterInputHTML('fundSource', 'inline-exp', 'พิมพ์หรือเลือกแหล่งเงิน...');
                break;
            case 'vendorId':
                td.innerHTML = buildMasterInputHTML('vendor', 'inline-exp', 'พิมพ์หรือเลือกผู้ขาย...');
                break;
            case 'description':
                td.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:4px; min-width:140px;">
                        <input type="text" id="inline-exp-desc" class="form-input" style="font-size:12px; padding:4px 8px; width:100%;" placeholder="รายละเอียด...">
                        <button type="button" class="btn btn-outline btn-sm" onclick="openMultiItemsModal('EXP')" style="padding:2px 6px; font-size:11px; display:inline-flex; align-items:center; gap:4px; border-radius:4px; align-self:start; border-color:var(--primary); color:var(--primary);">
                            <i data-lucide="list-plus" style="width:12px; height:12px;"></i> รายการย่อย
                        </button>
                    </div>
                `;
                break;
            case 'quantity':
                td.innerHTML = `<input type="number" id="inline-exp-qty" class="form-input text-right" style="font-size:12px; padding:4px 8px; width:100%;" min="0.01" step="any" value="1">`;
                break;
            case 'unitPrice':
                td.innerHTML = `<input type="number" id="inline-exp-price" class="form-input text-right" style="font-size:12px; padding:4px 8px; width:100%;" min="0" step="any" value="0.00">`;
                break;
            case 'amount':
                td.innerHTML = `<input type="number" id="inline-exp-amount" class="form-input text-right" style="font-size:12px; padding:4px 8px; width:100%; font-weight:600; background:rgba(0,0,0,0.02);" readonly value="0.00">`;
                break;
            case 'claimable':
                td.innerHTML = `
                    <select id="inline-exp-claimable" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">
                        <option value="true" selected>เบิกมูลนิธิ</option>
                        <option value="false">ไม่เบิก</option>
                    </select>
                `;
                break;
            case 'attachment':
                td.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">บันทึกก่อนแนบ</span>`;
                td.className = 'text-center';
                break;
            default:
                if (col.custom) {
                    td.innerHTML = `<input type="text" id="inline-exp-custom-${col.id}" class="form-input inline-exp-custom" data-col-label="${col.label}" style="font-size:12px; padding:4px 8px; width:100%;" placeholder="${col.label}...">`;
                }
                break;
        }
        
        tr.appendChild(td);
    });
    
    const toolsTd = document.createElement('td');
    toolsTd.className = 'text-center';
    toolsTd.dataset.label = 'เครื่องมือ';
    toolsTd.innerHTML = `
        <button type="button" class="btn btn-primary btn-sm" onclick="saveInlineRow('EXP')" style="padding:4px 10px; border-radius:6px; font-weight:600; display:flex; align-items:center; gap:4px; margin: 0 auto;">
            <i data-lucide="check" style="width:14px; height:14px;"></i> บันทึก
        </button>
    `;
    tr.appendChild(toolsTd);
    
    tbody.appendChild(tr);
    setupExpenseMasterInput('category', '', 'inline-exp');
    setupExpenseMasterInput('fundSource', '', 'inline-exp');
    setupExpenseMasterInput('vendor', '', 'inline-exp');
}

function renderAttachmentInlineAddRow(tbody) {
    const tr = document.createElement('tr');
    tr.className = 'inline-add-row';
    
    const defaultProj = state.projects.find(p => (p.name || '').includes("ค่าซ่อมแซมหอพัก") || (p.name || '').includes("หอพัก"));
    const defaultProjId = defaultProj ? defaultProj.id : (state.projects[0] ? state.projects[0].id : '');
    
    state.columns.forEach(col => {
        if (!col.visible) return;
        const td = document.createElement('td');
        td.dataset.label = col.label;
        
        switch (col.id) {
            case 'documentNo':
                td.innerHTML = `<input type="text" disabled class="form-input" style="font-size:12px; padding:4px 8px; width:100%; border:none; background:transparent; font-weight:600;" value="อัตโนมัติ">`;
                break;
            case 'expenseDate':
                td.innerHTML = `<input type="date" id="inline-att-date" class="form-input" style="font-size:12px; padding:4px 8px; width:100%;" value="${getSelectedMonthDefaultDateStr()}">`;
                break;
            case 'projectId':
                let projOptions = state.projects.filter(p => p.active).map(p => 
                    `<option value="${p.id}" ${p.id === defaultProjId ? 'selected' : ''}>${p.name}</option>`
                ).join('');
                td.innerHTML = `<select id="inline-att-project" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">${projOptions}</select>`;
                break;
            case 'categoryId':
                td.innerHTML = buildMasterInputHTML('category', 'inline-att', 'พิมพ์หรือเลือกหมวดหมู่...');
                break;
            case 'fundSourceId':
                td.innerHTML = buildMasterInputHTML('fundSource', 'inline-att', 'พิมพ์หรือเลือกแหล่งเงิน...');
                break;
            case 'vendorId':
                td.innerHTML = buildMasterInputHTML('vendor', 'inline-att', 'พิมพ์หรือเลือกผู้ขาย...');
                break;
            case 'description':
                td.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:4px; min-width:140px;">
                        <input type="text" id="inline-att-desc" class="form-input" style="font-size:12px; padding:4px 8px; width:100%;" placeholder="รายละเอียด...">
                        <button type="button" class="btn btn-outline btn-sm" onclick="openMultiItemsModal('ATT')" style="padding:2px 6px; font-size:11px; display:inline-flex; align-items:center; gap:4px; border-radius:4px; align-self:start; border-color:var(--primary); color:var(--primary);">
                            <i data-lucide="list-plus" style="width:12px; height:12px;"></i> รายการย่อย
                        </button>
                    </div>
                `;
                break;
            case 'quantity':
                td.innerHTML = `<input type="number" id="inline-att-qty" class="form-input text-right" style="font-size:12px; padding:4px 8px; width:100%;" min="0.01" step="any" value="1">`;
                break;
            case 'unitPrice':
                td.innerHTML = `<input type="number" id="inline-att-price" class="form-input text-right" style="font-size:12px; padding:4px 8px; width:100%;" min="0" step="any" value="0.00">`;
                break;
            case 'amount':
                td.innerHTML = `<input type="number" id="inline-att-amount" class="form-input text-right" style="font-size:12px; padding:4px 8px; width:100%; font-weight:600; background:rgba(0,0,0,0.02);" readonly value="0.00">`;
                break;
            case 'claimable':
                td.innerHTML = `
                    <select id="inline-att-claimable" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">
                        <option value="true" selected>เบิกมูลนิธิ</option>
                        <option value="false">ไม่เบิก</option>
                    </select>
                `;
                break;
            case 'attachment':
                td.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">บันทึกก่อนแนบ</span>`;
                td.className = 'text-center';
                break;
            default:
                if (col.custom) {
                    td.innerHTML = `<input type="text" id="inline-att-custom-${col.id}" class="form-input inline-att-custom" data-col-label="${col.label}" style="font-size:12px; padding:4px 8px; width:100%;" placeholder="${col.label}...">`;
                }
                break;
        }
        tr.appendChild(td);
    });
    
    const toolsTd = document.createElement('td');
    toolsTd.className = 'text-center';
    toolsTd.dataset.label = 'เครื่องมือ';
    toolsTd.innerHTML = `
        <button type="button" class="btn btn-primary btn-sm" onclick="saveInlineRow('ATT')" style="padding:4px 10px; border-radius:6px; font-weight:600; display:flex; align-items:center; gap:4px; margin: 0 auto;">
            <i data-lucide="check" style="width:14px; height:14px;"></i> บันทึก
        </button>
    `;
    tr.appendChild(toolsTd);
    
    tbody.appendChild(tr);
    setupExpenseMasterInput('category', '', 'inline-att');
    setupExpenseMasterInput('fundSource', '', 'inline-att');
    setupExpenseMasterInput('vendor', '', 'inline-att');
}

function bindInlineListeners() {
    const expQty = document.getElementById('inline-exp-qty');
    const expPrice = document.getElementById('inline-exp-price');
    const expAmount = document.getElementById('inline-exp-amount');
    
    if (expQty && expPrice && expAmount) {
        const recalc = () => {
            const qty = parseFloat(expQty.value) || 0;
            const price = parseFloat(expPrice.value) || 0;
            expAmount.value = (qty * price).toFixed(2);
        };
        expQty.addEventListener('input', recalc);
        expPrice.addEventListener('input', recalc);
    }
    
    const attQty = document.getElementById('inline-att-qty');
    const attPrice = document.getElementById('inline-att-price');
    const attAmount = document.getElementById('inline-att-amount');
    
    if (attQty && attPrice && attAmount) {
        const recalc = () => {
            const qty = parseFloat(attQty.value) || 0;
            const price = parseFloat(attPrice.value) || 0;
            attAmount.value = (qty * price).toFixed(2);
        };
        attQty.addEventListener('input', recalc);
        attPrice.addEventListener('input', recalc);
    }
}

async function saveInlineRow(prefix) {
    const isEXP = prefix === 'EXP';
    const inlineContext = isEXP ? 'inline-exp' : 'inline-att';
    
    const dateVal = document.getElementById(`inline-${prefix.toLowerCase()}-date`).value;
    const projId = document.getElementById(`inline-${prefix.toLowerCase()}-project`).value;
    const descVal = document.getElementById(`inline-${prefix.toLowerCase()}-desc`).value.trim();
    const qtyVal = parseFloat(document.getElementById(`inline-${prefix.toLowerCase()}-qty`).value) || 1;
    const priceVal = parseFloat(document.getElementById(`inline-${prefix.toLowerCase()}-price`).value) || 0;
    const claimableVal = document.getElementById(`inline-${prefix.toLowerCase()}-claimable`).value === 'true';
    
    if (!descVal) {
        appAlert('กรุณาระบุรายละเอียด!');
        return;
    }
    
    const customFields = {};
    document.querySelectorAll(`.inline-${prefix.toLowerCase()}-custom`).forEach(input => {
        const label = input.getAttribute('data-col-label');
        const val = input.value.trim();
        if (val) {
            customFields[label] = val;
        }
    });
    
    const multiItems = isEXP ? inlineExpMultiItems : inlineAttMultiItems;
    const noteStr = formatNoteData('', customFields, multiItems);

    const inlineUser = JSON.parse(localStorage.getItem('rdf_current_user') || '{}');
    if (!inlineUser.organizationId) {
        appAlert('ไม่พบข้อมูลหน่วยงานของผู้ใช้ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่', 'error');
        return;
    }
    showLoading(true);
    try {
        const catId = await resolveExpenseMasterSelection('category', inlineContext);
        const fundId = await resolveExpenseMasterSelection('fundSource', inlineContext);
        const vendorId = await resolveExpenseMasterSelection('vendor', inlineContext);
        const payload = {
            expenseDate: dateVal,
            organizationId: inlineUser.organizationId,
            projectId: projId,
            categoryId: catId,
            fundSourceId: fundId,
            vendorId: vendorId,
            description: descVal,
            quantity: qtyVal,
            unit: 'รายการ',
            unitPrice: priceVal,
            vatAmount: 0,
            claimable: claimableVal,
            note: noteStr,
            idPrefix: prefix
        };

        await apiCall('createExpense', payload);
        appAlert('บันทึกสำเร็จ!');
        if (isEXP) {
            inlineExpMultiItems = null;
        } else {
            inlineAttMultiItems = null;
        }
        await initAppWithAPI();
    } catch (err) {
        appAlert('บันทึกล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function openMultiItemsModal(target) {
    currentMultiItemsTarget = target;
    
    const existingItems = target === 'EXP' ? inlineExpMultiItems : inlineAttMultiItems;
    if (existingItems) {
        currentMultiItems = JSON.parse(JSON.stringify(existingItems));
    } else {
        currentMultiItems = [];
    }
    
    renderMultiItemsInModal();
    
    const modal = document.getElementById('modal-multi-items');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
    initializeLucide();
}

function openQuickExpenseMultiItems(rowId) {
    currentQuickExpenseRowId = rowId;
    currentMultiItemsTarget = 'QUICK_EXPENSE_ROW';
    currentMultiItems = JSON.parse(JSON.stringify(quickExpenseMultiItemsByRow[rowId] || []));
    renderMultiItemsInModal();
    const modal = document.getElementById('modal-multi-items');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
    initializeLucide();
}
window.openQuickExpenseMultiItems = openQuickExpenseMultiItems;

function updateExpenseModalMultiItemsSummary() {
    const summary = document.getElementById('bill-multi-items-summary');
    if (!summary) return;
    const items = expenseModalNoteMetadata.multiItems || [];
    summary.textContent = items.length
        ? `${items.length} รายการย่อย · รวม ${items.reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.price) || 0)), 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`
        : 'ยังไม่มีรายการย่อย';
}

function openExpenseModalMultiItems() {
    currentQuickExpenseRowId = null;
    currentMultiItemsTarget = 'FULL_EXPENSE';
    currentMultiItems = JSON.parse(JSON.stringify(expenseModalNoteMetadata.multiItems || []));
    renderMultiItemsInModal();
    const modal = document.getElementById('modal-multi-items');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.add('active');
    }
    initializeLucide();
}
window.openExpenseModalMultiItems = openExpenseModalMultiItems;

function closeMultiItemsModal() {
    const modal = document.getElementById('modal-multi-items');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}

function renderMultiItemsInModal() {
    const tbody = document.querySelector('#multi-items-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (currentMultiItems.length === 0) {
        currentMultiItems.push({ desc: '', qty: 1, price: 0 });
    }
    
    currentMultiItems.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <input type="text" class="form-input multi-item-desc" style="font-size:12px; padding:4px 8px; width:100%;" value="${escapeHTML(item.desc)}" placeholder="เช่น ตะปู, ค้อน..." oninput="updateMultiItemData(${index}, 'desc', this.value)">
            </td>
            <td>
                <input type="number" class="form-input text-right multi-item-qty" style="font-size:12px; padding:4px 8px; width:100%;" value="${item.qty}" min="0.01" step="any" oninput="updateMultiItemData(${index}, 'qty', this.value)">
            </td>
            <td>
                <input type="number" class="form-input text-right multi-item-price" style="font-size:12px; padding:4px 8px; width:100%;" value="${item.price}" min="0" step="any" oninput="updateMultiItemData(${index}, 'price', this.value)">
            </td>
            <td class="text-right font-semibold multi-item-total" style="font-size:12px; padding:8px; width:120px;">
                ฿${(item.qty * item.price).toFixed(2)}
            </td>
            <td class="text-center" style="width:80px;">
                <button type="button" class="btn btn-icon btn-danger" onclick="removeMultiItemRow(${index})" style="padding:4px; margin: 0 auto;"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    updateMultiItemsTotal();
    initializeLucide();
}

function updateMultiItemData(index, field, value) {
    const item = currentMultiItems[index];
    if (!item) return;
    
    if (field === 'desc') {
        item.desc = value;
    } else if (field === 'qty') {
        item.qty = parseFloat(value) || 0;
    } else if (field === 'price') {
        item.price = parseFloat(value) || 0;
    }
    
    const tbody = document.querySelector('#multi-items-table tbody');
    if (tbody) {
        const row = tbody.children[index];
        if (row) {
            const totalTd = row.querySelector('.multi-item-total');
            if (totalTd) {
                totalTd.textContent = `฿${(item.qty * item.price).toFixed(2)}`;
            }
        }
    }
    
    updateMultiItemsTotal();
}

function addMultiItemRow() {
    currentMultiItems.push({ desc: '', qty: 1, price: 0 });
    renderMultiItemsInModal();
}

function removeMultiItemRow(index) {
    currentMultiItems.splice(index, 1);
    renderMultiItemsInModal();
}

function updateMultiItemsTotal() {
    let grandTotal = 0;
    currentMultiItems.forEach(item => {
        grandTotal += item.qty * item.price;
    });
    
    const display = document.getElementById('multi-items-grand-total');
    if (display) {
        display.textContent = `ยอดรวมสุทธิ: ฿${grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
}

function saveMultiItems() {
    const validItems = currentMultiItems.filter(item => item.desc.trim() !== '' && item.qty > 0 && item.price >= 0);
    if (validItems.length === 0) {
        appAlert('กรุณากรอกรายละเอียดสินค้าอย่างน้อย 1 รายการ!');
        return;
    }
    
    let totalAmount = 0;
    validItems.forEach(item => {
        totalAmount += item.qty * item.price;
    });

    if (currentMultiItemsTarget === 'QUICK_EXPENSE_ROW' && currentQuickExpenseRowId) {
        const descInput = getQuickExpenseRowField(currentQuickExpenseRowId, 'description');
        const qtyInput = getQuickExpenseRowField(currentQuickExpenseRowId, 'quantity');
        const priceInput = getQuickExpenseRowField(currentQuickExpenseRowId, 'unitPrice');
        if (descInput && qtyInput && priceInput) {
            if (validItems.length === 1) {
                descInput.value = validItems[0].desc;
                qtyInput.value = validItems[0].qty;
                priceInput.value = validItems[0].price;
                qtyInput.disabled = false;
                priceInput.disabled = false;
            } else {
                descInput.value = `[หลายรายการ] ${validItems[0].desc} และรายการอื่นๆ รวม ${validItems.length} รายการ`;
                qtyInput.value = 1;
                priceInput.value = totalAmount;
                qtyInput.disabled = true;
                priceInput.disabled = true;
            }
        }
        quickExpenseMultiItemsByRow[currentQuickExpenseRowId] = validItems;
        updateQuickExpenseRowTotal(currentQuickExpenseRowId);
        ensureQuickExpenseTrailingRow(currentQuickExpenseRowId);
        scheduleQuickExpenseDraftSave();
        closeMultiItemsModal();
        return;
    }

    if (currentMultiItemsTarget === 'FULL_EXPENSE') {
        const descInput = document.getElementById('bill-desc');
        const qtyInput = document.getElementById('bill-qty');
        const priceInput = document.getElementById('bill-price');
        if (descInput && qtyInput && priceInput) {
            if (validItems.length === 1) {
                descInput.value = validItems[0].desc;
                qtyInput.value = validItems[0].qty;
                priceInput.value = validItems[0].price;
                qtyInput.disabled = false;
                priceInput.disabled = false;
            } else {
                descInput.value = `[หลายรายการ] ${validItems[0].desc} และรายการอื่นๆ รวม ${validItems.length} รายการ`;
                qtyInput.value = 1;
                priceInput.value = totalAmount;
                qtyInput.disabled = true;
                priceInput.disabled = true;
            }
        }
        expenseModalNoteMetadata.multiItems = validItems.map(item => ({ ...item }));
        updateExpenseModalMultiItemsSummary();
        closeMultiItemsModal();
        return;
    }
    
    const prefix = currentMultiItemsTarget.toLowerCase();
    
    const descInput = document.getElementById(`inline-${prefix}-desc`);
    const qtyInput = document.getElementById(`inline-${prefix}-qty`);
    const priceInput = document.getElementById(`inline-${prefix}-price`);
    const amountInput = document.getElementById(`inline-${prefix}-amount`);
    
    if (descInput) {
        if (validItems.length === 1) {
            descInput.value = validItems[0].desc;
            qtyInput.value = validItems[0].qty;
            priceInput.value = validItems[0].price;
            qtyInput.disabled = false;
            priceInput.disabled = false;
        } else {
            descInput.value = `[หลายรายการ] ${validItems[0].desc} และรายการอื่นๆ รวม ${validItems.length} รายการ`;
            qtyInput.value = 1;
            priceInput.value = totalAmount;
            qtyInput.disabled = true;
            priceInput.disabled = true;
        }
        amountInput.value = totalAmount.toFixed(2);
    }
    
    if (currentMultiItemsTarget === 'EXP') {
        inlineExpMultiItems = validItems;
    } else {
        inlineAttMultiItems = validItems;
    }
    
    closeMultiItemsModal();
}


// ==========================================================================
// Excel Export XLSX (Phase 2)
// ==========================================================================
async function exportExcelXLSX() {
    const table = document.getElementById('excel-grid');
    if (!table) return appAlert('ไม่พบตารางข้อมูลสเปรดชีตสำหรับส่งออก!');

    try {
        // โหลด xlsx แบบ lazy (ปกติเตรียมไว้เบื้องหลังแล้ว → resolve ทันที)
        await ensureExportLibs();
        const wb = XLSX.utils.table_to_book(table, { raw: true });
        const dateStr = `${state.selectedYear}-${state.selectedMonth}`;
        XLSX.writeFile(wb, `rdf_billing_report_${dateStr}.xlsx`);
    } catch (e) {
        appAlert("การส่งออก Excel ล้มเหลว: " + e.message);
    }
}

// ==========================================================================
// Signature Pad Controller (Phase 2)
// ==========================================================================
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let canvasBound = false;

function initSignatureCanvas() {
    const canvas = document.getElementById('sig-canvas');
    if (!canvas || canvasBound) return;
    
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    
    function getCanvasCoords(e, isTouch = false) {
        const rect = canvas.getBoundingClientRect();
        const clientX = isTouch ? e.touches[0].clientX : e.clientX;
        const clientY = isTouch ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    }
    
    canvas.addEventListener('mousedown', (e) => {
        isDrawing = true;
        const coords = getCanvasCoords(e);
        lastX = coords.x;
        lastY = coords.y;
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const coords = getCanvasCoords(e);
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();
        lastX = coords.x;
        lastY = coords.y;
    });
    
    canvas.addEventListener('mouseup', () => isDrawing = false);
    canvas.addEventListener('mouseleave', () => isDrawing = false);
    
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDrawing = true;
        const coords = getCanvasCoords(e, true);
        lastX = coords.x;
        lastY = coords.y;
    });
    
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!isDrawing) return;
        const coords = getCanvasCoords(e, true);
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(coords.x, coords.y);
        ctx.stroke();
        lastX = coords.x;
        lastY = coords.y;
    });
    
    canvas.addEventListener('touchend', () => isDrawing = false);
    
    canvasBound = true;
}

function openSignatureModal(role) {
    (document.getElementById('sig-role-target') || {}).value = role;
    
    const titles = {
        'prepared': 'ลายเซ็น: ผู้จัดทำ / Prepared By',
        'checked': 'ลายเซ็น: ผู้ตรวจสอบ / Checked By',
        'approved': 'ลายเซ็น: ผู้อนุมัติ / Approved By'
    };
    
    (document.getElementById('modal-sig-title') || {}).textContent = titles[role] || 'เขียนลายเซ็นดิจิทัล';
    document.getElementById('modal-signature').classList.add('active');
    
    initSignatureCanvas();
    clearSignatureCanvas();
}

function closeSignatureModal() {
    document.getElementById('modal-signature').classList.remove('active');
}

function clearSignatureCanvas() {
    const canvas = document.getElementById('sig-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function saveSignatureCanvas() {
    const canvas = document.getElementById('sig-canvas');
    if (!canvas) return;
    
    // Check if canvas is empty
    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    if (canvas.toDataURL() === blank.toDataURL()) {
        appAlert("กรุณาวาดลายเซ็นก่อนบันทึก!");
        return;
    }
    
    const role = document.getElementById('sig-role-target').value;
    if (!state.signatures) state.signatures = {};
    
    state.signatures[role] = canvas.toDataURL();
    saveState();
    renderSignaturePreviews();
    closeSignatureModal();
    appAlert("บันทึกลายเซ็นเรียบร้อยแล้ว!");
}

function renderSignaturePreviews() {
    const roles = ['prepared', 'checked', 'approved'];
    roles.forEach(role => {
        const img = state.signatures?.[role];
        const previewDiv = document.getElementById(`sig-preview-${role}`);
        const statusSpan = document.getElementById(`sig-status-${role}`);
        // The legacy preview cards are optional and are not present in every
        // settings layout. Missing optional markup must never break app load.
        if (!previewDiv || !statusSpan) return;
        if (img) {
            previewDiv.style.display = 'flex';
            const previewImage = previewDiv.querySelector('img');
            if (previewImage) previewImage.src = img;
            statusSpan.textContent = 'มีลายเซ็นแล้ว';
            statusSpan.style.color = 'var(--success)';
        } else {
            previewDiv.style.display = 'none';
            statusSpan.textContent = 'ยังไม่มีลายเซ็น';
            statusSpan.style.color = 'var(--text-muted)';
        }
    });
}

// ==========================================================================
// Signature library and report signing workflow. This is declared after the
// legacy canvas-only helpers so existing saved data remains compatible.
const SIGNATURE_ROLES = ['prepared', 'checked', 'approved'];
const SIGNATURE_ROLE_LABELS = { prepared: 'ผู้จัดทำ', checked: 'ผู้ตรวจสอบ', approved: 'ผู้อนุมัติ' };
let signatureLibraryLoadPromise = null;

function ensureSignatureState() {
    if (!state.signatures) state.signatures = { prepared: null, checked: null, approved: null };
    if (!Array.isArray(state.signatureLibrary)) state.signatureLibrary = [];
    if (!state.signatureSelection) state.signatureSelection = { prepared: '', checked: '', approved: '' };
    SIGNATURE_ROLES.forEach(role => { if (state.signatureSelection[role] === undefined) state.signatureSelection[role] = ''; });
}

function getSignatureControlRoleId(role, suffix) {
    const prefix = role === 'prepared' ? 'preparer' : role === 'checked' ? 'reviewer' : 'approver';
    return `pdf-${prefix}-signature-${suffix}`;
}

function getActiveSignatureDataUrl(role) {
    ensureSignatureState();
    const id = state.signatureSelection[role];
    const item = id ? state.signatureLibrary.find(entry => entry.id === id) : null;
    return (item && item.dataUrl) || (typeof state.signatures[role] === 'string' ? state.signatures[role] : '') || '';
}

function signatureDataParts(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
    return match ? { mimeType: match[1], base64Data: match[2] } : null;
}

async function loadSignatureLibrary(force = false) {
    ensureSignatureState();
    if (!force && signatureLibraryLoadPromise) return signatureLibraryLoadPromise;
    signatureLibraryLoadPromise = apiCall('getSignatures').then(result => {
        const remote = Array.isArray(result && result.signatures) ? result.signatures : [];
        remote.forEach(meta => {
            const existing = state.signatureLibrary.find(item => item.id === meta.id);
            if (existing) Object.assign(existing, meta, { dataUrl: existing.dataUrl || '' });
            else state.signatureLibrary.push({ ...meta, name: meta.fileName, dataUrl: '' });
        });
        renderSignatureControls();
        saveState();
        return state.signatureLibrary;
    }).catch(error => {
        console.warn('[signature] online library unavailable:', error && error.message);
        renderSignatureControls();
        return state.signatureLibrary;
    }).finally(() => { signatureLibraryLoadPromise = null; });
    return signatureLibraryLoadPromise;
}

async function ensureActiveSignaturesLoaded() {
    ensureSignatureState();
    await loadSignatureLibrary();
    for (const role of SIGNATURE_ROLES) {
        const id = state.signatureSelection[role];
        const item = id ? state.signatureLibrary.find(entry => entry.id === id) : null;
        if (!item || item.dataUrl || !String(id).startsWith('SIG')) continue;
        try {
            const result = await apiCall('getSignatureDataUrl', { id });
            if (result && result.dataUrl) { item.dataUrl = result.dataUrl; state.signatures[role] = result.dataUrl; }
        } catch (error) { console.warn('[signature] cannot load signature:', id, error && error.message); }
    }
    saveState();
    renderSignatureControls();
}

async function selectSignatureForRole(role, id) {
    ensureSignatureState();
    if (!SIGNATURE_ROLES.includes(role)) return;
    state.signatureSelection[role] = id || '';
    if (!id) state.signatures[role] = null;
    else {
        const item = state.signatureLibrary.find(entry => entry.id === id);
        try {
            if (item && !item.dataUrl && String(id).startsWith('SIG')) {
                const result = await apiCall('getSignatureDataUrl', { id });
                if (result && result.dataUrl) item.dataUrl = result.dataUrl;
            }
            state.signatures[role] = (item && item.dataUrl) || null;
        } catch (error) {
            state.signatureSelection[role] = '';
            state.signatures[role] = null;
            appAlert('โหลดลายเซ็นไม่สำเร็จ: ' + (error.message || error), 'error');
        }
    }
    saveState();
    renderSignatureControls();
    renderExportPreview();
}
window.selectSignatureForRole = selectSignatureForRole;

async function uploadSignatureFile(role, file, source = 'uploaded') {
    if (!file || !SIGNATURE_ROLES.includes(role)) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return appAlert('กรุณาเลือกไฟล์ PNG, JPG หรือ WEBP', 'warning');
    if (file.size > 2 * 1024 * 1024) return appAlert('ไฟล์ลายเซ็นต้องมีขนาดไม่เกิน 2 MB', 'warning');
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    ensureSignatureState();
    const localItem = { id: `local-${createClientRequestId('signature')}`, roleInDoc: role, name: file.name, fileName: file.name, mimeType: file.type, source, dataUrl, createdAt: new Date().toISOString() };
    state.signatureLibrary.push(localItem);
    state.signatureSelection[role] = localItem.id;
    state.signatures[role] = dataUrl;
    saveState(); renderSignatureControls(); renderExportPreview();
    try {
        const parts = signatureDataParts(dataUrl);
        const result = await apiCall('uploadSignature', { roleInDoc: role, fileName: file.name, mimeType: file.type, base64Data: parts && parts.base64Data, source });
        if (result && result.id) { Object.assign(localItem, result, { name: result.fileName || file.name, dataUrl }); state.signatureSelection[role] = result.id; saveState(); renderSignatureControls(); }
        appAlert('บันทึกลายเซ็นไว้ในระบบแล้ว', 'success');
    } catch (error) { appAlert('บันทึกไว้ในเครื่องแล้ว แต่ส่งขึ้นฐานข้อมูลไม่สำเร็จ', 'warning'); }
}

function handleSignatureUpload(role, event) {
    const file = event && event.target && event.target.files && event.target.files[0];
    if (file) uploadSignatureFile(role, file, 'uploaded');
    if (event && event.target) event.target.value = '';
}
window.handleSignatureUpload = handleSignatureUpload;

async function removeSelectedSignature(role) {
    ensureSignatureState();
    const id = state.signatureSelection[role];
    if (!id) return;
    state.signatureLibrary = state.signatureLibrary.filter(item => item.id !== id);
    state.signatureSelection[role] = '';
    state.signatures[role] = null;
    saveState(); renderSignatureControls(); renderExportPreview();
    if (String(id).startsWith('SIG')) { try { await apiCall('deleteSignature', { id }); } catch (error) { appAlert('ลบจากเครื่องแล้ว แต่ลบจากฐานข้อมูลไม่สำเร็จ', 'warning'); } }
}
window.removeSelectedSignature = removeSelectedSignature;

function renderSignatureControls() {
    ensureSignatureState();
    SIGNATURE_ROLES.forEach(role => {
        const select = document.getElementById(getSignatureControlRoleId(role, 'select'));
        const status = document.getElementById(getSignatureControlRoleId(role, 'status'));
        const preview = document.getElementById(`pdf-${role}-signature-preview`);
        if (select) {
            const current = state.signatureSelection[role] || '';
            select.innerHTML = '<option value="">เว้นพื้นที่สำหรับเซ็นด้วยปากกา</option>' + state.signatureLibrary.filter(item => !item.roleInDoc || item.roleInDoc === role).map(item => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name || item.fileName || 'ลายเซ็นที่บันทึกไว้')}</option>`).join('');
            select.value = current;
        }
        const dataUrl = getActiveSignatureDataUrl(role);
        if (status) { status.textContent = dataUrl ? 'เลือกลายเซ็นแล้ว (จะแสดงใน PDF)' : 'ยังไม่เลือกลายเซ็น — จะเว้นช่องให้เซ็นด้วยปากกา'; status.style.color = dataUrl ? 'var(--success)' : 'var(--text-muted)'; }
        if (preview) { preview.style.display = dataUrl ? 'block' : 'none'; if (dataUrl) preview.src = dataUrl; }
    });
    // Keep legacy settings cards safe when they exist.
    if (typeof renderSignaturePreviews === 'function') renderSignaturePreviews();
}

function openSignatureModal(role) {
    ensureSignatureState();
    if (!SIGNATURE_ROLES.includes(role)) return;
    (document.getElementById('sig-role-target') || {}).value = role;
    const titles = { prepared: 'ลายเซ็น: ผู้จัดทำ / Prepared By', checked: 'ลายเซ็น: ผู้ตรวจสอบ / Checked By', approved: 'ลายเซ็น: ผู้อนุมัติ / Approved By' };
    (document.getElementById('modal-sig-title') || {}).textContent = titles[role] || 'เขียนลายเซ็นดิจิทัล';
    const modal = document.getElementById('modal-signature'); if (modal) modal.classList.add('active');
    initSignatureCanvas(); clearSignatureCanvas();
}

async function saveSignatureCanvas() {
    const canvas = document.getElementById('sig-canvas'); if (!canvas) return;
    const blank = document.createElement('canvas'); blank.width = canvas.width; blank.height = canvas.height;
    if (canvas.toDataURL() === blank.toDataURL()) return appAlert('กรุณาวาดลายเซ็นก่อนบันทึก', 'warning');
    const role = (document.getElementById('sig-role-target') || {}).value; if (!SIGNATURE_ROLES.includes(role)) return;
    const dataUrl = canvas.toDataURL('image/png'); ensureSignatureState();
    const localItem = { id: `local-${createClientRequestId('signature')}`, roleInDoc: role, name: `ลายเซ็น${SIGNATURE_ROLE_LABELS[role] || ''} ${formatSystemDate(new Date())}`, fileName: `signature-${role}.png`, mimeType: 'image/png', source: 'drawn', dataUrl, createdAt: new Date().toISOString() };
    state.signatureLibrary.push(localItem); state.signatureSelection[role] = localItem.id; state.signatures[role] = dataUrl;
    saveState(); renderSignatureControls(); closeSignatureModal(); renderExportPreview();
    try {
        const parts = signatureDataParts(dataUrl);
        const result = await apiCall('uploadSignature', { roleInDoc: role, fileName: localItem.fileName, mimeType: 'image/png', base64Data: parts && parts.base64Data, source: 'drawn' });
        if (result && result.id) { Object.assign(localItem, result, { dataUrl }); state.signatureSelection[role] = result.id; saveState(); renderSignatureControls(); }
        appAlert('บันทึกลายเซ็นเรียบร้อยแล้ว', 'success');
    } catch (error) { appAlert('บันทึกลายเซ็นไว้ในเครื่องแล้ว แต่ซิงก์ฐานข้อมูลไม่สำเร็จ', 'warning'); }
}

// Claims Management (Phase 2)
// ==========================================================================
function openClaimModal() {
    (document.getElementById('claim-title') || {}).value = '';
    (document.getElementById('claim-month') || {}).value = state.selectedMonth;
    (document.getElementById('claim-year') || {}).value = state.selectedYear;
    
    renderClaimSelectorTable();
    document.getElementById('modal-create-claim').classList.add('active');
}

function closeClaimModal() {
    document.getElementById('modal-create-claim').classList.remove('active');
}

function renderClaimSelectorTable() {
    const m = parseInt(document.getElementById('claim-month').value, 10);
    const y = parseInt(document.getElementById('claim-year').value, 10);
    
    const claimableExpenses = state.expenses.filter(e => {
        const postingMonth = getExpensePostingMonth(e);
        return postingMonth === `${y - 543}-${String(m).padStart(2, '0')}` && e.claimable && (!e.claimId || e.claimId === '') && e.status !== 'cancelled';
    });
    
    const tbody = document.getElementById('claim-selector-tbody');
    tbody.innerHTML = '';
    
    if (claimableExpenses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding:16px; color:var(--text-muted);">ไม่มีบิลที่ยังไม่ได้จัดกลุ่มส่งเบิกในเดือนที่เลือก</td></tr>`;
        (document.getElementById('claim-selected-count') || {}).textContent = 'เลือกแล้ว: 0 รายการ';
        (document.getElementById('claim-selected-total') || {}).textContent = 'ยอดรวมทั้งสิ้น: ฿0.00';
        return;
    }
    
    claimableExpenses.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="claim-item-select" data-id="${e.id}" data-amount="${e.amount}"></td>
            <td>${e.documentNo}</td>
            <td>${formatThaiDate(e.expenseDate)}</td>
            <td><strong>[${getCategoryName(e.categoryId)}]</strong> ${e.description}</td>
            <td class="text-right bold">฿${e.amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
        `;
        tbody.appendChild(tr);
    });
    
    // Attach change event
    tbody.querySelectorAll('.claim-item-select').forEach(cb => {
        cb.addEventListener('change', updateClaimSelectedTotals);
    });
    
    document.getElementById('claim-select-all').checked = false;
    updateClaimSelectedTotals();
}

// Watch month/year selectors inside modal to refresh lists
(document.getElementById('claim-month') || {}).addEventListener?.('change', renderClaimSelectorTable);
(document.getElementById('claim-year') || {}).addEventListener?.('change', renderClaimSelectorTable);

function toggleClaimSelectorAll(e) {
    const checkboxes = document.querySelectorAll('#claim-selector-tbody .claim-item-select');
    checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
    });
    updateClaimSelectedTotals();
}

function updateClaimSelectedTotals() {
    const checkboxes = document.querySelectorAll('#claim-selector-tbody .claim-item-select:checked');
    const count = checkboxes.length;
    let sum = 0;
    checkboxes.forEach(cb => {
        sum += parseFloat(cb.getAttribute('data-amount')) || 0;
    });
    
    (document.getElementById('claim-selected-count') || {}).textContent = `เลือกแล้ว: ${count} รายการ`;
    (document.getElementById('claim-selected-total') || {}).textContent = `ยอดรวมทั้งสิ้น: ฿${sum.toLocaleString('th-TH', {minimumFractionDigits:2})}`;
}

async function saveClaimPackage() {
    const title = document.getElementById('claim-title').value.trim();
    if (!title) return appAlert("กรุณาระบุชื่อชุดส่งเบิก!");
    
    const checkboxes = document.querySelectorAll('#claim-selector-tbody .claim-item-select:checked');
    if (checkboxes.length === 0) return appAlert("กรุณาเลือกอย่างน้อย 1 รายการค่าใช้จ่ายเพื่อรวมกลุ่มส่งเบิก!");
    
    const expenseIds = Array.from(checkboxes).map(cb => cb.getAttribute('data-id'));
    const m = parseInt(document.getElementById('claim-month').value, 10);
    const y = parseInt(document.getElementById('claim-year').value, 10);
    
    const gYear = y - 543;
    const monthStr = `${gYear}-${String(m).padStart(2, '0')}`;
    
    showLoading(true);
    try {
        await apiCall('createClaim', {
            title: title,
            month: monthStr,
            expenseIds: expenseIds
        });
        appAlert("สร้างชุดส่งเบิกเสร็จเรียบร้อยแล้ว!");
        closeClaimModal();
        await initAppWithAPI();
    } catch (err) {
        appAlert('สร้างชุดส่งเบิกไม่สำเร็จ: ' + err.message);
    } finally {
        showLoading(false);
    }
}

const CLAIM_STATUS_LABELS = {
    draft: 'ร่าง', submitted: 'ส่งอนุมัติแล้ว', approved: 'อนุมัติแล้ว', paid: 'จ่ายเงินแล้ว', rejected: 'ถูกปฏิเสธ'
};

function getCurrentUserRole() {
    const user = JSON.parse(localStorage.getItem('rdf_current_user') || 'null');
    return (user && user.role) ? user.role.toLowerCase() : '';
}

function parseClaimMonth(claimMonth) {
    // claimMonth เก็บเป็น "YYYY-MM" (ปี ค.ศ.)
    const [yCE, m] = (claimMonth || '').split('-').map(Number);
    if (!yCE || !m) return { label: '-', yearBE: null, monthNum: null };
    return { label: `${THAI_MONTH_NAMES[m - 1] || ''} ${yCE + 543}`, yearBE: yCE + 543, monthNum: m };
}

function claimToolsButtons(claim, role) {
    const canManage = role === 'admin' || role === 'manager';
    const canStaff = canManage || role === 'staff';
    let html = `<button class="btn btn-icon btn-sm" title="พิมพ์ใบเบิก" onclick="exportClaimPDF('${claim.id}')"><i data-lucide="printer" style="width:14px;height:14px;"></i></button> `;

    if (claim.status === 'draft') {
        if (canStaff) html += `<button class="btn btn-outline btn-sm" onclick="openClaimActionModal('${claim.id}','submit')">ส่งอนุมัติ</button> `;
        if (canStaff) html += `<button class="btn btn-icon btn-sm text-danger" title="ยกเลิกชุดนี้" onclick="deleteClaimPackage('${claim.id}')"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>`;
    } else if (claim.status === 'submitted') {
        if (canManage) {
            html += `<button class="btn btn-sm" style="background:var(--success); border-color:var(--success); color:#fff;" onclick="openClaimActionModal('${claim.id}','approve')">อนุมัติ</button> `;
            html += `<button class="btn btn-outline btn-sm" style="color:var(--danger); border-color:var(--danger);" onclick="openClaimActionModal('${claim.id}','reject')">ปฏิเสธ</button>`;
        }
    } else if (claim.status === 'approved') {
        if (canManage) html += `<button class="btn btn-primary btn-sm" onclick="openRecordPaymentModal('${claim.id}')">บันทึกรับเงิน</button>`;
    }
    return html;
}

function renderClaims() {
    const tbody = document.getElementById('claims-list-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const claims = state.claims || [];
    const countDisplay = document.getElementById('claims-count-display');
    if (state.claimsLoadStatus === 'loading' || state.claimsLoadStatus === 'error') {
        const failed = state.claimsLoadStatus === 'error';
        if (countDisplay) countDisplay.textContent = failed ? 'โหลดชุดส่งเบิกไม่สำเร็จ' : 'กำลังโหลดชุดส่งเบิก...';
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding:24px; color:var(--text-muted);">${failed ? 'กรุณากดลองใหม่จากแถบสถานะ' : 'กำลังโหลดข้อมูล...'}</td></tr>`;
        return;
    }
    if (countDisplay) countDisplay.textContent = `จำนวนชุดส่งเบิกทั้งหมด: ${claims.length} รายการ`;

    if (claims.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding:24px; color:var(--text-muted);">ยังไม่มีชุดส่งเบิก — กด "สร้างชุดส่งเบิกใหม่" เพื่อเริ่มต้น</td></tr>`;
        return;
    }

    const role = getCurrentUserRole();
    claims.forEach(claim => {
        const tr = document.createElement('tr');
        const monthInfo = parseClaimMonth(claim.claimMonth);
        const statusDate = claim.paidDate || claim.approvedDate || claim.submittedDate || claim.createdAt;

        tr.innerHTML = `
            <td>${escapeHTML(claim.id)}</td>
            <td>${escapeHTML(claim.title)}</td>
            <td>${monthInfo.label}</td>
            <td class="text-right">${claim.itemCount || 0}</td>
            <td class="text-right font-bold text-primary">${(claim.totalAmount || 0).toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
            <td class="text-center"><span class="badge badge-status-${claim.status}">${CLAIM_STATUS_LABELS[claim.status] || claim.status}</span></td>
            <td class="text-center" style="font-size:12px; color:var(--text-secondary);">${statusDate ? formatThaiDate(statusDate) : '-'}</td>
            <td class="text-center" style="white-space:nowrap;">${claimToolsButtons(claim, role)}</td>
        `;
        tbody.appendChild(tr);
    });
    initializeLucide();
}

// ---- Claim workflow: submit / approve / reject ----
function openClaimActionModal(claimId, actionType) {
    document.getElementById('claim-action-id').value = claimId;
    document.getElementById('claim-action-type').value = actionType;
    document.getElementById('claim-action-remark').value = '';

    const titles = { submit: 'ส่งอนุมัติชุดส่งเบิก', approve: 'อนุมัติชุดส่งเบิก', reject: 'ปฏิเสธชุดส่งเบิก' };
    const remarkLabels = { submit: 'หมายเหตุ (ถ้ามี)', approve: 'หมายเหตุ (ถ้ามี)', reject: 'เหตุผลการปฏิเสธ *' };
    const confirmLabels = { submit: 'ส่งอนุมัติ', approve: 'อนุมัติ', reject: 'ยืนยันปฏิเสธ (ลบถาวร)' };

    document.getElementById('claim-action-title').textContent = titles[actionType] || 'ยืนยันการดำเนินการ';
    document.getElementById('claim-action-remark-label').textContent = remarkLabels[actionType] || 'หมายเหตุ';
    document.getElementById('claim-action-warning').style.display = actionType === 'reject' ? 'block' : 'none';

    const confirmBtn = document.getElementById('btn-claim-action-confirm');
    confirmBtn.textContent = confirmLabels[actionType] || 'ยืนยัน';
    if (actionType === 'reject') {
        confirmBtn.className = 'btn btn-outline';
        confirmBtn.style.color = 'var(--danger)';
        confirmBtn.style.borderColor = 'var(--danger)';
    } else {
        confirmBtn.className = 'btn btn-primary';
        confirmBtn.style.color = '';
        confirmBtn.style.borderColor = '';
    }

    document.getElementById('modal-claim-action').classList.add('active');
}

function closeClaimActionModal() {
    document.getElementById('modal-claim-action').classList.remove('active');
}

async function confirmClaimAction() {
    const claimId = document.getElementById('claim-action-id').value;
    const actionType = document.getElementById('claim-action-type').value;
    const remark = document.getElementById('claim-action-remark').value.trim();

    if (actionType === 'reject' && !remark) {
        appAlert('กรุณาระบุเหตุผลการปฏิเสธ', 'error');
        return;
    }

    const actionMap = { submit: 'submitClaim', approve: 'approveClaim', reject: 'rejectClaim' };
    const apiAction = actionMap[actionType];
    if (!apiAction) return;

    const payload = actionType === 'reject' ? { claimId, reason: remark } : { claimId, remark };

    showLoading(true);
    try {
        await apiCall(apiAction, payload);
        appAlert('ดำเนินการสำเร็จ!', 'success');
        closeClaimActionModal();
        await initAppWithAPI();
    } catch (err) {
        appAlert('ดำเนินการไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ---- Claim workflow: record payment ----
function openRecordPaymentModal(claimId) {
    const claim = (state.claims || []).find(c => c.id === claimId);
    if (!claim) return;
    document.getElementById('payment-claim-id').value = claimId;
    document.getElementById('payment-received-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('payment-amount').value = claim.totalAmount || 0;
    document.getElementById('payment-transfer-ref').value = '';
    document.getElementById('payment-note').value = '';
    document.getElementById('modal-record-payment').classList.add('active');
}

function closeRecordPaymentModal() {
    document.getElementById('modal-record-payment').classList.remove('active');
}

async function saveRecordPayment() {
    const claimId = document.getElementById('payment-claim-id').value;
    const receivedDate = document.getElementById('payment-received-date').value;
    const amount = parseFloat(document.getElementById('payment-amount').value);
    const transferRef = document.getElementById('payment-transfer-ref').value.trim();
    const note = document.getElementById('payment-note').value.trim();

    if (!receivedDate || !amount || amount <= 0) {
        appAlert('กรุณากรอกวันที่และจำนวนเงินให้ถูกต้อง', 'error');
        return;
    }

    showLoading(true);
    try {
        await apiCall('recordReimbursement', { claimId, receivedDate, amount, transferRef, note });
        appAlert('บันทึกการรับเงินสำเร็จ!', 'success');
        closeRecordPaymentModal();
        await initAppWithAPI();
    } catch (err) {
        appAlert('บันทึกไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ---- Claim workflow: cancel a draft ----
async function deleteClaimPackage(claimId) {
    if (!await appConfirm(`คุณต้องการยกเลิกชุดส่งเบิก ${claimId} ใช่หรือไม่? รายการบิลทั้งหมดในชุดนี้จะถูกปลดออกกลับมาเป็นสถานะร่างตามปกติ`)) return;

    showLoading(true);
    try {
        await apiCall('cancelClaimDraft', { claimId });
        appAlert(`ยกเลิกชุดส่งเบิก ${claimId} เรียบร้อยแล้ว!`, 'success');
        await initAppWithAPI();
    } catch (err) {
        appAlert('ยกเลิกชุดส่งเบิกไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function exportClaimPDF(claimId) {
    await ensureActiveSignaturesLoaded();
    const claim = state.claims.find(c => c.id === claimId);
    if (!claim) return appAlert("ไม่พบชุดส่งเบิกนี้!");

    const claimQrDataUrl = claim.verifyCode ? await generateVerifyQR('claim', claim.verifyCode) : '';

    const [claimYearCE, claimMonthNum] = (claim.claimMonth || '').split('-').map(Number);
    const claimYearBE = claimYearCE + 543;

    // หมายเหตุ: state.expenses/state.attachments โหลดมาแค่เดือน/ปีที่เลือกอยู่ในตัวกรองหลักตอนนี้
    // ถ้า export ชุดของเดือนอื่น รายการจะว่างเปล่า — เตือนผู้ใช้แทนโชว์ตารางว่างเงียบๆ
    const claimExpenses = state.expenses.filter(e => e.claimId === claim.id);
    if (claimExpenses.length === 0) {
        appAlert('ไม่พบรายการบิลของชุดนี้ในตัวกรองเดือน/ปีปัจจุบัน กรุณาเลือกเดือน/ปีของชุดส่งเบิกนี้ในตัวกรองหลักก่อน export', 'error');
        return;
    }
    const claimAttachments = state.attachments.filter(a =>
        claimExpenses.some(e => e.id === a.expenseId) ||
        (getExpensePostingMonth(a) === claim.claimMonth && a.claimable)
    );
    const claimActiveTotal = claimExpenses.reduce((sum, e) => sum + e.amount, 0);
    const claimAttachTotal = claimAttachments.reduce((sum, a) => sum + a.amount, 0);
    const claimGrandTotal = claimActiveTotal + claimAttachTotal;

    const monthName = THAI_MONTH_NAMES[claimMonthNum - 1];
    
    const expRows = claimExpenses.map(exp => `
        <tr>
            <td class="tc">${exp.documentNo}</td>
            <td class="tc">${formatThaiDate(exp.expenseDate)}</td>
            <td>${getProjectName(exp.projectId)}</td>
            <td>${getCategoryName(exp.categoryId)}</td>
            <td>${getVendorName(exp.vendorId)}</td>
            <td>${exp.description}${exp.note ? `<br><em class="note">(${exp.note})</em>` : ''}</td>
            <td class="tr">${exp.quantity}</td>
            <td class="tr">${exp.unitPrice.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
            <td class="tr bold">${exp.amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
            <td class="tc"><span class="bc">เบิก</span></td>
        </tr>`).join('');
        
    const attachRows = claimAttachments.length > 0 ? `
        <tr><td colspan="10" class="section-row">📎 รายการบิลแนบ / ค่าสาธารณูปโภค</td></tr>
        ${claimAttachments.map(a => `
        <tr>
            <td class="tc">—</td>
            <td class="tc">${formatThaiDate(a.expenseDate)}</td>
            <td>${getProjectName(a.projectId)}</td>
            <td>${getCategoryName(a.categoryId)}</td>
            <td>—</td>
            <td>${a.description}</td>
            <td class="tr">—</td>
            <td class="tr">—</td>
            <td class="tr bold">${a.amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
            <td class="tc"><span class="bc">เบิก</span></td>
        </tr>`).join('')}` : '';

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>ใบขอเบิกเงิน (ชุด: ${claim.title}) — ${monthName} ${claimYearBE}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Sarabun',sans-serif;font-size:13px;color:#111;background:#fff;}
.page{max-width:960px;margin:0 auto;padding:16mm 18mm;}
.no-print{background:#f0fdf4;border-bottom:1px solid #d1fae5;padding:12px 20px;display:flex;align-items:center;gap:12px;}
.no-print button{
    background:#059669;color:white;border:none;border-radius:8px;
    padding:10px 28px;font-size:15px;cursor:pointer;font-family:'Sarabun',sans-serif;font-weight:700;
}
.no-print button:hover{background:#047857;}
.no-print .note-text{font-size:12px;color:#374151;}
.org-header{text-align:center;border-bottom:2.5px double #111;padding-bottom:14px;margin-bottom:16px;}
.org-header .eng-title{font-size:16px;font-weight:700;letter-spacing:.5px;}
.org-header .thai-title{font-size:14px;font-weight:600;margin:4px 0;}
.org-header .sub-title{font-size:12px;color:#444;margin-bottom:8px;}
.org-header .month-badge{
    display:inline-block;background:#d1fae5;color:#065f46;
    border:1px solid #6ee7b7;border-radius:6px;
    padding:4px 18px;font-size:14px;font-weight:700;margin-top:6px;
}
table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px;}
th{background:#1e3a5f;color:white;font-weight:700;padding:8px 7px;border:1px solid #1e3a5f;text-align:center;}
td{padding:6px 7px;border:1px solid #999;vertical-align:top;}
tr:nth-child(even) td{background:#f8fafc;}
.tc{text-align:center;}
.tr{text-align:right;}
.bold{font-weight:700;}
.note{font-size:11px;color:#666;}
.bc{background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}
.section-row{background:#eff6ff;color:#1e40af;font-weight:700;text-align:left;padding:8px 10px;font-size:12px;}
.totals-box{border:1.5px solid #334155;border-radius:8px;padding:14px 18px;margin:12px 0;}
.totals-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;}
.totals-row.sub{color:#555;}
.totals-row.claim{color:#065f46;font-weight:700;}
.totals-row.grand{font-size:15px;font-weight:700;border-top:2px solid #111;margin-top:6px;padding-top:8px;}
.thai-baht-text{font-style:italic;color:#444;font-size:12px;margin-top:6px;}
.signatures{display:flex;justify-content:space-around;margin-top:52px;text-align:center;}
.sig-box{width:28%;}
.sig-line{height:52px;border-bottom:1px solid #111;margin-bottom:8px;}
.sig-label{font-weight:700;font-size:13px;}
.sig-sub{font-size:11px;color:#666;margin-top:4px;}
.date-line{font-size:11px;color:#444;margin-top:8px;}
.doc-footer{text-align:center;margin-top:24px;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:10px;}
@media print{
    .no-print{display:none!important;}
    @page{size:A4;margin:10mm 12mm;}
    body{font-size:11px;}
    th{background:#1e3a5f!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .bc{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .section-row{background:#eff6ff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
}
</style>
</head>
<body>
<div class="no-print">
    <button onclick="window.print()">🖨️ พิมพ์ / บันทึก PDF</button>
    <span class="note-text">
        ⓘ กด <strong>พิมพ์</strong> แล้วเลือก <em>Save as PDF</em> ในเบราว์เซอร์เพื่อบันทึกไฟล์
    </span>
</div>

<div class="page">
    <div class="org-header">
        <div class="eng-title">DR. ROBERT DYCKERHOFF FOUNDATION</div>
        <div class="thai-title">มูลนิธิ ดร. โรเบิร์ต ดีคเคอร์ฮอฟฟ์</div>
        <div class="sub-title">Reimbursement Package: ${claim.title} (รหัส: ${claim.id})</div>
        <div class="sub-title">วิทยาลัยการอาชีพแม่สะเรียง (Mae Sariang ICEC)</div>
        <div class="month-badge">รอบเดือน ${monthName} พ.ศ. ${claimYearBE}</div>
    </div>

    <table>
        <thead>
            <tr>
                <th style="width:55px;">เลขบิล</th>
                <th style="width:65px;">วันที่</th>
                <th style="width:100px;">โครงการ</th>
                <th style="width:75px;">หมวดหมู่</th>
                <th style="width:95px;">ร้าน/ผู้ขาย</th>
                <th>รายละเอียด</th>
                <th style="width:40px;">จำนวน</th>
                <th style="width:70px;">ราคา/หน่วย</th>
                <th style="width:78px;">รวม (฿)</th>
                <th style="width:58px;">ประเภท</th>
            </tr>
        </thead>
        <tbody>
            ${expRows || '<tr><td colspan="10" class="tc" style="padding:16px;color:#666;">ไม่มีรายการบิลในชุดส่งเบิกนี้</td></tr>'}
            ${attachRows}
        </tbody>
    </table>

    <div class="totals-box">
        <div class="totals-row claim">
            <span>✅ ยอดขอเบิกเงินรวมสะสมในชุดนี้:</span>
            <span>฿${claimGrandTotal.toLocaleString('th-TH', {minimumFractionDigits:2})}</span>
        </div>
        <div class="thai-baht-text">( ${thaiBahtText(claimGrandTotal)} )</div>
    </div>

    <div class="signatures">
        <div class="sig-box">
            <div class="sig-line" style="display:flex; justify-content:center; align-items:center; height:52px; border-bottom:1px solid #111; margin-bottom:8px;">
                ${(state.signatures && state.signatures.prepared) ? `<img src="${state.signatures.prepared}" class="sig-image-rendered" style="max-height:48px; max-width:120px; object-fit:contain;" />` : ''}
            </div>
            <div class="sig-label">ผู้จัดทำ / Prepared By</div>
            <div class="sig-sub">............................................</div>
            <div class="date-line">วันที่ ............/............/.............</div>
        </div>
        <div class="sig-box">
            <div class="sig-line" style="display:flex; justify-content:center; align-items:center; height:52px; border-bottom:1px solid #111; margin-bottom:8px;">
                ${(state.signatures && state.signatures.checked) ? `<img src="${state.signatures.checked}" class="sig-image-rendered" style="max-height:48px; max-width:120px; object-fit:contain;" />` : ''}
            </div>
            <div class="sig-label">ผู้ตรวจสอบ / Checked By</div>
            <div class="sig-sub">............................................</div>
            <div class="date-line">วันที่ ............/............/.............</div>
        </div>
        <div class="sig-box">
            <div class="sig-line" style="display:flex; justify-content:center; align-items:center; height:52px; border-bottom:1px solid #111; margin-bottom:8px;">
                ${(state.signatures && state.signatures.approved) ? `<img src="${state.signatures.approved}" class="sig-image-rendered" style="max-height:48px; max-width:120px; object-fit:contain;" />` : ''}
            </div>
            <div class="sig-label">ผู้อนุมัติ / Approved By</div>
            <div class="sig-sub">............................................</div>
            <div class="date-line">วันที่ ............/............/.............</div>
        </div>
    </div>

    ${claimQrDataUrl ? `
    <div class="doc-footer" style="display:flex; align-items:center; justify-content:center; gap:12px;">
        <img src="${claimQrDataUrl}" style="width:64px; height:64px; flex-shrink:0;">
        <div style="text-align:left;">
            สแกนเพื่อตรวจสอบเอกสารนี้กับระบบ<br>
            สร้างโดย: ระบบบันทึกรายจ่าย RDF — วก.แม่สะเรียง &bull;
            พิมพ์เมื่อ: ${formatSystemDate(new Date())}
        </div>
    </div>` : `
    <div class="doc-footer">
        สร้างโดย: ระบบบันทึกรายจ่าย RDF — วก.แม่สะเรียง &bull;
        พิมพ์เมื่อ: ${formatSystemDate(new Date())}
    </div>`}
</div>
</body>
</html>`;

    const printWin = window.open('', '_blank', 'width=960,height=720');
    if (!printWin) {
        appAlert('กรุณาอนุญาต Popup ในเบราว์เซอร์ก่อนใช้งาน Export PDF');
        return;
    }
    printWin.document.write(html);
    preparePrintDocumentText(printWin.document);
    printWin.document.close();
}

// ==========================================================================
// Login Screen Custom Background Logic
// ==========================================================================
function applyLoginBackground() {
    // Update the first slide of the slideshow with user's custom background
    const firstSlide = document.querySelector('#login-slideshow .login-slide:first-child');
    if (firstSlide) {
        if (state.loginBg) {
            firstSlide.style.backgroundImage = `url('${state.loginBg}')`;
        } else {
            firstSlide.style.backgroundImage = `url('login_bg.png')`;
        }
    }
    
    // Handle background mode (slideshow vs animation)
    const overlay = document.getElementById('login-overlay');
    if (overlay) {
        const mode = state.loginBgMode || 'slideshow';
        if (mode === 'animation') {
            overlay.classList.add('mode-animation');
            overlay.classList.remove('mode-slideshow');
        } else {
            overlay.classList.add('mode-slideshow');
            overlay.classList.remove('mode-animation');
        }
    }
}

function renderLoginBgSettingsUI() {
    const bgUrlInput = document.getElementById('login-bg-url');
    if (bgUrlInput) {
        if (state.loginBg && !state.loginBg.startsWith('data:')) {
            bgUrlInput.value = state.loginBg;
            bgUrlInput.placeholder = 'เช่น https://example.com/image.jpg';
        } else if (state.loginBg && state.loginBg.startsWith('data:')) {
            bgUrlInput.value = '';
            bgUrlInput.placeholder = 'รูปภาพจากการอัปโหลด (Upload)';
        } else {
            bgUrlInput.value = '';
            bgUrlInput.placeholder = 'เช่น https://example.com/image.jpg';
        }
    }
    
    // Set active background mode radio button
    const mode = state.loginBgMode || 'slideshow';
    const activeRadio = document.querySelector(`input[name="login-bg-mode"][value="${mode}"]`);
    if (activeRadio) {
        activeRadio.checked = true;
    }
    
    // Toggle image controls panel visibility based on mode
    const imageControls = document.getElementById('login-bg-image-controls');
    if (imageControls) {
        imageControls.style.display = (mode === 'animation') ? 'none' : 'block';
    }
}

// ==========================================================================
// Login Slideshow & Interactive Particles System
// ==========================================================================
let loginSlideshowTimer = null;

function initLoginFloatingIcons() {
    // This is the main entry point called by handleSessionExpired
    initLoginSlideshow();
    initLoginParticles();
}

function initLoginSlideshow() {
    const slides = document.querySelectorAll('#login-slideshow .login-slide');
    const dots = document.querySelectorAll('#login-slide-dots .dot');
    if (slides.length === 0) return;
    
    let currentSlide = 0;
    
    function goToSlide(index) {
        slides.forEach(s => s.classList.remove('active'));
        dots.forEach(d => d.classList.remove('active'));
        currentSlide = index % slides.length;
        slides[currentSlide].classList.add('active');
        if (dots[currentSlide]) dots[currentSlide].classList.add('active');
    }
    
    function nextSlide() {
        if (state.loginBgMode === 'animation') return;
        goToSlide(currentSlide + 1);
    }
    
    // Click on dot to jump to slide
    dots.forEach(dot => {
        dot.addEventListener('click', () => {
            const idx = parseInt(dot.getAttribute('data-slide'), 10);
            goToSlide(idx);
            resetTimer();
        });
    });
    
    function resetTimer() {
        if (loginSlideshowTimer) clearInterval(loginSlideshowTimer);
        loginSlideshowTimer = setInterval(() => {
            const overlay = document.getElementById('login-overlay');
            if (!overlay || overlay.style.display === 'none') {
                clearInterval(loginSlideshowTimer);
                return;
            }
            nextSlide();
        }, 6000);
    }
    
    resetTimer();
}

function initLoginParticles() {
    const container = document.getElementById('login-particles');
    if (!container) return;
    
    if(container) container.innerHTML = '';
    const particles = [];
    const numParticles = 35;
    
    for (let i = 0; i < numParticles; i++) {
        const el = document.createElement('div');
        el.className = 'login-particle';
        
        const size = Math.random() * 6 + 2;
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        
        // Blue dominant with occasional red
        const isRed = Math.random() < 0.25;
        if (isRed) {
            el.style.background = `radial-gradient(circle, rgba(239,68,68,${0.4 + Math.random()*0.3}), transparent 70%)`;
        } else {
            el.style.background = `radial-gradient(circle, rgba(59,130,246,${0.4 + Math.random()*0.3}), transparent 70%)`;
        }
        el.style.boxShadow = isRed 
            ? `0 0 ${size*2}px rgba(239,68,68,0.3)` 
            : `0 0 ${size*2}px rgba(59,130,246,0.3)`;
        
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        el.style.left = x + '%';
        el.style.top = y + '%';
        
        if(container) container.appendChild(el);
        
        particles.push({
            el: el,
            baseX: x,
            baseY: y,
            phaseX: Math.random() * Math.PI * 2,
            phaseY: Math.random() * Math.PI * 2,
            speedX: 0.003 + Math.random() * 0.008,
            speedY: 0.003 + Math.random() * 0.008,
            amplitude: 30 + Math.random() * 50,
            size: size,
            offsetX: 0,
            offsetY: 0
        });
    }
    
    // Track mouse
    let mouseX = -9999;
    let mouseY = -9999;
    const overlay = document.getElementById('login-overlay');
    
    if (overlay) {
        overlay.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        });
        overlay.addEventListener('mouseleave', () => {
            mouseX = -9999;
            mouseY = -9999;
        });
        // Touch support
        overlay.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                mouseX = e.touches[0].clientX;
                mouseY = e.touches[0].clientY;
            }
        }, { passive: true });
        overlay.addEventListener('touchend', () => {
            mouseX = -9999;
            mouseY = -9999;
        });
    }
    
    function animateParticles() {
        if (!overlay || overlay.style.display === 'none') return;
        
        const rect = overlay.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        
        particles.forEach(p => {
            p.phaseX += p.speedX;
            p.phaseY += p.speedY;
            const floatX = Math.sin(p.phaseX) * p.amplitude;
            const floatY = Math.cos(p.phaseY) * p.amplitude;
            
            // Mouse attraction / glow effect
            let attractX = 0;
            let attractY = 0;
            let glowScale = 1;
            
            if (mouseX > 0 && mouseY > 0) {
                const pxX = (p.baseX / 100) * w + floatX + p.offsetX;
                const pxY = (p.baseY / 100) * h + floatY + p.offsetY;
                const dx = mouseX - rect.left - pxX;
                const dy = mouseY - rect.top - pxY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const maxDist = 180;
                
                if (dist < maxDist) {
                    const force = (maxDist - dist) / maxDist;
                    // Gentle attraction toward the mouse
                    attractX = dx * force * 0.15;
                    attractY = dy * force * 0.15;
                    // Glow bigger near mouse
                    glowScale = 1 + force * 2.5;
                }
            }
            
            // Smooth interpolation
            p.offsetX += (attractX - p.offsetX) * 0.06;
            p.offsetY += (attractY - p.offsetY) * 0.06;
            
            const tx = floatX + p.offsetX;
            const ty = floatY + p.offsetY;
            
            p.el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${glowScale})`;
            p.el.style.opacity = Math.min(1, 0.4 + (glowScale - 1) * 0.3);
        });
        
        requestAnimationFrame(animateParticles);
    }
    
    requestAnimationFrame(animateParticles);
}

// ==========================================================================
// ==========================================================================
// DYNAMIC REPORTS & EXPORT BUILDER (Preview & Export Center)
// ==========================================================================

let EXPORT_DICTIONARY = {};

let currentExportState = {
    context: 'dashboard'
};

let exportReportData = {
    month: '',
    expenses: [],
    attachments: [],
    foodExpenses: [],
    loading: null,
};

// Preview อาจถูกสร้างหลายรอบระหว่างผู้ใช้กำลังพิมพ์หัวข้อรายงาน.
// QR เดิมต้องใช้ได้กับเลขเอกสาร/เดือน/ยอดชุดเดิม จึงเก็บ Promise ไว้ใน memory
// เพื่อไม่ให้ preview ซ้ำ ๆ เขียน system_config หรือเรียก Apps Script เกินจำเป็น.
const exportVerifyCodeCache = new Map();

function getExportVerifyCacheKey(payload) {
    return [
        payload.docNumber || '',
        payload.month || '',
        payload.orgId || '',
        Number(payload.itemCount) || 0,
        Number(payload.attachmentCount) || 0,
        Number(payload.totalAmount) || 0,
    ].join('|');
}

async function getCachedExportVerifyCode(payload) {
    const cacheKey = getExportVerifyCacheKey(payload);
    if (!exportVerifyCodeCache.has(cacheKey)) {
        const request = apiCall('getExportVerifyCode', payload).catch(err => {
            exportVerifyCodeCache.delete(cacheKey);
            throw err;
        });
        exportVerifyCodeCache.set(cacheKey, request);
    }
    return exportVerifyCodeCache.get(cacheKey);
}

async function fetchAllExpensesForReportMonth(month) {
    return fetchAllExpensesForMonth(month);
}

async function fetchAllFoodExpensesForReportMonth(month) {
    return fetchAllFoodExpensesForMonth(month);
}

async function ensureExportReportData(month, force = false) {
    const reportMonth = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : getSelectedPostingMonth();
    if (!force && exportReportData.month === reportMonth && !exportReportData.loading) return exportReportData;
    if (!force && exportReportData.month === reportMonth && exportReportData.loading) return exportReportData.loading;

    const request = Promise.all([
        fetchAllExpensesForReportMonth(reportMonth),
        fetchAllFoodExpensesForReportMonth(reportMonth),
    ]).then(([expenses, foodExpenses]) => {
        exportReportData.month = reportMonth;
        exportReportData.expenses = expenses.filter(x => x.id && x.id.startsWith('EXP'));
        exportReportData.attachments = expenses.filter(x => x.id && x.id.startsWith('ATT'));
        exportReportData.foodExpenses = foodExpenses;
        exportReportData.loading = null;
        return exportReportData;
    }).catch(err => {
        exportReportData.loading = null;
        throw err;
    });
    exportReportData.month = reportMonth;
    exportReportData.loading = request;
    return request;
}

// 1. Dynamic Field Generator
function extractSchemaFromData(dataArray) {
    if (!dataArray || dataArray.length === 0) return [];
    
    let allKeys = new Set();
    dataArray.forEach(item => {
        if (item) Object.keys(item).forEach(k => allKeys.add(k));
    });
    
    return Array.from(allKeys).map(key => {
        let label = key;
        let type = 'string';
        let isDefault = true;
        
        const dictionary = {
            id: 'รหัสอ้างอิง', documentNo: 'เลขที่เอกสาร', receiptNo: 'เล่มที่ / เลขที่ใบเสร็จ', expenseDate: 'วันที่',
            month: 'เดือน', year: 'ปี', projectId: 'รหัสโครงการ', projectName: 'ชื่อโครงการ', 
            categoryId: 'รหัสหมวดหมู่', categoryName: 'หมวดหมู่', description: 'รายละเอียด', 
            amount: 'จำนวนเงิน', totalAmount: 'รวมเงิน', vat: 'VAT', recordedBy: 'ผู้บันทึก', 
            timestamp: 'วันที่บันทึก', status: 'สถานะ', note: 'หมายเหตุ', dormitory: 'หอพัก', 
            responsiblePerson: 'ผู้รับผิดชอบ', claimNo: 'เลขชุดเบิก', itemsCount: 'จำนวนรายการ'
        };
        
        if (dictionary[key]) label = dictionary[key];
        else {
            label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        }
        
        if (key.toLowerCase().includes('date') || key === 'timestamp') type = 'date';
        if (key.toLowerCase().includes('amount') || key === 'vat' || key === 'price' || key === 'budget') type = 'currency';
        if (key === 'status') type = 'status';
        
        if (key === 'id' || key === 'attachments' || key === '_categoryConfig') isDefault = false;
        
        return { id: key, label: label, default: isDefault, type: type, source: key.includes('project') ? 'projects' : (key.includes('category') ? 'categories' : null) };
    });
}

// 2. Dynamic Menu Detection & Context Builder

function buildDynamicExportDictionary(context) {
    let dictionary = {};
    
    if (context === 'dashboard' || context === 'summary-view') {
        dictionary['summary'] = {
            label: context === 'dashboard' ? 'แดชบอร์ดภาพรวมระบบ' : 'รายงานสรุปรายปี',
            getData: () => {
                let totalExp = state.expenses.reduce((s,x)=>s+(parseFloat(x.amount)||0), 0);
                let totalFood = state.foodExpenses.reduce((s,x)=>s+(parseFloat(x.totalAmount)||0), 0);
                let totalClaims = state.claims.reduce((s,x)=>s+(parseFloat(x.totalAmount)||0), 0);
                return [
                    { metric: 'สรุปจำนวนรายการทั้งหมด', value: state.expenses.length + state.foodExpenses.length, type: 'number' },
                    { metric: 'สรุปรายจ่ายทั้งหมด', value: totalExp + totalFood, type: 'currency' },
                    { metric: 'สรุปยอดส่งเบิก', value: totalClaims, type: 'currency' },
                    { metric: 'ยอดคงเหลือ', value: 0, type: 'currency' },
                    { metric: 'จำนวนชุดเบิก', value: state.claims.length, type: 'number' }
                ];
            },
            fields: [
                { id: 'metric', label: 'รายการสรุป', default: true },
                { id: 'value', label: 'จำนวน', default: true, type: 'currency' }
            ]
        };
    } else if (context === 'bills-table' || context === 'expenses' || context === 'expense') {
        dictionary['expenses'] = {
            label: 'รายละเอียดรายการบิลประจำเดือน',
            getData: () => state.expenses,
            fields: [
                { id: 'documentNo', label: 'เลขที่เอกสาร', default: true },
                { id: 'receiptNo', label: 'เล่มที่ / เลขที่ใบเสร็จ', default: true },
                { id: 'expenseDate', label: 'วันที่', default: true, type: 'date' },
                { id: 'projectId', label: 'โครงการ', default: true, source: 'projects' },
                { id: 'categoryId', label: 'หมวดรายจ่าย', default: true, source: 'categories' },
                { id: 'description', label: 'รายละเอียด', default: true },
                { id: 'quantity', label: 'จำนวน', default: true, type: 'number' },
                { id: 'unitPrice', label: 'ราคาต่อหน่วย', default: true, type: 'currency' },
                { id: 'vat', label: 'VAT', default: true, type: 'currency' },
                { id: 'amount', label: 'ยอดรวม', default: true, type: 'currency' },
                { id: 'vendorId', label: 'ผู้ขาย', default: true },
                { id: 'recordedBy', label: 'ผู้บันทึก', default: true },
                { id: 'timestamp', label: 'วันที่บันทึก', default: false, type: 'date' },
                { id: 'note', label: 'หมายเหตุ', default: true },
                { id: 'status', label: 'สถานะ', default: true, type: 'status' }
            ]
        };
    } else if (context === 'food-expenses' || context === 'food' || context === 'food-overview') {
         dictionary['food'] = {
            label: 'ค่าอาหารประจำเดือน',
            getData: () => state.foodExpenses,
            fields: [
                { id: 'expenseDate', label: 'เดือน/ปี', default: true, type: 'date' },
                { id: 'dormitory', label: 'หอพัก', default: true },
                { id: 'responsiblePerson', label: 'ผู้รับผิดชอบ', default: true },
                { id: 'description', label: 'รายการวัตถุดิบ', default: true },
                { id: 'quantity', label: 'จำนวน', default: true, type: 'number' },
                { id: 'unit', label: 'หน่วย', default: true },
                { id: 'unitPrice', label: 'ราคาต่อหน่วย', default: true, type: 'currency' },
                { id: 'totalAmount', label: 'รวมเงิน', default: true, type: 'currency' },
                { id: 'recordedBy', label: 'ผู้บันทึก', default: true },
                { id: 'note', label: 'หมายเหตุ', default: true }
            ]
         };
    } else if (context === 'claims-view' || context === 'claims') {
         dictionary['claims'] = {
            label: 'ข้อมูลชุดเบิก (Claims)',
            getData: () => state.claims,
            fields: [
                { id: 'claimNo', label: 'เลขชุดเบิก', default: true },
                { id: 'date', label: 'วันที่สร้างชุดเบิก', default: true, type: 'date' },
                { id: 'projectId', label: 'ชื่อโครงการ', default: true, source: 'projects' },
                { id: 'itemCount', label: 'จำนวนรายการ', default: true, type: 'number' },
                { id: 'totalAmount', label: 'ยอดรวม', default: true, type: 'currency' },
                { id: 'preparer', label: 'ผู้จัดทำ', default: true },
                { id: 'checker', label: 'ผู้ตรวจสอบ', default: true },
                { id: 'approver', label: 'ผู้อนุมัติ', default: true },
                { id: 'status', label: 'สถานะ', default: true, type: 'status' },
                { id: 'note', label: 'หมายเหตุ', default: true }
            ]
         };
    } else if (context === 'fund-receipts') {
         dictionary['fundReceipts'] = {
            label: 'เอกสารรับเงินทุนประจำเดือน',
            getData: () => state.fundReceipts,
            fields: [
                { id: 'month', label: 'เดือน', default: true },
                { id: 'amount', label: 'จำนวนเงิน', default: true, type: 'currency' },
                { id: 'note', label: 'หมายเหตุ', default: true },
                { id: 'fileName', label: 'ชื่อไฟล์แนบ', default: true },
                { id: 'createdAt', label: 'วันที่บันทึก', default: false, type: 'date' }
            ]
         };
    } else if (context === 'spreadsheet-view') {
         dictionary['spreadsheet'] = {
            label: 'สเปรดชีตส่งเบิก (Accounting Format)',
            getData: () => state.expenses, // use expenses for spreadsheet view
            fields: [
                { id: 'documentNo', label: 'เลขที่เอกสาร', default: true },
                { id: 'expenseDate', label: 'วันที่', default: true, type: 'date' },
                { id: 'description', label: 'รายการ', default: true },
                { id: 'projectId', label: 'โครงการ', default: true, source: 'projects' },
                { id: 'categoryId', label: 'หมวดรายจ่าย', default: true, source: 'categories' },
                { id: 'amount', label: 'จำนวนเงิน', default: true, type: 'currency' },
                { id: 'documentNo', label: 'หมายเลขบิล', default: true },
                { id: 'vendorId', label: 'ผู้ขาย', default: true },
                { id: 'recordedBy', label: 'ผู้บันทึก', default: true }
            ]
         };
    } else {
        dictionary['expenses'] = { label: 'รายการบิลทั่วไป', getData: () => state.expenses, fields: extractSchemaFromData(state.expenses) };
        dictionary['food'] = { label: 'ค่าอาหารประจำเดือน', getData: () => state.foodExpenses, fields: extractSchemaFromData(state.foodExpenses) };
    }
    
    // Auto append dynamic fields that are not defined above (Schema Sync)
    Object.keys(dictionary).forEach(key => {
        const data = dictionary[key].getData();
        if (data && data.length > 0) {
            const dynamicFields = extractSchemaFromData(data);
            dynamicFields.forEach(df => {
                if (!dictionary[key].fields.find(f => f.id === df.id)) {
                    df.default = false; // new fields hide by default
                    dictionary[key].fields.push(df);
                }
            });
        }
    });

    return dictionary;
}

async function openExportModal(context) {
    currentExportState.context = context || 'dashboard';
    (document.getElementById('pdf-export-mode') || {}).value = currentExportState.context;
    const reportMonthInput = document.getElementById('export-report-month');
    if (reportMonthInput && !reportMonthInput.value) reportMonthInput.value = getSelectedPostingMonth();

    // Auto titles
    const titleInput = document.getElementById('pdf-report-title');
    const titles = {
        'dashboard': 'รายงานภาพรวมระบบ', 'summary-view': 'รายงานสรุปประจำปี',
        'bills-table': 'รายงานสรุปรายการบิล', 'expenses': 'รายงานสรุปรายการบิล', 'expense': 'รายงานสรุปรายการบิล',
        'food-expenses': 'รายงานค่าอาหารประจำเดือน', 'food': 'รายงานค่าอาหารประจำเดือน',
        'claims-view': 'รายงานจัดกลุ่มส่งเบิก', 'spreadsheet-view': 'สเปรดชีตบัญชี', 'claims': 'รายงานจัดกลุ่มส่งเบิก', 'spreadsheet': 'สเปรดชีตบัญชี',
        'master-data': 'รายงาน Master Data'
    };
    titleInput.value = titles[currentExportState.context] || 'รายงานสรุป';

    // ตัวกรององค์กร — เห็นเฉพาะ admin เพราะมีแค่ admin ที่เห็นข้อมูลข้ามสถานศึกษา
    const orgFilterWrap = document.getElementById('export-org-filter-wrap');
    const orgFilterSel = document.getElementById('export-org-filter');
    if (orgFilterWrap && orgFilterSel) {
        if (getCurrentUserRole() === 'admin') {
            orgFilterWrap.style.display = '';
            if (orgFilterSel.options.length === 0) {
                orgFilterSel.innerHTML = '<option value="">ทั้งหมด (รวมทุกสถานศึกษา)</option>' +
                    (state.organizations || []).map(o => `<option value="${o.id}">${escapeHTML(o.name)}</option>`).join('');
            }
        } else {
            orgFilterWrap.style.display = 'none';
        }
    }

    const modal = document.getElementById('modal-export-pdf');
    modal.style.display = 'flex';
    modal.classList.add('active');
    syncExportReportTypeUI(false);
    updateExportPreviewPaperSize(getExportPageOrientation());

    loadExportTemplatesList();
    const reportMonth = (document.getElementById('export-report-month') || {}).value || getSelectedPostingMonth();
    try {
        await ensureExportReportData(reportMonth, true);
        updateExportSectionBadges();
    } catch (err) {
        appAlert('โหลดข้อมูลสำหรับรายงานไม่สำเร็จ: ' + err.message, 'error');
    }
    await loadSignatureLibrary();
    renderSignatureControls();
    renderExportPreview();
}

function closeExportModal() {
    const modal = document.getElementById('modal-export-pdf');
    modal.style.display = 'none';
    modal.classList.remove('active');
}

window.onExportReportMonthChange = async function() {
    autoFillExportDocNumber();
    const reportMonth = (document.getElementById('export-report-month') || {}).value || getSelectedPostingMonth();
    try {
        await ensureExportReportData(reportMonth, true);
        updateExportSectionBadges();
        renderExportPreview();
    } catch (err) {
        appAlert('โหลดข้อมูลของเดือนที่เลือกไม่สำเร็จ: ' + err.message, 'error');
    }
};

// ==========================================================================
// Export data source — single source of truth shared by preview, PDF, Excel/CSV
// and the per-section "ดาวน์โหลด" buttons. Reads from `state` (filtered by the
// month picked in #export-report-month), never from the DOM, so it can't pick
// up stray rows like the always-present inline quick-add row.
// ==========================================================================
function buildExportSectionData(section) {
    const reportMonth = (document.getElementById('export-report-month') || {}).value || '';
    const contextReady = exportReportData.month === reportMonth && !exportReportData.loading;

    // ตัวกรององค์กร — มีผลเฉพาะ admin (เห็นข้อมูลข้ามสถานศึกษาอยู่แล้ว), ผู้ใช้ทั่วไปไม่มี dropdown นี้อยู่แล้ว
    const orgFilterSel = document.getElementById('export-org-filter');
    const orgFilter = (orgFilterSel && getCurrentUserRole() === 'admin') ? orgFilterSel.value : '';
    const inOrg = (x) => !orgFilter || x.organizationId === orgFilter;

    if (section === 'bills' || section === 'attach') {
        const source = contextReady
            ? (section === 'bills' ? exportReportData.expenses : exportReportData.attachments)
            : (section === 'bills' ? (state.expenses || []) : (state.attachments || []));
        const rows = source
            .filter(x => (!reportMonth || getExpensePostingMonth(x) === reportMonth) && inOrg(x))
            .map(x => ({
                id: x.id,
                docNo: x.documentNo || '',
                receiptNo: x.receiptNo || '',
                date: x.expenseDate || '',
                postingMonth: getExpensePostingMonth(x),
                project: getProjectName(x.projectId),
                category: getCategoryName(x.categoryId),
                vendor: getVendorName(x.vendorId),
                amount: parseFloat(x.amount) || 0,
                claimType: x.claimable ? 'เบิกมูลนิธิ' : 'ไม่เบิก',
                attachmentsCount: (attachmentStore[x.id] || []).length
            }));

        if (section === 'bills') {
            const sortBy = (document.getElementById('export-sort-by') || {}).value || 'date';
            const sortOrder = (document.getElementById('export-sort-order') || {}).value || 'asc';
            rows.sort((a, b) => {
                let va = a[sortBy], vb = b[sortBy];
                if (sortBy === 'amount') { va = va || 0; vb = vb || 0; }
                else { va = String(va || ''); vb = String(vb || ''); }
                if (va < vb) return sortOrder === 'asc' ? -1 : 1;
                if (va > vb) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return rows;
    }

    if (section === 'food') {
        const foodSource = contextReady ? exportReportData.foodExpenses : (state.foodExpenses || []);
        return foodSource
            .filter(x => (!reportMonth || getFoodPostingMonth(x) === reportMonth) && inOrg(x))
            .map(x => ({
                id: x.id,
                foodDate: x.date || '',
                postingMonth: getFoodPostingMonth(x),
                foodName: x.name || '',
                foodCategory: x.category || '',
                foodAmount: parseFloat(x.totalAmount) || 0
            }))
            .sort((a, b) => String(a.foodDate || '').localeCompare(String(b.foodDate || '')));
    }

    return [];
}

// เติม attachmentStore ให้ครบสำหรับแถวที่จะส่งออก — attachmentStore ปกติจะมีแค่บิลที่ผู้ใช้เคยเปิดมอดัลดูระหว่าง
// เซสชันนี้เท่านั้น (แคชแบบ lazy) ตอนสร้างรายงานจึงต้องเรียก endpoint เดิม (getAttachments/getFoodExpenseById)
// เติมของที่ยังไม่มีในแคชก่อนเสมอ ไม่ได้เพิ่ม endpoint ใหม่ แค่เรียกของเดิมเป็นชุด
async function ensureAttachmentsLoaded(rows, section) {
    const missing = rows.filter(r => !attachmentStore[r.id]);
    if (missing.length === 0) return [];
    const errors = [];

    if (section === 'food') {
        await mapWithConcurrency(missing, ATTACHMENT_LOAD_CONCURRENCY, async r => {
            try {
                const res = await apiCall('getFoodExpenseById', { id: r.id });
                const files = [];
                (res.items || []).forEach(item => (item.attachments || []).forEach(a => files.push(a)));
                attachmentStore[r.id] = files;
            } catch (err) {
                errors.push({ id: r.id, message: err && err.message ? err.message : 'โหลดหลักฐานไม่สำเร็จ' });
            }
        });
    } else {
        await mapWithConcurrency(missing, ATTACHMENT_LOAD_CONCURRENCY, async r => {
            try {
                const res = await apiCall('getAttachments', { expenseId: r.id });
                attachmentStore[r.id] = res.attachments || [];
            } catch (err) {
                errors.push({ id: r.id, message: err && err.message ? err.message : 'โหลดหลักฐานไม่สำเร็จ' });
            }
        });
    }
    return errors;
}

// ดึงรูปจาก URL (ไฟล์ Google Drive) มาแปลงเป็น base64 data URL — pdfmake ฝังรูปในเอกสารได้เฉพาะ base64
// เท่านั้น ไม่รองรับ URL ภายนอกตรงๆ — ถ้าดึงไม่สำเร็จ (เครือข่าย/CORS/ไฟล์ถูกลบ) คืน null แบบ graceful
// ให้ผู้เรียกใส่ลิงก์อ้างอิงแทนรูปแทน ไม่ทำให้การสร้างรายงานทั้งฉบับล้ม
async function fetchImageAsDataUrl(url) {
    if (!url) return null;
    try {
        const res = await fetch(url, { headers: { Accept: 'image/*' } });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (!blob.type || !blob.type.startsWith('image/')) return null;
        return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        return null;
    }
}

function inferAttachmentMime(file) {
    const explicit = file.fileType || file.mimeType || '';
    if (explicit) return explicit;
    const name = String(file.originalFileName || file.fileName || file.storedFileName || file.name || '').toLowerCase();
    if (/\.(jpe?g)$/.test(name)) return 'image/jpeg';
    if (/\.png$/.test(name)) return 'image/png';
    if (/\.webp$/.test(name)) return 'image/webp';
    if (/\.gif$/.test(name)) return 'image/gif';
    if (/\.pdf$/.test(name)) return 'application/pdf';
    return '';
}

function getAttachmentUrl(file) {
    return file.fileUrl || file.viewUrl || file.url || file.thumbnailUrl || '';
}

async function getAttachmentImageDataUrl(file) {
    if (file && file._cachedImageDataUrl) return file._cachedImageDataUrl;
    if (file.dataUrl && String(file.dataUrl).startsWith('data:image/')) return file.dataUrl;
    const attachmentId = file.id || file.attachmentId;
    if (attachmentId) {
        try {
            const res = await apiCall('getAttachmentDataUrl', { attachmentId });
            if (res.dataUrl && String(res.dataUrl).startsWith('data:image/')) {
                file._cachedImageDataUrl = res.dataUrl;
                return file._cachedImageDataUrl;
            }
        } catch (err) {
            // Fallback below covers old deployments that do not have this endpoint yet.
        }
    }
    const dataUrl = await fetchImageAsDataUrl(getAttachmentUrl(file));
    if (dataUrl) file._cachedImageDataUrl = dataUrl;
    return dataUrl;
}

// รูปใบเสร็จจากโทรศัพท์มักมีความละเอียดสูงกว่าที่ A4 ต้องใช้มาก. ย่อเฉพาะ
// สำเนาที่ฝังใน PDF (ไม่แก้ไฟล์จริงใน Drive) เพื่อลดหน่วยความจำและเวลา preview.
async function optimizeImageDataUrlForPdf(file, dataUrl) {
    if (!dataUrl) return null;
    if (file && file._cachedReportImageDataUrl) return file._cachedReportImageDataUrl;
    if (typeof Image === 'undefined' || typeof document === 'undefined') return dataUrl;

    return new Promise(resolve => {
        const image = new Image();
        image.onload = () => {
            const naturalWidth = image.naturalWidth || image.width || 0;
            const naturalHeight = image.naturalHeight || image.height || 0;
            if (!naturalWidth || !naturalHeight) {
                resolve(dataUrl);
                return;
            }

            const scale = Math.min(
                1,
                REPORT_EMBEDDED_IMAGE_MAX_WIDTH / naturalWidth,
                REPORT_EMBEDDED_IMAGE_MAX_HEIGHT / naturalHeight
            );
            const shouldReencode = scale < 1 || dataUrl.length > 1600000;
            if (!shouldReencode) {
                if (file) file._cachedReportImageDataUrl = dataUrl;
                resolve(dataUrl);
                return;
            }

            try {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(naturalHeight * scale));
                const context = canvas.getContext('2d');
                if (!context) {
                    resolve(dataUrl);
                    return;
                }
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                const optimized = canvas.toDataURL('image/jpeg', REPORT_EMBEDDED_IMAGE_QUALITY);
                if (file) file._cachedReportImageDataUrl = optimized;
                resolve(optimized);
            } catch (err) {
                resolve(dataUrl);
            }
        };
        image.onerror = () => resolve(dataUrl);
        image.src = dataUrl;
    });
}

// Which .export-col-chk / .export-food-col values are currently checked
function getExportSelectedColumns(selector) {
    return Array.from(document.querySelectorAll(selector))
        .filter(el => el.checked)
        .map(el => el.value);
}

// เลขที่เอกสารอัตโนมัติ — ผูกกับ (สถานศึกษา + เดือน) แบบ deterministic (ไม่มี running number)
// รูปแบบ RDF-<รหัสย่อสถานศึกษา>-<พ.ศ.><เดือน 2 หลัก> เช่น RDF-MIS-256907
// องค์กร+เดือนเดียวกันได้เลขเดิมเสมอ → QR ตรวจสอบผูกกับเลขนี้ → เอกสารชุดเดิมได้ QR เดิม
function computeExportDocNumber() {
    const reportMonth = (document.getElementById('export-report-month') || {}).value || '';
    if (!reportMonth) return '';
    const [ceYearStr, mm] = reportMonth.split('-');
    const beYear = (parseInt(ceYearStr, 10) || 0) + 543;

    // หา org context: admin ใช้ตัวกรองในมอดัล (ถ้าเลือก), ผู้ใช้ทั่วไปใช้องค์กรตัวเอง
    const orgFilterSel = document.getElementById('export-org-filter');
    const currentUser = JSON.parse(localStorage.getItem('rdf_current_user') || '{}');
    let orgId = '';
    if (orgFilterSel && getCurrentUserRole() === 'admin' && orgFilterSel.value) {
        orgId = orgFilterSel.value;
    } else if (getCurrentUserRole() !== 'admin') {
        orgId = currentUser.organizationId || '';
    }

    let short = 'ALL'; // admin ดูรวมทุกสถานศึกษา หรือหา short ไม่เจอ
    if (orgId) {
        const org = (state.organizations || []).find(o => o.id === orgId);
        short = (org && (org.shortName || org.short_name)) || orgId;
    }
    return `RDF-${short}-${beYear}${mm}`;
}

// เติมเลขที่เอกสารอัตโนมัติลงช่อง (readonly) — เรียกทุกครั้งที่ตั้งค่ารายงานเปลี่ยน (เดือน/องค์กร)
function autoFillExportDocNumber() {
    const el = document.getElementById('export-doc-number');
    if (!el) return;
    el.value = computeExportDocNumber();
}

// ชนิดรายงานต้องเปลี่ยนเนื้อหา PDF จริง ไม่ใช่เพียงชื่อใน dropdown.
// หลักฐานจะถูกอ่านจาก Drive เฉพาะ report type ที่ต้องใช้เท่านั้น เพื่อลดเวลา
// preview และหลีกเลี่ยงการเรียก Apps Script โดยไม่จำเป็น.
const EXPORT_REPORT_TYPE_RULES = Object.freeze({
    summary: { detailed: false, needsEvidence: false, attachmentOnly: false, audit: false },
    detailed: { detailed: true, needsEvidence: false, attachmentOnly: false, audit: false },
    with_attachments: { detailed: true, needsEvidence: true, attachmentOnly: false, audit: false },
    only_attachments: { detailed: false, needsEvidence: true, attachmentOnly: true, audit: false },
    audit: { detailed: true, needsEvidence: true, attachmentOnly: false, audit: true },
});

function getExportReportType() {
    const value = (document.getElementById('export-report-type') || {}).value || 'summary';
    return Object.prototype.hasOwnProperty.call(EXPORT_REPORT_TYPE_RULES, value) ? value : 'summary';
}

function getExportPageOrientation() {
    const value = (document.getElementById('export-page-orientation') || {}).value || 'portrait';
    return value === 'landscape' ? 'landscape' : 'portrait';
}

function getExportReportOptions() {
    const type = getExportReportType();
    const rules = EXPORT_REPORT_TYPE_RULES[type];
    const imageToggle = document.querySelector('.att-chk[value="show_img"]');
    const fileToggle = document.querySelector('.att-chk[value="show_pdf"]');
    const qrToggle = document.querySelector('.att-chk[value="show_qr"]');
    return {
        type,
        detailed: rules.detailed,
        attachmentOnly: rules.attachmentOnly,
        audit: rules.audit,
        needsEvidence: rules.needsEvidence,
        showImages: rules.needsEvidence && !!(imageToggle && imageToggle.checked),
        showFileLinks: rules.needsEvidence && !!(fileToggle && fileToggle.checked),
        showQr: !!(qrToggle && qrToggle.checked),
        pageOrientation: getExportPageOrientation(),
    };
}

function updateExportPreviewPaperSize(orientation) {
    const frame = document.getElementById('export-preview-frame');
    if (!frame) return;
    const isLandscape = orientation === 'landscape';
    frame.style.width = isLandscape ? '297mm' : '210mm';
    frame.style.minHeight = isLandscape ? '210mm' : '297mm';
    frame.dataset.orientation = isLandscape ? 'landscape' : 'portrait';
}

function syncExportReportTypeUI(applyPreset) {
    const type = getExportReportType();
    const rules = EXPORT_REPORT_TYPE_RULES[type];
    const imageToggle = document.querySelector('.att-chk[value="show_img"]');
    const fileToggle = document.querySelector('.att-chk[value="show_pdf"]');
    const hint = document.getElementById('export-evidence-hint');

    [imageToggle, fileToggle].forEach(toggle => {
        if (!toggle) return;
        toggle.disabled = !rules.needsEvidence;
        if (!rules.needsEvidence) toggle.checked = false;
        const label = toggle.closest('label');
        if (label) {
            label.style.opacity = rules.needsEvidence ? '' : '0.55';
            label.style.cursor = rules.needsEvidence ? 'pointer' : 'not-allowed';
        }
    });

    if (applyPreset) {
        if (imageToggle) imageToggle.checked = rules.needsEvidence;
        if (fileToggle) fileToggle.checked = rules.needsEvidence;
    }

    if (hint) {
        const messages = {
            summary: 'รายงานสรุปจะไม่โหลดไฟล์หลักฐาน เพื่อสร้าง PDF ได้รวดเร็วขึ้น',
            detailed: 'รายงานละเอียดจะแสดงข้อมูลทุกช่องที่เกี่ยวข้อง โดยไม่โหลดไฟล์หลักฐาน',
            with_attachments: 'ฝังรูปหลักฐานและแสดงลิงก์ PDF/ไฟล์อ้างอิงที่เลือกไว้',
            only_attachments: 'แสดงเฉพาะหลักฐานที่ผูกกับแต่ละรายการ เหมาะสำหรับแนบเป็นภาคผนวก',
            audit: 'แสดงรายละเอียด, หลักฐาน และสรุปสำหรับตรวจสอบบัญชี',
        };
        hint.textContent = messages[type];
    }
}

window.onExportReportTypeChange = function() {
    syncExportReportTypeUI(true);
    renderExportPreview();
};

window.onExportPageOrientationChange = function() {
    updateExportPreviewPaperSize(getExportPageOrientation());
    renderExportPreview();
};

// Footer "เลือกทั้งหมด" / "ยกเลิกทั้งหมด" — toggles every column checkbox in the modal
function toggleAllExportCheckboxes(check) {
    document.querySelectorAll('.export-col-chk, .export-food-col, .att-chk').forEach(el => { el.checked = check; });
    renderExportPreview();
}

// 4. Report Templates
function saveExportTemplate() {
    const templateName = prompt('ตั้งชื่อ Template นี้ (เช่น รายงานส่งมูลนิธิ RDF):');
    if (!templateName) return;

    let templates = JSON.parse(localStorage.getItem('rdf_export_templates') || '{}');
    templates[templateName] = {
        context: currentExportState.context,
        title: document.getElementById('pdf-report-title').value,
        orgName: (document.getElementById('export-org-name') || {}).value || '',
        docNumber: (document.getElementById('export-doc-number') || {}).value || '',
        headerDetail: (document.getElementById('export-header-detail') || {}).value || '',
        type: (document.getElementById('export-report-type') || {}).value || 'summary',
        pageOrientation: getExportPageOrientation(),
        sortBy: (document.getElementById('export-sort-by') || {}).value || 'date',
        sortOrder: (document.getElementById('export-sort-order') || {}).value || 'asc',
        inclBills: (document.getElementById('export-chk-bills') || {}).checked,
        inclFood: (document.getElementById('export-chk-food') || {}).checked,
        inclAttach: (document.getElementById('export-chk-attach') || {}).checked,
        billCols: getExportSelectedColumns('.export-col-chk'),
        foodCols: getExportSelectedColumns('.export-food-col'),
        att: {
            img: document.querySelector('.att-chk[value="show_img"]') ? document.querySelector('.att-chk[value="show_img"]').checked : false,
            pdf: document.querySelector('.att-chk[value="show_pdf"]') ? document.querySelector('.att-chk[value="show_pdf"]').checked : false,
            qr: document.querySelector('.att-chk[value="show_qr"]') ? document.querySelector('.att-chk[value="show_qr"]').checked : false
        }
    };
    localStorage.setItem('rdf_export_templates', JSON.stringify(templates));
    appAlert('บันทึก Template สำเร็จ!', 'success');
    loadExportTemplatesList();
}

function loadExportTemplatesList() {
    const sel = document.getElementById('export-template-select');
    if(!sel) return;
    if(sel) sel.innerHTML = '<option value="">-- โหลด Template --</option>';
    let templates = JSON.parse(localStorage.getItem('rdf_export_templates') || '{}');
    Object.keys(templates).forEach(k => {
        sel.innerHTML += `<option value="${k}">${escapeHTML(k)} (${templates[k].context})</option>`;
    });
}

function loadExportTemplate(name) {
    if (!name) return;
    let templates = JSON.parse(localStorage.getItem('rdf_export_templates') || '{}');
    let t = templates[name];
    if (!t) return;

    currentExportState.context = t.context || currentExportState.context;

    (document.getElementById('pdf-report-title') || {}).value = t.title || '';
    (document.getElementById('export-org-name') || {}).value = t.orgName || '';
    (document.getElementById('export-doc-number') || {}).value = t.docNumber || '';
    (document.getElementById('export-header-detail') || {}).value = t.headerDetail || '';
    if(document.getElementById('export-report-type')) (document.getElementById('export-report-type') || {}).value = t.type || 'summary';
    if(document.getElementById('export-page-orientation')) (document.getElementById('export-page-orientation') || {}).value = t.pageOrientation === 'landscape' ? 'landscape' : 'portrait';
    if(document.getElementById('export-sort-by')) (document.getElementById('export-sort-by') || {}).value = t.sortBy || 'date';
    if(document.getElementById('export-sort-order')) (document.getElementById('export-sort-order') || {}).value = t.sortOrder || 'asc';

    (document.getElementById('export-chk-bills') || {}).checked = t.inclBills !== false;
    (document.getElementById('export-chk-food') || {}).checked = t.inclFood !== false;
    (document.getElementById('export-chk-attach') || {}).checked = t.inclAttach !== false;

    document.querySelectorAll('.export-col-chk').forEach(el => {
        el.checked = !t.billCols || t.billCols.includes(el.value);
    });
    document.querySelectorAll('.export-food-col').forEach(el => {
        el.checked = !t.foodCols || t.foodCols.includes(el.value);
    });

    if (t.att) {
        if(document.querySelector('.att-chk[value="show_img"]')) document.querySelector('.att-chk[value="show_img"]').checked = t.att.img;
        if(document.querySelector('.att-chk[value="show_pdf"]')) document.querySelector('.att-chk[value="show_pdf"]').checked = t.att.pdf;
        if(document.querySelector('.att-chk[value="show_qr"]')) document.querySelector('.att-chk[value="show_qr"]').checked = t.att.qr;
    }

    syncExportReportTypeUI(false);
    updateExportPreviewPaperSize(getExportPageOrientation());
    renderExportPreview();
}

// ==========================================================================
// รายงาน (PDF) — Section "หลักฐานแนบ": สำหรับแต่ละแถวที่มีไฟล์แนบจริง สร้างชุด
// {รายละเอียด 7 ฟิลด์, รูปที่ฝังได้เป็น base64, ไฟล์ที่ฝังไม่ได้ให้ใช้ลิงก์อ้างอิงแทน}
// ==========================================================================
async function buildAttachmentItems(rows, section, showImg, showPdf) {
    if (!showImg && !showPdf) return [];
    const columnDefs = section === 'food' ? EXPORT_FOOD_COLUMNS : EXPORT_BILL_COLUMNS;
    const prepared = (rows || []).map(row => ({
        detail: columnDefs.map(c => ({ label: c.label, value: c.get(row) })),
        images: [],
        fileRefs: [],
        files: attachmentStore[row.id] || [],
    }));
    const imageJobs = [];

    prepared.forEach((item, rowIndex) => {
        item.files.forEach(file => {
            const mime = inferAttachmentMime(file);
            const url = getAttachmentUrl(file);
            const name = file.originalFileName || file.fileName || file.storedFileName || 'ไฟล์แนบ';
            if (mime.startsWith('image/')) {
                if (showImg) imageJobs.push({ rowIndex, file, mime, url, name });
                return;
            }
            if (showPdf) {
                const note = mime === 'application/pdf'
                    ? 'เปิด PDF หลักฐานจากลิงก์นี้'
                    : 'ไฟล์อ้างอิง — เปิดจากลิงก์นี้';
                item.fileRefs.push({ name, url, note });
            }
        });
    });

    // จำกัดจำนวนภาพที่อ่านพร้อมกันทั้งรายงาน ไม่ทำ nested Promise.all()
    // เพราะไฟล์รูปจาก Drive ขนาดมากอาจทำให้ preview ค้างหรือ Apps Script ถูกจำกัด quota.
    const imageResults = await mapWithConcurrency(
        imageJobs,
        ATTACHMENT_LOAD_CONCURRENCY,
        async job => {
            const dataUrl = await getAttachmentImageDataUrl(job.file);
            if (dataUrl) {
                const optimized = await optimizeImageDataUrlForPdf(job.file, dataUrl);
                return Object.assign({}, job, { dataUrl: optimized });
            }
            return Object.assign({}, job, { dataUrl: '' });
        }
    );

    imageResults.forEach(result => {
        if (!result) return;
        const item = prepared[result.rowIndex];
        if (!item) return;
        if (result.dataUrl) {
            item.images.push({
                src: result.dataUrl,
                name: result.name,
                caption: result.name,
                mime: result.mime,
                sizeBytes: parseInt(result.file.fileSize || result.file.compressedSize || 0, 10) || 0,
            });
        } else {
            item.fileRefs.push({ name: result.name, url: result.url, note: 'ไม่สามารถฝังรูปในเอกสารได้ — เปิดไฟล์ต้นฉบับจากลิงก์นี้' });
        }
    });

    return prepared
        .filter(item => item.images.length > 0 || item.fileRefs.length > 0)
        .map(item => ({
            detail: item.detail,
            images: item.images,
            fileRefs: item.fileRefs,
            fileCount: item.images.length + item.fileRefs.length,
        }));
}

// ==========================================================================
// Report Model — ชั้นกลางเดียวที่พรีวิว (PDF จริงในกรอบ) และปุ่มส่งออก PDF ใช้ร่วมกัน
// เพื่อไม่ให้ข้อมูลที่เห็นในพรีวิวกับไฟล์ที่ดาวน์โหลดจริงเพี้ยนกัน
// ==========================================================================
async function buildReportModel() {
    const orgName = (document.getElementById('export-org-name') || {}).value || '';
    const title = (document.getElementById('pdf-report-title') || {}).value || 'รายงานค่าใช้จ่าย';
    const subHeading = (document.getElementById('export-header-detail') || {}).value || '';
    const docNum = (document.getElementById('export-doc-number') || {}).value || '';
    const reportMonth = (document.getElementById('export-report-month') || {}).value || '';
    await ensureExportReportData(reportMonth);
    const reportOptions = getExportReportOptions();
    const logoSrc = (document.getElementById('export-logo-preview') || {}).dataset?.logoSrc || '';

    const inclSig = (document.getElementById('pdf-include-signature') || {}).checked;
    const preparer = (document.getElementById('pdf-preparer-name') || {}).value || '';
    const reviewer = (document.getElementById('pdf-reviewer-name') || {}).value || '';
    const approver = (document.getElementById('pdf-approver-name') || {}).value || '';
    if (inclSig) await ensureActiveSignaturesLoaded();
    const preparerImage = inclSig ? getActiveSignatureDataUrl('prepared') : '';
    const reviewerImage = inclSig ? getActiveSignatureDataUrl('checked') : '';
    const approverImage = inclSig ? getActiveSignatureDataUrl('approved') : '';

    const inclBills = (document.getElementById('export-chk-bills') || {}).checked;
    const inclFood = (document.getElementById('export-chk-food') || {}).checked;
    const inclAttach = (document.getElementById('export-chk-attach') || {}).checked;

    const billCols = getExportSelectedColumns('.export-col-chk');
    const foodCols = getExportSelectedColumns('.export-food-col');

    const showImg = reportOptions.showImages;
    const showPdf = reportOptions.showFileLinks;
    const showQr = reportOptions.showQr;

    let monthLabel = '';
    if (reportMonth) {
        const [y, m] = reportMonth.split('-');
        const thMonths = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
        monthLabel = thMonths[parseInt(m)] + ' พ.ศ. ' + (parseInt(y) + 543);
    }

    const sections = [];
    // ไม่ใช้ emoji ในหัวข้อ (ฟอนต์ Sarabun ไม่มี glyph emoji → แสดงเป็นกล่องว่างใน PDF) ใช้แถบสี accent ซ้ายแทน
    const specs = [
        { on: inclBills, key: 'bills', label: 'รายการบิล', accent: '#059669', columnDefs: EXPORT_BILL_COLUMNS, selCols: billCols },
        { on: inclFood, key: 'food', label: 'ค่าอาหารประจำเดือน', accent: '#f59e0b', columnDefs: EXPORT_FOOD_COLUMNS, selCols: foodCols },
        { on: inclAttach, key: 'attach', label: 'บิลแนบ / ค่าสาธารณูปโภค', accent: '#8b5cf6', columnDefs: EXPORT_BILL_COLUMNS, selCols: billCols },
    ];
    for (const spec of specs) {
        if (!spec.on) continue;
        const rows = buildExportSectionData(spec.key);
        const attachmentLoadErrors = reportOptions.needsEvidence && (showImg || showPdf)
            ? await ensureAttachmentsLoaded(rows, spec.key)
            : [];
        const attachmentItems = await buildAttachmentItems(rows, spec.key, showImg, showPdf);
        const attachmentCount = attachmentItems.reduce((sum, item) => sum + (Number(item.fileCount) || 0), 0);
        sections.push({
            key: spec.key,
            label: spec.label + (spec.key === 'bills' && monthLabel ? ' ประจำเดือน ' + monthLabel : ''),
            accent: spec.accent,
            columns: spec.columnDefs.filter(c => spec.selCols.includes(c.id)),
            rows,
            detailed: reportOptions.detailed,
            attachmentOnly: reportOptions.attachmentOnly,
            attachmentItems,
            attachmentCount,
            attachmentWarnings: attachmentLoadErrors,
        });
    }

    let qrDataUrl = '';
    let verifyCode = '';
    if (showQr && docNum) {
        try {
            const itemCount = sections.reduce((s, sec) => s + sec.rows.length, 0);
            const attachmentCount = sections.reduce((s, sec) => s + (Number(sec.attachmentCount) || 0), 0);
            const totalAmount = sections.reduce((s, sec) => s + sec.rows.reduce((s2, r) => s2 + (parseFloat(r.amount ?? r.foodAmount) || 0), 0), 0);
            const orgFilterSel = document.getElementById('export-org-filter');
            const currentUser = JSON.parse(localStorage.getItem('rdf_current_user') || '{}');
            const orgId = (orgFilterSel && getCurrentUserRole() === 'admin' && orgFilterSel.value) ? orgFilterSel.value : (currentUser.organizationId || '');
            const res = await getCachedExportVerifyCode({ docNumber: docNum, month: reportMonth, orgId, itemCount, attachmentCount, totalAmount });
            verifyCode = res.code || '';
            qrDataUrl = await generateVerifyQR('export', res.code);
        } catch (err) {
            console.warn('[export] สร้าง QR ตรวจสอบไม่สำเร็จ:', err && err.message);
            qrDataUrl = '';
        }
    }

    return {
        header: {
            orgName, title, subHeading, docNum, monthLabel, logoSrc, qrDataUrl, verifyCode,
            attachmentCount: sections.reduce((sum, section) => sum + (Number(section.attachmentCount) || 0), 0),
        },
        signature: inclSig ? { preparer, reviewer, approver, preparerImage, reviewerImage, approverImage } : null,
        sections,
        reportOptions,
    };
}

// 5. Exporters — column definitions (EXPORT_BILL_COLUMNS / EXPORT_FOOD_COLUMNS)
// are the same ones the preview renders from, so Excel/CSV always matches what's shown.
async function executeDynamicExport(format) {
    const reportMonth = (document.getElementById('export-report-month') || {}).value || getSelectedPostingMonth();
    try {
        await ensureExportReportData(reportMonth);
    } catch (err) {
        appAlert('โหลดข้อมูลสำหรับส่งออกไม่สำเร็จ: ' + err.message, 'error');
        return;
    }
    const inclBills = (document.getElementById('export-chk-bills') || {}).checked;
    const inclFood = (document.getElementById('export-chk-food') || {}).checked;
    const inclAttach = (document.getElementById('export-chk-attach') || {}).checked;

    const billCols = getExportSelectedColumns('.export-col-chk');
    const foodCols = getExportSelectedColumns('.export-food-col');

    const sections = [];
    if (inclBills) sections.push({ label: 'รายการบิล', rows: buildExportSectionData('bills'), cols: EXPORT_BILL_COLUMNS.filter(c => billCols.includes(c.id)) });
    if (inclFood) sections.push({ label: 'ค่าอาหารประจำเดือน', rows: buildExportSectionData('food'), cols: EXPORT_FOOD_COLUMNS.filter(c => foodCols.includes(c.id)) });
    if (inclAttach) sections.push({ label: 'บิลแนบ / ค่าสาธารณูปโภค', rows: buildExportSectionData('attach'), cols: EXPORT_BILL_COLUMNS.filter(c => billCols.includes(c.id)) });

    const hasAnyData = sections.some(s => s.rows.length > 0 && s.cols.length > 0);
    if (!hasAnyData) {
        appAlert('ระบบไม่สามารถดำเนินการได้: ไม่มีข้อมูลสำหรับส่งออก (Empty Data)');
        return;
    }

    // โหลด xlsx/pdfmake แบบ lazy (ปกติเตรียมไว้เบื้องหลังแล้ว → resolve ทันที)
    try {
        await ensureExportLibs();
    } catch (err) {
        appAlert('โหลดเครื่องมือส่งออกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง: ' + err.message, 'error');
        return;
    }

    if (format === 'excel' || format === 'csv') {
        const wb = XLSX.utils.book_new();
        sections.forEach(section => {
            if (section.rows.length === 0 || section.cols.length === 0) return;
            const exportData = section.rows.map(row => {
                let obj = {};
                section.cols.forEach(c => { obj[c.label] = c.get(row) ?? ''; });
                return obj;
            });
            const ws = XLSX.utils.json_to_sheet(exportData);
            XLSX.utils.book_append_sheet(wb, ws, section.label.substring(0, 31));
        });

        if (format === 'csv') {
            const firstSheet = wb.SheetNames[0];
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[firstSheet]);
            const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], {type: "text/csv;charset=utf-8"});
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `DynamicReport_${new Date().getTime()}.csv`;
            link.click();
        } else {
            XLSX.writeFile(wb, `DynamicReport_${new Date().getTime()}.xlsx`);
        }
    } else if (format === 'pdf') {
        showLoading(true);
        try {
            const model = await buildReportModel();
            const docDef = buildPdfDocDefinition(model);
            const filename = (model.header.docNum || model.header.title || 'DynamicReport').replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
            // download() เป็น async ใน pdfmake 0.3.x — ต้อง await เพื่อให้ error เข้า catch และ showLoading(false) รอจนเสร็จจริง
            await pdfMake.createPdf(docDef).download(filename);
        } catch (err) {
            appAlert('สร้าง PDF ไม่สำเร็จ: ' + err.message, 'error');
        } finally {
            showLoading(false);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('modal-export-pdf-close');
    if(closeBtn) closeBtn.addEventListener('click', closeExportModal);
    
    const cancelBtn = document.getElementById('btn-export-pdf-cancel');
    if(cancelBtn) cancelBtn.addEventListener('click', closeExportModal);
});


// ==========================================================================
// USER MANAGEMENT & PROFILE (Phase 12)
// ==========================================================================
// showUserProfile() itself now lives near the top of the file (merged with the
// sidebar-box version — both updated the same login-response user object).

function openUserProfileModal() {
    const userJson = localStorage.getItem('rdf_current_user');
    if (!userJson) return;
    const user = JSON.parse(userJson);
    
    document.getElementById('profile-modal-avatar-preview').src = user.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.name || user.username || user.id || 'User') + '&background=random';
    (document.getElementById('profile-modal-email') || {}).value = user.email || '';
    (document.getElementById('profile-current-password') || {}).value = '';
    (document.getElementById('profile-new-password') || {}).value = '';
    (document.getElementById('profile-modal-avatar') || {}).value = '';
    (document.getElementById('profile-modal-name') || {}).textContent = user.name || user.username || user.id || '-';
    (document.getElementById('profile-modal-role') || {}).textContent = user.role || '-';
    
    const modal = document.getElementById('modal-user-profile');
    modal.classList.add('active');
}

function closeUserProfileModal() {
    const modal = document.getElementById('modal-user-profile');
    modal.classList.remove('active');
    modal.style.display = '';
}

function previewProfileAvatar(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById('profile-modal-avatar-preview');
        if (preview) preview.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// หมายเหตุ: ยังไม่รองรับอัปโหลดรูปโปรไฟล์ขึ้น Drive เพราะ users sheet ไม่มีคอลัมน์ avatar
async function saveUserProfile() {
    const userJson = localStorage.getItem('rdf_current_user');
    if (!userJson) return;
    const user = JSON.parse(userJson);

    const email = String((document.getElementById('profile-modal-email') || {}).value || '').trim();
    const currentPassword = String((document.getElementById('profile-current-password') || {}).value || '');
    const newPassword = String((document.getElementById('profile-new-password') || {}).value || '');
    if ((currentPassword && !newPassword) || (!currentPassword && newPassword)) {
        return appAlert('หากต้องการเปลี่ยนรหัสผ่าน กรุณากรอกทั้งรหัสผ่านปัจจุบันและรหัสผ่านใหม่', 'warning');
    }
    if (newPassword && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(newPassword)) {
        return appAlert('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัว และมี A-Z, a-z, 0-9', 'warning');
    }

    appAlert('กำลังบันทึกข้อมูล...', 'info');
    try {
        const payload = { email };
        if (newPassword) {
            payload.currentPasswordHash = await sha256(currentPassword);
            payload.newPasswordHash = await sha256(newPassword);
        }
        await apiCall('updateProfile', payload);
        user.email = email;
        localStorage.setItem('rdf_current_user', JSON.stringify(user));
        showUserProfile(user);
        appAlert('อัปเดตข้อมูลส่วนตัวสำเร็จ!', 'success');
        closeUserProfileModal();
    } catch (err) {
        appAlert('เกิดข้อผิดพลาดในการอัปเดตข้อมูล: ' + err.message, 'error');
    }
}

// ---- Admin User Management ----
let adminUserList = [];
let userMgmtFilters = { search: '', role: '' };

async function renderUserManagement() {
    const tbody = document.getElementById('user-management-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        const res = await apiCall('getUsers');
        adminUserList = res.users || [];
        renderUserManagementRows();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger);">โหลดข้อมูลไม่สำเร็จ: ' + escapeHTML(err.message) + '</td></tr>';
    }
}

function applyUserMgmtFilter() {
    userMgmtFilters.search = (document.getElementById('user-mgmt-search') || {}).value || '';
    userMgmtFilters.role = (document.getElementById('user-mgmt-role-filter') || {}).value || '';
    renderUserManagementRows();
}

function renderUserManagementRows() {
    const tbody = document.getElementById('user-management-tbody');
    if (!tbody) return;

    if (!adminUserList.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">ยังไม่มีผู้ใช้งาน</td></tr>';
        return;
    }

    const search = userMgmtFilters.search.trim().toLowerCase();
    const roleFilter = userMgmtFilters.role;
    const filtered = adminUserList.filter(u => {
        if (roleFilter && (u.role || '').toLowerCase() !== roleFilter) return false;
        if (!search) return true;
        const haystack = `${u.username || ''} ${u.fullName || ''} ${u.email || ''}`.toLowerCase();
        return haystack.includes(search);
    });

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">ไม่พบผู้ใช้งานที่ตรงกับเงื่อนไข</td></tr>';
        return;
    }

    const roleColors = { admin: '#ef4444', manager: '#1d4ed8', staff: '#16a34a', viewer: '#0ea5e9' };
    tbody.innerHTML = filtered.map(u => {
        const color = roleColors[(u.role || '').toLowerCase()] || '#6b7280';
        const activeBadge = u.active
            ? '<span style="background:#10b98122;color:#10b981;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">ใช้งาน</span>'
            : '<span style="background:#ef444422;color:#ef4444;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">ปิดใช้งาน</span>';
        return `
            <tr>
                <td><img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.username || '')}&background=random" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--border-color);"></td>
                <td style="font-weight:600;">${escapeHTML(u.username || '-')}</td>
                <td style="color:var(--text-secondary);font-size:13px;">${escapeHTML(u.email || '-')}</td>
                <td><span style="background:${color}22;color:${color};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">${(u.role || '-').toUpperCase()}</span></td>
                <td style="text-align:center;">${activeBadge}</td>
                <td style="text-align:center;">
                    <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;margin-right:4px;" onclick="openEditUserModal('${escapeHTML(u.id)}')"><i data-lucide="edit-2"></i></button>
                    <button class="btn" style="padding:4px 10px;font-size:12px;background:var(--danger-light);color:var(--danger);border:none;" onclick="confirmToggleUserActive('${escapeHTML(u.id)}', ${!!u.active})" title="${u.active ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}">
                        <i data-lucide="${u.active ? 'user-x' : 'user-check'}"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    initializeLucide();
}

// เติม dropdown เลือกสถานศึกษาในฟอร์มเพิ่ม/แก้ไขผู้ใช้ — ซ่อนไว้ถ้ามีองค์กรเดียว (ไม่มีอะไรให้เลือก)
function setupAdminUserOrgSelect(selectedOrgId) {
    const wrap = document.getElementById('admin-user-org-wrap');
    const sel = document.getElementById('admin-user-org');
    if (!wrap || !sel) return;
    const orgs = state.organizations || [];
    if (orgs.length <= 1) {
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = '';
    const currentUser = JSON.parse(localStorage.getItem('rdf_current_user') || 'null');
    const defaultOrgId = selectedOrgId || (currentUser && currentUser.organizationId) || orgs[0].id;
    sel.innerHTML = orgs.map(o => `<option value="${o.id}">${escapeHTML(o.name)}</option>`).join('');
    sel.value = defaultOrgId;
}

function openCreateUserModal() {
    (document.getElementById('admin-user-modal-title') || {}).textContent = 'เพิ่มผู้ใช้งานใหม่';
    (document.getElementById('admin-user-mode') || {}).value = 'create';
    (document.getElementById('admin-user-username') || {}).value = '';
    document.getElementById('admin-user-username').disabled = false;
    (document.getElementById('admin-user-firstname') || {}).value = '';
    (document.getElementById('admin-user-lastname') || {}).value = '';
    (document.getElementById('admin-user-email') || {}).value = '';
    (document.getElementById('admin-user-password') || {}).value = '';
    (document.getElementById('admin-user-role') || {}).value = 'staff';
    (document.getElementById('admin-user-pw-hint') || {}).textContent = '(จำเป็น)';
    (document.getElementById('admin-user-role-warning') || {}).style.display = 'none';
    setupAdminUserOrgSelect();
    const modal = document.getElementById('modal-admin-user');
    modal.classList.add('active');
}

const VALID_USER_ROLES = ['admin', 'manager', 'staff', 'viewer'];

function openEditUserModal(userId) {
    const u = adminUserList.find(x => x.id === userId);
    if (!u) return;
    (document.getElementById('admin-user-modal-title') || {}).textContent = 'แก้ไขผู้ใช้งาน: ' + u.username;
    (document.getElementById('admin-user-mode') || {}).value = 'edit';
    (document.getElementById('admin-user-username') || {}).value = u.username || '';
    document.getElementById('admin-user-username').disabled = true;
    (document.getElementById('admin-user-firstname') || {}).value = u.fullName || '';
    (document.getElementById('admin-user-lastname') || {}).value = '';
    (document.getElementById('admin-user-email') || {}).value = u.email || '';
    (document.getElementById('admin-user-password') || {}).value = '';
    const currentRole = (u.role || '').toLowerCase();
    const isKnownRole = VALID_USER_ROLES.includes(currentRole);
    (document.getElementById('admin-user-role') || {}).value = isKnownRole ? currentRole : 'staff';
    (document.getElementById('admin-user-role-warning') || {}).style.display = isKnownRole ? 'none' : 'block';
    (document.getElementById('admin-user-pw-hint') || {}).textContent = '(เว้นว่างถ้าไม่ต้องการเปลี่ยน)';
    setupAdminUserOrgSelect(u.organizationId);
    const modal = document.getElementById('modal-admin-user');
    modal.classList.add('active');
}

function closeAdminUserModal() {
    const modal = document.getElementById('modal-admin-user');
    if (modal) { modal.classList.remove('active'); modal.style.display = ''; }
}

async function saveAdminUser() {
    const mode      = document.getElementById('admin-user-mode').value;
    const username  = document.getElementById('admin-user-username').value.trim();
    const password  = document.getElementById('admin-user-password').value.trim();
    const email     = document.getElementById('admin-user-email').value.trim();
    const role      = document.getElementById('admin-user-role').value;
    const firstName = document.getElementById('admin-user-firstname').value.trim();
    const lastName  = document.getElementById('admin-user-lastname').value.trim();
    const fullName  = [firstName, lastName].filter(Boolean).join(' ');

    if (!username) { appAlert('กรุณาระบุ Username', 'error'); return; }
    if (!fullName) { appAlert('กรุณาระบุชื่อ-นามสกุล', 'error'); return; }
    if (mode === 'create' && !password) { appAlert('กรุณาตั้งรหัสผ่านสำหรับผู้ใช้ใหม่', 'error'); return; }

    const orgSel = document.getElementById('admin-user-org');
    const selectedOrgId = orgSel && orgSel.value ? orgSel.value : null;

    try {
        if (mode === 'create') {
            const currentUser = JSON.parse(localStorage.getItem('rdf_current_user') || 'null');
            const passwordHash = await sha256(password);
            await apiCall('createUser', {
                username, passwordHash, fullName, role, email,
                organizationId: selectedOrgId || (currentUser && currentUser.organizationId)
            });
        } else {
            const editingUser = adminUserList.find(u => u.username === username);
            if (!editingUser) throw new Error('ไม่พบผู้ใช้งานนี้ในระบบ');
            await apiCall('updateUser', {
                id: editingUser.id, fullName, role, email,
                ...(selectedOrgId && { organizationId: selectedOrgId })
            });
            if (password) {
                const passwordHash = await sha256(password);
                await apiCall('changePassword', { id: editingUser.id, passwordHash });
            }
        }
        appAlert('บันทึกสำเร็จ!', 'success');
        closeAdminUserModal();
        renderUserManagement();
    } catch (err) {
        appAlert(err.message || 'เกิดข้อผิดพลาด', 'error');
    }
}

function confirmToggleUserActive(id, isCurrentlyActive) {
    if (!id) return;
    const currentUser = JSON.parse(localStorage.getItem('rdf_current_user') || 'null');
    if (currentUser && currentUser.id === id && isCurrentlyActive) {
        appAlert('ไม่สามารถปิดการใช้งานบัญชีตัวเองได้', 'error'); return;
    }
    const actionLabel = isCurrentlyActive ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน';
    if (!confirm(`ยืนยันการ${actionLabel}บัญชีนี้?`)) return;
    toggleUserActive(id, !isCurrentlyActive);
}

async function toggleUserActive(id, newActiveState) {
    try {
        await apiCall('updateUser', { id, active: newActiveState });
        appAlert((newActiveState ? 'เปิด' : 'ปิด') + 'การใช้งานบัญชีสำเร็จ', 'success');
        renderUserManagement();
    } catch (err) {
        appAlert(err.message || 'เกิดข้อผิดพลาด', 'error');
    }
}

// ---- User Management Sub-Tabs (รายชื่อผู้ใช้งาน / อธิบายสิทธิ์ / Permission Matrix) ----
function switchUserMgmtTab(tabKey) {
    const bar = document.querySelector('#tab-user-management .settings-tabbar');
    if (!bar) return;
    bar.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-usermgmt-tab') === tabKey);
    });
    document.querySelectorAll('#tab-user-management .settings-tab-panel').forEach(panel => {
        panel.style.display = (panel.id === `usermgmt-panel-${tabKey}`) ? '' : 'none';
    });
    if (tabKey === 'matrix') renderPermissionMatrix();
    initializeLucide();
}
window.switchUserMgmtTab = switchUserMgmtTab;

// ---- Permission Matrix ----
// รายการ action ต้อง sync ด้วยมือกับ PERMISSIONS ใน backend/Config.gs ถ้ามีการเพิ่ม/ลบ action ในอนาคต
const PERMISSION_ACTIONS = [
    { action: 'createExpense',       label: 'เพิ่มรายจ่าย',                    category: 'รายจ่าย' },
    { action: 'updateExpense',       label: 'แก้ไขรายจ่าย',                    category: 'รายจ่าย' },
    { action: 'deleteExpense',       label: 'ลบรายจ่าย',                       category: 'รายจ่าย' },
    { action: 'getExpenses',         label: 'ดูรายจ่าย',                       category: 'รายจ่าย' },
    { action: 'getAttachmentDataUrl', label: 'ดูรูปไฟล์แนบในรายงาน',            category: 'รายจ่าย' },
    { action: 'getFoodExpenses',      label: 'ดูรายการค่าอาหาร',                category: 'ค่าอาหาร' },
    { action: 'createFoodExpense',    label: 'เพิ่มรายการค่าอาหาร',             category: 'ค่าอาหาร' },
    { action: 'updateFoodExpense',    label: 'แก้ไขรายการค่าอาหาร',             category: 'ค่าอาหาร' },
    { action: 'uploadFoodAttachment', label: 'แนบหลักฐานค่าอาหาร',              category: 'ค่าอาหาร' },
    { action: 'deleteFoodExpenseAPI', label: 'ลบรายการค่าอาหาร',                category: 'ค่าอาหาร' },
    { action: 'createClaim',         label: 'สร้างใบเบิก',                     category: 'ใบเบิก' },
    { action: 'cancelClaimDraft',    label: 'ยกเลิกใบเบิก (ฉบับร่าง)',          category: 'ใบเบิก' },
    { action: 'submitClaim',         label: 'ส่งใบเบิกขออนุมัติ',              category: 'ใบเบิก' },
    { action: 'approveClaim',        label: 'อนุมัติใบเบิก',                    category: 'ใบเบิก' },
    { action: 'rejectClaim',         label: 'ปฏิเสธใบเบิก',                     category: 'ใบเบิก' },
    { action: 'recordReimbursement', label: 'บันทึกการเบิกจ่ายเงินคืน',         category: 'ใบเบิก' },
    { action: 'getFundReceipts',     label: 'ดูเอกสารรับเงินทุน',               category: 'เอกสารรับเงินทุน' },
    { action: 'saveFundReceipt',     label: 'บันทึกเอกสารรับเงินทุน',           category: 'เอกสารรับเงินทุน' },
    { action: 'deleteFundReceipt',   label: 'ลบเอกสารรับเงินทุน',               category: 'เอกสารรับเงินทุน' },
    { action: 'getUsers',            label: 'ดูรายชื่อผู้ใช้งาน',               category: 'ผู้ใช้งานและระบบ' },
    { action: 'createUser',          label: 'เพิ่มผู้ใช้งาน',                   category: 'ผู้ใช้งานและระบบ' },
    { action: 'updateUser',          label: 'แก้ไขผู้ใช้งาน',                   category: 'ผู้ใช้งานและระบบ' },
    { action: 'getSystemConfig',     label: 'ดูการตั้งค่าระบบ',                 category: 'ผู้ใช้งานและระบบ' },
    { action: 'updateSystemConfig',  label: 'แก้ไขการตั้งค่าระบบ',              category: 'ผู้ใช้งานและระบบ' },
    { action: 'getCarryOverAmount',  label: 'ดูยอดยกไปจากเดือนก่อน',           category: 'รายงาน' },
    { action: 'getMonthStatuses',    label: 'ดูสถานะเบิกจ่ายรายเดือน',          category: 'รายงาน' },
    { action: 'toggleMonthStatus',   label: 'สลับสถานะเบิกจ่ายรายเดือน',        category: 'รายงาน' },
];

// ค่าเริ่มต้น = มิเรอร์ของ PERMISSIONS ใน backend/Config.gs (admin ไม่ต้องเก็บ เพราะ full access เสมอ)
const DEFAULT_PERMISSION_MATRIX = {
    createExpense:       { manager: true,  staff: true,  viewer: false },
    updateExpense:       { manager: true,  staff: true,  viewer: false },
    deleteExpense:       { manager: true,  staff: false, viewer: false },
    getExpenses:         { manager: true,  staff: true,  viewer: true  },
    getAttachmentDataUrl: { manager: true,  staff: true,  viewer: true  },
    getFoodExpenses:      { manager: true,  staff: true,  viewer: true  },
    createFoodExpense:    { manager: true,  staff: true,  viewer: false },
    updateFoodExpense:    { manager: true,  staff: true,  viewer: false },
    uploadFoodAttachment: { manager: true,  staff: true,  viewer: false },
    deleteFoodExpenseAPI: { manager: true,  staff: false, viewer: false },
    createClaim:         { manager: true,  staff: true,  viewer: false },
    cancelClaimDraft:    { manager: true,  staff: true,  viewer: false },
    submitClaim:         { manager: true,  staff: true,  viewer: false },
    approveClaim:        { manager: true,  staff: false, viewer: false },
    rejectClaim:         { manager: true,  staff: false, viewer: false },
    recordReimbursement: { manager: true,  staff: false, viewer: false },
    getFundReceipts:     { manager: true,  staff: true,  viewer: true  },
    saveFundReceipt:     { manager: true,  staff: true,  viewer: false },
    deleteFundReceipt:   { manager: true,  staff: false, viewer: false },
    getUsers:            { manager: false, staff: false, viewer: false },
    createUser:          { manager: false, staff: false, viewer: false },
    updateUser:          { manager: false, staff: false, viewer: false },
    getSystemConfig:     { manager: false, staff: false, viewer: false },
    updateSystemConfig:  { manager: false, staff: false, viewer: false },
    getCarryOverAmount:  { manager: true,  staff: true,  viewer: true  },
    getMonthStatuses:    { manager: true,  staff: true,  viewer: true  },
    toggleMonthStatus:   { manager: true,  staff: false, viewer: false },
};

async function renderPermissionMatrix() {
    const tbody = document.getElementById('permission-matrix-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        const res = await apiCall('getSystemConfig');
        const config = res.config || {};
        let matrix = DEFAULT_PERMISSION_MATRIX;
        if (config.permissionMatrix) {
            try {
                matrix = { ...DEFAULT_PERMISSION_MATRIX, ...JSON.parse(config.permissionMatrix) };
            } catch (e) { /* ข้อมูลเสีย ใช้ค่าเริ่มต้นแทน */ }
        }

        let lastCategory = null;
        tbody.innerHTML = PERMISSION_ACTIONS.map(({ action, label, category }) => {
            const perms = matrix[action] || DEFAULT_PERMISSION_MATRIX[action] || { manager: false, staff: false, viewer: false };
            const categoryRow = category !== lastCategory
                ? `<tr><td colspan="5" style="background:var(--bg-main);font-weight:700;font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">${escapeHTML(category)}</td></tr>`
                : '';
            lastCategory = category;
            return `
                ${categoryRow}
                <tr data-action="${action}">
                    <td>${escapeHTML(label)}</td>
                    <td style="text-align:center;color:var(--text-muted);">✓</td>
                    <td style="text-align:center;"><input type="checkbox" data-perm-role="manager" ${perms.manager ? 'checked' : ''}></td>
                    <td style="text-align:center;"><input type="checkbox" data-perm-role="staff" ${perms.staff ? 'checked' : ''}></td>
                    <td style="text-align:center;"><input type="checkbox" data-perm-role="viewer" ${perms.viewer ? 'checked' : ''}></td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger);">โหลดข้อมูลไม่สำเร็จ: ' + escapeHTML(err.message) + '</td></tr>';
    }
}

async function savePermissionMatrix() {
    const matrix = {};
    document.querySelectorAll('#permission-matrix-tbody tr[data-action]').forEach(tr => {
        const action = tr.getAttribute('data-action');
        matrix[action] = {
            manager: tr.querySelector('input[data-perm-role="manager"]').checked,
            staff: tr.querySelector('input[data-perm-role="staff"]').checked,
            viewer: tr.querySelector('input[data-perm-role="viewer"]').checked,
        };
    });
    if (!confirm('ยืนยันการบันทึก Permission Matrix? การเปลี่ยนแปลงจะมีผลทันทีกับผู้ใช้งานทุกคน')) return;
    try {
        await apiCall('updateSystemConfig', { permissionMatrix: JSON.stringify(matrix) });
        appAlert('บันทึก Permission Matrix สำเร็จ', 'success');
    } catch (err) {
        appAlert(err.message || 'เกิดข้อผิดพลาด', 'error');
    }
}

// ── Google Sign-In: init (called once we know the configured Client ID) ──
// ใช้วิธี imperative (google.accounts.id.initialize + renderButton) แทนแบบ HTML declarative (g_id_onload)
// เพราะ Client ID มาจาก backend หลัง page load แล้วเสมอ ไม่ใช่ค่าคงที่ที่ฝังไว้ตอน build
function initGoogleLogin(clientId) {
    if (!window.google || !google.accounts || !google.accounts.id || !clientId) return;
    google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleLogin,
        auto_select: false,
        cancel_on_tap_outside: true,
    });
    const container = document.getElementById('google-login-container');
    if (container) container.style.display = 'block';
    const btnTarget = document.getElementById('google-signin-button');
    if (btnTarget) {
        google.accounts.id.renderButton(btnTarget, {
            type: 'standard', theme: 'outline', text: 'signin_with', locale: 'th', width: 280,
        });
    }
}
window.initGoogleLogin = initGoogleLogin;

// ── Google Sign-In: callback เมื่อผู้ใช้เลือกบัญชี Google สำเร็จ ──
// ผูกบัญชีด้วยการจับคู่อีเมล — ไม่มีการสมัครสมาชิกอัตโนมัติ ต้องมีบัญชีที่ตั้งอีเมลนี้ไว้แล้วในหน้าจัดการผู้ใช้งาน
async function handleGoogleLogin(response) {
    const errorMsg = document.getElementById('login-error-msg');
    if (errorMsg) errorMsg.style.display = 'none';
    showLoading(true);
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'loginWithGoogle', data: { idToken: response.credential } })
        });
        const result = await res.json();

        if (result.success) {
            localStorage.setItem('rdf_session_token', result.data.token);
            localStorage.setItem('rdf_current_user', JSON.stringify(result.data.user));
            localStorage.setItem('rdf_login_time', new Date().toISOString());

            const loginOverlay = document.getElementById('login-overlay');
            if (loginOverlay) loginOverlay.style.display = 'none';

            showUserProfile(result.data.user);
            await initAppWithAPI();
            await resolvePendingExportVerify(); // สแกน QR แล้ว login ด้วย Google → เปิดเอกสารเดือนนั้น
        } else if (errorMsg) {
            errorMsg.textContent = (result.error && result.error.message) || 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ';
            errorMsg.style.display = 'block';
        }
    } catch (err) {
        if (errorMsg) {
            errorMsg.textContent = 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ: การเชื่อมต่อล้มเหลว';
            errorMsg.style.display = 'block';
        }
        console.error('Google login error:', err);
    } finally {
        showLoading(false);
    }
}
window.handleGoogleLogin = handleGoogleLogin;

// ── Initialize Google Login on app startup ──
(function initGoogleOnLoad() {
    // Check settings and try to initialize Google Login
    const tryInit = () => {
        if (window.google && window.google.accounts) {
            fetch(API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'getPublicSettings' })
            }).then(r => r.json()).then(result => {
                if (result.status === 'success' || result.success) {
                    const enabled = result.data.googleLoginEnabled === 'true';
                    const clientId = result.data.googleOauthClientId;
                    if (enabled && clientId) {
                        initGoogleLogin(clientId);
                    }
                }
            }).catch(() => {});
        }
    };
    // Wait for Google script to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryInit, 1500));
    } else {
        setTimeout(tryInit, 1500);
    }
})();



// ==========================================
// Food Expenses Functionality (Local Storage)
// ==========================================

let foodFiles = [];
let foodBillsTableExpanded = false;
let foodBillsCollapsedLimit = getFoodBillsCollapsedLimit();

function getFoodBillsCollapsedLimit() {
    return Number(window.innerWidth || 1024) <= 900 ? 5 : 6;
}

window.toggleFoodBillsTable = function() {
    foodBillsTableExpanded = !foodBillsTableExpanded;
    renderFoodBillsTable();
};

window.addEventListener('resize', () => {
    const nextLimit = getFoodBillsCollapsedLimit();
    if (nextLimit === foodBillsCollapsedLimit) return;
    foodBillsCollapsedLimit = nextLimit;
    if (!foodBillsTableExpanded) renderFoodBillsTable();
});

async function loadFoodExpensesForMonth(month) {
    if (!/^\d{4}-\d{2}$/.test(String(month || ''))) {
        state.foodExpenses = [];
        return state.foodExpenses;
    }
    const rows = await fetchAllFoodExpensesForMonth(month);
    state.foodExpenses = rows;
    return rows;
}



// Load food data from API
window.loadFoodOverview = async function() {
    try {
        const selectedMonth = (document.getElementById('food-overview-month') || {}).value || getSelectedPostingMonth();
        await loadFoodExpensesForMonth(selectedMonth);
        renderFoodOverview();
    } catch (err) {
        console.error(err);
        appAlert('ไม่สามารถโหลดข้อมูลค่าอาหารได้: ' + err.message);
    }
};

window.loadFoodBillsForMonth = async function() {
    try {
        await loadFoodExpensesForMonth(getSelectedPostingMonth());
        renderFoodBillsTable();
    } catch (err) {
        console.error('โหลดรายการค่าอาหารไม่สำเร็จ:', err);
    }
};

function renderFoodBillsTable() {
    const table = document.getElementById('food-bills-table');
    const tbody = table ? table.querySelector('tbody') : null;
    if (!tbody) return;
    table.classList.add('responsive-record-table', 'compact-record-table');
    const container = table.closest('.table-container');
    if (container) container.classList.add('responsive-record-container');

    const selectedMonth = getSelectedPostingMonth();
    const searchInput = document.getElementById('filter-search');
    const searchText = String(searchInput ? searchInput.value : '').trim().toLowerCase();
    const rows = [...(state.foodExpenses || [])]
        .filter(item => getFoodPostingMonth(item) === selectedMonth)
        .filter(item => !searchText || [item.name, item.category, item.documentNo]
            .join(' ').toLowerCase().includes(searchText))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

    updateFoodWidgetMonthBadge();
    populateQuickFoodSuggestions();
    const title = document.getElementById('food-bills-widget-title');
    if (title) title.textContent = 'ค่าอาหารประจำเดือน';

    const disclosure = document.getElementById('food-table-disclosure');
    const countLabel = document.getElementById('food-table-count');
    const toggleButton = document.getElementById('food-table-toggle');
    const collapsedLimit = getFoodBillsCollapsedLimit();
    foodBillsCollapsedLimit = collapsedLimit;

    if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">ไม่พบรายการค่าอาหารในรอบบันทึกนี้</td></tr>';
        if (disclosure) disclosure.hidden = true;
        return;
    }

    const hasHiddenRows = rows.length > collapsedLimit;
    const visibleRows = foodBillsTableExpanded || !hasHiddenRows
        ? rows
        : rows.slice(0, collapsedLimit);

    if (disclosure) disclosure.hidden = !hasHiddenRows;
    if (countLabel) {
        countLabel.textContent = foodBillsTableExpanded
            ? `กำลังแสดงทั้งหมด ${rows.length} รายการ`
            : `กำลังแสดง ${visibleRows.length} จาก ${rows.length} รายการ`;
    }
    if (toggleButton) {
        toggleButton.setAttribute('aria-expanded', String(foodBillsTableExpanded));
        toggleButton.innerHTML = foodBillsTableExpanded
            ? '<i data-lucide="chevron-up"></i><span data-role="label">ย่อรายการ</span>'
            : `<i data-lucide="chevron-down"></i><span data-role="label">ดูทั้งหมด ${rows.length} รายการ</span>`;
    }

    const canDelete = ['admin', 'manager'].includes(getCurrentUserRole());
    tbody.innerHTML = visibleRows.map((item, index) => {
        const amount = parseFloat(item.totalAmount) || 0;
        const hasFiles = Boolean(item.files);
        return `
            <tr>
                <td class="text-center food-row-number" data-label="ลำดับ">${index + 1}</td>
                <td data-label="วันที่ / รอบ">
                    <span class="record-primary">${escapeHTML(formatThaiDate(item.date) || '-')}</span>
                    <span class="record-secondary">รอบ ${escapeHTML(formatPostingMonth(getFoodPostingMonth(item)))}</span>
                </td>
                <td data-label="รายการ">
                    <span class="record-primary">${escapeHTML(item.name || '-')}</span>
                    <div class="record-meta"><span class="badge">${escapeHTML(item.category || '-')}</span></div>
                </td>
                <td data-label="จำนวน">
                    <span class="record-primary">${escapeHTML(String(item.quantity || '-'))} ${escapeHTML(item.unit || '')}</span>
                    <span class="record-secondary">฿${(parseFloat(item.price) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / หน่วย</span>
                </td>
                <td class="text-right" data-label="รวมเป็นเงิน"><span class="record-amount">฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></td>
                <td data-label="หลักฐาน / เครื่องมือ">
                    <div class="record-tools">
                        <span class="badge" title="${hasFiles ? 'มีไฟล์แนบ' : 'ไม่มีไฟล์แนบ'}">${hasFiles ? '<i data-lucide="paperclip" style="width:14px;height:14px;"></i> มีหลักฐาน' : 'ไม่มีหลักฐาน'}</span>
                        <button type="button" class="btn btn-icon btn-sm btn-icon-edit" onclick="openFoodExpenseEditor('${escapeHTML(item.id)}')" title="แก้ไขรายการ" aria-label="แก้ไขรายการ"><i data-lucide="pencil"></i></button>
                        ${canDelete ? `<button type="button" class="btn btn-icon btn-sm btn-icon-delete" onclick="deleteFoodExpense('${escapeHTML(item.id)}')" title="ลบรายการ" aria-label="ลบรายการ"><i data-lucide="trash-2"></i></button>` : ''}
                    </div>
                </td>
            </tr>`;
    }).join('');
    initializeLucide();
}

window.openFoodExpenseEditor = function(id) {
    openFoodEntryModal();
    editFoodExpense(id);
};

window.renderFoodOverview = function() {
    const tbody = document.getElementById('food-overview-tbody');
    const totalEl = document.getElementById('food-overview-total');
    if (!tbody || !totalEl) return;

    const selectedMonth = document.getElementById('food-overview-month').value; // YYYY-MM
    let data = [...(state.foodExpenses || [])];
    
    if (selectedMonth) {
        data = data.filter(item => getFoodPostingMonth(item) === selectedMonth);
    }
    
    // Sort by date desc
    data.sort((a, b) => new Date(b.date) - new Date(a.date));

    let html = '';
    let total = 0;
    
    if (data.length === 0) {
        html = '<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:20px;">ไม่มีข้อมูลค่าอาหารในรอบบันทึกนี้</td></tr>';
    } else {
        data.forEach((item, idx) => {
            const amount = parseFloat(item.totalAmount) || 0;
            total += amount;
            html += `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${formatThaiDate(item.date)}</td>
                    <td>${formatPostingMonth(getFoodPostingMonth(item))}</td>
                    <td>${escapeHTML(item.name || '')}</td>
                    <td><span class="badge" style="background:var(--primary); color:white;">${escapeHTML(item.category || '')}</span></td>
                    <td class="text-right">${escapeHTML(String(item.quantity || ''))} ${escapeHTML(item.unit || '')}</td>
                    <td class="text-right">${parseFloat(item.price).toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                    <td class="text-right" style="font-weight:600;">${amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                </tr>
            `;
        });
    }

    if (tbody) tbody.innerHTML = html;
    if (totalEl) totalEl.textContent = total.toLocaleString('th-TH', {minimumFractionDigits:2}) + ' บาท';
};

window.exportFoodPDF = async function() {
    const selectedMonth = (document.getElementById('food-overview-month') || {}).value; // YYYY-MM
    let data = [];
    try {
        data = selectedMonth ? await fetchAllFoodExpensesForMonth(selectedMonth) : [];
    } catch (err) {
        appAlert('ไม่สามารถโหลดข้อมูลค่าอาหารสำหรับรายงานได้: ' + err.message, 'error');
        return;
    }
    data.sort((a, b) => new Date(a.date) - new Date(b.date));

    // QR ตรวจสอบย้อนกลับผูกกับ "เดือน" (ไม่ใช่รายการเดียว เพราะรายงานนี้รวมหลายรายการ) — ต้องเลือกเดือนก่อนถึงจะมี QR ได้
    let foodQrDataUrl = '';
    if (selectedMonth) {
        try {
            const res = await apiCall('getFoodMonthVerifyCode', { month: selectedMonth });
            if (res && res.code) foodQrDataUrl = await generateVerifyQR('food', res.code);
        } catch (err) {
            console.error('สร้าง QR ตรวจสอบไม่สำเร็จ:', err);
        }
    }

    let total = 0;
    const rows = data.length
        ? data.map((item, idx) => {
            const amount = parseFloat(item.totalAmount) || 0;
            total += amount;
            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${formatThaiDate(item.date)}</td>
                    <td>${escapeHTML(formatPostingMonth(getFoodPostingMonth(item)))}</td>
                    <td>${escapeHTML(item.name)}</td>
                    <td>${escapeHTML(item.category)}</td>
                    <td style="text-align:right;">${escapeHTML(String(item.quantity))} ${escapeHTML(item.unit || '')}</td>
                    <td style="text-align:right;">${parseFloat(item.price).toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                    <td style="text-align:right; font-weight:600;">${amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                </tr>
            `;
        }).join('')
        : '<tr><td colspan="8" style="text-align:center; padding:20px;">ไม่มีข้อมูลค่าอาหารในรอบบันทึกนี้</td></tr>';

    const monthLabel = selectedMonth
        ? formatThaiDate(selectedMonth + '-01').split(' ').slice(1).join(' ')
        : '';

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>สรุปค่าอาหารประจำเดือน ${monthLabel}</title>
<style>
    body { font-family: 'Sarabun', sans-serif; padding: 24px; color: #111; }
    h2 { margin-bottom: 4px; }
    .subtitle { color: #555; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #999; padding: 6px 8px; }
    th { background: #f0f0f0; text-align: left; }
    .total-row td { font-weight: bold; background: #fafafa; }
    .doc-footer { margin-top: 24px; font-size: 11px; color: #777; text-align: right; }
    @media print { button { display: none; } }
</style>
</head>
<body onload="window.print();">
    <h2>สรุปค่าอาหารประจำเดือน</h2>
    <div class="subtitle">${monthLabel || 'ทุกเดือน'}</div>
    <table>
        <thead>
            <tr>
                <th>#</th><th>วันที่ซื้อ</th><th>รอบบันทึก</th><th>รายการ</th><th>หมวดหมู่</th>
                <th style="text-align:right;">จำนวน</th><th style="text-align:right;">ราคา/หน่วย</th><th style="text-align:right;">รวมเป็นเงิน</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
            <tr class="total-row">
                <td colspan="7" style="text-align:right;">ยอดรวมทั้งสิ้น</td>
                <td style="text-align:right;">${total.toLocaleString('th-TH', {minimumFractionDigits:2})} บาท</td>
            </tr>
        </tfoot>
    </table>
    <div class="doc-footer" style="${foodQrDataUrl ? 'display:flex; align-items:center; justify-content:flex-end; gap:10px;' : ''}">
        ${foodQrDataUrl ? `<img src="${foodQrDataUrl}" style="width:56px; height:56px;"><span>สแกนเพื่อตรวจสอบเอกสารนี้กับระบบ &bull; </span>` : ''}
        สร้างโดย: ระบบบันทึกรายจ่าย RDF &bull; พิมพ์เมื่อ: ${formatSystemDate(new Date())}
    </div>
</body></html>`;

    const printWin = window.open('', '_blank', 'width=960,height=720');
    if (!printWin) {
        appAlert('กรุณาอนุญาต Popup ในเบราว์เซอร์ก่อนใช้งาน Export PDF');
        return;
    }
    printWin.document.write(html);
    preparePrintDocumentText(printWin.document);
    printWin.document.close();
};

window.loadFoodEntryList = async function() {
    try {
        const selectedMonth = (document.getElementById('food-modal-month') || {}).value || getSelectedPostingMonth();
        await loadFoodExpensesForMonth(selectedMonth);
        renderFoodEntryList();
    } catch (err) {
        console.error(err);
    }
};

window.renderFoodEntryList = function() {
    const tbody = document.getElementById('food-entry-tbody');
    if (!tbody) return;

    const selectedMonth = (document.getElementById('food-modal-month') || {}).value; // YYYY-MM
    let data = [...(state.foodExpenses || [])];

    if (selectedMonth) {
        data = data.filter(item => getFoodPostingMonth(item) === selectedMonth);
    }

    data.sort((a, b) => new Date(b.date) - new Date(a.date));

    let html = '';
    if (data.length === 0) {
        html = '<tr><td colspan="5" class="empty-state">ไม่มีข้อมูลที่บันทึกไว้</td></tr>';
    } else {
        data.forEach(item => {
            const amount = parseFloat(item.totalAmount) || 0;
            // hasFiles check: if item.files exists or we stored something
            const hasFiles = item.files && item.files.length > 0;
            html += `
                <tr>
                    <td data-label="วันที่ซื้อ" class="food-entry-date-cell">${formatThaiDate(item.date)}</td>
                    <td data-label="รายการ">
                        <div class="food-entry-item-content">
                            <span class="food-entry-item-text" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</span>
                            ${hasFiles ? '<i data-lucide="paperclip" class="food-entry-attachment-icon"></i>' : ''}
                        </div>
                    </td>
                    <td data-label="หมวดหมู่"><span class="badge">${escapeHTML(item.category)}</span></td>
                    <td data-label="ยอดเงิน" class="text-right food-entry-amount-cell">${amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                    <td data-label="จัดการ" class="text-center">
                        <div class="food-entry-row-actions">
                        <button type="button" class="btn btn-icon btn-sm btn-icon-edit" onclick="editFoodExpense('${item.id}')" title="แก้ไขรายการ" aria-label="แก้ไขรายการ">
                            <i data-lucide="pencil"></i>
                        </button>
                        <button type="button" class="btn btn-icon btn-sm btn-icon-delete" onclick="deleteFoodExpense('${item.id}')" title="ลบรายการ" aria-label="ลบรายการ">
                            <i data-lucide="trash-2"></i>
                        </button>
                        </div>
                    </td>
                </tr>
            `;
        });
    }

    if (tbody) tbody.innerHTML = html;
    initializeLucide();
};

window.calcFoodEntryTotal = function() {
    const qty = parseFloat(document.getElementById('food-entry-qty').value) || 0;
    const price = parseFloat(document.getElementById('food-entry-price').value) || 0;
    const total = qty * price;
    const totalEl = document.getElementById('food-entry-total-display');
    if (totalEl) totalEl.textContent = total.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' บาท';
};

window.handleFoodFiles = async function(event) {
    const files = Array.from((event.target && event.target.files) || []);
    if (!files.length) return;

    const maxMb = state.maxUploadSizeMb || 2;
    const errors = [];
    try {
        for (const file of files) {
            try {
                const processed = await processUploadFile(file, maxMb);
                foodFiles.push(processed);
            } catch (err) {
                errors.push(`${file.name}: ${err.message}`);
            }
        }
        renderFoodFileList();
        if (errors.length) appAlert(`มีไฟล์ที่แนบไม่สำเร็จ:\n${errors.join('\n')}`, 'warning');
    } catch (err) {
        console.error(err);
        appAlert('ไม่สามารถแนบไฟล์นี้ได้: ' + err.message, 'error');
    } finally {
        if (event.target) event.target.value = '';
    }
};

window.renderFoodFileList = function() {
    const container = document.getElementById('food-file-list');
    if (!container) return;

    const editId = (document.getElementById('food-entry-edit-id') || {}).value || '';
    const existing = editId ? (state.foodExpenses || []).find(item => item.id === editId) : null;
    const existingNotice = existing && existing.files
        ? '<div style="padding:6px 10px; background:var(--primary-light); color:var(--primary-dark); border-radius:6px; font-size:12px;">มีไฟล์แนบเดิมอยู่แล้ว และระบบจะเก็บไฟล์เดิมไว้</div>'
        : '';

    if (!foodFiles.length) {
        container.innerHTML = existingNotice;
        return;
    }

    container.innerHTML = existingNotice + foodFiles.map((f, idx) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:var(--bg-secondary); border-radius:6px; font-size:12px;">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(f.filename)}</span>
            <button type="button" class="btn-icon btn-icon-delete" style="padding:2px;" onclick="removeFoodFile(${idx})"><i data-lucide="x" style="width:14px;height:14px;"></i></button>
        </div>
    `).join('');
    initializeLucide();
};

window.removeFoodFile = function(idx) {
    foodFiles.splice(idx, 1);
    renderFoodFileList();
};

window.editFoodExpense = function(id) {
    const item = (state.foodExpenses || []).find(entry => entry.id === id);
    if (!item) {
        appAlert('ไม่พบรายการค่าอาหารที่ต้องการแก้ไข', 'error');
        return;
    }

    const postingMonth = getFoodPostingMonth(item) || getSelectedPostingMonth();
    const monthInput = document.getElementById('food-modal-month');
    if (monthInput) monthInput.value = postingMonth;
    updateFoodModalMonthLabel();

    document.getElementById('food-entry-edit-id').value = item.id;
    document.getElementById('food-entry-name').value = item.name || '';
    document.getElementById('food-entry-qty').value = item.quantity || '';
    document.getElementById('food-entry-unit').value = item.unit || 'กก.';
    document.getElementById('food-entry-price').value = item.price || '';
    document.getElementById('food-entry-category').value = item.category || '';
    document.getElementById('food-entry-date').value = String(item.date || '').slice(0, 10);

    foodFiles = [];
    renderFoodFileList();
    calcFoodEntryTotal();

    const title = document.getElementById('food-entry-modal-title');
    if (title) title.textContent = 'แก้ไขรายการค่าอาหาร';
    const submitBtn = document.getElementById('food-entry-submit-btn');
    if (submitBtn) submitBtn.innerHTML = '<i data-lucide="save"></i> บันทึกการแก้ไข';
    initializeLucide();
};

window.submitFoodEntry = async function(e) {
    e.preventDefault();
    const editId = (document.getElementById('food-entry-edit-id') || {}).value || '';
    const existing = editId ? (state.foodExpenses || []).find(item => item.id === editId) : null;
    const qty = parseFloat(document.getElementById('food-entry-qty').value) || 0;
    const price = parseFloat(document.getElementById('food-entry-price').value) || 0;
    
    if (qty <= 0 || price <= 0) {
        appAlert('กรุณาระบุจำนวนและราคาให้ถูกต้อง', 'error');
        return;
    }

    if (state.requireAttachment && foodFiles.length === 0 && !(existing && existing.files)) {
        appAlert('ระบบกำหนดให้แนบหลักฐานอย่างน้อย 1 ไฟล์ก่อนบันทึกรายการค่าอาหาร', 'error');
        return;
    }

    const dateStr = document.getElementById('food-entry-date').value; // YYYY-MM-DD
    const selectedMonth = (document.getElementById('food-modal-month') || {}).value;
    if (!dateStr || !/^\d{4}-\d{2}$/.test(selectedMonth || '')) {
        appAlert('กรุณาระบุวันที่ซื้อและรอบเดือนที่บันทึก', 'error');
        return;
    }
    const [postingYear, postingMonth] = selectedMonth.split('-').map(Number);
    const currentUser = JSON.parse(localStorage.getItem('rdf_current_user') || 'null');

    // Backend stores food expenses as a document with a list of items; the
    // quick-entry modal only ever submits one ingredient at a time, so we
    // wrap it as a single-item document (no Sheet schema changes needed).
    const payload = {
        ...(!editId && { requestId: createClientRequestId('food') }),
        month: postingMonth,
        year: postingYear,
        dormitory: '',
        responsiblePerson: (currentUser && currentUser.name) || '',
        note: document.getElementById('food-entry-category').value, // repurposed to carry category
        items: [{
            expenseDate: dateStr,
            ingredientName: document.getElementById('food-entry-name').value,
            quantity: qty,
            unit: document.getElementById('food-entry-unit').value,
            unitPrice: price
        }]
    };

    appAlert('กำลังบันทึกข้อมูล...', 'info');
    try {
        const res = editId
            ? await apiCall('updateFoodExpense', { ...payload, id: editId })
            : await apiCall('createFoodExpense', payload);
        const assignedId = editId
            ? (res.itemId || (existing && existing.itemId))
            : (res.items && res.items[0] && res.items[0].assignedId);

        if (assignedId && foodFiles.length > 0) {
            for (const f of foodFiles) {
                try {
                    await apiCall('uploadFoodAttachment', {
                        foodExpenseItemId: assignedId,
                        fileName: f.filename,
                        mimeType: f.mimeType,
                        base64Data: (f.base64 || '').split(',')[1] || f.base64
                    });
                } catch (attErr) {
                    console.error('Food attachment upload failed:', attErr);
                }
            }
        }

        appAlert(editId ? 'แก้ไขข้อมูลค่าอาหารสำเร็จ!' : 'บันทึกข้อมูลค่าอาหารลงระบบสำเร็จ!', 'success');

        resetFoodEntryEditor(selectedMonth);

        await loadFoodEntryList();
        exportReportData.month = '';
        if (document.getElementById('tab-food-overview').classList.contains('active')) {
            await loadFoodOverview();
        }
        if (selectedMonth === getSelectedPostingMonth()) {
            renderFoodBillsTable();
        } else {
            await loadFoodBillsForMonth();
        }
    } catch (err) {
        appAlert('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message, 'error');
    }
};

window.deleteFoodExpense = async function(id) {
    if (!confirm('ยืนยันการลบรายการนี้?')) return;
    
    appAlert('กำลังลบข้อมูล...', 'info');
    try {
        await apiCall('deleteFoodExpenseAPI', { id: id });
        appAlert('ลบรายการสำเร็จ', 'success');
        await loadFoodEntryList();
        exportReportData.month = '';
        if (document.getElementById('tab-food-overview').classList.contains('active')) {
            await loadFoodOverview();
        }
        await loadFoodBillsForMonth();
    } catch (err) {
        appAlert('เกิดข้อผิดพลาดในการลบ: ' + err.message, 'error');
    }
};



async function processUploadFile(file, maxMb) {
    const maxBytes = maxMb * 1024 * 1024;
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(evt) {
            let base64Data = evt.target.result;
            if (file.type.startsWith('image/') && file.size > maxBytes) {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const MAX_WIDTH = 1920; const MAX_HEIGHT = 1080;
                    if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } }
                    else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
                    canvas.width = width; canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    let quality = 0.8;
                    let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                    let approxBytes = Math.round(compressedDataUrl.length * 0.75);
                    
                    while (approxBytes > maxBytes && quality > 0.1) {
                        quality -= 0.1;
                        compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                        approxBytes = Math.round(compressedDataUrl.length * 0.75);
                    }
                    resolve({ base64: compressedDataUrl, mimeType: 'image/jpeg', filename: file.name, sizeBytes: approxBytes });
                };
                img.onerror = () => reject(new Error('Cannot load image for compression.'));
                img.src = base64Data;
            } else {
                resolve({ base64: base64Data, mimeType: file.type, filename: file.name, sizeBytes: file.size });
            }
        };
        reader.onerror = () => reject(new Error('Cannot read file.'));
        reader.readAsDataURL(file);
    });
}


/* ==========================================================================
   Bottom Navigation Logic
   ========================================================================== */
function initBottomNavigation() {
    const bottomNavItems = document.querySelectorAll('.bottom-nav-item');
    
    // Close submenus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.bottom-nav-item')) {
            document.querySelectorAll('.bottom-nav-item.has-submenu').forEach(item => {
                item.classList.remove('open');
            });
        }
    });

    bottomNavItems.forEach(item => {
        item.addEventListener('click', function(e) {
            // If it has a submenu, toggle it and don't switch tabs yet
            if (this.classList.contains('has-submenu')) {
                // If we clicked on a submenu item itself
                if (e.target.closest('.submenu-item')) {
                    const subItem = e.target.closest('.submenu-item');
                    const targetTab = subItem.getAttribute('data-tab');
                    if (targetTab) {
                        switchTab(targetTab);
                        this.classList.remove('open');
                    }
                    return;
                }
                
                // Toggle this submenu
                const wasOpen = this.classList.contains('open');
                
                // Close all other submenus first
                document.querySelectorAll('.bottom-nav-item.has-submenu').forEach(nav => {
                    nav.classList.remove('open');
                });
                
                if (!wasOpen) {
                    this.classList.add('open');
                }
            } else {
                // Normal item click (no submenu)
                const targetTab = this.getAttribute('data-tab');
                if (targetTab) {
                    switchTab(targetTab);
                    document.querySelectorAll('.bottom-nav-item.has-submenu').forEach(nav => {
                        nav.classList.remove('open');
                    });
                }
            }
        });
    });

    // Opacity setting logic
    const opacityInput = document.getElementById('setting-bottom-nav-opacity');
    const opacityValueDisplay = document.getElementById('bottom-nav-opacity-value');
    
    if (opacityInput) {
        // Load saved opacity
        const savedOpacity = localStorage.getItem('BOTTOM_NAV_OPACITY') || '0.85';
        opacityInput.value = savedOpacity;
        if (opacityValueDisplay) opacityValueDisplay.innerText = Math.round(parseFloat(savedOpacity) * 100) + '%';
        document.documentElement.style.setProperty('--bottom-nav-opacity', savedOpacity);
        
        // Live preview on input change
        opacityInput.addEventListener('input', function() {
            if (opacityValueDisplay) opacityValueDisplay.innerText = Math.round(parseFloat(this.value) * 100) + '%';
            document.documentElement.style.setProperty('--bottom-nav-opacity', this.value);
        });
    }
}

// Ensure the opacity is loaded even if settings tab is not opened
document.addEventListener('DOMContentLoaded', () => {
    const savedOpacity = localStorage.getItem('BOTTOM_NAV_OPACITY') || '0.85';
    document.documentElement.style.setProperty('--bottom-nav-opacity', savedOpacity);
});

window.saveBottomNavOpacity = function() {
    const val = document.getElementById('setting-bottom-nav-opacity').value;
    localStorage.setItem('BOTTOM_NAV_OPACITY', val);
    document.documentElement.style.setProperty('--bottom-nav-opacity', val);
    showToast('บันทึกความโปร่งใสเมนูด้านล่างสำเร็จ', 'success');
};

// Call init on load
document.addEventListener('DOMContentLoaded', initBottomNavigation);

/* ==========================================================================
   Bills Table - Sub-Tab Navigation Logic
   ========================================================================== */
function initBillsSubTabs() {
    const subTabBtns = document.querySelectorAll('.bills-subtab-btn');
    subTabBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            const target = this.getAttribute('data-bills-subtab');

            // Update button active state
            subTabBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // Show/hide panels
            const mainPanel = document.getElementById('bills-subtab-main');
            const foodPanel = document.getElementById('bills-subtab-food-entry-inline');

            if (target === 'bills-main') {
                if (mainPanel) mainPanel.style.display = '';
                if (foodPanel) foodPanel.style.display = 'none';
            } else if (target === 'food-entry-inline') {
                if (mainPanel) mainPanel.style.display = 'none';
                if (foodPanel) foodPanel.style.display = '';
                // Load food entry data for the current month
                const monthInput = document.getElementById('food-entry-month');
                if (monthInput && !monthInput.value) {
                    const now = new Date();
                    monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
                }
                if (typeof loadFoodEntryList === 'function') loadFoodEntryList();
                initializeLucide();
            }
        });
    });
}

// Initialise on DOM load
document.addEventListener('DOMContentLoaded', initBillsSubTabs);

/* ==========================================================================
   Food Entry Modal - Open / Close / Sync with main month filter
   ========================================================================== */
function resetFoodEntryEditor(postingMonth) {
    const form = document.getElementById('food-entry-form');
    if (form) form.reset();

    const editId = document.getElementById('food-entry-edit-id');
    if (editId) editId.value = '';
    const title = document.getElementById('food-entry-modal-title');
    if (title) title.textContent = 'บันทึกค่าอาหาร';
    const submitBtn = document.getElementById('food-entry-submit-btn');
    if (submitBtn) submitBtn.innerHTML = '<i data-lucide="save"></i> บันทึกรายการ';

    foodFiles = [];
    renderFoodFileList();
    calcFoodEntryTotal();
    const dateInput = document.getElementById('food-entry-date');
    if (dateInput) dateInput.value = getFoodEntryDefaultDate(postingMonth || '');
    initializeLucide();
}

window.openFoodEntryModal = function () {
    const overlay = document.getElementById('modal-food-entry');
    if (!overlay) return;

    // Sync month with the current selected month/year in the main filter
    const selMonth = document.getElementById('select-month');
    const selYear = document.getElementById('select-year');
    const monthInput = document.getElementById('food-modal-month');

    if (selMonth && selYear && monthInput) {
        const m = String(selMonth.value).padStart(2, '0');
        const y = parseInt(selYear.value);
        // Convert if needed - assume year in select is BE, convert to CE
        const ceYear = y > 2500 ? y - 543 : y;
        monthInput.value = ceYear + '-' + m;
    } else if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }

    updateFoodModalMonthLabel();
    resetFoodEntryEditor(monthInput ? monthInput.value : '');

    // Load existing entries
    if (typeof loadFoodEntryList === 'function') loadFoodEntryList();

    overlay.classList.add('active');
    initializeLucide();
};

window.closeFoodEntryModal = function () {
    const overlay = document.getElementById('modal-food-entry');
    if (overlay) overlay.classList.remove('active');
    
    // Refresh the food widget in the bills table
    if (typeof loadFoodBillsForMonth === 'function') loadFoodBillsForMonth();
    updateFoodWidgetMonthBadge();
};

function getFoodEntryDefaultDate(monthValue) {
    const today = new Date();
    const todayValue = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!/^\d{4}-\d{2}$/.test(monthValue || '')) return todayValue;
    return todayValue.startsWith(monthValue) ? todayValue : `${monthValue}-01`;
}

window.onFoodModalMonthChange = function () {
    updateFoodModalMonthLabel();
    if (typeof loadFoodEntryList === 'function') loadFoodEntryList();
};

function updateFoodModalMonthLabel() {
    const monthInput = document.getElementById('food-modal-month');
    const label = document.getElementById('food-modal-month-label');
    if (monthInput && monthInput.value && label) {
        const [y, m] = monthInput.value.split('-');
        const thMonths = ['', 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
        const thYear = parseInt(y) + 543;
        label.textContent = thMonths[parseInt(m)] + ' ' + thYear;
    }
}

function updateFoodWidgetMonthBadge() {
    const badge = document.getElementById('food-widget-month-badge');
    if (!badge) return;
    const selMonth = document.getElementById('select-month');
    const selYear = document.getElementById('select-year');
    if (selMonth && selYear) {
        const thMonths = ['', 'ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
        badge.textContent = thMonths[parseInt(selMonth.value)] + ' ' + selYear.value;
    }
}

function updateBillsWidgetMonthBadge() {
    const badge = document.getElementById('bills-widget-month-badge');
    if (!badge) return;
    const selMonth = document.getElementById('select-month');
    const selYear = document.getElementById('select-year');
    if (selMonth && selYear) {
        const thMonths = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        badge.textContent = `${thMonths[parseInt(selMonth.value, 10)] || ''} ${selYear.value || ''}`.trim();
    } else {
        const [year, month] = String(getSelectedPostingMonth() || '').split('-');
        const thMonths = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        badge.textContent = `${thMonths[parseInt(month, 10)] || ''} ${year ? Number(year) + 543 : ''}`.trim();
    }
}

// Wire close button
document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.getElementById('modal-food-entry-close');
    if (closeBtn) closeBtn.addEventListener('click', closeFoodEntryModal);
    
    // Update badge whenever month/year changes
    ['select-month','select-year'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
            updateFoodWidgetMonthBadge();
            updateFundReceiptWidget();
        });
    });

    updateFoodWidgetMonthBadge();
    updateFundReceiptWidget();
});

// closeExportModal — single source of truth. Defined at top level (not inside a
// DOMContentLoaded wrapper) because other DOMContentLoaded listeners registered
// earlier in this file reference it directly and would fire before a later
// wrapper's assignment ran, throwing "is not defined".
window.closeExportModal = function() {
    const modal = document.getElementById('modal-export-pdf');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = '';   // ← always clear inline style
    }
};

// updateExportSectionBadges helper
// นับจาก buildExportSectionData (แหล่งข้อมูลเดียวกับที่ PDF ใช้) เพื่อให้ badge ตรงกับตารางใน PDF เสมอ
// — เดิมนับจาก DOM table ทำให้รวมแถว "เพิ่มข้อมูล" (inline-add) เกินมาด้วย และไม่ได้กรองตามเดือนของรายงาน
window.updateExportSectionBadges = function() {
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n + ' รายการ'; };
    try {
        set('export-bills-badge', buildExportSectionData('bills').length);
        set('export-food-badge', buildExportSectionData('food').length);
        set('export-attach-badge', buildExportSectionData('attach').length);
    } catch (e) { /* state อาจยังไม่พร้อมตอนเรียกครั้งแรก — ปล่อยผ่าน */ }
};

/* ==========================================================================
   Export Modal — Enhanced Logic
   ========================================================================== */

/* Toggle accordion panels */
window.toggleExportAcc = function(header) {
    const acc = header.closest('.export-accordion');
    if (acc) acc.classList.toggle('collapsed');
};

/* Handle logo upload */
window.handleExportLogo = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById('export-logo-preview');
        const icon = document.getElementById('export-logo-icon');
        if (preview) {
            // Store base64
            preview.dataset.logoSrc = e.target.result;
            // Show image
            preview.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:contain;border-radius:8px;">';
        }
        renderExportPreview();
    };
    reader.readAsDataURL(file);
};

window.clearExportLogo = function() {
    const preview = document.getElementById('export-logo-preview');
    const icon = document.getElementById('export-logo-icon');
    if (preview) {
        delete preview.dataset.logoSrc;
        preview.innerHTML = '<i data-lucide="image" style="width:22px;height:22px;color:var(--text-muted);" id="export-logo-icon"></i>';
        initializeLucide();
    }
    renderExportPreview();
};

/* Sync export modal month from main filter when opening */
// [REMOVED: _origOpenExportModal override chain - was wrapping the original function and blocking close]

/* Count report rows (นับจากแหล่งเดียวกับ PDF — ดูหมายเหตุที่ window.updateExportSectionBadges) */
function updateExportSectionBadges() {
    const billsN = buildExportSectionData('bills').length;
    const foodN = buildExportSectionData('food').length;
    const attachN = buildExportSectionData('attach').length;

    const bb = document.getElementById('export-bills-badge');
    const fb = document.getElementById('export-food-badge');
    const ab = document.getElementById('export-attach-badge');
    if (bb) bb.textContent = billsN + ' รายการ';
    if (fb) fb.textContent = foodN + ' รายการ';
    if (ab) ab.textContent = attachN + ' รายการ';
}

/* Column definitions shared by preview, PDF and per-section download —
   each id matches a checkbox `value` in the modal so selection state maps 1:1. */
const EXPORT_BILL_COLUMNS = [
    { id: 'docNo', label: 'เลขบิล', align: 'left', get: r => r.docNo },
    { id: 'receiptNo', label: 'เล่มที่ / เลขที่ใบเสร็จ', align: 'left', get: r => r.receiptNo },
    { id: 'date', label: 'วันที่', align: 'left', get: r => formatDateThai(r.date) },
    { id: 'postingMonth', label: 'รอบบันทึก', align: 'left', get: r => formatPostingMonth(r.postingMonth) },
    { id: 'project', label: 'โครงการ', align: 'left', get: r => r.project },
    { id: 'category', label: 'หมวดหมู่', align: 'left', get: r => r.category },
    { id: 'vendor', label: 'ผู้ขาย', align: 'left', get: r => r.vendor },
    { id: 'amount', label: 'ยอดรวม', align: 'right', get: r => formatNumber(r.amount), isAmount: true },
    { id: 'attachmentsCount', label: 'จำนวนหลักฐาน', align: 'right', get: r => r.attachmentsCount || 0 },
    { id: 'claimType', label: 'ประเภทเบิก', align: 'left', get: r => r.claimType }
];
const EXPORT_FOOD_COLUMNS = [
    { id: 'foodDate', label: 'วันที่', align: 'left', get: r => formatDateThai(r.foodDate) },
    { id: 'postingMonth', label: 'รอบบันทึก', align: 'left', get: r => formatPostingMonth(r.postingMonth) },
    { id: 'foodName', label: 'รายการ', align: 'left', get: r => r.foodName },
    { id: 'foodCategory', label: 'หมวดหมู่', align: 'left', get: r => r.foodCategory },
    { id: 'foodAmount', label: 'ยอดเงิน', align: 'right', get: r => formatNumber(r.foodAmount), isAmount: true }
];

/* ==========================================================================
   pdfmake docDefinition builder — ชั้นเดียวที่รู้จัก "หน้าตา" ของ PDF จริง
   ใช้ทั้งพรีวิว (getDataUrl เข้า iframe) และปุ่มดาวน์โหลด (download) จาก
   report model ตัวเดียวกันเสมอ ไม่มีทางพรีวิวกับไฟล์จริงเพี้ยนกันได้อีก
   ========================================================================== */
const PDF_A4_PORTRAIT_WIDTH = 595.28; // A4 pt
const PDF_A4_LANDSCAPE_WIDTH = 841.89; // A4 pt
const PDF_MARGIN = [40, 40, 40, 56];
const PDF_ATTACHMENT_IMAGE_FIT = [260, 330];

// ฟอนต์ Sarabun ถูกฝัง base64 + ลงทะเบียนแล้วโดย fonts/sarabun-vfs.js (โหลดก่อน app.js ใน index.html)
// ผ่าน pdfMake.addVirtualFileSystem()+addFonts() (วิธีเดียวกับที่ vfs_fonts.js ของ pdfmake เองใช้ลงทะเบียน
// Roboto — ยืนยันจาก source จริงของ pdfmake แล้ว) — pdfMake.addFonts({...URL...}) เฉยๆ โดยไม่มี VFS ไม่พอ
// เพราะเวอร์ชันนี้อ่านไฟล์ฟอนต์จาก virtual file system เท่านั้น ไม่ได้ fetch จาก URL ตรงๆ

function buildPdfDocDefinition(model) {
    const { header, sections, signature, reportOptions = {} } = model;
    const pageOrientation = reportOptions.pageOrientation === 'landscape' ? 'landscape' : 'portrait';
    const pageWidth = pageOrientation === 'landscape' ? PDF_A4_LANDSCAPE_WIDTH : PDF_A4_PORTRAIT_WIDTH;
    const contentWidth = pageWidth - PDF_MARGIN[0] - PDF_MARGIN[2];
    const content = [];

    // pdfmake 0.3.11 ต้องอ้างรูปผ่าน images dictionary (key → dataURL) เท่านั้น — มันจะแปลง base64→Buffer
    // ให้ก่อนส่งเข้า openImage (รับ Buffer ได้) ส่วนการใส่ dataURL inline ตรงๆ ({image:'data:...'}) ส่ง string
    // ดิบเข้า openImage ที่ไม่รองรับ → รูปหายเงียบ (ยืนยันจาก src/PDFDocument.js@0.3.11 realImageSrc/provideImage)
    const images = {};
    let _imgSeq = 0;
    const registerImage = (dataUrl) => {
        if (!dataUrl) return null;
        const key = 'img' + (_imgSeq++);
        images[key] = dataUrl;
        return key;
    };

    // หัวเอกสาร: โลโก้ | ชื่อหน่วยงาน/ชื่อเรื่อง | (เลขที่เอกสาร + QR ตรวจสอบ) มุมขวา
    // QR วางเป็น image ในหัวเอกสาร (content ปกติ) — อยู่หน้าแรกครั้งเดียวอยู่แล้ว และ image ใน content
    // render ได้จริงเสมอ (ต่างจาก background callback ที่ commit ที่ (0,0) ทำให้ absolutePosition ไม่ทำงาน)
    const headerCols = [];
    if (header.logoSrc) headerCols.push({ image: registerImage(header.logoSrc), width: 46, height: 46, margin: [0, 0, 10, 0] });
    const titleStack = { stack: [], width: '*' };
    if (header.orgName) titleStack.stack.push({ text: header.orgName, bold: true, fontSize: 12, color: '#1a1a2e' });
    titleStack.stack.push({ text: header.title, bold: true, fontSize: 16, color: '#1a1a2e', margin: [0, 2, 0, 0] });
    if (header.monthLabel) titleStack.stack.push({ text: 'ประจำ' + header.monthLabel, fontSize: 9, color: '#4b5563' });
    if (header.subHeading) titleStack.stack.push({ text: header.subHeading, fontSize: 8, color: '#6b7280', margin: [0, 2, 0, 0] });
    headerCols.push(titleStack);

    const rightStack = [];
    if (header.docNum) rightStack.push({ text: 'เลขที่: ' + header.docNum, fontSize: 9, color: '#6b7280', alignment: 'right' });
    if (header.qrDataUrl) {
        rightStack.push({ image: registerImage(header.qrDataUrl), width: 62, alignment: 'right', margin: [0, 4, 0, 0] });
        rightStack.push({ text: 'สแกนเพื่อตรวจสอบ', fontSize: 6.5, color: '#9ca3af', alignment: 'right', margin: [0, 1, 0, 0] });
    }
    if (header.verifyCode) {
        rightStack.push({ text: 'รหัสตรวจสอบ: ' + header.verifyCode, fontSize: 6.5, color: '#6b7280', alignment: 'right', margin: [0, 2, 0, 0] });
    }
    if (header.qrDataUrl) {
        rightStack.push({ text: `หลักฐานแนบ: ${Number(header.attachmentCount) || 0} ไฟล์`, fontSize: 6.5, color: '#6b7280', alignment: 'right', margin: [0, 1, 0, 0] });
    }
    if (rightStack.length) headerCols.push({ width: 'auto', stack: rightStack });

    content.push({ columns: headerCols, columnGap: 10 });
    content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: 1.2, lineColor: '#1a1a2e' }], margin: [0, 8, 0, 14] });

    if (reportOptions.audit) {
        const auditBody = [[
            { text: 'หัวข้อ', bold: true, fontSize: 8.5, fillColor: '#e5e7eb' },
            { text: 'จำนวนรายการ', bold: true, fontSize: 8.5, fillColor: '#e5e7eb', alignment: 'right' },
            { text: 'ยอดรวม', bold: true, fontSize: 8.5, fillColor: '#e5e7eb', alignment: 'right' },
            { text: 'หลักฐาน', bold: true, fontSize: 8.5, fillColor: '#e5e7eb', alignment: 'right' },
        ]];
        sections.forEach(section => {
            const total = section.rows.reduce((sum, row) => sum + (parseFloat(row.amount ?? row.foodAmount) || 0), 0);
            auditBody.push([
                { text: section.label, fontSize: 8.5 },
                { text: String(section.rows.length), fontSize: 8.5, alignment: 'right' },
                { text: formatNumber(total), fontSize: 8.5, alignment: 'right' },
                { text: String(Number(section.attachmentCount) || 0), fontSize: 8.5, alignment: 'right' },
            ]);
        });
        content.push({ text: 'สรุปสำหรับตรวจสอบบัญชี', fontSize: 11, bold: true, color: '#1a1a2e', margin: [0, 0, 0, 6] });
        content.push({ table: { headerRows: 1, widths: ['*', 72, 82, 52], body: auditBody }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 14] });
    }

    sections.forEach(section => {
        // หัวข้อ section: พื้นเทาอ่อน + แถบสี accent ซ้าย (แทน emoji ที่ Sarabun ไม่มี glyph)
        content.push({
            table: { widths: ['*'], body: [[{ text: section.label, fontSize: 12, bold: true, color: '#1a1a2e', fillColor: '#f3f4f6', margin: [8, 5, 8, 5] }]] },
            layout: {
                hLineWidth: () => 0,
                vLineWidth: (i) => i === 0 ? 3 : 0,
                vLineColor: () => section.accent || '#1a1a2e',
                paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
            },
            margin: [0, 2, 0, 6],
            unbreakable: true,
        });

        if (section.attachmentOnly) {
            if (section.attachmentItems.length === 0) {
                content.push({ text: 'ไม่พบหลักฐานแนบสำหรับหัวข้อนี้', italics: true, color: '#9ca3af', fontSize: 9, margin: [0, 6, 0, 14] });
            }
        } else if (section.columns.length === 0) {
            content.push({ text: 'ยังไม่ได้เลือกคอลัมน์ที่จะแสดง', italics: true, color: '#9ca3af', fontSize: 9, margin: [0, 6, 0, 14] });
        } else {
            const cols = section.columns;
            const amtIdx = cols.findIndex(c => c.isAmount);
            const widths = cols.map(c => c.isAmount ? 70 : '*');
            const body = [cols.map(c => ({ text: c.label, bold: true, fontSize: 9, fillColor: '#e5e7eb', alignment: c.align }))];

            if (section.rows.length === 0) {
                body.push([{ text: 'ไม่มีข้อมูล', colSpan: cols.length, alignment: 'center', italics: true, color: '#9ca3af', fontSize: 9 }, ...cols.slice(1).map(() => ({}))]);
            } else {
                section.rows.forEach(row => {
                    body.push(cols.map(c => ({ text: String(c.get(row) ?? ''), alignment: c.align, fontSize: 9 })));
                    if (section.detailed) {
                        const missingCols = (section.key === 'food' ? EXPORT_FOOD_COLUMNS : EXPORT_BILL_COLUMNS).filter(c => !cols.includes(c));
                        if (missingCols.length > 0) {
                            const detailText = missingCols.map(c => `${c.label}: ${c.get(row) ?? ''}`).join('   ');
                            body.push([{ text: detailText, colSpan: cols.length, italics: true, fontSize: 8, color: '#6b7280' }, ...cols.slice(1).map(() => ({}))]);
                        }
                    }
                });
                if (amtIdx >= 0) {
                    const total = section.rows.reduce((s, r) => s + (parseFloat(r.amount ?? r.foodAmount) || 0), 0);
                    const totalRow = cols.map((c, i) => {
                        if (i === amtIdx) return { text: formatNumber(total), bold: true, alignment: 'right', fillColor: '#f9fafb', color: '#059669', fontSize: 9 };
                        if (i === amtIdx - 1) return { text: 'รวมทั้งหมด', bold: true, alignment: 'right', fillColor: '#f9fafb', fontSize: 9 };
                        return { text: '', fillColor: '#f9fafb' };
                    });
                    body.push(totalRow);
                }
            }

            content.push({ table: { headerRows: 1, widths, body }, layout: 'lightHorizontalLines', margin: [0, 4, 0, 14] });
        }

        // Section "หลักฐานแนบ" — ต่อจากตารางเสมอ ไม่แทรกในตาราง
        if (section.attachmentItems.length > 0) {
            content.push({ text: 'หลักฐานแนบ', fontSize: 11, bold: true, color: '#1a1a2e', margin: [0, 2, 0, 6], unbreakable: true });
            section.attachmentItems.forEach((item, idx) => {
                const stack = [];
                stack.push({ text: `รายการที่ ${idx + 1}`, bold: true, fontSize: 9, color: '#1a1a2e' });
                stack.push({
                    text: item.detail.map(d => `${d.label}: ${d.value ?? '-'}`).join('\n'),
                    fontSize: 8.5, color: '#374151', margin: [0, 2, 0, 6],
                });
                item.images.forEach((img, imageIdx) => {
                    const src = typeof img === 'string' ? img : img.src;
                    const caption = typeof img === 'string' ? `Image ${imageIdx + 1}` : (img.caption || img.name || `Image ${imageIdx + 1}`);
                    stack.push({
                        stack: [
                            { image: registerImage(src), fit: PDF_ATTACHMENT_IMAGE_FIT, alignment: 'center', margin: [0, 4, 0, 2] },
                            { text: caption, fontSize: 7.5, color: '#6b7280', alignment: 'center', margin: [0, 0, 0, 6] },
                        ],
                        unbreakable: true,
                    });
                });
                item.fileRefs.forEach(ref => {
                    // ไม่ใช้ emoji (Sarabun ไม่มี glyph) — ใช้ป้ายข้อความนำหน้าแทน
                    stack.push({
                        text: (ref.note ? '[!] ' : '[ไฟล์แนบ] ') + ref.name + (ref.note ? ' — ' + ref.note : ''),
                        fontSize: 8.5, color: ref.note ? '#b45309' : '#4f46e5', link: ref.url || undefined,
                        margin: [0, 2, 0, 2],
                    });
                });
                content.push({ stack, margin: [0, 0, 0, 12] });
            });
        }
        if (section.attachmentWarnings && section.attachmentWarnings.length) {
            content.push({
                text: `หลักฐานแนบโหลดไม่สำเร็จ ${section.attachmentWarnings.length} รายการ — ตรวจสอบการเชื่อมต่อแล้วลองสร้างรายงานใหม่`,
                fontSize: 8.5, color: '#b45309', margin: [0, 2, 0, 12]
            });
        }
    });

    if (signature && (signature.preparer || signature.reviewer || signature.approver || signature.preparerImage || signature.reviewerImage || signature.approverImage)) {
        const sigBlock = (role, name, image) => ({
            stack: [
                image ? { image: registerImage(image), fit: [120, 48], alignment: 'center', margin: [0, 0, 0, 5] } : { text: ' ', margin: [0, 30, 0, 0] },
                { text: '........................................', alignment: 'center', fontSize: 9 },
                { text: '(' + (name || '.........................') + ')', alignment: 'center', fontSize: 9, margin: [0, 2, 0, 0] },
                { text: role, alignment: 'center', fontSize: 9, color: '#6b7280' },
            ],
        });
        content.push({
            columns: [
                sigBlock('ผู้จัดทำ', signature.preparer, signature.preparerImage),
                sigBlock('ผู้ตรวจสอบ', signature.reviewer, signature.reviewerImage),
                sigBlock('ผู้อนุมัติ', signature.approver, signature.approverImage),
            ],
            unbreakable: true,
            margin: [0, 20, 0, 0],
        });
    }

    return preparePdfDocumentText({
        pageSize: 'A4',
        pageOrientation,
        pageMargins: PDF_MARGIN,
        defaultStyle: { font: 'Sarabun', fontSize: 10 },
        images, // ทุกรูป (QR/โลโก้/หลักฐานแนบ) ลงทะเบียนไว้ที่นี่ แล้ว content อ้างด้วย key
        content,
        // QR ย้ายไปอยู่ในหัวเอกสาร (content) แล้ว — ไม่ใช้ background callback เพราะ absolutePosition ไม่ทำงานในนั้น
        footer: (currentPage, pageCount) => ({
            text: `หน้า ${currentPage} / ${pageCount}`,
            alignment: 'center', fontSize: 8, color: '#9ca3af', margin: [0, 14, 0, 0],
        }),
    });
}

/* Preview: สร้าง PDF จริงด้วย pdfmake แล้วฝังใน iframe — debounce กันเรียกถี่เกินไปตอนพิมพ์ในฟอร์ม
   generation counter กันผลลัพธ์เก่า (ที่ยังรอ fetch รูปอยู่) มาทับผลลัพธ์ใหม่กว่าที่เสร็จก่อน */
let _previewDebounceTimer = null;
let _previewGeneration = 0;
window.renderExportPreview = function() {
    // อัปเดตเลขที่เอกสารอัตโนมัติทันที (ไม่ debounce) ให้ผู้ใช้เห็นเลขเปลี่ยนตามเดือน/องค์กรทันที
    // ต้องมาก่อน buildReportModel เพราะ QR/เอกสารอ่านเลขจากช่องนี้
    autoFillExportDocNumber();
    clearTimeout(_previewDebounceTimer);
    _previewDebounceTimer = setTimeout(() => generateAndShowPreview(), 450);
};

function setPreviewLoadingText(text, isError) {
    const el = document.getElementById('export-preview-loading-text');
    if (el) {
        el.textContent = text;
        el.style.color = isError ? '#b91c1c' : '';
    }
    const spinner = document.getElementById('export-preview-spinner');
    if (spinner) spinner.style.display = isError ? 'none' : '';
}

function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} ใช้เวลานานเกินไป (เกิน ${ms / 1000} วินาที) — อาจเป็นปัญหาเครือข่ายหรือเข้าถึงไฟล์แนบไม่ได้`)), ms)),
    ]);
}

async function generateAndShowPreview() {
    const frame = document.getElementById('export-preview-frame');
    const loading = document.getElementById('export-preview-loading');
    if (!frame) return;
    const myGeneration = ++_previewGeneration;
    if (loading) loading.style.display = 'flex';
    setPreviewLoadingText('กำลังเตรียมเครื่องมือสร้าง PDF...');
    try {
        // โหลด pdfmake/ฟอนต์แบบ lazy (ปกติเตรียมไว้เบื้องหลังแล้ว → resolve ทันที)
        await ensureExportLibs();
        setPreviewLoadingText('กำลังสร้างตัวอย่าง PDF...');
        const model = await withTimeout(buildReportModel(), 45000, 'การรวบรวมข้อมูล/ไฟล์แนบ');
        if (myGeneration !== _previewGeneration) return; // มีคำขอใหม่กว่าเข้ามาแล้ว

        updateExportPreviewPaperSize((model.reportOptions || {}).pageOrientation);
        const docDef = buildPdfDocDefinition(model);
        // pdfmake 0.3.x: getDataUrl() เป็น async คืน Promise<string> โดยตรง (ไม่ใช่ callback แบบเวอร์ชันเก่า)
        const dataUrl = await withTimeout(
            pdfMake.createPdf(docDef).getDataUrl(),
            15000,
            'การสร้างไฟล์ PDF (pdfmake)'
        );

        if (myGeneration !== _previewGeneration) return;
        frame.src = dataUrl;
        if (loading) loading.style.display = 'none';
    } catch (err) {
        console.error('[export] สร้างตัวอย่าง PDF ไม่สำเร็จ:', err);
        if (myGeneration === _previewGeneration) {
            setPreviewLoadingText('สร้างตัวอย่างไม่สำเร็จ: ' + err.message + ' (ดูรายละเอียดใน Console — กด F12)', true);
        }
    }
}

/* Wire up close buttons */
document.addEventListener('DOMContentLoaded', () => {
    const exportCloseBtn = document.getElementById('modal-export-pdf-close');
    if (exportCloseBtn) exportCloseBtn.addEventListener('click', () => {
        if (typeof closeExportModal === 'function') closeExportModal();
        else document.getElementById('modal-export-pdf')?.classList.remove('active');
    });
    const exportCancelBtn = document.getElementById('btn-export-pdf-cancel');
    if (exportCancelBtn) exportCancelBtn.addEventListener('click', () => {
        if (typeof closeExportModal === 'function') closeExportModal();
        else document.getElementById('modal-export-pdf')?.classList.remove('active');
    });
});

/* ==========================================================================
   Export Single Section - individual file download per section
   ========================================================================== */
window.exportSingleSection = async function(section) {
    const monthInput = document.getElementById('export-report-month');
    const reportMonth = monthInput?.value || '';
    try {
        await ensureExportReportData(reportMonth || getSelectedPostingMonth());
    } catch (err) {
        appAlert('โหลดข้อมูลสำหรับส่งออกไม่สำเร็จ: ' + err.message, 'error');
        return;
    }
    let monthLabel = '';
    if (reportMonth) {
        const [y, m] = reportMonth.split('-');
        const thMonths = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
        monthLabel = thMonths[parseInt(m)] + '_' + (parseInt(y) + 543);
    }

    const sectionNames = {
        bills: 'รายการบิลประจำเดือน',
        food: 'ค่าอาหารประจำเดือน',
        attach: 'บิลแนบ_สาธารณูปโภค'
    };

    const rows = buildExportSectionData(section);
    if (rows.length === 0) {
        if (typeof showToast === 'function') showToast('ไม่มีข้อมูลในหัวข้อนี้', 'warning');
        return;
    }

    const isFood = section === 'food';
    const columnDefs = isFood ? EXPORT_FOOD_COLUMNS : EXPORT_BILL_COLUMNS;
    const selectedIds = isFood ? getExportSelectedColumns('.export-food-col') : getExportSelectedColumns('.export-col-chk');
    const cols = columnDefs.filter(c => selectedIds.includes(c.id));
    if (cols.length === 0) {
        if (typeof showToast === 'function') showToast('กรุณาเลือกคอลัมน์ที่จะดาวน์โหลดอย่างน้อย 1 คอลัมน์', 'warning');
        return;
    }

    const fileName = (sectionNames[section] || section) + (monthLabel ? '_' + monthLabel : '');

    // Build CSV
    let csvContent = cols.map(c => '"' + c.label.replace(/"/g, '""') + '"').join(',') + '\n';
    rows.forEach(row => {
        const cells = cols.map(c => '"' + String(c.get(row) ?? '').replace(/"/g, '""') + '"');
        csvContent += cells.join(',') + '\n';
    });

    // Download as CSV (Excel-compatible with UTF-8 BOM)
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName + '.csv';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (typeof showToast === 'function') showToast('ดาวน์โหลด ' + sectionNames[section] + ' สำเร็จ', 'success');
};

/* ==========================================================================
   Modal UX: Auto-close sidebar when any modal opens (mobile)
   + Scale-aware modal positioning
   ========================================================================== */
(function patchModalForSidebar() {
    'use strict';

    // Helper: close sidebar if open
    function closeSidebarIfOpen() {
        const sidebar = document.getElementById('sidebar');
        const sidebarOverlay = document.getElementById('sidebar-overlay') ||
                               document.querySelector('.sidebar-overlay');
        if (!sidebar) return;
        // Check if sidebar is open (class 'open', 'active', or transform is translateX(0))
        if (sidebar.classList.contains('open') || sidebar.classList.contains('active')) {
            sidebar.classList.remove('open', 'active');
            if (sidebarOverlay) {
                sidebarOverlay.classList.remove('active');
                sidebarOverlay.style.display = 'none';
            }
            document.body.style.overflow = '';
        }
    }

    // Observe all .modal-overlay elements and close sidebar when they become active
    function observeModals() {
        const overlays = document.querySelectorAll('.modal-overlay');
        overlays.forEach(overlay => {
            const obs = new MutationObserver(mutations => {
                mutations.forEach(m => {
                    if (m.attributeName === 'class' &&
                        overlay.classList.contains('active')) {
                        closeSidebarIfOpen();
                    }
                });
            });
            obs.observe(overlay, { attributes: true });
        });
    }

    // [REMOVED: DOMTokenList.prototype.add override - caused pointer-event bugs]

    // Wire up on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeModals);
    } else {
        observeModals();
    }
})();

/* ==========================================================================
   Export Modal: make the 2-column grid responsive via JS (fallback)
   ========================================================================== */
document.addEventListener('DOMContentLoaded', function() {
    const exportModal = document.getElementById('modal-export-pdf');
    if (!exportModal) return;

    function adjustExportModalLayout() {
        const bodyGrid = exportModal.querySelector('.modal-card > div[style*="grid"]');
        if (!bodyGrid) return;
        const w = window.innerWidth;
        if (w < 900) {
            bodyGrid.style.gridTemplateColumns = '1fr';
            bodyGrid.style.overflowY = 'auto';
        } else {
            // Restore original 2-column layout
            bodyGrid.style.gridTemplateColumns = '400px 1fr';
            bodyGrid.style.overflowY = '';
        }
    }

    // Run on open and on resize
    const obs = new MutationObserver(muts => {
        muts.forEach(m => {
            if (m.attributeName === 'class' && exportModal.classList.contains('active')) {
                setTimeout(adjustExportModalLayout, 50);
            }
        });
    });
    obs.observe(exportModal, { attributes: true });

    window.addEventListener('resize', adjustExportModalLayout);
    adjustExportModalLayout();
});

/* ==========================================================================
   Export Modal — Clean Fix (replaces all previous overrides)
   ========================================================================== */

// Override the close buttons to always clear both style.display AND class
document.addEventListener('DOMContentLoaded', function() {
    // Wire close/cancel buttons for modal-export-pdf
    const closeSelectors = [
        '#modal-export-pdf-close',
        '#btn-export-pdf-cancel'
    ];
    closeSelectors.forEach(sel => {
        const btn = document.querySelector(sel);
        if (btn) {
            // Remove old listeners by cloning
            const fresh = btn.cloneNode(true);
            btn.parentNode.replaceChild(fresh, btn);
            fresh.addEventListener('click', function() {
                const modal = document.getElementById('modal-export-pdf');
                if (modal) {
                    modal.classList.remove('active');
                    modal.style.display = '';   // ← clear inline display so CSS takes over
                }
            });
        }
    });

    // Patch openExportModal to sync month from main filter + reset display
    const _origOpen = typeof openExportModal === 'function' ? openExportModal : null;
    window.openExportModal = function(context) {
        // Reset display so CSS .modal-overlay.active can show it
        const modal = document.getElementById('modal-export-pdf');
        if (modal) modal.style.display = '';

        // Sync report month from main filter
        const selMonth = document.getElementById('select-month');
        const selYear  = document.getElementById('select-year');
        const reportMonth = document.getElementById('export-report-month');
        if (selMonth && selYear && reportMonth) {
            const m = String(selMonth.value).padStart(2, '0');
            const y = parseInt(selYear.value);
            const ceYear = y > 2500 ? y - 543 : y;
            reportMonth.value = ceYear + '-' + m;
        }

        // Auto-fill title with month name
        const titleInput = document.getElementById('pdf-report-title');
        if (titleInput && (!titleInput.value || titleInput.value.startsWith('รายงานค่าใช้จ่ายประจำ'))) {
            const thMonths = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
            if (selMonth && selYear) {
                titleInput.value = 'รายงานค่าใช้จ่ายประจำเดือน ' + thMonths[parseInt(selMonth.value)] + ' ' + selYear.value;
            }
        }

        // Call original function to build category UI and render preview
        if (typeof _origOpen === 'function') {
            _origOpen(context || 'bills-table');
        } else {
            // Fallback: just open the modal
            if (modal) {
                modal.style.display = 'flex';
                modal.classList.add('active');
                initializeLucide();
                if (typeof renderExportPreview === 'function') setTimeout(renderExportPreview, 100);
            }
        }

        // Update section badges
        if (typeof updateExportSectionBadges === 'function') updateExportSectionBadges();

        // Collapse sidebar on mobile
        const sidebar = document.getElementById('sidebar');
        const sidebarOv = document.querySelector('.sidebar-overlay');
        if (sidebar) sidebar.classList.remove('open', 'active');
        if (sidebarOv) { sidebarOv.classList.remove('active'); sidebarOv.style.display = ''; }
    };

});


/* ==========================================================================
   RESTORED FUNCTIONS (Settings & Modals) - Added back to fix missing references
   ========================================================================== */

window.closeFoodExpenseModal = function() {
    const modal = document.getElementById('modal-food-entry');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = '';
    }
};

window.saveSecureSetting = async function(key, value) {
    if (!value) {
        appAlert('กรุณากรอกค่าก่อนบันทึก', 'error');
        return;
    }
    const confirmed = await appConfirm(
        'การตั้งค่านี้มีผลกับทั้งระบบ — ถ้ากรอกผิดพลาด ฟีเจอร์ที่เกี่ยวข้องจะหยุดทำงานทันทีสำหรับผู้ใช้ทุกคน ยืนยันการบันทึกทับค่าเดิมหรือไม่?',
        'ยืนยันการบันทึก'
    );
    if (!confirmed) return;
    const trigger = getSettingTriggerElement();
    setSettingControlBusy(trigger, true);
    try {
        await apiCall('updateSystemConfig', { [key]: value });
        appAlert('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
        renderSettingsTab();
    } catch (err) {
        appAlert('บันทึกการตั้งค่าไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        setSettingControlBusy(trigger, false);
    }
};

function getSettingTriggerElement() {
    const eventTarget = window.event && (window.event.currentTarget || window.event.target);
    const trigger = eventTarget || document.activeElement;
    return trigger && trigger.disabled !== undefined ? trigger : null;
}

function setSettingControlBusy(control, isBusy) {
    if (!control) return;
    if (isBusy) {
        control.dataset.wasDisabled = control.disabled ? 'true' : 'false';
        control.disabled = true;
        if (control.tagName === 'BUTTON') {
            control.dataset.originalHtml = control.innerHTML;
            control.innerHTML = 'กำลังบันทึก...';
        }
        return;
    }
    control.disabled = control.dataset.wasDisabled === 'true';
    if (control.tagName === 'BUTTON' && control.dataset.originalHtml) {
        control.innerHTML = control.dataset.originalHtml;
    }
    delete control.dataset.wasDisabled;
    delete control.dataset.originalHtml;
}

function normalizeClientSystemSetting(key, value) {
    if (key === 'requireAttachment' || key === 'googleLoginEnabled' || key === 'publicExportVerifyEnabled') {
        return { ok: true, value: isConfigEnabled(value) };
    }
    if (key === 'maxUploadSizeMb' || key === 'maxAttachmentMb') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
            return { ok: false, message: 'ขนาดไฟล์แนบสูงสุดต้องอยู่ระหว่าง 1-20 MB' };
        }
        return { ok: true, value: parsed };
    }
    if (key === 'tokenExpiryHours') {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24) {
            return { ok: false, message: 'อายุ Session Token ต้องเป็นจำนวนเต็ม 1-24 ชั่วโมง' };
        }
        return { ok: true, value: parsed };
    }
    if (key === 'fiscalYearStart') {
        const month = String(value);
        if (!['1', '4', '10'].includes(month)) {
            return { ok: false, message: 'เดือนเริ่มต้นปีงบประมาณไม่ถูกต้อง' };
        }
        return { ok: true, value: month };
    }
    if (key === 'defaultCurrency') {
        const currency = String(value || '').trim().toUpperCase();
        if (!['THB', 'USD', 'EUR'].includes(currency)) {
            return { ok: false, message: 'สกุลเงินหลักไม่ถูกต้อง' };
        }
        return { ok: true, value: currency };
    }
    if (key === 'dateFormat') {
        const format = normalizeSystemDateFormat(value);
        if (format !== String(value || '').trim().toUpperCase()) {
            return { ok: false, message: 'รูปแบบวันที่ไม่ถูกต้อง' };
        }
        return { ok: true, value: format };
    }
    if (key === 'documentPrefix' || key === 'docPrefix') {
        const prefix = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        if (!prefix || prefix.length > 12) {
            return { ok: false, message: 'รหัสนำหน้าเลขเอกสารต้องมี 1-12 ตัวอักษร และใช้ได้เฉพาะ A-Z, 0-9, _ หรือ -' };
        }
        return { ok: true, value: prefix };
    }
    return { ok: true, value };
}

window.saveSystemSetting = async function(key, value) {
    const normalized = normalizeClientSystemSetting(key, value);
    if (!normalized.ok) {
        appAlert(normalized.message, 'error');
        renderSettingsTab();
        return;
    }
    const trigger = getSettingTriggerElement();
    setSettingControlBusy(trigger, true);
    try {
        await apiCall('updateSystemConfig', { [key]: normalized.value });
        if (key === 'requireAttachment') {
            state.requireAttachment = isConfigEnabled(normalized.value);
        } else if (key === 'maxUploadSizeMb' || key === 'maxAttachmentMb') {
            const parsed = parseFloat(normalized.value);
            if (Number.isFinite(parsed) && parsed > 0) state.maxUploadSizeMb = parsed;
        } else if (key === 'dateFormat') {
            state.dateFormat = normalizeSystemDateFormat(normalized.value);
            renderAll();
            queueSystemDateInputRefresh();
        }
        appAlert('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
        renderSettingsTab();
    } catch (err) {
        appAlert('บันทึกการตั้งค่าไม่สำเร็จ: ' + err.message, 'error');
    } finally {
        setSettingControlBusy(trigger, false);
    }
};

window.renderSettingsTab = async function() {
    // ค่า preference ส่วนตัวของอุปกรณ์ ไม่ใช่ค่าระบบ ยังเก็บที่ localStorage เหมือนเดิม
    const opacityInput = document.getElementById('setting-bottom-nav-opacity');
    if (opacityInput) {
        const op = localStorage.getItem('BOTTOM_NAV_OPACITY') || 0.85;
        opacityInput.value = op;
        const valDisp = document.getElementById('bottom-nav-opacity-value');
        if (valDisp) valDisp.textContent = Math.round(op * 100) + '%';
    }

    const apiStatusEl = document.getElementById('setting-api-status');
    let config = {};
    try {
        const res = await apiCall('getSystemConfig');
        config = res.config || {};
        if (apiStatusEl) apiStatusEl.textContent = 'เชื่อมต่อสำเร็จ';
    } catch (err) {
        console.error('โหลดการตั้งค่าระบบไม่สำเร็จ:', err);
        if (apiStatusEl) apiStatusEl.textContent = 'เชื่อมต่อไม่สำเร็จ';
    }

    const uploadInput = document.getElementById('setting-max-upload-size');
    if (uploadInput) uploadInput.value = config.maxUploadSizeMb || config.maxAttachmentMb || 2;

    const documentPrefix = document.getElementById('setting-document-prefix');
    if (documentPrefix) documentPrefix.value = config.documentPrefix || config.docPrefix || 'MIS';

    const fiscalYearStart = document.getElementById('setting-fiscal-year-start');
    if (fiscalYearStart) fiscalYearStart.value = config.fiscalYearStart || '10';

    const defaultCurrency = document.getElementById('setting-default-currency');
    if (defaultCurrency) defaultCurrency.value = config.defaultCurrency || 'THB';

    const dateFormat = document.getElementById('setting-date-format');
    if (dateFormat) dateFormat.value = normalizeSystemDateFormat(config.dateFormat || state.dateFormat);

    const tokenExpiryHours = document.getElementById('setting-token-expiry-hours');
    if (tokenExpiryHours) tokenExpiryHours.value = config.tokenExpiryHours || 8;

    const requireAttachment = document.getElementById('setting-require-attachment');
    const requireAttachmentStatus = document.getElementById('setting-require-attachment-status');
    const isRequireAttachmentOn = isConfigEnabled(config.requireAttachment);
    if (requireAttachment) requireAttachment.checked = isRequireAttachmentOn;
    if (requireAttachmentStatus) requireAttachmentStatus.textContent = isRequireAttachmentOn ? 'เปิดอยู่' : 'ปิดอยู่';

    const publicExportVerify = document.getElementById('setting-public-export-verify');
    const publicExportVerifyStatus = document.getElementById('setting-public-export-verify-status');
    const isPublicExportVerifyOn = isConfigEnabled(config.publicExportVerifyEnabled);
    if (publicExportVerify) publicExportVerify.checked = isPublicExportVerifyOn;
    if (publicExportVerifyStatus) publicExportVerifyStatus.textContent = isPublicExportVerifyOn ? 'เปิดอยู่' : 'ปิดอยู่';

    const googleLogin = document.getElementById('setting-google-login-enabled');
    const googleLoginStatus = document.getElementById('setting-google-login-status');
    const isGoogleLoginOn = config.googleLoginEnabled === 'true';
    if (googleLogin) googleLogin.checked = isGoogleLoginOn;
    if (googleLoginStatus) googleLoginStatus.textContent = isGoogleLoginOn ? 'เปิดอยู่' : 'ปิดอยู่';

    const clientId = document.getElementById('setting-google-client-id');
    if (clientId) clientId.value = config.googleOauthClientId || '';

    const driveFolderId = document.getElementById('setting-drive-folder-id');
    if (driveFolderId) driveFolderId.value = config.driveFolderId || '';

    const driveFolderStatus = document.getElementById('drive-folder-status');
    if (driveFolderStatus) {
        const span = driveFolderStatus.querySelector('span');
        if (span) {
            span.textContent = config.driveFolderId
                ? 'ตั้งค่า Folder ID แล้ว: ' + config.driveFolderId
                : 'ยังไม่ได้ตั้งค่า Folder ID ระบบจะสร้างโฟลเดอร์ใหม่อัตโนมัติหลังจากกำหนด';
        }
    }

    const currentUser = JSON.parse(localStorage.getItem('rdf_current_user') || 'null');
    const adminInfoEl = document.getElementById('setting-admin-info');
    if (adminInfoEl) adminInfoEl.textContent = (currentUser && currentUser.name) || '-';

    const lastLoginEl = document.getElementById('setting-last-login');
    if (lastLoginEl) {
        const loginTime = localStorage.getItem('rdf_login_time');
        lastLoginEl.textContent = loginTime ? formatThaiDate(loginTime) : '-';
    }
};

// แอบเตรียมเครื่องมือส่งออก (pdfmake/xlsx/ฟอนต์) ไว้ล่วงหน้าเบื้องหลัง
// เริ่มหลังหน้าแรกแสดงเสร็จ ('load') + ตอนเบราว์เซอร์ว่าง (requestIdleCallback)
// → กดส่งออกครั้งแรกได้ทันที โดยไม่บล็อกการโหลด/แสดงผลหน้าแรก
window.addEventListener('load', () => {
    const preload = () => ensureExportLibs('กำลังเตรียมเครื่องมือส่งออกเบื้องหลัง...').catch(() => {});
    if ('requestIdleCallback' in window) requestIdleCallback(preload, { timeout: 5000 });
    else setTimeout(preload, 2000);
});
