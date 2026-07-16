// ==========================================================================
// RDF Expense & Claim Management System — v4.0 (GAS Cloud Integration)
// Master Data + Full Expense Schema
// ==========================================================================

const API_URL = 'https://script.google.com/macros/s/AKfycbwxEEhfMfU8hjiR-iijOqcdPbRR-UOQOf4CMD34B0qVlhjgJYEpFXzGkopJ4inI5RyRnA/exec';

// API request router (CORS friendly via text/plain payload)
async function apiCall(action, data = null, filters = null, pagination = null) {
    const token = localStorage.getItem('rdf_session_token');
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8'
            },
            body: JSON.stringify({ action, token, data, filters, pagination })
        });
        const result = await response.json();
        if (result.status !== 'success' && !result.success) {
            if (result.error && result.error.code === 'UNAUTHORIZED' || result.message === 'Token ไม่ถูกต้อง' || result.message === 'Unauthorized. Please login again.') {
                handleSessionExpired();
            }
            throw new Error(result.message || (result.error ? result.error.message : 'API call failed'));
        }
        return result.data || result;
    } catch (err) {
        console.error(`API Call [${action}] failed:`, err);
        throw err;
    }
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

// SweetAlert2 wrappers
async function appConfirm(message, title = 'ยืนยัน') {
    const result = await Swal.fire({
        title: title,
        text: message,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'ตกลง',
        cancelButtonText: 'ยกเลิก',
        confirmButtonColor: '#3b82f6',
        cancelButtonColor: '#ef4444'
    });
    return result.isConfirmed;
}

function appAlert(message, icon = 'info', title = '') {
    return Swal.fire({
        title: title,
        text: message,
        icon: icon,
        confirmButtonText: 'ตกลง',
        confirmButtonColor: '#3b82f6'
    });
}

// Loading state overlay control
function showLoading(show) {
    if (show) {
        Swal.fire({
            title: 'กำลังประมวลผลข้อมูล...',
            allowOutsideClick: false,
            showConfirmButton: false,
            didOpen: () => {
                Swal.showLoading();
            }
        });
    } else {
        if (Swal.isVisible() && Swal.isLoading()) {
            Swal.close();
        }
        // Fallback to original overlay just in case
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    }
}

// Handle login session expiration
function handleSessionExpired() {
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

// Display logged in user details in sidebar
function showUserProfile(user) {
    const profileBox = document.getElementById('user-profile-box');
    const profileName = document.getElementById('user-profile-name');
    const profileRole = document.getElementById('user-profile-role');
    const avatarChar = document.getElementById('user-avatar-char');
    
    if (profileBox && user) {
        profileBox.style.display = 'flex';
        if (profileName) profileName.textContent = user.name || user.id;
        if (profileRole) profileRole.textContent = `สิทธิ์: ${user.role || 'staff'}`;
        if (avatarChar) avatarChar.textContent = (user.name || 'U').substring(0, 1).toUpperCase();
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

// Temporary attachments array for new/editing bills
let tempBillAttachments = [];

// ==========================================================================
// Default State (v4)
// ==========================================================================
function getDefaultState() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYearBE = now.getFullYear() + 543; // BE Year

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

        // ---- Expense Records ----
        expenses: [],

        // Utility bills (electric, water, etc.)
        attachments: [],

        // ---- UI State ----
        theme: "light",
        activeTab: "dashboard",
        selectedMonth: currentMonth,
        selectedYear: currentYearBE,
        calculationMode: "all",
        monthStatuses: {},
        
        // ---- Claims & Signatures ----
        claims: [],
        bills: [],
        claimBillMap: [],
        fundReceipts: [],
        signatures: { prepared: null, checked: null, approved: null },
        columns: [
            { id: "documentNo", label: "เลขบิล", visible: true, custom: false },
            { id: "expenseDate", label: "วันที่บิล", visible: true, custom: false },
            { id: "projectId", label: "โครงการ", visible: true, custom: false },
            { id: "categoryId", label: "หมวดหมู่", visible: true, custom: false },
            { id: "fundSourceId", label: "แหล่งเงิน", visible: true, custom: false },
            { id: "vendorId", label: "ร้านค้า/ผู้ขาย", visible: true, custom: false },
            { id: "description", label: "รายละเอียด", visible: true, custom: false },
            { id: "quantity", label: "จำนวน", visible: true, custom: false },
            { id: "unitPrice", label: "ราคาหน่วย", visible: true, custom: false },
            { id: "amount", label: "รวม", visible: true, custom: false },
            { id: "claimable", label: "ประเภท", visible: true, custom: false },
            { id: "attachment", label: "หลักฐาน", visible: true, custom: false }
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
// Initialization & Lifecycle
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    applyLoginBackground();
    initializeLucide();

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

// โหลดฐานข้อมูลหลักแบบ real-time จาก Google Sheets
async function initAppWithAPI() {
    try {
        showLoading(true);
        
        // 1. ดึงข้อมูล Master Data
        const settingsRes = await apiCall('getSystemConfig');
          state.maxUploadSizeMb = (settingsRes.config && settingsRes.config.maxUploadSizeMb) ? parseFloat(settingsRes.config.maxUploadSizeMb) : 2;
          const master = await apiCall('getMasterData');
        state.projects = (master.projects || []).map(p => ({ ...p, name: p.projectName || p.name }));
        state.categories = (master.categories || []).map(c => ({ ...c, name: c.categoryName || c.name }));
        state.vendors = (master.vendors || []).map(v => ({ ...v, name: v.vendorName || v.name }));
        state.fundSources = (master.fundSources || []).map(f => ({ ...f, name: f.name || f.fundSourceName }));
        
        // 2. ดึงค่าใช้จ่าย (Expenses) ของเดือนที่เลือก
        const gYear = state.selectedYear - 543;
        const mStr = String(state.selectedMonth).padStart(2, '0');
        const monthFilter = `${gYear}-${mStr}`;
        
        const expensesRes = await apiCall('getExpenses', null, { month: monthFilter });
        const allExpenses = expensesRes.expenses || [];
        
        // แยกบิลปกติ (EXP) และบิลสาธารณูปโภค (ATT) เพื่อแสดงผลในหน้าเว็บอย่างถูกต้อง
        state.expenses = allExpenses.filter(e => e.id && e.id.startsWith('EXP'));
        state.attachments = allExpenses.filter(e => e.id && e.id.startsWith('ATT'));
        
        // 3. ดึงกลุ่มชุดเคลมทั้งหมด
        const claimsRes = await apiCall('getClaims');
        state.claims = claimsRes.claims || [];

        // 4. ดึงเอกสารรับเงินทุนประจำเดือนทั้งหมด (โหลดทั้งหมดไว้ล่วงหน้าเหมือน claims เพราะหน้าสรุปต้องเห็นทุกเดือนพร้อมกัน)
        const fundReceiptsRes = await apiCall('getFundReceipts');
        state.fundReceipts = fundReceiptsRes.fundReceipts || [];

        // โหลดข้อมูลลายเซ็นจาก LocalStorage ท้องถิ่น (ตาม Phase 2 เดิม)
        loadAttachments();

        renderAll();
    } catch (err) {
        appAlert('ไม่สามารถโหลดข้อมูลจาก Google Sheets ได้: ' + err.message);
    } finally {
        showLoading(false);
    }
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
            state.selectedMonth = parsed.selectedMonth || defaults.selectedMonth;
            state.selectedYear = parsed.selectedYear || defaults.selectedYear;
            state.calculationMode = parsed.calculationMode || 'all';
            state.monthStatuses = parsed.monthStatuses || {};
            state.signatures = parsed.signatures || { prepared: null, checked: null, approved: null };
            state.loginBg = parsed.loginBg || '';
            state.loginBgMode = parsed.loginBgMode || 'slideshow';
            if (parsed.columns) state.columns = parsed.columns;
        } catch (e) {
            console.error("Failed to parse saved UI settings", e);
        }
    }
}

function saveState() {
    const uiSettings = {
        theme: state.theme,
        activeTab: state.activeTab,
        selectedMonth: state.selectedMonth,
        selectedYear: state.selectedYear,
        calculationMode: state.calculationMode,
        monthStatuses: state.monthStatuses,
        signatures: state.signatures,
        columns: state.columns,
        loginBg: state.loginBg,
        loginBgMode: state.loginBgMode
    };
    localStorage.setItem('rdf_expense_ui_settings', JSON.stringify(uiSettings));
}

function initializeLucide() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
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

    const statusKey = `${state.selectedYear}-${state.selectedMonth}`;
    const status = state.monthStatuses[statusKey] || 'claimed';
    document.getElementById('month-status-unclaimed').checked = (status === 'unclaimed');
}

// ==========================================================================
// Event Bindings
// ==========================================================================
function setupEventBindings() {
    // Navigation Tabs
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            switchTab(item.getAttribute('data-tab'));
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
        updateMonthStatusCheckboxUI();
        saveState();
        await initAppWithAPI();
    });
    (document.getElementById('select-year') || {}).addEventListener?.('change', async (e) => {
        state.selectedYear = parseInt(e.target.value, 10);
        updateMonthStatusCheckboxUI();
        saveState();
        await initAppWithAPI();
    });
    (document.getElementById('select-calc-mode') || {}).addEventListener?.('change', (e) => {
        state.calculationMode = e.target.value;
        saveState();
        renderAll();
    });

    // Month Status Checkbox
    (document.getElementById('month-status-unclaimed') || {}).addEventListener?.('change', (e) => {
        const statusKey = `${state.selectedYear}-${state.selectedMonth}`;
        state.monthStatuses[statusKey] = e.target.checked ? 'unclaimed' : 'claimed';
        saveState();
        renderAll();
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

    // Backup & Restore Events
    (document.getElementById('btn-backup-export') || {}).addEventListener?.('click', exportBackupJSON);
    (document.getElementById('btn-backup-import-trigger') || {}).addEventListener?.('click', () => {
        document.getElementById('input-backup-file').click();
    });
    (document.getElementById('input-backup-file') || {}).addEventListener?.('change', importBackupJSON);

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
    const statusKey = `${state.selectedYear}-${state.selectedMonth}`;
    const status = state.monthStatuses[statusKey] || 'claimed';
    document.getElementById('month-status-unclaimed').checked = (status === 'unclaimed');
}

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

async function fetchAllExpensesForSummary() {
    let all = [];
    let page = 1;
    const limit = 200;
    while (true) {
        const res = await apiCall('getExpenses', null, {}, { page, limit });
        const batch = res.expenses || [];
        all = all.concat(batch);
        if (batch.length < limit) break;
        page++;
    }
    return all;
}

async function renderSummaryView() {
    setupSummaryYearDropdown();
    const yearSelect = document.getElementById('summary-year-select');
    const selectedYear = parseInt((yearSelect && yearSelect.value) || state.selectedYear, 10);
    const ceYear = selectedYear - 543;

    const monthTbody = document.getElementById('summary-by-month-tbody');
    const projectTbody = document.getElementById('summary-by-project-tbody');
    const totalEl = document.getElementById('summary-year-total');
    if (!monthTbody || !projectTbody) return;

    monthTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    projectTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';

    let allExpenses;
    try {
        allExpenses = await fetchAllExpensesForSummary();
    } catch (err) {
        appAlert('ไม่สามารถโหลดข้อมูลรายงานสรุปได้: ' + err.message, 'error');
        monthTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--danger);">โหลดข้อมูลไม่สำเร็จ</td></tr>';
        projectTbody.innerHTML = '';
        return;
    }

    const yearExpenses = allExpenses.filter(e => e.expenseDate && e.expenseDate.startsWith(String(ceYear)));

    const thMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const byMonth = Array.from({ length: 12 }, () => ({ count: 0, amount: 0 }));
    const byProject = {};
    let yearTotal = 0;

    yearExpenses.forEach(e => {
        const amount = parseFloat(e.amount) || 0;
        yearTotal += amount;

        const monthIdx = new Date(e.expenseDate).getMonth();
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

    monthTbody.innerHTML = byMonth.map((m, idx) => `
        <tr>
            <td>${thMonths[idx]}</td>
            <td class="text-right">${m.count}</td>
            <td class="text-right">${m.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
        </tr>
    `).join('');

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

function updateFundReceiptWidget() {
    const badge = document.getElementById('fund-receipt-widget-month-badge');
    const body = document.getElementById('fund-receipt-widget-body');
    if (!badge || !body) return;

    const thShort = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    badge.textContent = thShort[state.selectedMonth - 1] + ' ' + state.selectedYear;

    const rec = getFundReceiptByMonth(selectedMonthKey());
    if (rec) {
        body.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div>
                    <div style="font-size:20px; font-weight:700; color:var(--primary);">${(parseFloat(rec.amount) || 0).toLocaleString('th-TH', {minimumFractionDigits:2})} บาท</div>
                    <a href="${rec.fileUrl}" target="_blank" style="font-size:13px;"><i data-lucide="paperclip" style="width:14px;height:14px;vertical-align:middle;"></i> ${escapeHTML(rec.fileName || 'ดูไฟล์แนบ')}</a>
                </div>
                <span class="badge" style="background:#10b98122;color:#10b981;">มีเอกสารแล้ว</span>
            </div>`;
    } else {
        body.innerHTML = `<div style="color:var(--text-muted); font-size:13px;">ยังไม่มีเอกสารรับเงินทุนของเดือนนี้</div>`;
    }
    if (window.lucide) lucide.createIcons();
}

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
    if (window.lucide) lucide.createIcons();
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

        const res = await apiCall('getFundReceipts');
        state.fundReceipts = res.fundReceipts || [];
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

        const res = await apiCall('getFundReceipts');
        state.fundReceipts = res.fundReceipts || [];
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
    if (window.lucide) lucide.createIcons();
}

// ==========================================================================
// Tab Navigation
// ==========================================================================
function switchTab(tabName) {
    state.activeTab = tabName;
    
    // Close sidebar on mobile after tab click
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-tab') === tabName);
    });
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
        const d = new Date();
        const mStr = String(d.getMonth() + 1).padStart(2, '0');
        const monthInput = document.getElementById('food-overview-month');
        if (monthInput && !monthInput.value) monthInput.value = `${d.getFullYear()}-${mStr}`;
        loadFoodOverview();
    }
    if (tabName === 'user-management') renderUserManagement();
    if (tabName === 'settings-view') {
        renderSettingsTab();
        renderMasterData();
        renderSignaturePreviews();
        renderColumnSettingsUI();
        switchSettingsTab('master');
    }
    if (tabName === 'summary-view') renderSummaryView();
    if (tabName === 'fund-receipts') renderFundReceiptsOverview();

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

function getBudDateInfo(dateStr) {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return { month: date.getMonth() + 1, year: date.getFullYear() + 543 };
}

function formatThaiDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear() + 543}`;
}

function formatDateToShort(dateStr) {
    return formatThaiDate(dateStr);
}

function formatDateThai(dateStr) {
    return formatThaiDate(dateStr);
}

function formatNumber(num) {
    return (parseFloat(num) || 0).toLocaleString('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

// ==========================================================================
// Carry-over Balance Logic
// ==========================================================================
function calculateCarryOver(targetMonth, targetYear) {
    let carryOverTotal = 0;
    let curMonth = 1;
    let curYear = 2566;

    while (curYear < targetYear || (curYear === targetYear && curMonth < targetMonth)) {
        const statusKey = `${curYear}-${curMonth}`;
        const status = state.monthStatuses[statusKey] || 'claimed';

        if (status === 'unclaimed') {
            let monthClaimableSum = 0;
            state.expenses.forEach(exp => {
                const info = getBudDateInfo(exp.expenseDate);
                if (info && info.month === curMonth && info.year === curYear && exp.claimable) {
                    monthClaimableSum += exp.amount;
                }
            });
            state.attachments.forEach(a => {
                const info = getBudDateInfo(a.expenseDate);
                if (info && info.month === curMonth && info.year === curYear && a.claimable) {
                    monthClaimableSum += a.amount;
                }
            });
            carryOverTotal += monthClaimableSum;
        }

        curMonth++;
        if (curMonth > 12) { curMonth = 1; curYear++; }
    }
    return carryOverTotal;
}

// ==========================================================================
// Calculations Engine
// ==========================================================================
function calculateTotals() {
    let activeClaimable = 0;
    let activeNonClaimable = 0;

    state.expenses.forEach(exp => {
        if (isDateInSelectedMonth(exp.expenseDate)) {
            if (exp.claimable) activeClaimable += exp.amount;
            else activeNonClaimable += exp.amount;
        }
    });
    state.attachments.forEach(a => {
        if (isDateInSelectedMonth(a.expenseDate)) {
            if (a.claimable) activeClaimable += a.amount;
            else activeNonClaimable += a.amount;
        }
    });

    const carryOver = calculateCarryOver(state.selectedMonth, state.selectedYear);
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
    if (totals.carryOver > 0) {
        banner.style.display = 'flex';
        (document.getElementById('carry-over-text') || {}).textContent =
            `ยอดยกมาจากเดือนก่อน: ฿${totals.carryOver.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (สมทบเข้ากับยอดเบิกในเดือนนี้)`;
    } else {
        banner.style.display = 'none';
    }

    const claimCard = document.getElementById('metric-claimable-card');
    const nonClaimCard = document.getElementById('metric-non-claimable-card');
    claimCard.style.opacity = state.calculationMode === 'no-claim' ? '0.4' : '1';
    nonClaimCard.style.opacity = state.calculationMode === 'claim' ? '0.4' : '1';

    const fmt = v => '฿' + v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    (document.getElementById('metric-total-expense') || {}).textContent = fmt(totals.grandTotal);
    (document.getElementById('metric-total-claimable') || {}).textContent = fmt(totals.totalClaimable);
    (document.getElementById('metric-total-non-claimable') || {}).textContent = fmt(totals.totalNonClaimable);
    (document.getElementById('metric-total-expense-thai') || {}).textContent = thaiBahtText(totals.grandTotal);
    (document.getElementById('metric-total-claimable-thai') || {}).textContent = thaiBahtText(totals.totalClaimable);
    (document.getElementById('metric-total-non-claimable-thai') || {}).textContent = thaiBahtText(totals.totalNonClaimable);

    // KPI counts
    const monthExpenses = state.expenses.filter(e => isDateInSelectedMonth(e.expenseDate));
    const monthAttachments = state.attachments.filter(a => isDateInSelectedMonth(a.expenseDate));
    const kpiCount = document.getElementById('metric-bill-count');
    if (kpiCount) kpiCount.textContent = monthExpenses.length + monthAttachments.length + ' รายการ';
}

// ==========================================================================
// Render All
// ==========================================================================
function renderAll() {
    updateMetricsBar();
    renderTables();
    renderCharts();
    renderSpreadsheet();
    renderSummaries();
    renderProjectFilterDropdown();
    updateFundReceiptWidget();
    if (state.activeTab === 'settings-view') {
        renderMasterData();
        renderSignaturePreviews();
        renderColumnSettingsUI();
    }
    if (state.activeTab === 'claims-view') renderClaims();
    if (state.activeTab === 'fund-receipts') renderFundReceiptsOverview();
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
function renderCharts() {
    const isDark = state.theme === 'dark';
    const textColor = isDark ? '#e5e7eb' : '#374151';

    // 1. Project breakdown table (dynamic from state.projects)
    const projectMap = {};
    state.projects.forEach(p => {
        projectMap[p.id] = { name: p.name, claimable: 0, nonClaimable: 0 };
    });

    state.expenses.forEach(exp => {
        if (!isDateInSelectedMonth(exp.expenseDate)) return;
        const key = projectMap[exp.projectId] ? exp.projectId : null;
        if (key) {
            if (exp.claimable) projectMap[key].claimable += exp.amount;
            else projectMap[key].nonClaimable += exp.amount;
        }
    });
    state.attachments.forEach(a => {
        if (!isDateInSelectedMonth(a.expenseDate)) return;
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
        if (!isDateInSelectedMonth(exp.expenseDate)) return;
        if (fundMap[exp.fundSourceId]) fundMap[exp.fundSourceId].total += exp.amount;
    });
    state.attachments.forEach(a => {
        if (!isDateInSelectedMonth(a.expenseDate)) return;
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
        if (!isDateInSelectedMonth(exp.expenseDate)) return;
        const catName = getCategoryName(exp.categoryId);
        catMap[catName] = (catMap[catName] || 0) + exp.amount;
    });
    state.attachments.forEach(a => {
        if (!isDateInSelectedMonth(a.expenseDate)) return;
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
    const monthExpenses = state.expenses.filter(e => isDateInSelectedMonth(e.expenseDate)).slice().reverse();

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
        if (!isDateInSelectedMonth(exp.expenseDate)) return false;
        const matchSearch = [exp.documentNo, exp.description, getVendorName(exp.vendorId), getCategoryName(exp.categoryId), exp.note]
            .join(' ').toLowerCase().includes(searchVal);
        const matchProj = projFilter === 'all' || exp.projectId === projFilter;
        return matchSearch && matchProj;
    });

    if (filteredExp.length === 0) {
        const visibleColsCount = state.columns.filter(c => c.visible).length + 1; // +1 for Actions
        tbodyBills.innerHTML = `<tr><td colspan="${visibleColsCount}" class="empty-state">ไม่พบรายการบิลในเดือนนี้</td></tr>`;
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
        if (!isDateInSelectedMonth(a.expenseDate)) return false;
        const matchSearch = [a.description, getVendorName(a.vendorId), getCategoryName(a.categoryId), a.note]
            .join(' ').toLowerCase().includes(searchVal);
        const matchProj = projFilter === 'all' || a.projectId === projFilter;
        return matchSearch && matchProj;
    });

    if (filteredAttach.length === 0) {
        const visibleColsCount = state.columns.filter(c => c.visible).length + 1; // +1 for Actions
        tbodyAttach.innerHTML = `<tr><td colspan="${visibleColsCount}" class="empty-state">ไม่พบบิลแนบ / ค่าสาธารณูปโภคในเดือนนี้</td></tr>`;
    } else {
        filteredAttach.forEach(a => {
            const idx = state.attachments.findIndex(x => x === a);
            renderAttachmentRow(a, idx, tbodyAttach);
        });
    }

    // 4. Render Inline Add Rows
    renderExpenseInlineAddRow(tbodyBills);
    renderAttachmentInlineAddRow(tbodyAttach);

    bindInlineListeners();
    bindTableActionButtons();
    initializeLucide();
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
            if (await appConfirm(`ลบรายการ ${exp.documentNo} หรือไม่?`)) {
                showLoading(true);
                try {
                    await apiCall('deleteExpense', { id: exp.id });
                    appAlert('ลบรายการสำเร็จ!');
                    await initAppWithAPI();
                } catch (err) {
                    appAlert('ลบล้มเหลว: ' + err.message);
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
            if (await appConfirm(`ลบรายการ "${att.description}" หรือไม่?`)) {
                showLoading(true);
                try {
                    await apiCall('deleteExpense', { id: att.id });
                    appAlert('ลบรายการสำเร็จ!');
                    await initAppWithAPI();
                } catch (err) {
                    appAlert('ลบล้มเหลว: ' + err.message);
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

    const monthlyExp = state.expenses.filter(e => isDateInSelectedMonth(e.expenseDate));
    const monthlyAttach = state.attachments.filter(a => isDateInSelectedMonth(a.expenseDate));

    let expSum = 0;
    monthlyExp.forEach(e => {
        if (state.calculationMode === 'all' || (state.calculationMode === 'claim' && e.claimable) || (state.calculationMode === 'no-claim' && !e.claimable)) {
            expSum += e.amount;
        }
    });

    const carryOver = calculateCarryOver(state.selectedMonth, state.selectedYear);
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
// TAB 4: Summaries
// ==========================================================================
function renderSummaries() {
    const selectedYear = state.selectedYear;
    (document.getElementById('summary-active-year') || {}).textContent = selectedYear;
    (document.getElementById('summary-active-year-monthly') || {}).textContent = selectedYear;

    // Project annual summary
    const projSum = {};
    state.projects.forEach(p => { projSum[p.id] = { name: p.name, claimable: 0, nonClaimable: 0 }; });

    state.expenses.forEach(exp => {
        const info = getBudDateInfo(exp.expenseDate);
        if (info && info.year === selectedYear && projSum[exp.projectId]) {
            if (exp.claimable) projSum[exp.projectId].claimable += exp.amount;
            else projSum[exp.projectId].nonClaimable += exp.amount;
        }
    });
    state.attachments.forEach(a => {
        const info = getBudDateInfo(a.expenseDate);
        if (info && info.year === selectedYear && projSum[a.projectId]) {
            if (a.claimable) projSum[a.projectId].claimable += a.amount;
            else projSum[a.projectId].nonClaimable += a.amount;
        }
    });

    const tbodyProjSum = document.querySelector('#summary-project-table tbody');
    if(tbodyProjSum) tbodyProjSum.innerHTML = '';
    let annualGrand = 0, annualClaim = 0, annualNonClaim = 0;

    Object.values(projSum).forEach(p => {
        const total = p.claimable + p.nonClaimable;
        annualGrand += total; annualClaim += p.claimable; annualNonClaim += p.nonClaimable;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-semibold">${p.name}</td>
            <td class="text-right text-success font-semibold">฿${p.claimable.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
            <td class="text-right text-secondary">฿${p.nonClaimable.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
            <td class="text-right font-bold">฿${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
        `;
        if(tbodyProjSum) tbodyProjSum.appendChild(tr);
    });
    if(tbodyProjSum && tbodyProjSum.children.length === 0) {
        if(tbodyProjSum) tbodyProjSum.innerHTML = `<tr><td colspan="4" class="empty-state">ไม่มีข้อมูลในปีนี้</td></tr>`;
    }

    (document.getElementById('summary-year-total') || {}).textContent = '฿' + annualGrand.toLocaleString('th-TH', { minimumFractionDigits: 2 });
    (document.getElementById('summary-year-claimable') || {}).textContent = '฿' + annualClaim.toLocaleString('th-TH', { minimumFractionDigits: 2 });
    (document.getElementById('summary-year-non-claimable') || {}).textContent = '฿' + annualNonClaim.toLocaleString('th-TH', { minimumFractionDigits: 2 });

    // Monthly breakdown
    const monthlyData = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, claimable: 0, nonClaimable: 0, count: 0 }));

    state.expenses.forEach(exp => {
        const info = getBudDateInfo(exp.expenseDate);
        if (info && info.year === selectedYear) {
            const mi = info.month - 1;
            if (exp.claimable) monthlyData[mi].claimable += exp.amount;
            else monthlyData[mi].nonClaimable += exp.amount;
            monthlyData[mi].count++;
        }
    });
    state.attachments.forEach(a => {
        const info = getBudDateInfo(a.expenseDate);
        if (info && info.year === selectedYear) {
            const mi = info.month - 1;
            if (a.claimable) monthlyData[mi].claimable += a.amount;
            else monthlyData[mi].nonClaimable += a.amount;
            monthlyData[mi].count++;
        }
    });

    const tbodyMonthly = document.querySelector('#summary-monthly-table tbody');
    if(tbodyMonthly) tbodyMonthly.innerHTML = '';
    monthlyData.forEach(md => {
        const statusKey = `${selectedYear}-${md.month}`;
        const status = state.monthStatuses[statusKey] || 'claimed';
        const carryVal = calculateCarryOver(md.month, selectedYear);
        const totalPayout = md.claimable + carryVal;

        if (md.count > 0 || carryVal > 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-semibold">${THAI_MONTH_NAMES[md.month - 1]}</td>
                <td><span class="badge ${status === 'claimed' ? 'badge-claimable' : 'badge-non-claimable'}" style="cursor:pointer" data-month-toggle="${md.month}">${status === 'claimed' ? 'เบิกจ่ายแล้ว' : 'ยกยอดไปต่อ'}</span></td>
                <td class="text-right text-success">฿${md.claimable.toFixed(2)}</td>
                <td class="text-right text-secondary">฿${md.nonClaimable.toFixed(2)}</td>
                <td class="text-right font-semibold" style="color:var(--warning);">฿${carryVal.toFixed(2)}</td>
                <td class="text-right font-bold">฿${totalPayout.toFixed(2)}</td>
                <td class="text-center">${md.count}</td>
            `;
            if(tbodyMonthly) tbodyMonthly.appendChild(tr);
        }
    });
    if (tbodyMonthly && tbodyMonthly.children.length === 0) {
        if(tbodyMonthly) tbodyMonthly.innerHTML = `<tr><td colspan="7" class="empty-state">ไม่มีรายการในปีงบประมาณนี้</td></tr>`;
    }

    document.querySelectorAll('[data-month-toggle]').forEach(badge => {
        badge.addEventListener('click', () => {
            const month = badge.getAttribute('data-month-toggle');
            const key = `${selectedYear}-${month}`;
            const cur = state.monthStatuses[key] || 'claimed';
            state.monthStatuses[key] = cur === 'claimed' ? 'unclaimed' : 'claimed';
            saveState(); renderAll();
        });
    });

    // Year-by-year
    const yearlyMap = {};
    [...state.expenses, ...state.attachments].forEach(item => {
        const info = getBudDateInfo(item.expenseDate || item.expenseDate);
        if (!info) return;
        const y = info.year;
        if (!yearlyMap[y]) yearlyMap[y] = { claimable: 0, nonClaimable: 0 };
        const amt = item.amount || (item.quantity * item.unitPrice);
        if (item.claimable) yearlyMap[y].claimable += amt;
        else yearlyMap[y].nonClaimable += amt;
    });

    const tbodyYearly = document.querySelector('#summary-yearly-table tbody');
    if(tbodyYearly) tbodyYearly.innerHTML = '';
    Object.keys(yearlyMap).sort().forEach(y => {
        const v = yearlyMap[y];
        const total = v.claimable + v.nonClaimable;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-semibold">${y}</td>
            <td class="text-right text-success font-semibold">฿${v.claimable.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
            <td class="text-right text-secondary">฿${v.nonClaimable.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
            <td class="text-right font-bold">฿${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</td>
        `;
        if(tbodyYearly) tbodyYearly.appendChild(tr);
    });
    if (tbodyYearly && tbodyYearly.children.length === 0) {
        if(tbodyYearly) tbodyYearly.innerHTML = `<tr><td colspan="4" class="empty-state">ยังไม่มีข้อมูล</td></tr>`;
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
    renderLoginBgSettingsUI();
    initializeLucide();
}

function renderMasterProjects() {
    const tbody = document.querySelector('#master-projects-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.projects.forEach((p, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-semibold">${p.id}</td>
            <td>${p.name}</td>
            <td class="text-right">฿${(p.budget || 0).toLocaleString('th-TH')}</td>
            <td><span class="badge ${p.active ? 'badge-claimable' : 'badge-non-claimable'}">${p.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
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
    tbody.innerHTML = '';
    state.categories.forEach((c, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-semibold">${c.id}</td>
            <td>${c.name}</td>
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
    tbody.innerHTML = '';
    state.vendors.forEach((v, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-semibold">${v.id}</td>
            <td>${v.name}</td>
            <td>${v.phone || '-'}</td>
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
    tbody.innerHTML = '';
    state.fundSources.forEach((f, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-semibold">${f.id}</td>
            <td>${f.name}</td>
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

function handleMasterDelete(master, idx) {
    appAlert("การลบข้อมูลหลัก (Master Data) ถูกปฏิเสธเพื่อป้องกันความเสียหายของประวัติการลงบัญชีเก่าในระบบ กรุณาปิดใช้งานหรือลบแถวข้อมูลผ่าน Google Sheets ของท่านโดยตรง");
}

// ==========================================================================
// Master Data Modal (Single reusable modal)
// ==========================================================================
function openMasterModal(master, editIdx = null) {
    const modal = document.getElementById('modal-master');
    const title = document.getElementById('modal-master-title');
    const body = document.getElementById('modal-master-body');
    modal.setAttribute('data-master', master);
    modal.setAttribute('data-edit-idx', editIdx !== null ? editIdx : '');

    const titles = { project: 'โครงการ', category: 'หมวดหมู่', vendor: 'ผู้ขาย/ร้านค้า', fundsource: 'แหล่งเงิน' };
    title.textContent = (editIdx !== null ? 'แก้ไข' : 'เพิ่ม') + titles[master];

    body.innerHTML = '';

    if (master === 'project') {
        const item = editIdx !== null ? state.projects[editIdx] : null;
        body.innerHTML = `
            <div class="form-group"><label class="form-label">ชื่อโครงการ</label><input type="text" id="mf-name" class="form-input" value="${item ? item.name : ''}" required></div>
            <div class="form-group"><label class="form-label">งบประมาณ (฿)</label><input type="number" id="mf-budget" class="form-input" value="${item ? item.budget : 0}" min="0"></div>
            <div class="form-group"><label class="form-label">สถานะ</label>
                <select id="mf-active" class="form-select w-full" style="padding:10px;" ${item ? 'disabled' : ''}>
                    <option value="true" ${!item || item.active ? 'selected' : ''}>ใช้งาน</option>
                    <option value="false" ${item && !item.active ? 'selected' : ''}>ปิดใช้งาน</option>
                </select>
            </div>
        `;
    } else if (master === 'category') {
        const item = editIdx !== null ? state.categories[editIdx] : null;
        body.innerHTML = `<div class="form-group"><label class="form-label">ชื่อหมวดหมู่</label><input type="text" id="mf-name" class="form-input" value="${item ? item.name : ''}" required></div>`;
    } else if (master === 'vendor') {
        const item = editIdx !== null ? state.vendors[editIdx] : null;
        body.innerHTML = `
            <div class="form-group"><label class="form-label">ชื่อร้าน / ผู้ขาย</label><input type="text" id="mf-name" class="form-input" value="${item ? item.name : ''}" required></div>
            <div class="form-group"><label class="form-label">เบอร์โทรศัพท์</label><input type="text" id="mf-phone" class="form-input" value="${item ? (item.phone || '') : ''}"></div>
        `;
    } else if (master === 'fundsource') {
        const item = editIdx !== null ? state.fundSources[editIdx] : null;
        body.innerHTML = `<div class="form-group"><label class="form-label">ชื่อแหล่งเงิน</label><input type="text" id="mf-name" class="form-input" value="${item ? item.name : ''}" required></div>`;
    }

    modal.classList.add('active');
}

function closeMasterModal() {
    document.getElementById('modal-master').classList.remove('active');
}

async function handleMasterSubmit(e) {
    e.preventDefault();
    const modal = document.getElementById('modal-master');
    const master = modal.getAttribute('data-master');
    const editIdx = modal.getAttribute('data-edit-idx');
    const idx = editIdx !== '' ? parseInt(editIdx, 10) : null;
    const name = document.getElementById('mf-name').value.trim();
    if (!name) return;

    if (idx !== null) {
        appAlert("การแก้ไขข้อมูลหลักโดยตรงบนเว็บไซต์ถูกจำกัด กรุณาแก้ไขผ่าน Google Sheets ของหน่วยงานโดยตรงเพื่อรักษาเสถียรภาพของฐานข้อมูล");
        closeMasterModal();
        return;
    }

    showLoading(true);
    try {
        if (master === 'project') {
            const budget = parseFloat(document.getElementById('mf-budget').value) || 0;
            await apiCall('createProject', { projectName: name, budget });
        } else if (master === 'category') {
            await apiCall('createCategory', { categoryName: name });
        } else if (master === 'vendor') {
            const phone = (document.getElementById('mf-phone') || {}).value || '';
            await apiCall('createVendor', { vendorName: name, phone });
        } else if (master === 'fundsource') {
            await apiCall('createFundSource', { fundSourceName: name });
        }
        appAlert('เพิ่มข้อมูลหลักสำเร็จ!');
        closeMasterModal();
        await initAppWithAPI();
    } catch (err) {
        appAlert('บันทึกข้อมูลหลักล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
    }
}

// ==========================================================================
// Expense Modal (Bill Form)
// ==========================================================================
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

// ==========================================================================
// Quick Add Project (Directly from bill modals)
// ==========================================================================
async function quickAddProject(target) {
    const name = prompt("กรุณาระบุชื่อโครงการ / กิจกรรมใหม่ที่ต้องการเพิ่ม:");
    if (!name) return;
    const nameTrimmed = name.trim();
    if (!nameTrimmed) return;
    
    showLoading(true);
    try {
        await apiCall('createProject', { projectName: nameTrimmed, budget: 0 });
        appAlert('เพิ่มโครงการสำเร็จ!');
        await initAppWithAPI();
        
        const activeProjects = state.projects.filter(p => p.active);
        const newProj = state.projects.find(p => p.name === nameTrimmed);
        const selectedVal = newProj ? newProj.id : null;
        
        if (target === 'bill') {
            populateDropdown('bill-project', activeProjects, 'id', 'name', selectedVal);
        } else if (target === 'attach') {
            populateDropdown('attach-project', activeProjects, 'id', 'name', selectedVal);
        }
    } catch (err) {
        appAlert('บันทึกโครงการล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
    }
}
window.quickAddProject = quickAddProject;

function openExpenseModal(editIdx = null, isNewProject = false) {
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

    (document.getElementById('bill-edit-index') || {}).value = editIdx !== null ? editIdx : '';
    form.reset();

    const activeProjects = state.projects.filter(p => p.active);
    populateDropdown('bill-project', activeProjects, 'id', 'name');
    populateDropdown('bill-category', state.categories, 'id', 'name');
    populateDropdown('bill-vendor', state.vendors, 'id', 'name');
    populateDropdown('bill-fund-source', state.fundSources, 'id', 'name');

    if (editIdx !== null) {
        const exp = state.expenses[editIdx];
        (document.getElementById('bill-docno') || {}).value = exp.documentNo;
        (document.getElementById('bill-date') || {}).value = exp.expenseDate;
        (document.getElementById('bill-project') || {}).value = exp.projectId;
        (document.getElementById('bill-category') || {}).value = exp.categoryId;
        (document.getElementById('bill-vendor') || {}).value = exp.vendorId;
        (document.getElementById('bill-fund-source') || {}).value = exp.fundSourceId;
        (document.getElementById('bill-desc') || {}).value = exp.description;
        (document.getElementById('bill-qty') || {}).value = exp.quantity;
        (document.getElementById('bill-price') || {}).value = exp.unitPrice;
        (document.getElementById('bill-claim-type') || {}).value = exp.claimable ? 'claim' : 'no-claim';
        (document.getElementById('bill-note') || {}).value = exp.note || '';
    } else {
        const nextNum = state.expenses.length + 1;
        (document.getElementById('bill-docno') || {}).value = 'X' + String(nextNum).padStart(2, '0');
        const gYear = state.selectedYear - 543;
        const mStr = String(state.selectedMonth).padStart(2, '0');
        (document.getElementById('bill-date') || {}).value = `${gYear}-${mStr}-01`;
    }

    modal.classList.add('active');
}

function closeExpenseModal() {
    isNewProjectExpenseMode = false;
    document.getElementById('modal-bill').classList.remove('active');
}

async function handleExpenseSubmit(e) {
    e.preventDefault();
    const editIdx = document.getElementById('bill-edit-index').value;
    const claimable = (document.getElementById('bill-claim-type') || {}).value === 'claim';
    const qty = Math.max(0.01, parseFloat(document.getElementById('bill-qty').value) || 1);
    const unitPrice = Math.max(0, parseFloat(document.getElementById('bill-price').value) || 0);

    const user = JSON.parse(localStorage.getItem('rdf_current_user') || '{}');
    const orgId = user.organizationId || 'ORG001';

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

        const expData = {
            expenseDate: document.getElementById('bill-date').value,
            organizationId: orgId,
            projectId: projectId,
            categoryId: document.getElementById('bill-category').value,
            vendorId: document.getElementById('bill-vendor').value,
            fundSourceId: document.getElementById('bill-fund-source').value,
            description: document.getElementById('bill-desc').value.trim(),
            quantity: qty,
            unitPrice: unitPrice,
            claimable: claimable,
            note: document.getElementById('bill-note').value.trim()
        };

        let finalExpId = null;
        if (editIdx !== '') {
            const existingExp = state.expenses[parseInt(editIdx, 10)];
            expData.id = existingExp.id;
            await apiCall('updateExpense', expData);
            finalExpId = existingExp.id;
            appAlert('แก้ไขรายจ่ายเรียบร้อย!');
        } else {
            const result = await apiCall('createExpense', expData);
            finalExpId = result.id;
            appAlert('เพิ่มรายจ่ายใหม่เรียบร้อย!');
        }
        
        // Handle uploading temporary attachments if any
        if (tempBillAttachments.length > 0 && finalExpId) {
            Swal.fire({ title: 'กำลังอัปโหลดไฟล์แนบ...', text: 'กรุณารอสักครู่', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); }});
            for (const item of tempBillAttachments) {
                try {
                    const reader = new FileReader();
                    const base64Promise = new Promise((resolve, reject) => {
                        reader.onload = () => resolve(reader.result.split(',')[1]);
                        reader.onerror = error => reject(error);
                        reader.readAsDataURL(item.file);
                    });
                    const base64Data = await base64Promise;
                    await apiCall('uploadAttachment', {
                        expenseId: finalExpId,
                        fileName: item.originalFileName,
                        mimeType: item.file.type,
                        base64Data: base64Data,
                        originalSize: item.originalSize,
                        compressedSize: item.compressedSize,
                        sha256Hash: item.sha256Hash
                    });
                } catch(e) {
                    console.error("Upload temp file failed:", e);
                }
            }
            // Fetch updated attachments
            const res = await apiCall('getAttachments', { expenseId: finalExpId });
            attachmentStore[finalExpId] = res.attachments || [];
            saveAttachments();
        }

        closeExpenseModal();
        await initAppWithAPI();
    } catch (err) {
        appAlert('บันทึกรายจ่ายล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
    }
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
                    const newFile = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() });
                    resolve({ file: newFile, compressed: true, originalSize: file.size });
                }, 'image/jpeg', 0.7);
            };
        };
        reader.onerror = error => reject(error);
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
            div.innerHTML = `<img src="${att.viewUrl}" style="width:100%; height:100%; object-fit:cover;" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'32\\' height=\\'32\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\'><path d=\\'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z\\'/></svg>'">`;
            if(container) container.appendChild(div);
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
    
    lucide.createIcons();
}

// ==========================================================================
// Attachment Modal
// ==========================================================================
function openAttachmentModal(editIdx = null) {
    const modal = document.getElementById('modal-attachment');
    const form = document.getElementById('form-attachment');
    (document.getElementById('modal-attachment-title') || {}).textContent = editIdx !== null ? 'แก้ไขบิลแนบ' : 'เพิ่มบิลแนบ / ค่าสาธารณูปโภค';
    (document.getElementById('attachment-edit-index') || {}).value = editIdx !== null ? editIdx : '';
    form.reset();

    const activeProjects = state.projects.filter(p => p.active);
    populateDropdown('attach-project', activeProjects, 'id', 'name');
    populateDropdown('attach-category', state.categories, 'id', 'name');
    populateDropdown('attach-fund-source', state.fundSources, 'id', 'name');

    if (editIdx !== null) {
        const a = state.attachments[editIdx];
        (document.getElementById('attach-date') || {}).value = a.expenseDate;
        (document.getElementById('attach-project') || {}).value = a.projectId;
        (document.getElementById('attach-category') || {}).value = a.categoryId;
        (document.getElementById('attach-fund-source') || {}).value = a.fundSourceId;
        (document.getElementById('attach-desc') || {}).value = a.description;
        (document.getElementById('attach-amount') || {}).value = a.amount || a.unitPrice;
        (document.getElementById('attach-claim-type') || {}).value = a.claimable ? 'claim' : 'no-claim';
    } else {
        const gYear = state.selectedYear - 543;
        const mStr = String(state.selectedMonth).padStart(2, '0');
        (document.getElementById('attach-date') || {}).value = `${gYear}-${mStr}-01`;
    }

    modal.classList.add('active');
}

function closeAttachmentModal() {
    document.getElementById('modal-attachment').classList.remove('active');
}

async function handleAttachmentSubmit(e) {
    e.preventDefault();
    const editIdx = document.getElementById('attachment-edit-index').value;
    const claimable = (document.getElementById('attach-claim-type') || {}).value === 'claim';
    const amount = Math.max(0, parseFloat(document.getElementById('attach-amount').value) || 0);

    const user = JSON.parse(localStorage.getItem('rdf_current_user') || '{}');
    const orgId = user.organizationId || 'ORG001';

    const attachData = {
        expenseDate: document.getElementById('attach-date').value,
        organizationId: orgId,
        projectId: document.getElementById('attach-project').value,
        categoryId: document.getElementById('attach-category').value,
        vendorId: '', // ไม่มีผู้ขายสำหรับบิลค่าบริการสาธารณูปโภค
        fundSourceId: document.getElementById('attach-fund-source').value,
        description: document.getElementById('attach-desc').value.trim(),
        quantity: 1,
        unitPrice: amount,
        claimable: claimable,
        note: ''
    };

    showLoading(true);
    try {
        if (editIdx !== '') {
            const existingAtt = state.attachments[parseInt(editIdx, 10)];
            attachData.id = existingAtt.id;
            await apiCall('updateExpense', attachData);
            appAlert('แก้ไขบิลแนบสำเร็จ!');
        } else {
            await apiCall('createExpense', attachData);
            appAlert('เพิ่มบิลแนบสำเร็จ!');
        }
        closeAttachmentModal();
        await initAppWithAPI();
    } catch (err) {
        appAlert('บันทึกบิลแนบล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
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

async function openExpenseAttachmentModal(expId) {
    currentExpAttId = expId;
    const exp = state.expenses.find(e => e.id === expId);
    const docNo = exp ? exp.documentNo : '';
    const desc = exp ? exp.description : '';
    (document.getElementById('modal-att-title') || {}).textContent =
        `หลักฐานแนบ — ${docNo}${desc ? ' (' + desc.substring(0, 30) + (desc.length > 30 ? '…' : '') + ')' : ''}`;

    const storageEl = document.getElementById('att-storage-info');
    if (storageEl) storageEl.textContent = `ระบบจัดเก็บบน Google Drive คลาวด์`;

    // Wire file input
    const fileInput = document.getElementById('att-file-input');
    if (fileInput) {
        fileInput.value = '';
        fileInput.onchange = () => handleAttachmentUpload(expId, fileInput.files);
    }

    showLoading(true);
    try {
        const res = await apiCall('getAttachments', { expenseId: expId });
        attachmentStore[expId] = res.attachments || [];
        renderExpenseAttachmentModal(expId);
    } catch (err) {
        appAlert('ดึงข้อมูลไฟล์แนบล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
    }
    
    document.getElementById('modal-attachments').classList.add('active');
}

function closeExpenseAttachmentModal() {
    document.getElementById('modal-attachments').classList.remove('active');
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

    body.innerHTML = `<div class="att-grid">${attachments.map((att, i) => `
        <div class="att-item">
            <div class="att-preview" onclick="previewAttachmentFile('${expId}',${i})">
                ${att.fileType && att.fileType.startsWith('image/')
                    ? `<img src="${att.fileUrl}" class="att-thumb" alt="${att.fileName}">`
                    : `<div class="att-icon-file"><i data-lucide="file-text"></i><span>${att.fileName.split('.').pop().toUpperCase()}</span></div>`
                }
            </div>
            <div class="att-info">
                <div class="att-name" title="${att.fileName}">${att.fileName}</div>
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
        </div>`).join('')}</div>`;
    initializeLucide();
}

async function handleAttachmentUpload(expId, files) {
    if (!files || files.length === 0) return;
    
    showLoading(true);
    try {
        for (const file of files) {
            const reader = new FileReader();
            const promise = new Promise((resolve, reject) => {
                reader.onload = async (e) => {
                    const base64Data = e.target.result.split(',')[1];
                    try {
                        await apiCall('uploadAttachment', {
                            expenseId: expId,
                            fileName: file.name,
                            fileType: file.type,
                            fileBase64: base64Data,
                            fileSize: file.size
                        });
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            await promise;
        }
        appAlert('อัปโหลดไฟล์แนบขึ้น Google Drive เรียบร้อย!');
        // ดึงข้อมูลและอัปเดต Modal อีกครั้ง
        const res = await apiCall('getAttachments', { expenseId: expId });
        attachmentStore[expId] = res.attachments || [];
        renderExpenseAttachmentModal(expId);
    } catch (err) {
        appAlert('การอัปโหลดไฟล์ล้มเหลว: ' + err.message);
    } finally {
        showLoading(false);
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
// EXPORT OPTIONS MODAL & MULTI-FORMAT
// ==========================================================================
async function showExportOptions() {
    await Swal.fire({
        title: 'เลือกรูปแบบการ Export',
        html: `
            <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 15px;">
                <button id="swal-btn-pdf" class="btn btn-outline" style="width: 100%; justify-content: flex-start; gap: 10px; border-color: #ef4444; color: #ef4444;">
                    <i data-lucide="file-text"></i> Export PDF / Print
                </button>
                <button id="swal-btn-excel" class="btn btn-outline" style="width: 100%; justify-content: flex-start; gap: 10px; border-color: #10b981; color: #10b981;">
                    <i data-lucide="file-spreadsheet"></i> Export Excel (.xlsx)
                </button>
                <button id="swal-btn-docx" class="btn btn-outline" style="width: 100%; justify-content: flex-start; gap: 10px; border-color: #3b82f6; color: #3b82f6;">
                    <i data-lucide="file-type-2"></i> Export Word (.docx)
                </button>
            </div>
        `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'ปิด',
        didOpen: () => {
            initializeLucide();
            (document.getElementById('swal-btn-pdf') || {}).addEventListener?.('click', () => {
                Swal.close();
                exportMonthlyClaimSheet();
            });
            (document.getElementById('swal-btn-excel') || {}).addEventListener?.('click', () => {
                Swal.close();
                exportExcelXLSX();
            });
            (document.getElementById('swal-btn-docx') || {}).addEventListener?.('click', () => {
                Swal.close();
                exportMonthlyClaimDocx();
            });
        }
    });
}

function exportMonthlyClaimDocx() {
    const table = document.getElementById('excel-grid');
    if (!table) return appAlert('ไม่พบตารางสำหรับส่งออก!');
    
    // Using HTML-to-Word approach for best table compatibility
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export Report</title></head><body><h2 style='text-align:center;'>รายงานรายจ่ายโครงการ</h2><br>";
    const footer = "</body></html>";
    const html = header + table.outerHTML + footer;

    const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('A');
    link.href = url;
    const dateStr = `${state.selectedYear}-${state.selectedMonth}`;
    link.download = `rdf_billing_report_${dateStr}.doc`;
    document.body.appendChild(link);
    if (navigator.msSaveOrOpenBlob) navigator.msSaveOrOpenBlob(blob, link.download);
    else link.click();
    document.body.removeChild(link);
}

// ==========================================================================
// PHASE 2: PDF / Print Export (Claim Sheet)
// ==========================================================================
function exportMonthlyClaimSheet() {
    const monthlyExp = state.expenses.filter(e => isDateInSelectedMonth(e.expenseDate));
    const monthlyAttach = state.attachments.filter(a => isDateInSelectedMonth(a.expenseDate));
    const totals = calculateTotals();
    const monthName = THAI_MONTH_NAMES[state.selectedMonth - 1];

    const generatePrintRow = (item, isAttachment = false) => {
        const parsedNote = parseNoteData(item.note);
        const amount = item.amount || 0;
        
        let rowHtml = `<tr id="print-row-${item.id}">`;
        
        // Add check column (visible only on screen)
        rowHtml += `<td class="col-check no-print text-center" style="width:30px;"><input type="checkbox" class="row-toggle-checkbox" data-row-id="${item.id}" data-project-id="${item.projectId}" checked onchange="togglePrintRow('${item.id}', this.checked)"></td>`;
        
        state.columns.forEach(col => {
            const isVisible = col.visible;
            const style = isVisible ? '' : 'display:none;';
            let cellContent = '';
            let alignClass = '';
            
            switch (col.id) {
                case 'documentNo':
                    cellContent = item.documentNo || (isAttachment ? '—' : '');
                    alignClass = 'tc';
                    break;
                case 'expenseDate':
                    cellContent = formatThaiDate(item.expenseDate);
                    alignClass = 'tc';
                    break;
                case 'projectId':
                    cellContent = getProjectName(item.projectId);
                    break;
                case 'categoryId':
                    cellContent = getCategoryName(item.categoryId);
                    break;
                case 'fundSourceId':
                    cellContent = getFundSourceName(item.fundSourceId);
                    break;
                case 'vendorId':
                    cellContent = isAttachment ? '—' : getVendorName(item.vendorId);
                    break;
                case 'description':
                    let descHTML = item.description;
                    if (parsedNote.multiItems && parsedNote.multiItems.length > 0) {
                        descHTML += `<div class="itemized-list" style="margin-top: 4px; font-size: 11px; color: #4b5563; background: #f3f4f6; padding: 4px 8px; border-radius: 4px; border-left: 2px solid #3b82f6;">`;
                        parsedNote.multiItems.forEach((sub, subIdx) => {
                            descHTML += `<div style="display: flex; justify-content: space-between; gap: 8px; padding: 2px 0;">
                                <span>${subIdx + 1}. ${sub.desc}</span>
                                <span>${sub.qty} × ฿${sub.price.toFixed(2)} = ฿${(sub.qty * sub.price).toFixed(2)}</span>
                            </div>`;
                        });
                        descHTML += `</div>`;
                    }
                    if (parsedNote.text) {
                        descHTML += `<div style="font-size:11px; color:#6b7280; margin-top:2px;">หมายเหตุ: ${parsedNote.text}</div>`;
                    }
                    cellContent = descHTML;
                    break;
                case 'quantity':
                    cellContent = isAttachment ? '—' : item.quantity;
                    alignClass = 'tr';
                    break;
                case 'unitPrice':
                    cellContent = isAttachment ? '—' : `฿${item.unitPrice.toLocaleString('th-TH', {minimumFractionDigits:2})}`;
                    alignClass = 'tr';
                    break;
                case 'amount':
                    cellContent = `฿${amount.toLocaleString('th-TH', {minimumFractionDigits:2})}`;
                    alignClass = 'tr bold';
                    break;
                case 'claimable':
                    cellContent = `<span class="${item.claimable ? 'bc' : 'bnc'}">${item.claimable ? 'เบิก' : 'ไม่เบิก'}</span>`;
                    alignClass = 'tc';
                    break;
                case 'attachment':
                    const hasAttachment = attachmentStore[item.id] ? 'มี' : 'ไม่มี';
                    cellContent = `<span style="font-size:11px;">${hasAttachment}</span>`;
                    alignClass = 'tc';
                    break;
                default:
                    if (col.custom) {
                        cellContent = parsedNote.customFields[col.label] || '-';
                    }
                    break;
            }
            
            const extraAttrs = col.id === 'amount' ? `data-amount="${amount}"` : '';
            rowHtml += `<td class="col-${col.id} ${alignClass}" style="${style}" ${extraAttrs}>${cellContent}</td>`;
        });
        
        rowHtml += `</tr>`;
        return rowHtml;
    };

    const expRows = monthlyExp.map(exp => generatePrintRow(exp, false)).join('');
    
    // Dynamic colspan for the section headers row
    const visibleColsCount = state.columns.filter(c => c.visible).length + 1; // +1 for the check column
    
    const attachRows = monthlyAttach.length > 0 ? `
        <tr class="section-row-wrapper"><td colspan="${visibleColsCount}" class="section-row" style="background:#eff6ff; color:#1e40af; font-weight:700; text-align:left; padding:8px 10px; font-size:12px;">📎 รายการบิลแนบ / ค่าสาธารณูปโภค</td></tr>
        ${monthlyAttach.map(a => generatePrintRow(a, true)).join('')}` : '';

    const carryHTML = totals.carryOver > 0 ? `
        <div class="carry-banner" id="print-carry-banner">
            ⚠️ ยอดยกมาจากเดือนก่อน:
            <strong id="print-carry-banner-total">฿${totals.carryOver.toLocaleString('th-TH', {minimumFractionDigits:2})}</strong>
            รวมอยู่ในยอดขอเบิกแล้ว
        </div>` : '';

    const html = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>ใบขอเบิกเงิน — ${monthName} ${state.selectedYear}</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Sarabun',sans-serif;font-size:13px;color:#111;background:#fff;}
.page{max-width:960px;margin:0 auto;padding:16mm 18mm;}

/* Print Setup Panel */
.no-print {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 16px 24px;
    font-family: 'Sarabun', sans-serif;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.no-print button {
    background: #059669;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 10px 28px;
    font-size: 15px;
    cursor: pointer;
    font-weight: 700;
    font-family: 'Sarabun', sans-serif;
}
.no-print button:hover { background: #047857; }
.no-print label {
    font-size: 13px;
    color: #334155;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
}
.no-print select {
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    font-family: 'Sarabun', sans-serif;
    font-size: 13px;
}

/* Header */
.org-header{text-align:center;border-bottom:2.5px double #111;padding-bottom:14px;margin-bottom:16px;}
.org-header .eng-title{font-size:16px;font-weight:700;letter-spacing:.5px;}
.org-header .thai-title{font-size:14px;font-weight:600;margin:4px 0;}
.org-header .sub-title{font-size:12px;color:#444;margin-bottom:8px;}
.org-header .month-badge{
    display:inline-block;background:#d1fae5;color:#065f46;
    border:1px solid #6ee7b7;border-radius:6px;
    padding:4px 18px;font-size:14px;font-weight:700;margin-top:6px;
}

/* Table */
table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:12px;}
th{background:#1e3a5f;color:white;font-weight:700;padding:8px 7px;border:1px solid #1e3a5f;text-align:center;}
td{padding:6px 7px;border:1px solid #999;vertical-align:top;}
tr:nth-child(even) td{background:#f8fafc;}
.tc{text-align:center;}
.tr{text-align:right;}
.bold{font-weight:700;}
.note{font-size:11px;color:#666;}
.row-hidden { display: none !important; }

/* Status badges */
.bc{background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}
.bnc{background:#e5e7eb;color:#374151;padding:2px 8px;border-radius:4px;font-size:11px;}

/* Carry over banner */
.carry-banner{background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;}

/* Totals */
.totals-box{border:1.5px solid #334155;border-radius:8px;padding:14px 18px;margin:12px 0;}
.totals-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;}
.totals-row.sub{color:#555;}
.totals-row.claim{color:#065f46;font-weight:700;border-top:1px dashed #aaa;margin-top:6px;padding-top:8px;}
.totals-row.grand{font-size:15px;font-weight:700;border-top:2px solid #111;margin-top:6px;padding-top:8px;}
.thai-baht-text{font-style:italic;color:#444;font-size:12px;margin-top:6px;}

/* Signatures */
.signatures{display:flex;justify-content:space-around;margin-top:52px;text-align:center;}
.sig-box{width:28%;}
.sig-line{height:52px;border-bottom:1px solid #111;margin-bottom:8px;}
.sig-label{font-weight:700;font-size:13px;}
.sig-sub{font-size:11px;color:#666;margin-top:4px;}
.date-line{font-size:11px;color:#444;margin-top:8px;}

/* Footer */
.doc-footer{text-align:center;margin-top:24px;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:10px;}

@media print{
    .no-print{display:none!important;}
    @page{size:A4;margin:10mm 12mm;}
    body{font-size:11px;}
    th{background:#1e3a5f!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .bc,.bnc{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .section-row{background:#eff6ff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    .col-check { display: none !important; }
}
</style>
</head>
<body>
<div class="no-print">
    <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="margin:0; font-size:16px; color:#1e293b; font-weight:700;">⚙️ ตั้งค่าและควบคุมการพิมพ์รายงาน A4</h4>
        <div style="display:flex; gap: 8px;">
            <button onclick="window.print()" style="background:#ef4444; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold; font-family:'Sarabun',sans-serif;">🖨️ PDF / Print</button>
            <button onclick="exportExcel()" style="background:#10b981; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold; font-family:'Sarabun',sans-serif;">📊 Excel (.xlsx)</button>
            <button onclick="exportWord()" style="background:#3b82f6; color:white; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold; font-family:'Sarabun',sans-serif;">📄 Word (.docx)</button>
        </div>
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:10px 16px; padding:8px 0; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0;">
        <span style="font-weight:600; font-size:13px; color:#475569;">แสดงคอลัมน์:</span>
        ${state.columns.map(col => `
            <label>
                <input type="checkbox" class="col-filter-checkbox" data-col-id="${col.id}" ${col.visible ? 'checked' : ''} onchange="togglePrintColumn('${col.id}', this.checked)">
                ${col.label}
            </label>
        `).join('')}
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:24px; align-items:center;">
        <label>
            <input type="checkbox" checked onchange="document.querySelector('.signatures').style.display = this.checked ? 'flex' : 'none'">
            แสดงกล่องลงนามท้ายรายงาน
        </label>
        <label>
            <input type="checkbox" checked onchange="toggleAllRows(this.checked)">
            เลือกทั้งหมด / ยกเลิกทั้งหมด (แถว)
        </label>
        <label style="gap:8px;">
            <span>ตัวกรองโครงการ:</span>
            <select id="print-project-filter" onchange="filterPrintRowsByProject(this.value)">
                <option value="all">แสดงทุกโครงการ</option>
                ${state.projects.filter(p => p.active).map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
        </label>
        <label style="gap:8px;">
            <span>การคำนวณ:</span>
            <select id="print-calc-mode" onchange="recalculatePrintTotals()">
                <option value="all" ${state.calculationMode === 'all' ? 'selected' : ''}>ทั้งหมด</option>
                <option value="claim" ${state.calculationMode === 'claim' ? 'selected' : ''}>เฉพาะเบิกมูลนิธิ</option>
                <option value="no-claim" ${state.calculationMode === 'no-claim' ? 'selected' : ''}>เฉพาะไม่เบิก</option>
            </select>
        </label>
    </div>
</div>

<input type="hidden" id="carry-over-amount" value="${totals.carryOver}">

<div class="page">
    <div class="org-header">
        <div class="eng-title">DR. ROBERT DYCKERHOFF FOUNDATION</div>
        <div class="thai-title">มูลนิธิ ดร. โรเบิร์ต ดีคเคอร์ฮอฟฟ์</div>
        <div class="sub-title">Expense Reimbursement Report / ใบขอเบิกค่าใช้จ่าย</div>
        <div class="sub-title">วิทยาลัยการอาชีพแม่สะเรียง (Mae Sariang ICEC)</div>
        <div class="month-badge">ประจำเดือน ${monthName} พ.ศ. ${state.selectedYear}</div>
    </div>

    ${carryHTML}

    <table>
        <thead>
            <tr>
                <th class="col-check no-print" style="width:30px;"><input type="checkbox" checked onchange="toggleAllRows(this.checked)"></th>
                ${state.columns.map(col => `<th class="col-${col.id}" style="${col.visible ? '' : 'display:none;'}">${col.label}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            ${expRows || '<tr><td colspan="13" class="tc" style="padding:16px;color:#666;">ไม่มีรายการบิลในเดือนนี้</td></tr>'}
            ${attachRows}
        </tbody>
    </table>

    <div class="totals-box">
        <div class="totals-row sub">
            <span>ยอดรายจ่ายเดือนนี้ (ก่อนยกมา):</span>
            <span id="print-active-total">฿${totals.activeTotal.toLocaleString('th-TH', {minimumFractionDigits:2})}</span>
        </div>
        ${totals.carryOver > 0 ? `
        <div class="totals-row sub">
            <span>+ ยอดยกมาจากเดือนก่อน:</span>
            <span id="print-carry-total">฿${totals.carryOver.toLocaleString('th-TH', {minimumFractionDigits:2})}</span>
        </div>` : ''}
        <div class="totals-row claim">
            <span>✅ ยอดขอเบิกจากมูลนิธิ:</span>
            <span id="print-claimable-total">฿${totals.totalClaimable.toLocaleString('th-TH', {minimumFractionDigits:2})}</span>
        </div>
        <div class="totals-row sub">
            <span>❌ ยอดไม่ขอเบิกจากมูลนิธิ:</span>
            <span id="print-non-claimable-total">฿${totals.totalNonClaimable.toLocaleString('th-TH', {minimumFractionDigits:2})}</span>
        </div>
        <div class="totals-row grand">
            <span>ยอดรวมสุทธิ (ทั้งหมด):</span>
            <span id="print-grand-total">฿${totals.grandTotal.toLocaleString('th-TH', {minimumFractionDigits:2})}</span>
        </div>
        <div class="thai-baht-text" id="print-thai-baht-text">( ${thaiBahtText(totals.totalClaimable)} )</div>
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

    <div class="doc-footer">
        สร้างโดย: ระบบบันทึกรายจ่าย RDF — วก.แม่สะเรียง &bull;
        พิมพ์เมื่อ: ${new Date().toLocaleDateString('th-TH', {year:'numeric',month:'long',day:'numeric'})}
    </div>
</div>

<script>
${thaiBahtText.toString()}
${convertSection.toString()}

function togglePrintColumn(colId, visible) {
    const cells = document.querySelectorAll('.col-' + colId);
    cells.forEach(c => {
        c.style.display = visible ? '' : 'none';
    });
    updateSectionRowColspan();
}

function filterPrintRowsByProject(projectId) {
    const checkboxes = document.querySelectorAll('.row-toggle-checkbox');
    checkboxes.forEach(cb => {
        const rowId = cb.getAttribute('data-row-id');
        const rowProjId = cb.getAttribute('data-project-id');
        const matches = (projectId === 'all') || (rowProjId === projectId);
        cb.checked = matches;
        togglePrintRow(rowId, matches, false);
    });
    recalculatePrintTotals();
}

function updateSectionRowColspan() {
    const ths = Array.from(document.querySelectorAll('thead th'));
    const visibleCount = ths.filter(th => th.style.display !== 'none').length;
    const sectionRow = document.querySelector('.section-row');
    if (sectionRow) {
        sectionRow.colSpan = visibleCount;
    }
}

function togglePrintRow(rowId, checked, triggerRecalc = true) {
    const row = document.getElementById('print-row-' + rowId);
    if (row) {
        if (checked) {
            row.classList.remove('row-hidden');
        } else {
            row.classList.add('row-hidden');
        }
    }
    if (triggerRecalc) {
        recalculatePrintTotals();
    }
}

function toggleAllRows(checked) {
    const checkboxes = document.querySelectorAll('.row-toggle-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = checked;
        const rowId = cb.getAttribute('data-row-id');
        togglePrintRow(rowId, checked, false);
    });
    recalculatePrintTotals();
}

function recalculatePrintTotals() {
    let totalClaimable = 0;
    let totalNonClaimable = 0;
    
    const rows = document.querySelectorAll('tbody tr:not(.section-row-wrapper):not(.row-hidden)');
    rows.forEach(row => {
        const amountCell = row.querySelector('.col-amount');
        if (!amountCell) return;
        const amount = parseFloat(amountCell.getAttribute('data-amount')) || 0;
        
        const typeCell = row.querySelector('.col-claimable');
        const isClaim = typeCell && (typeCell.querySelector('.bc') || typeCell.textContent.includes('เบิก'));
        if (isClaim) {
            totalClaimable += amount;
        } else {
            totalNonClaimable += amount;
        }
    });
    
    const carryOver = parseFloat(document.getElementById('carry-over-amount').value) || 0;
    const displayClaimable = totalClaimable + carryOver;
    const activeTotal = totalClaimable + totalNonClaimable;
    
    // Mode calculation
    const mode = document.getElementById('print-calc-mode').value;
    let finalClaimable = 0;
    let finalNonClaimable = 0;
    let finalGrand = 0;
    
    if (mode === 'claim') {
        finalClaimable = displayClaimable;
        finalNonClaimable = 0;
        finalGrand = finalClaimable;
    } else if (mode === 'no-claim') {
        finalClaimable = 0;
        finalNonClaimable = totalNonClaimable;
        finalGrand = finalNonClaimable;
    } else {
        finalClaimable = displayClaimable;
        finalNonClaimable = totalNonClaimable;
        finalGrand = finalClaimable + finalNonClaimable;
    }
    
    const activeTotalEl = document.getElementById('print-active-total');
    const carryOverEl = document.getElementById('print-carry-total');
    const claimableEl = document.getElementById('print-claimable-total');
    const nonClaimableEl = document.getElementById('print-non-claimable-total');
    const grandEl = document.getElementById('print-grand-total');
    
    if (activeTotalEl) activeTotalEl.textContent = '฿' + activeTotal.toLocaleString('th-TH', {minimumFractionDigits:2});
    if (carryOverEl) carryOverEl.textContent = '฿' + carryOver.toLocaleString('th-TH', {minimumFractionDigits:2});
    if (claimableEl) claimableEl.textContent = '฿' + finalClaimable.toLocaleString('th-TH', {minimumFractionDigits:2});
    if (nonClaimableEl) nonClaimableEl.textContent = '฿' + finalNonClaimable.toLocaleString('th-TH', {minimumFractionDigits:2});
    if (grandEl) grandEl.textContent = '฿' + finalGrand.toLocaleString('th-TH', {minimumFractionDigits:2});
    
    // Recalculate banner text too
    const banner = document.getElementById('print-carry-banner');
    if (banner) {
        banner.style.display = (carryOver > 0 && mode !== 'no-claim') ? 'block' : 'none';
    }
    
    const thaiTextEl = document.getElementById('print-thai-baht-text');
    if (thaiTextEl) {
        thaiTextEl.textContent = '( ' + thaiBahtText(finalClaimable) + ' )';
    }
}

function exportExcel() {
    const table = document.querySelector('table');
    if (!table) return alert('ไม่พบตาราง');
    const clone = table.cloneNode(true);
    const checks = clone.querySelectorAll('.col-check');
    checks.forEach(c => c.remove());
    const hiddenRows = clone.querySelectorAll('.row-hidden');
    hiddenRows.forEach(c => c.remove());
    
    const wb = XLSX.utils.table_to_book(clone, { raw: true });
    XLSX.writeFile(wb, 'rdf_report_${state.selectedYear}_${state.selectedMonth}.xlsx');
}

function exportWord() {
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Export Report</title></head><body>";
    const footer = "</body></html>";
    const clone = document.body.cloneNode(true);
    const noPrint = clone.querySelector('.no-print');
    if (noPrint) noPrint.remove();
    const checks = clone.querySelectorAll('.col-check');
    checks.forEach(c => c.remove());
    const hiddenRows = clone.querySelectorAll('.row-hidden');
    hiddenRows.forEach(c => c.remove());

    const htmlStr = header + clone.innerHTML + footer;
    const blob = new Blob(['\ufeff', htmlStr], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('A');
    link.href = url;
    link.download = 'rdf_report_${state.selectedYear}_${state.selectedMonth}.doc';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

</script>
</body>
</html>`;

    const printWin = window.open('', '_blank', 'width=960,height=720');
    if (!printWin) {
        appAlert('กรุณาอนุญาต Popup ในเบราว์เซอร์ก่อนใช้งาน Export PDF');
        return;
    }
    printWin.document.write(html);
    printWin.document.close();
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
    const thead = table.querySelector('thead tr');
    if (!thead) return;
    
    thead.innerHTML = '';
    
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
    const tr = document.createElement('tr');
    tr.id = `row-exp-${exp.id}`;
    
    const parsedNote = parseNoteData(exp.note);
    
    state.columns.forEach(col => {
        if (!col.visible) return;
        const td = document.createElement('td');
        
        switch (col.id) {
            case 'documentNo':
                td.innerHTML = `<span style="cursor:pointer; color:var(--primary); margin-right:6px;" onclick="openExpenseModal(${idx})" title="แก้ไขรายการนี้"><i data-lucide="edit-2" style="width:14px; height:14px;"></i></span>${exp.documentNo || ''}`;
                td.style.fontWeight = '600';
                break;
            case 'expenseDate':
                td.textContent = formatThaiDate(exp.expenseDate);
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
                        attachHtml += `<img src="${fileData.viewUrl}" class="attachment-thumbnail" onclick="previewAttachmentFile('${exp.id}', ${i})" title="ดูหลักฐาน" onerror="this.onerror=null; this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'32\\' height=\\'32\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'2\\' stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\'><path d=\\'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z\\'/></svg>'; this.style.opacity='0.5';"/>`;
                    });
                    attachHtml += `<button class="btn btn-icon btn-icon-attach" data-exp-id="${exp.id}" title="แนบไฟล์เพิ่มเติม/แก้ไข" style="margin-left:4px;"><i data-lucide="upload-cloud" style="width:14px; height:14px;"></i></button></div>`;
                    td.innerHTML = attachHtml;
                } else {
                    td.innerHTML = `<button class="btn btn-icon btn-icon-attach" data-exp-id="${exp.id}" title="แนบไฟล์หลักฐาน"><i data-lucide="upload-cloud" style="width:14px; height:14px;"></i></button>`;
                }
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
    toolsTd.innerHTML = `
        <div class="action-buttons" style="justify-content:center;">
            <button class="btn btn-icon btn-icon-edit" data-idx="${idx}" title="แก้ไข"><i data-lucide="edit-2" style="width:14px; height:14px;"></i></button>
            <button class="btn btn-icon btn-icon-delete" data-idx="${idx}" title="ลบ"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>
        </div>
    `;
    tr.appendChild(toolsTd);
    
    tbody.appendChild(tr);
}

function renderAttachmentRow(a, idx, tbody) {
    const tr = document.createElement('tr');
    tr.id = `row-att-${a.id}`;
    
    const parsedNote = parseNoteData(a.note);
    
    state.columns.forEach(col => {
        if (!col.visible) return;
        const td = document.createElement('td');
        
        switch (col.id) {
            case 'documentNo':
                td.innerHTML = `<span style="cursor:pointer; color:var(--primary); margin-right:6px;" onclick="openAttachmentModal(${idx})" title="แก้ไขรายการนี้"><i data-lucide="edit-2" style="width:14px; height:14px;"></i></span>${a.documentNo || '—'}`;
                td.style.fontWeight = '600';
                break;
            case 'expenseDate':
                td.textContent = formatThaiDate(a.expenseDate);
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

function renderExpenseInlineAddRow(tbody) {
    const tr = document.createElement('tr');
    tr.className = 'inline-add-row';
    
    const defaultProj = state.projects.find(p => (p.name || '').includes("ค่าซ่อมแซมหอพัก") || (p.name || '').includes("หอพัก"));
    const defaultProjId = defaultProj ? defaultProj.id : (state.projects[0] ? state.projects[0].id : '');
    
    state.columns.forEach(col => {
        if (!col.visible) return;
        const td = document.createElement('td');
        
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
                let catOptions = state.categories.map(c => 
                    `<option value="${c.id}">${c.name}</option>`
                ).join('');
                td.innerHTML = `<select id="inline-exp-category" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">${catOptions}</select>`;
                break;
            case 'fundSourceId':
                let fundOptions = state.fundSources.map(f => 
                    `<option value="${f.id}">${f.name}</option>`
                ).join('');
                td.innerHTML = `<select id="inline-exp-fund" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">${fundOptions}</select>`;
                break;
            case 'vendorId':
                let vendorOptions = state.vendors.map(v => 
                    `<option value="${v.id}">${v.name}</option>`
                ).join('');
                td.innerHTML = `<select id="inline-exp-vendor" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">${vendorOptions}</select>`;
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
    toolsTd.innerHTML = `
        <button type="button" class="btn btn-primary btn-sm" onclick="saveInlineRow('EXP')" style="padding:4px 10px; border-radius:6px; font-weight:600; display:flex; align-items:center; gap:4px; margin: 0 auto;">
            <i data-lucide="check" style="width:14px; height:14px;"></i> บันทึก
        </button>
    `;
    tr.appendChild(toolsTd);
    
    tbody.appendChild(tr);
}

function renderAttachmentInlineAddRow(tbody) {
    const tr = document.createElement('tr');
    tr.className = 'inline-add-row';
    
    const defaultProj = state.projects.find(p => (p.name || '').includes("ค่าซ่อมแซมหอพัก") || (p.name || '').includes("หอพัก"));
    const defaultProjId = defaultProj ? defaultProj.id : (state.projects[0] ? state.projects[0].id : '');
    
    state.columns.forEach(col => {
        if (!col.visible) return;
        const td = document.createElement('td');
        
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
                let catOptions = state.categories.map(c => 
                    `<option value="${c.id}">${c.name}</option>`
                ).join('');
                td.innerHTML = `<select id="inline-att-category" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">${catOptions}</select>`;
                break;
            case 'fundSourceId':
                let fundOptions = state.fundSources.map(f => 
                    `<option value="${f.id}">${f.name}</option>`
                ).join('');
                td.innerHTML = `<select id="inline-att-fund" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">${fundOptions}</select>`;
                break;
            case 'vendorId':
                let vendorOptions = state.vendors.map(v => 
                    `<option value="${v.id}">${v.name}</option>`
                ).join('');
                td.innerHTML = `<select id="inline-att-vendor" class="form-select" style="font-size:12px; padding:4px 8px; width:100%;">${vendorOptions}</select>`;
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
    toolsTd.innerHTML = `
        <button type="button" class="btn btn-primary btn-sm" onclick="saveInlineRow('ATT')" style="padding:4px 10px; border-radius:6px; font-weight:600; display:flex; align-items:center; gap:4px; margin: 0 auto;">
            <i data-lucide="check" style="width:14px; height:14px;"></i> บันทึก
        </button>
    `;
    tr.appendChild(toolsTd);
    
    tbody.appendChild(tr);
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
    
    const dateVal = document.getElementById(`inline-${prefix.toLowerCase()}-date`).value;
    const projId = document.getElementById(`inline-${prefix.toLowerCase()}-project`).value;
    const catId = document.getElementById(`inline-${prefix.toLowerCase()}-category`).value;
    const fundId = document.getElementById(`inline-${prefix.toLowerCase()}-fund`).value;
    const vendorId = document.getElementById(`inline-${prefix.toLowerCase()}-vendor`).value;
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
    
    const payload = {
        expenseDate: dateVal,
        organizationId: 'ORG01',
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
    
    showLoading(true);
    try {
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
                <input type="text" class="form-input multi-item-desc" style="font-size:12px; padding:4px 8px; width:100%;" value="${item.desc}" placeholder="เช่น ตะปู, ค้อน..." oninput="updateMultiItemData(${index}, 'desc', this.value)">
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
// Backup & Restore JSON (Phase 2)
// ==========================================================================
function exportBackupJSON() {
    const backupData = {
        schemaVersion: 4.1,
        backupDate: new Date().toISOString(),
        state: state,
        attachmentStore: attachmentStore
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    
    const dateStr = new Date().toISOString().split('T')[0];
    downloadAnchor.setAttribute("download", `rdf_billing_backup_${dateStr}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    
    appAlert("ดาวน์โหลดไฟล์สำรองข้อมูลเรียบร้อยแล้ว!");
}

function importBackupJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.state || !data.state.expenses) {
                throw new Error("โครงสร้างไฟล์สำรองข้อมูลไม่ถูกต้อง");
            }
            
            if (await appConfirm("คุณต้องการกู้คืนข้อมูลจากไฟล์นี้ใช่หรือไม่? การทำงานนี้จะเขียนทับข้อมูลทั้งหมดที่คุณมีอยู่ในเครื่องนี้!")) {
                state = data.state;
                const defaults = getDefaultState();
                if (!state.projects) state.projects = defaults.projects;
                if (!state.categories) state.categories = defaults.categories;
                if (!state.vendors) state.vendors = defaults.vendors;
                if (!state.fundSources) state.fundSources = defaults.fundSources;
                if (!state.claims) state.claims = [];
                if (!state.signatures) state.signatures = { prepared: null, checked: null, approved: null };
                
                if (data.attachmentStore) {
                    attachmentStore = data.attachmentStore;
                    localStorage.setItem('rdf_attachments_v4', JSON.stringify(attachmentStore));
                }
                
                saveState();
                appAlert("กู้คืนข้อมูลสำเร็จ! ระบบจะทำการรีโหลดหน้าเว็บ");
                window.location.reload();
            }
        } catch (err) {
            appAlert("เกิดข้อผิดพลาดในการนำเข้าข้อมูล: " + err.message);
        }
    };
    reader.readAsText(file);
}

// ==========================================================================
// Excel Export XLSX (Phase 2)
// ==========================================================================
function exportExcelXLSX() {
    const table = document.getElementById('excel-grid');
    if (!table) return appAlert('ไม่พบตารางข้อมูลสเปรดชีตสำหรับส่งออก!');
    
    try {
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
        if (img) {
            previewDiv.style.display = 'flex';
            previewDiv.querySelector('img').src = img;
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
        const info = getBudDateInfo(e.expenseDate);
        return info && info.month === m && info.year === y && e.claimable && (!e.claimId || e.claimId === '') && e.status !== 'cancelled';
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
    (document.getElementById('claims-count-display') || {}).textContent = `จำนวนชุดส่งเบิกทั้งหมด: ${claims.length} รายการ`;

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
    if (window.lucide) window.lucide.createIcons();
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

function exportClaimPDF(claimId) {
    const claim = state.claims.find(c => c.id === claimId);
    if (!claim) return appAlert("ไม่พบชุดส่งเบิกนี้!");

    const [claimYearCE, claimMonthNum] = (claim.claimMonth || '').split('-').map(Number);
    const claimYearBE = claimYearCE + 543;

    // หมายเหตุ: state.expenses/state.attachments โหลดมาแค่เดือน/ปีที่เลือกอยู่ในตัวกรองหลักตอนนี้
    // ถ้า export ชุดของเดือนอื่น รายการจะว่างเปล่า — เตือนผู้ใช้แทนโชว์ตารางว่างเงียบๆ
    const claimExpenses = state.expenses.filter(e => e.claimId === claim.id);
    if (claimExpenses.length === 0) {
        appAlert('ไม่พบรายการบิลของชุดนี้ในตัวกรองเดือน/ปีปัจจุบัน กรุณาเลือกเดือน/ปีของชุดส่งเบิกนี้ในตัวกรองหลักก่อน export', 'error');
        return;
    }
    const claimAttachments = state.attachments.filter(a => claimExpenses.some(e => e.id === a.expenseId) || (a.expenseDate && getBudDateInfo(a.expenseDate).month === claimMonthNum && getBudDateInfo(a.expenseDate).year === claimYearBE && a.claimable));
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

    <div class="doc-footer">
        สร้างโดย: ระบบบันทึกรายจ่าย RDF — วก.แม่สะเรียง &bull;
        พิมพ์เมื่อ: ${new Date().toLocaleDateString('th-TH', {year:'numeric',month:'long',day:'numeric'})}
    </div>
</div>
</body>
</html>`;

    const printWin = window.open('', '_blank', 'width=960,height=720');
    if (!printWin) {
        appAlert('กรุณาอนุญาต Popup ในเบราว์เซอร์ก่อนใช้งาน Export PDF');
        return;
    }
    printWin.document.write(html);
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
    context: 'dashboard',
    selectedCategories: new Set(),
    selectedProjects: new Set(),
    selectedFields: new Set(),
    smartDisplay: true
};

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
            id: 'รหัสอ้างอิง', documentNo: 'เลขที่เอกสาร', expenseDate: 'วันที่', 
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
    } else if (context === 'food-expenses' || context === 'food') {
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

function openExportModal(context) {
    currentExportState.context = context || 'dashboard';
    (document.getElementById('pdf-export-mode') || {}).value = currentExportState.context;
    
    EXPORT_DICTIONARY = buildDynamicExportDictionary(currentExportState.context);
    
    currentExportState.selectedCategories = new Set(Object.keys(EXPORT_DICTIONARY));
    
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

    buildExportCategoryUI();
    buildExportProjectUI();
    buildExportFieldsUI();
    
    const modal = document.getElementById('modal-export-pdf');
    modal.style.display = 'flex';
    modal.classList.add('active');
    
    loadExportTemplatesList();
    renderExportPreview();
}

function closeExportModal() {
    const modal = document.getElementById('modal-export-pdf');
    modal.style.display = 'none';
    modal.classList.remove('active');
}

function buildExportCategoryUI() {
    const container = document.getElementById('export-category-selection');
    if(container) container.innerHTML = '';
    
    let hasCategories = false;
    Object.keys(EXPORT_DICTIONARY).forEach(key => {
        const data = EXPORT_DICTIONARY[key].getData();
        if (data.length === 0) return; // Smart Auto-Hide Empty
        
        hasCategories = true;
        const div = document.createElement('label');
        div.style.cssText = 'display:flex; gap:8px; cursor:pointer; font-size:13px; align-items:center;';
        
        const isChecked = currentExportState.selectedCategories.has(key) ? 'checked' : '';
        div.innerHTML = `<input type="checkbox" class="export-cat-chk" value="${key}" ${isChecked} onchange="toggleExportCategory('${key}', this.checked)"> ${EXPORT_DICTIONARY[key].label} (${data.length} รายการ)`;
        if(container) container.appendChild(div);
    });
    
    if (!hasCategories) {
        if(container) container.innerHTML = '<div style="color:red; font-size:12px;">ไม่มีข้อมูลในหมวดหมู่นี้</div>';
    }
}

function toggleExportCategory(key, checked) {
    if (checked) currentExportState.selectedCategories.add(key);
    else currentExportState.selectedCategories.delete(key);
    
    buildExportProjectUI();
    buildExportFieldsUI();
    renderExportPreview();
}

function buildExportProjectUI() {
    const container = document.getElementById('export-project-selection');
    if(container) container.innerHTML = '';
    currentExportState.selectedProjects.clear();
    
    let allProjects = new Set();
    currentExportState.selectedCategories.forEach(cat => {
        const data = EXPORT_DICTIONARY[cat].getData();
        data.forEach(item => {
            if (item.projectId) allProjects.add(item.projectId);
        });
    });
    
    if (allProjects.size === 0) {
        if(container) container.innerHTML = '<div style="color:#666; font-size:12px;">ไม่มีข้อมูลโครงการ</div>';
        return;
    }
    
    allProjects.forEach(pid => {
        currentExportState.selectedProjects.add(pid);
        const pName = getProjectName(pid);
        const div = document.createElement('label');
        div.style.cssText = 'display:flex; gap:8px; cursor:pointer; font-size:13px; margin-bottom:4px;';
        div.innerHTML = `<input type="checkbox" class="export-proj-chk" value="${pid}" checked onchange="toggleExportProject('${pid}', this.checked)"> ${escapeHTML(pName)}`;
        if(container) container.appendChild(div);
    });
}

function toggleExportProject(pid, checked) {
    if (checked) currentExportState.selectedProjects.add(pid);
    else currentExportState.selectedProjects.delete(pid);
    renderExportPreview();
}

function buildExportFieldsUI() {
    const container = document.getElementById('export-field-selection');
    if(container) container.innerHTML = '';
    
    let combinedFields = new Map();
    currentExportState.selectedCategories.forEach(cat => {
        EXPORT_DICTIONARY[cat].fields.forEach(f => {
            if (!combinedFields.has(f.id)) {
                combinedFields.set(f.id, f);
            }
        });
    });
    
    const allData = getFilteredExportData(false);
    
    combinedFields.forEach(f => {
        let hasData = false;
        if (currentExportState.smartDisplay) {
            for (let i = 0; i < allData.length; i++) {
                if (allData[i][f.id] !== undefined && allData[i][f.id] !== null && allData[i][f.id] !== '') {
                    hasData = true;
                    break;
                }
            }
        } else {
            hasData = true;
        }
        
        if (!hasData) return; // Smart Hide
        
        if (f.default) currentExportState.selectedFields.add(f.id);
        
        const div = document.createElement('label');
        div.style.cssText = 'display:flex; gap:6px; cursor:pointer; font-size:12px;';
        const isChecked = currentExportState.selectedFields.has(f.id) ? 'checked' : '';
        div.innerHTML = `<input type="checkbox" class="export-field-chk" value="${f.id}" ${isChecked} onchange="toggleExportField('${f.id}', this.checked)"> ${escapeHTML(f.label)}`;
        if(container) container.appendChild(div);
    });
}

function toggleExportField(id, checked) {
    if (checked) currentExportState.selectedFields.add(id);
    else currentExportState.selectedFields.delete(id);
    renderExportPreview();
}

function toggleAllExportCheckboxes(check) {
    document.querySelectorAll('.export-proj-chk').forEach(el => { el.checked = check; toggleExportProject(el.value, check); });
    document.querySelectorAll('.export-field-chk').forEach(el => { el.checked = check; toggleExportField(el.value, check); });
    renderExportPreview();
}

function getFilteredExportData(applySort = true) {
    let result = [];
    currentExportState.selectedCategories.forEach(cat => {
        const data = EXPORT_DICTIONARY[cat].getData();
        data.forEach(item => {
            if (item.projectId && !currentExportState.selectedProjects.has(item.projectId)) return;
            
            let normalized = { ...item, _categoryConfig: cat };
            if (cat === 'food' && item.month) {
                normalized.expenseDate = `${item.month}/${item.year}`;
            }
            result.push(normalized);
        });
    });
    
    if (applySort && result.length > 0 && typeof result[0] === 'object') {
        const sortBy = document.getElementById('export-sort-by') ? document.getElementById('export-sort-by').value : null;
        const sortOrder = document.getElementById('export-sort-order') ? document.getElementById('export-sort-order').value : 'asc';
        
        if(sortBy) {
            result.sort((a, b) => {
                let valA = a[sortBy] || '';
                let valB = b[sortBy] || '';
                
                if (sortBy === 'amount' || sortBy === 'totalAmount') {
                    valA = parseFloat(valA) || 0;
                    valB = parseFloat(valB) || 0;
                }
                
                if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                return 0;
            });
        }
    }
    
    return result;
}

// 3. Smart Preview Engine
function renderExportPreview() {
    const container = document.getElementById('export-preview-page');
    if(!container) return;
    
    const title = document.getElementById('pdf-report-title').value;
    const includeSig = document.getElementById('pdf-include-signature') ? document.getElementById('pdf-include-signature').checked : false;
    const prep = document.getElementById('pdf-preparer-name') ? document.getElementById('pdf-preparer-name').value : '';
    const rev = document.getElementById('pdf-reviewer-name') ? document.getElementById('pdf-reviewer-name').value : '';
    const appSig = document.getElementById('pdf-approver-name') ? document.getElementById('pdf-approver-name').value : '';
    
    const data = getFilteredExportData(true);
    const logoPath = 'RDForiginal.png';
    
    let html = `
        <div style="display:flex; align-items:center; flex-direction:column; margin-bottom:20px; text-align:center;">
            <img src="${logoPath}" alt="Logo" style="height:60px; margin-bottom:12px; object-fit:contain;" onerror="this.style.display='none'">
            <h2 style="margin:0 0 4px 0; font-size:20px;">${escapeHTML(title)}</h2>
            <p style="font-size:12px; color:#666;">วันที่พิมพ์: ${formatDateThai(new Date().toISOString())} | จำนวน: ${data.length} รายการ</p>
        </div>
    `;

    let visibleFields = [];
    currentExportState.selectedCategories.forEach(cat => {
        EXPORT_DICTIONARY[cat].fields.forEach(f => {
            if (currentExportState.selectedFields.has(f.id) && !visibleFields.find(vf => vf.id === f.id)) {
                visibleFields.push(f);
            }
        });
    });
    
    if (data.length === 0) {
        html += '<div style="text-align:center; padding:40px; border:1px solid #ccc;">ไม่มีข้อมูลตามเงื่อนไขที่เลือก หรือ ยังไม่ได้เลือกข้อมูล</div>';
    } else {
        html += `
            <table style="width:100%; border-collapse:collapse; font-size:12px; margin-bottom:20px;">
                <thead>
                    <tr style="background:#f1f5f9; border: 1px solid #000;">
        `;
        visibleFields.forEach(f => {
            html += `<th style="border:1px solid #000; padding:6px; text-align:${f.type==='currency'?'right':'left'};">${escapeHTML(f.label)}</th>`;
        });
        html += `</tr></thead><tbody>`;
        
        let totalAmount = 0;
        data.forEach(row => {
            html += `<tr>`;
            visibleFields.forEach(f => {
                let val = row[f.id] || '';
                if (f.id === 'amount' && !val) val = row.totalAmount;
                if (f.type === 'date') val = formatDateThai(val);
                if (f.type === 'currency' || (f.type === 'number' && typeof val === 'number')) {
                    val = parseFloat(val) || 0;
                    if (f.id === 'amount' || f.id === 'totalAmount' || f.id === 'value') totalAmount += val;
                    val = formatNumber(val);
                }
                if (f.source === 'projects') val = getProjectName(val);
                if (f.source === 'categories') val = getCategoryName(val);
                if (f.type === 'status') val = val === 'pending' ? 'รอพิจารณา' : 'อนุมัติแล้ว';
                
                html += `<td style="border:1px solid #000; padding:6px; text-align:${f.type==='currency'?'right':'left'};">${escapeHTML(String(val))}</td>`;
            });
            html += `</tr>`;
        });
        
        // Dynamic Footers
        html += `</tbody><tfoot><tr>`;
        const colSpan = Math.max(1, visibleFields.length - 1);
        html += `<td colspan="${colSpan}" style="border:1px solid #000; padding:6px; text-align:right; font-weight:bold;">ยอดรวมทั้งสิ้น</td>`;
        if (visibleFields.find(f => f.type === 'currency' || f.id === 'amount' || f.id === 'value' || f.id === 'totalAmount')) {
            html += `<td style="border:1px solid #000; padding:6px; text-align:right; font-weight:bold;">${formatNumber(totalAmount)}</td>`;
        } else {
             html += `<td style="border:1px solid #000; padding:6px; text-align:right; font-weight:bold;"></td>`;
        }
        html += `</tr></tfoot></table>`;
    }
    
    if (includeSig && currentExportState.context !== 'master-data') {
        html += `
            <div style="display:flex; justify-content:space-between; font-size:12px; text-align:center; margin-top:40px; page-break-inside: avoid;">
                <div><p>ผู้จัดทำ</p><br><br><br><p>ลงชื่อ........................................</p><p>(${escapeHTML(prep || '.........................')})</p></div>
                <div><p>ผู้ตรวจสอบ</p><br><br><br><p>ลงชื่อ........................................</p><p>(${escapeHTML(rev || '.........................')})</p></div>
                <div><p>ผู้อนุมัติ</p><br><br><br><p>ลงชื่อ........................................</p><p>(${escapeHTML(appSig || '.........................')})</p></div>
            </div>
        `;
    }
    
    if(container) container.innerHTML = html;
}

// 4. Report Templates
function saveExportTemplate() {
    const templateName = prompt('ตั้งชื่อ Template นี้ (เช่น รายงานส่งมูลนิธิ RDF):');
    if (!templateName) return;
    
    let templates = JSON.parse(localStorage.getItem('rdf_export_templates') || '{}');
    templates[templateName] = {
        context: currentExportState.context,
        title: document.getElementById('pdf-report-title').value,
        type: document.getElementById('export-report-type').value,
        sortBy: document.getElementById('export-sort-by').value,
        sortOrder: document.getElementById('export-sort-order').value,
        categories: Array.from(currentExportState.selectedCategories),
        fields: Array.from(currentExportState.selectedFields),
        att: {
            img: document.querySelector('.att-chk[value="show_img"]') ? document.querySelector('.att-chk[value="show_img"]').checked : false,
            pdf: document.querySelector('.att-chk[value="show_pdf"]') ? document.querySelector('.att-chk[value="show_pdf"]').checked : false
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
    
    // Switch Context if necessary
    if(t.context && t.context !== currentExportState.context) {
        currentExportState.context = t.context;
        EXPORT_DICTIONARY = buildDynamicExportDictionary(t.context);
    }
    
    (document.getElementById('pdf-report-title') || {}).value = t.title || '';
    if(document.getElementById('export-report-type')) (document.getElementById('export-report-type') || {}).value = t.type || 'summary';
    if(document.getElementById('export-sort-by')) (document.getElementById('export-sort-by') || {}).value = t.sortBy || 'date';
    if(document.getElementById('export-sort-order')) (document.getElementById('export-sort-order') || {}).value = t.sortOrder || 'asc';
    
    currentExportState.selectedCategories = new Set(t.categories || []);
    currentExportState.selectedFields = new Set(t.fields || []);
    
    if (t.att) {
        if(document.querySelector('.att-chk[value="show_img"]')) document.querySelector('.att-chk[value="show_img"]').checked = t.att.img;
        if(document.querySelector('.att-chk[value="show_pdf"]')) document.querySelector('.att-chk[value="show_pdf"]').checked = t.att.pdf;
    }
    
    buildExportCategoryUI();
    buildExportProjectUI();
    buildExportFieldsUI();
    renderExportPreview();
}

// 5. Exporters
function executeDynamicExport(format) {
    const data = getFilteredExportData();
    if (data.length === 0) {
        appAlert('ระบบไม่สามารถดำเนินการได้: ไม่มีข้อมูลสำหรับส่งออก (Empty Data)');
        return;
    }
    
    if (format === 'excel' || format === 'csv') {
        let visibleFields = [];
        currentExportState.selectedCategories.forEach(cat => {
            EXPORT_DICTIONARY[cat].fields.forEach(f => {
                if (currentExportState.selectedFields.has(f.id) && !visibleFields.find(vf => vf.id === f.id)) {
                    visibleFields.push(f);
                }
            });
        });
        
        const exportData = data.map(row => {
            let obj = {};
            visibleFields.forEach(f => {
                let val = row[f.id] || '';
                if (f.id === 'amount' && !val) val = row.totalAmount;
                if (f.type === 'date') val = formatDateThai(val);
                if (f.source === 'projects') val = getProjectName(val);
                if (f.source === 'categories') val = getCategoryName(val);
                if (f.type === 'status') val = val === 'pending' ? 'รอพิจารณา' : 'อนุมัติแล้ว';
                obj[f.label] = val;
            });
            return obj;
        });
        
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "DynamicReport");
        
        if (format === 'csv') {
            const csv = XLSX.utils.sheet_to_csv(ws);
            const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], {type: "text/csv;charset=utf-8"});
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `DynamicReport_${new Date().getTime()}.csv`;
            link.click();
        } else {
            XLSX.writeFile(wb, `DynamicReport_${new Date().getTime()}.xlsx`);
        }
    } else if (format === 'pdf') {
        const previewHtml = document.getElementById('export-preview-page').innerHTML;
        const iframe = document.createElement('iframe');
        iframe.style.visibility = 'hidden';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        document.body.appendChild(iframe);
        
        iframe.contentWindow.document.open();
        iframe.contentWindow.document.write(`
            <html>
            <head>
                <title>Export PDF - ${document.getElementById('pdf-report-title').value}</title>
                <style>
                    body { font-family: 'Sarabun', sans-serif; padding: 20px; font-size: 12px; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    th, td { border: 1px solid #000; padding: 8px; }
                    @media print {
                        @page { margin: 15mm; size: auto; }
                        body { padding: 0; }
                    }
                </style>
            </head>
            <body onload="window.print(); setTimeout(()=>window.parent.document.body.removeChild(window.frameElement), 2000);">
                ${previewHtml}
            </body>
            </html>
        `);
        iframe.contentWindow.document.close();
    }
}

function toggleSmartExportSetting(checked) {
    currentExportState.smartDisplay = checked;
    if ((document.getElementById('modal-export-pdf') || {style:{}}).style.display === 'flex') {
        buildExportFieldsUI();
        renderExportPreview();
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

function showUserProfile(user) {
    if (!user) return;
    const usernameEl = document.getElementById('header-username');
    const roleEl = document.getElementById('header-role');
    const avatarEl = document.getElementById('header-avatar');
    
    if(usernameEl) usernameEl.textContent = user.username;
    if(roleEl) roleEl.textContent = (user.role || 'User').toUpperCase();
    if(avatarEl) avatarEl.src = user.avatar || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(user.username) + '&background=random');
    
    // Check Admin rights
    const navUserMgt = document.getElementById('nav-user-management');
    if (navUserMgt) {
        if (user.role && user.role.toLowerCase() === 'admin') {
            navUserMgt.style.display = 'flex';
        } else {
            navUserMgt.style.display = 'none';
        }
    }
}

function openUserProfileModal() {
    const userJson = localStorage.getItem('rdf_current_user');
    if (!userJson) return;
    const user = JSON.parse(userJson);
    
    document.getElementById('profile-modal-avatar-preview').src = user.avatar || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.username) + '&background=random';
    (document.getElementById('profile-modal-email') || {}).value = user.email || '';
    (document.getElementById('profile-modal-password') || {}).value = '';
    (document.getElementById('profile-modal-avatar') || {}).value = '';
    
    const modal = document.getElementById('modal-user-profile');
    modal.style.display = 'flex';
    modal.classList.add('active');
}

function closeUserProfileModal() {
    const modal = document.getElementById('modal-user-profile');
    modal.style.display = 'none';
    modal.classList.remove('active');
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
// (เดิมเรียก action 'upload_file'/'update_profile' ที่ไม่มีอยู่จริงใน backend เลย) —
// ตอนนี้แก้ให้ใช้ action 'updateUser'/'changePassword' ที่มีอยู่แล้วจริงแทน จำกัดแค่แก้อีเมล/รหัสผ่าน
async function saveUserProfile() {
    const userJson = localStorage.getItem('rdf_current_user');
    if (!userJson) return;
    const user = JSON.parse(userJson);

    const email = document.getElementById('profile-modal-email').value.trim();
    const password = document.getElementById('profile-modal-password').value.trim();

    appAlert('กำลังบันทึกข้อมูล...', 'info');
    try {
        await apiCall('updateUser', { id: user.id, email });
        if (password) {
            const passwordHash = await sha256(password);
            await apiCall('changePassword', { id: user.id, passwordHash });
        }
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

async function renderUserManagement() {
    const tbody = document.getElementById('user-management-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        const res = await apiCall('getUsers');
        adminUserList = res.users || [];

        if (!adminUserList.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);">ยังไม่มีผู้ใช้งาน</td></tr>';
            return;
        }

        const roleColors = { admin: '#f59e0b', superadmin: '#ef4444', manager: '#3b82f6', user: '#10b981' };
        tbody.innerHTML = adminUserList.map((u, idx) => {
            const color = roleColors[(u.role || 'user').toLowerCase()] || '#6b7280';
            const activeBadge = u.active
                ? '<span style="background:#10b98122;color:#10b981;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">ใช้งาน</span>'
                : '<span style="background:#ef444422;color:#ef4444;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">ปิดใช้งาน</span>';
            return `
                <tr>
                    <td><img src="https://ui-avatars.com/api/?name=${encodeURIComponent(u.username || '')}&background=random" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--border-color);"></td>
                    <td style="font-weight:600;">${escapeHTML(u.username || '-')}</td>
                    <td style="color:var(--text-secondary);font-size:13px;">${escapeHTML(u.email || '-')}</td>
                    <td><span style="background:${color}22;color:${color};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">${(u.role || 'user').toUpperCase()}</span></td>
                    <td style="text-align:center;">${activeBadge}</td>
                    <td style="text-align:center;">
                        <button class="btn btn-outline" style="padding:4px 10px;font-size:12px;margin-right:4px;" onclick="openEditUserModal(${idx})"><i data-lucide="edit-2"></i></button>
                        <button class="btn" style="padding:4px 10px;font-size:12px;background:var(--danger-light);color:var(--danger);border:none;" onclick="confirmToggleUserActive('${escapeHTML(u.id)}', ${!!u.active})" title="${u.active ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}">
                            <i data-lucide="${u.active ? 'user-x' : 'user-check'}"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        if (window.lucide) lucide.createIcons();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger);">โหลดข้อมูลไม่สำเร็จ: ' + escapeHTML(err.message) + '</td></tr>';
    }
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
    (document.getElementById('admin-user-role') || {}).value = 'user';
    (document.getElementById('admin-user-pw-hint') || {}).textContent = '(จำเป็น)';
    const modal = document.getElementById('modal-admin-user');
    modal.style.display = 'flex'; modal.classList.add('active');
}

function openEditUserModal(index) {
    const u = adminUserList[index];
    if (!u) return;
    (document.getElementById('admin-user-modal-title') || {}).textContent = 'แก้ไขผู้ใช้งาน: ' + u.username;
    (document.getElementById('admin-user-mode') || {}).value = 'edit';
    (document.getElementById('admin-user-username') || {}).value = u.username || '';
    document.getElementById('admin-user-username').disabled = true;
    (document.getElementById('admin-user-firstname') || {}).value = u.fullName || '';
    (document.getElementById('admin-user-lastname') || {}).value = '';
    (document.getElementById('admin-user-email') || {}).value = u.email || '';
    (document.getElementById('admin-user-password') || {}).value = '';
    (document.getElementById('admin-user-role') || {}).value = (u.role || 'user').toLowerCase();
    (document.getElementById('admin-user-pw-hint') || {}).textContent = '(เว้นว่างถ้าไม่ต้องการเปลี่ยน)';
    const modal = document.getElementById('modal-admin-user');
    modal.style.display = 'flex'; modal.classList.add('active');
}

function closeAdminUserModal() {
    const modal = document.getElementById('modal-admin-user');
    if (modal) { modal.style.display = 'none'; modal.classList.remove('active'); }
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

    try {
        if (mode === 'create') {
            const currentUser = JSON.parse(localStorage.getItem('rdf_current_user') || 'null');
            const passwordHash = await sha256(password);
            await apiCall('createUser', {
                username, passwordHash, fullName, role, email,
                organizationId: currentUser && currentUser.organizationId
            });
        } else {
            const editingUser = adminUserList.find(u => u.username === username);
            if (!editingUser) throw new Error('ไม่พบผู้ใช้งานนี้ในระบบ');
            await apiCall('updateUser', { id: editingUser.id, fullName, role, email });
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



// Load food data from API
window.loadFoodOverview = async function() {
    try {
        const res = await apiCall('getFoodExpenses');
        state.foodExpenses = res.foodExpenses || [];
        renderFoodOverview();
    } catch (err) {
        console.error(err);
        appAlert('ไม่สามารถโหลดข้อมูลค่าอาหารได้: ' + err.message);
    }
};

window.renderFoodOverview = function() {
    const tbody = document.getElementById('food-overview-tbody');
    const totalEl = document.getElementById('food-overview-total');
    if (!tbody || !totalEl) return;

    const selectedMonth = document.getElementById('food-overview-month').value; // YYYY-MM
    let data = state.foodExpenses || [];
    
    if (selectedMonth) {
        data = data.filter(item => item.date && item.date.startsWith(selectedMonth));
    }
    
    // Sort by date desc
    data.sort((a, b) => new Date(b.date) - new Date(a.date));

    let html = '';
    let total = 0;
    
    if (data.length === 0) {
        html = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">ไม่มีข้อมูลค่าอาหารในเดือนนี้</td></tr>';
    } else {
        data.forEach((item, idx) => {
            const amount = parseFloat(item.totalAmount) || 0;
            total += amount;
            html += `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${formatThaiDate(item.date)}</td>
                    <td>${item.name}</td>
                    <td><span class="badge" style="background:var(--primary); color:white;">${item.category}</span></td>
                    <td class="text-right">${item.quantity} ${item.unit}</td>
                    <td class="text-right">${parseFloat(item.price).toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                    <td class="text-right" style="font-weight:600;">${amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                </tr>
            `;
        });
    }

    if (tbody) tbody.innerHTML = html;
    if (totalEl) totalEl.textContent = total.toLocaleString('th-TH', {minimumFractionDigits:2}) + ' บาท';
};

window.exportFoodPDF = function() {
    const selectedMonth = (document.getElementById('food-overview-month') || {}).value; // YYYY-MM
    let data = state.foodExpenses || [];
    if (selectedMonth) {
        data = data.filter(item => item.date && item.date.startsWith(selectedMonth));
    }
    data.sort((a, b) => new Date(a.date) - new Date(b.date));

    let total = 0;
    const rows = data.length
        ? data.map((item, idx) => {
            const amount = parseFloat(item.totalAmount) || 0;
            total += amount;
            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${formatThaiDate(item.date)}</td>
                    <td>${escapeHTML(item.name)}</td>
                    <td>${escapeHTML(item.category)}</td>
                    <td style="text-align:right;">${escapeHTML(String(item.quantity))} ${escapeHTML(item.unit || '')}</td>
                    <td style="text-align:right;">${parseFloat(item.price).toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                    <td style="text-align:right; font-weight:600;">${amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                </tr>
            `;
        }).join('')
        : '<tr><td colspan="7" style="text-align:center; padding:20px;">ไม่มีข้อมูลค่าอาหารในเดือนนี้</td></tr>';

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
                <th>#</th><th>วันที่</th><th>รายการ</th><th>หมวดหมู่</th>
                <th style="text-align:right;">จำนวน</th><th style="text-align:right;">ราคา/หน่วย</th><th style="text-align:right;">รวมเป็นเงิน</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
            <tr class="total-row">
                <td colspan="6" style="text-align:right;">ยอดรวมทั้งสิ้น</td>
                <td style="text-align:right;">${total.toLocaleString('th-TH', {minimumFractionDigits:2})} บาท</td>
            </tr>
        </tfoot>
    </table>
    <div class="doc-footer">
        สร้างโดย: ระบบบันทึกรายจ่าย RDF &bull; พิมพ์เมื่อ: ${new Date().toLocaleDateString('th-TH', {year:'numeric',month:'long',day:'numeric'})}
    </div>
</body></html>`;

    const printWin = window.open('', '_blank', 'width=960,height=720');
    if (!printWin) {
        appAlert('กรุณาอนุญาต Popup ในเบราว์เซอร์ก่อนใช้งาน Export PDF');
        return;
    }
    printWin.document.write(html);
    printWin.document.close();
};

window.loadFoodEntryList = async function() {
    try {
        const res = await apiCall('getFoodExpenses');
        state.foodExpenses = res.foodExpenses || [];
        renderFoodEntryList();
    } catch (err) {
        console.error(err);
    }
};

window.renderFoodEntryList = function() {
    const tbody = document.getElementById('food-entry-tbody');
    if (!tbody) return;

    const selectedMonth = (document.getElementById('food-modal-month') || {}).value; // YYYY-MM
    let data = state.foodExpenses || [];

    if (selectedMonth) {
        data = data.filter(item => item.date && item.date.startsWith(selectedMonth));
    }

    data.sort((a, b) => new Date(b.date) - new Date(a.date));

    let html = '';
    if (data.length === 0) {
        html = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">ไม่มีข้อมูลที่บันทึกไว้</td></tr>';
    } else {
        data.forEach(item => {
            const amount = parseFloat(item.totalAmount) || 0;
            // hasFiles check: if item.files exists or we stored something
            const hasFiles = item.files && item.files.length > 0;
            html += `
                <tr>
                    <td>${formatThaiDate(item.date)}</td>
                    <td>${escapeHTML(item.name)} ${hasFiles ? '<i data-lucide="paperclip" style="color:var(--primary); width:13px; vertical-align:middle;"></i>' : ''}</td>
                    <td><span class="badge">${escapeHTML(item.category)}</span></td>
                    <td class="text-right" style="font-weight:600;">${amount.toLocaleString('th-TH', {minimumFractionDigits:2})}</td>
                    <td class="text-center">
                        <button type="button" class="btn btn-icon btn-sm text-danger" onclick="deleteFoodExpense('${item.id}')" title="ลบรายการ">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </td>
                </tr>
            `;
        });
    }

    if (tbody) tbody.innerHTML = html;
    if (window.lucide) window.lucide.createIcons();
};

window.calcFoodEntryTotal = function() {
    const qty = parseFloat(document.getElementById('food-entry-qty').value) || 0;
    const price = parseFloat(document.getElementById('food-entry-price').value) || 0;
    const total = qty * price;
    const totalEl = document.getElementById('food-entry-total-display');
    if (totalEl) totalEl.textContent = total.toLocaleString('th-TH', {minimumFractionDigits: 2}) + ' บาท';
};

window.handleFoodFiles = async function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const maxMb = state.maxUploadSizeMb || 2;
    try {
        const processed = await processUploadFile(file, maxMb);
        foodFiles.push(processed);
        renderFoodFileList();
    } catch (err) {
        console.error(err);
        appAlert('ไม่สามารถแนบไฟล์นี้ได้: ' + err.message, 'error');
    } finally {
        event.target.value = '';
    }
};

window.renderFoodFileList = function() {
    const container = document.getElementById('food-file-list');
    if (!container) return;

    if (!foodFiles.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = foodFiles.map((f, idx) => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 10px; background:var(--bg-secondary); border-radius:6px; font-size:12px;">
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHTML(f.filename)}</span>
            <button type="button" class="btn-icon btn-icon-delete" style="padding:2px;" onclick="removeFoodFile(${idx})"><i data-lucide="x" style="width:14px;height:14px;"></i></button>
        </div>
    `).join('');
    if (window.lucide) window.lucide.createIcons();
};

window.removeFoodFile = function(idx) {
    foodFiles.splice(idx, 1);
    renderFoodFileList();
};

window.submitFoodEntry = async function(e) {
    e.preventDefault();
    const qty = parseFloat(document.getElementById('food-entry-qty').value) || 0;
    const price = parseFloat(document.getElementById('food-entry-price').value) || 0;
    
    if (qty <= 0 || price <= 0) {
        appAlert('กรุณาระบุจำนวนและราคาให้ถูกต้อง', 'error');
        return;
    }

    const dateStr = document.getElementById('food-entry-date').value; // YYYY-MM-DD
    const [y, m] = dateStr.split('-');
    const currentUser = JSON.parse(localStorage.getItem('rdf_current_user') || 'null');

    // Backend stores food expenses as a document with a list of items; the
    // quick-entry modal only ever submits one ingredient at a time, so we
    // wrap it as a single-item document (no Sheet schema changes needed).
    const payload = {
        month: parseInt(m, 10),
        year: parseInt(y, 10),
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
        const res = await apiCall('createFoodExpense', payload);
        const assignedId = res.items && res.items[0] && res.items[0].assignedId;

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

        appAlert('บันทึกข้อมูลค่าอาหารลงระบบสำเร็จ!', 'success');

        document.getElementById('food-entry-form').reset();
        foodFiles = [];
        renderFoodFileList();
        calcFoodEntryTotal();

        await loadFoodEntryList();
        if (document.getElementById('tab-food-overview').classList.contains('active')) {
            await loadFoodOverview();
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
        await loadFoodOverview();
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
                        
                        // Update active states
                        document.querySelectorAll('.bottom-nav-item').forEach(nav => nav.classList.remove('active'));
                        this.classList.add('active');
                        
                        document.querySelectorAll('.submenu-item').forEach(nav => nav.classList.remove('active'));
                        subItem.classList.add('active');
                        
                        // Close submenu
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
                    
                    // Update active states
                    document.querySelectorAll('.bottom-nav-item').forEach(nav => nav.classList.remove('active'));
                    this.classList.add('active');
                    
                    // Close any open submenus
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
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        });
    });
}

// Initialise on DOM load
document.addEventListener('DOMContentLoaded', initBillsSubTabs);

/* ==========================================================================
   Food Entry Modal - Open / Close / Sync with main month filter
   ========================================================================== */
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
        const thYear = y; // Already CE year stored in select
        // Convert if needed - assume year in select is BE, convert to CE
        const ceYear = y > 2500 ? y - 543 : y;
        monthInput.value = ceYear + '-' + m;
    } else if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }

    updateFoodModalMonthLabel();
    
    // Reset form
    const form = document.getElementById('food-entry-form');
    if (form) form.reset();
    const totalDisplay = document.getElementById('food-entry-total-display');
    if (totalDisplay) totalDisplay.textContent = '0.00 บาท';
    const fileList = document.getElementById('food-file-list');
    if (fileList) fileList.innerHTML = '';

    // Set today's date
    const dateInput = document.getElementById('food-entry-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // Load existing entries
    if (typeof loadFoodEntryList === 'function') loadFoodEntryList();

    overlay.classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeFoodEntryModal = function () {
    const overlay = document.getElementById('modal-food-entry');
    if (overlay) overlay.classList.remove('active');
    
    // Refresh the food widget in the bills table
    if (typeof loadFoodBillsForMonth === 'function') loadFoodBillsForMonth();
    updateFoodWidgetMonthBadge();
};

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

/* ==========================================================================
   Export Bills Modal - Open / Close / Execute
   ========================================================================== */
// [REMOVED: openExportModal override that pointed to wrong modal-export-bills]

window.updateExportBillsCounts = function () {
    const monthInput = document.getElementById('export-bills-month');
    if (!monthInput || !monthInput.value) return;

    const [ceYear, month] = monthInput.value.split('-').map(Number);
    const thYear = ceYear + 543;

    // Try to get counts from existing rendered tables
    const billsTable = document.getElementById('full-bills-table');
    const foodTable = document.getElementById('food-bills-table');
    const attachTable = document.getElementById('attached-bills-table');

    const countRows = (table) => {
        if (!table) return 0;
        const rows = table.querySelectorAll('tbody tr');
        return Array.from(rows).filter(r => !r.querySelector('td[colspan]')).length;
    };

    const billsCount = countRows(billsTable);
    const foodCount = countRows(foodTable);
    const attachCount = countRows(attachTable);

    const billsChk = document.getElementById('export-chk-bills');
    const foodChk = document.getElementById('export-chk-food');
    const attachChk = document.getElementById('export-chk-attach');

    document.getElementById('export-bills-count').textContent = billsCount + ' รายการ';
    document.getElementById('export-food-count').textContent = foodCount + ' รายการ';
    document.getElementById('export-attach-count').textContent = attachCount + ' รายการ';

    const total = (billsChk?.checked ? billsCount : 0) +
                  (foodChk?.checked ? foodCount : 0) +
                  (attachChk?.checked ? attachCount : 0);
    document.getElementById('export-total-count').textContent = total;

    // Update toggles on checkbox change
    ['export-chk-bills','export-chk-food','export-chk-attach'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onchange = updateExportBillsTotalCount;
    });
};

window.updateExportBillsTotalCount = function () {
    const billsChk = document.getElementById('export-chk-bills');
    const foodChk = document.getElementById('export-chk-food');
    const attachChk = document.getElementById('export-chk-attach');

    const billsCount = parseInt(document.getElementById('export-bills-count').textContent) || 0;
    const foodCount = parseInt(document.getElementById('export-food-count').textContent) || 0;
    const attachCount = parseInt(document.getElementById('export-attach-count').textContent) || 0;

    const total = (billsChk?.checked ? billsCount : 0) +
                  (foodChk?.checked ? foodCount : 0) +
                  (attachChk?.checked ? attachCount : 0);
    document.getElementById('export-total-count').textContent = total;
};

window.executeBillsExport = function () {
    const format = document.getElementById('export-bills-format')?.value || 'excel';
    const includeBills = document.getElementById('export-chk-bills')?.checked;
    const includeFood = document.getElementById('export-chk-food')?.checked;
    const includeAttach = document.getElementById('export-chk-attach')?.checked;

    if (!includeBills && !includeFood && !includeAttach) {
        if (typeof showToast === 'function') showToast('กรุณาเลือกอย่างน้อย 1 หัวข้อ', 'error');
        return;
    }

    if (format === 'pdf') {
        // Open the existing PDF export modal if available
        if (typeof openExportPdfModal === 'function') {
            closeBillsExportModal();
            openExportPdfModal();
        } else {
            window.print();
        }
    } else if (format === 'excel' && typeof executeDynamicExport === 'function') {
        closeBillsExportModal();
        executeDynamicExport('excel');
    } else if (format === 'csv' && typeof executeDynamicExport === 'function') {
        closeBillsExportModal();
        executeDynamicExport('csv');
    } else {
        if (typeof showToast === 'function') showToast('ฟีเจอร์ส่งออกกำลังพัฒนา', 'info');
    }
};

// closeExportModal — single source of truth. Defined at top level (not inside a
// DOMContentLoaded wrapper) because other DOMContentLoaded listeners registered
// earlier in this file reference it directly and would fire before a later
// wrapper's assignment ran, throwing "closeBillsExportModal is not defined".
window.closeExportModal = function() {
    const modal = document.getElementById('modal-export-pdf');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = '';   // ← always clear inline style
    }
};

// closeBillsExportModal — fix to close the correct modal
window.closeBillsExportModal = function() {
    const m1 = document.getElementById('modal-export-bills');
    const m2 = document.getElementById('modal-export-pdf');
    if (m1) { m1.classList.remove('active'); m1.style.display = ''; }
    if (m2) { m2.classList.remove('active'); m2.style.display = ''; }
};

// updateExportSectionBadges helper
window.updateExportSectionBadges = function() {
    const countRows = id => {
        const t = document.getElementById(id);
        if (!t) return 0;
        return Array.from(t.querySelectorAll('tbody tr'))
            .filter(r => !r.querySelector('td[colspan]')).length;
    };
    const badges = {
        'export-bills-badge': countRows('full-bills-table'),
        'export-food-badge':  countRows('food-bills-table'),
        'export-attach-badge': countRows('attached-bills-table')
    };
    Object.entries(badges).forEach(([id, n]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = n + ' รายการ';
    });
};

// Style section toggle rows
document.addEventListener('DOMContentLoaded', () => {
    // Close modal-export-bills
    const closeBtn = document.getElementById('modal-export-bills-close');
    if (closeBtn) closeBtn.addEventListener('click', closeBillsExportModal);

    // Highlight checked section rows
    ['export-chk-bills','export-chk-food','export-chk-attach'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const row = el.closest('.export-section-toggle');
            const syncStyle = () => {
                if (row) {
                    row.style.borderColor = el.checked ? 'var(--primary)' : 'var(--border-color)';
                    row.style.background = el.checked ? 'var(--primary-light)' : '';
                }
                updateExportBillsTotalCount();
            };
            el.addEventListener('change', syncStyle);
            syncStyle();
        }
    });
});

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
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    renderExportPreview();
};

/* Sync export modal month from main filter when opening */
// [REMOVED: _origOpenExportModal override chain - was wrapping the original function and blocking close]

/* Count current table rows */
function updateExportSectionBadges() {
    const countRows = (tableId) => {
        const t = document.getElementById(tableId);
        if (!t) return 0;
        return Array.from(t.querySelectorAll('tbody tr'))
            .filter(r => !r.querySelector('td[colspan]')).length;
    };
    const billsN = countRows('full-bills-table');
    const foodN = countRows('food-bills-table');
    const attachN = countRows('attached-bills-table');
    
    const bb = document.getElementById('export-bills-badge');
    const fb = document.getElementById('export-food-badge');
    const ab = document.getElementById('export-attach-badge');
    if (bb) bb.textContent = billsN + ' รายการ';
    if (fb) fb.textContent = foodN + ' รายการ';
    if (ab) ab.textContent = attachN + ' รายการ';
}

/* Patch renderExportPreview to include logo + enhanced header */
const _origRenderExportPreview = window.renderExportPreview;
window.renderExportPreview = function() {
    const page = document.getElementById('export-preview-page');
    if (!page) return;
    
    // Gather settings
    const orgName = document.getElementById('export-org-name')?.value || '';
    const title = document.getElementById('pdf-report-title')?.value || 'รายงานค่าใช้จ่าย';
    const subHeading = document.getElementById('export-header-detail')?.value || '';
    const docNum = document.getElementById('export-doc-number')?.value || '';
    const reportMonth = document.getElementById('export-report-month')?.value || '';
    const logoPreview = document.getElementById('export-logo-preview');
    const logoSrc = logoPreview?.dataset?.logoSrc || '';
    
    // Signature
    const inclSig = document.getElementById('pdf-include-signature')?.checked;
    const preparer = document.getElementById('pdf-preparer-name')?.value || '';
    const reviewer = document.getElementById('pdf-reviewer-name')?.value || '';
    const approver = document.getElementById('pdf-approver-name')?.value || '';
    
    // Section toggles
    const inclBills = document.getElementById('export-chk-bills')?.checked;
    const inclFood = document.getElementById('export-chk-food')?.checked;
    const inclAttach = document.getElementById('export-chk-attach')?.checked;
    
    // Month label
    let monthLabel = '';
    if (reportMonth) {
        const [y, m] = reportMonth.split('-');
        const thMonths = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
        monthLabel = thMonths[parseInt(m)] + ' พ.ศ. ' + (parseInt(y) + 543);
    }
    
    // Build preview HTML
    let html = '';
    
    // Document header
    html += '<div style="display:flex; align-items:center; gap:16px; margin-bottom:16px; border-bottom:2px solid #1a1a2e; padding-bottom:14px;">';
    if (logoSrc) {
        html += '<img src="' + logoSrc + '" style="width:64px;height:64px;object-fit:contain; flex-shrink:0;">';
    }
    html += '<div style="flex:1;">';
    if (orgName) html += '<div style="font-size:14px; font-weight:700; color:#1a1a2e;">' + orgName + '</div>';
    html += '<div style="font-size:18px; font-weight:800; color:#1a1a2e; margin:2px 0;">' + title + '</div>';
    if (monthLabel) html += '<div style="font-size:12px; color:#4b5563;">ประจำ' + monthLabel + '</div>';
    if (subHeading) html += '<div style="font-size:11px; color:#6b7280; margin-top:2px;">' + subHeading + '</div>';
    html += '</div>';
    if (docNum) html += '<div style="text-align:right; font-size:11px; color:#6b7280;">เลขที่: <strong>' + docNum + '</strong></div>';
    html += '</div>';
    
    // Bills section preview
    if (inclBills) {
        const billsRows = document.getElementById('full-bills-table')?.querySelectorAll('tbody tr') || [];
        const visibleRows = Array.from(billsRows).filter(r => !r.querySelector('td[colspan]'));
        html += '<div style="margin-bottom:16px;">';
        const _billsMonthLabel = (() => { const mi = document.getElementById('export-report-month')?.value; if (!mi) return ''; const [y,m]=mi.split('-'); const thM=['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']; return 'ประจำเดือน' + thM[parseInt(m)] + ' พ.ศ. ' + (parseInt(y)+543); })();
        html += '<div style="font-size:13px; font-weight:700; color:#1a1a2e; background:#f3f4f6; padding:6px 10px; border-radius:4px; margin-bottom:8px; border-left:3px solid #059669;">📄 รายการบิล' + _billsMonthLabel + '</div>';
        html += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
        html += '<thead><tr style="background:#e5e7eb;">';
        html += '<th style="padding:5px 8px; text-align:left; border:1px solid #d1d5db;">เลขบิล</th>';
        html += '<th style="padding:5px 8px; text-align:left; border:1px solid #d1d5db;">วันที่</th>';
        html += '<th style="padding:5px 8px; text-align:left; border:1px solid #d1d5db;">โครงการ</th>';
        html += '<th style="padding:5px 8px; text-align:left; border:1px solid #d1d5db;">หมวดหมู่</th>';
        html += '<th style="padding:5px 8px; text-align:right; border:1px solid #d1d5db;">ยอดรวม</th>';
        html += '</tr></thead><tbody>';
        
        if (visibleRows.length === 0) {
            html += '<tr><td colspan="5" style="padding:8px; text-align:center; color:#9ca3af; border:1px solid #d1d5db; font-style:italic;">ไม่มีข้อมูล</td></tr>';
        } else {
            let total = 0;
            visibleRows.slice(0, 8).forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 10) {
                    const amtText = cells[9]?.textContent?.trim() || '0';
                    const amt = parseFloat(amtText.replace(/,/g, '')) || 0;
                    total += amt;
                    html += '<tr style="border-bottom:1px solid #f3f4f6;">';
                    html += '<td style="padding:4px 8px; border:1px solid #d1d5db; font-size:10px;">' + (cells[0]?.textContent?.trim() || '') + '</td>';
                    html += '<td style="padding:4px 8px; border:1px solid #d1d5db;">' + (cells[1]?.textContent?.trim() || '') + '</td>';
                    html += '<td style="padding:4px 8px; border:1px solid #d1d5db;">' + (cells[2]?.textContent?.trim() || '') + '</td>';
                    html += '<td style="padding:4px 8px; border:1px solid #d1d5db;">' + (cells[3]?.textContent?.trim() || '') + '</td>';
                    html += '<td style="padding:4px 8px; border:1px solid #d1d5db; text-align:right;">' + (cells[9]?.textContent?.trim() || '') + '</td>';
                    html += '</tr>';
                }
            });
            if (visibleRows.length > 8) {
                html += '<tr><td colspan="5" style="padding:4px 8px; text-align:center; color:#6b7280; font-style:italic; font-size:10px; border:1px solid #d1d5db;">... และอีก ' + (visibleRows.length - 8) + ' รายการ (แสดงในไฟล์จริง)</td></tr>';
            }
            html += '<tr style="background:#f9fafb; font-weight:700;"><td colspan="4" style="padding:5px 8px; border:1px solid #d1d5db; text-align:right;">รวมทั้งหมด</td><td style="padding:5px 8px; border:1px solid #d1d5db; text-align:right; color:#059669;">' + total.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td></tr>';
        }
        html += '</tbody></table></div>';
    }
    
    // Food section preview
    if (inclFood) {
        const foodRows = document.getElementById('food-bills-table')?.querySelectorAll('tbody tr') || [];
        const visibleFoodRows = Array.from(foodRows).filter(r => !r.querySelector('td[colspan]'));
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:13px; font-weight:700; color:#1a1a2e; background:#fef3c7; padding:6px 10px; border-radius:4px; margin-bottom:8px; border-left:3px solid #f59e0b;">🍽️ ค่าอาหารประจำเดือน</div>';
        if (visibleFoodRows.length === 0) {
            html += '<div style="font-size:11px; color:#9ca3af; font-style:italic; padding:8px;">ไม่มีข้อมูลค่าอาหาร</div>';
        } else {
            html += '<table style="width:100%; border-collapse:collapse; font-size:11px;">';
            html += '<thead><tr style="background:#e5e7eb;"><th style="padding:5px 8px; border:1px solid #d1d5db;">วันที่</th><th style="padding:5px 8px; border:1px solid #d1d5db;">รายการ</th><th style="padding:5px 8px; border:1px solid #d1d5db;">หมวดหมู่</th><th style="padding:5px 8px; text-align:right; border:1px solid #d1d5db;">ยอดเงิน</th></tr></thead><tbody>';
            visibleFoodRows.slice(0, 5).forEach(row => {
                const cells = row.querySelectorAll('td');
                html += '<tr><td style="padding:4px 8px;border:1px solid #d1d5db;">' + (cells[1]?.textContent?.trim()||'') + '</td><td style="padding:4px 8px;border:1px solid #d1d5db;">' + (cells[2]?.textContent?.trim()||'') + '</td><td style="padding:4px 8px;border:1px solid #d1d5db;">' + (cells[3]?.textContent?.trim()||'') + '</td><td style="padding:4px 8px;border:1px solid #d1d5db;text-align:right;">' + (cells[6]?.textContent?.trim()||'') + '</td></tr>';
            });
            if (visibleFoodRows.length > 5) html += '<tr><td colspan="4" style="padding:4px 8px;text-align:center;color:#9ca3af;font-size:10px;border:1px solid #d1d5db;font-style:italic;">... และอีก ' + (visibleFoodRows.length - 5) + ' รายการ</td></tr>';
            html += '</tbody></table>';
        }
        html += '</div>';
    }

    // Attach section preview
    if (inclAttach) {
        const attachRows = document.getElementById('attached-bills-table')?.querySelectorAll('tbody tr') || [];
        const visibleAttachRows = Array.from(attachRows).filter(r => !r.querySelector('td[colspan]'));
        if (visibleAttachRows.length > 0) {
            html += '<div style="margin-bottom:16px;">';
            html += '<div style="font-size:13px; font-weight:700; color:#1a1a2e; background:#ede9fe; padding:6px 10px; border-radius:4px; margin-bottom:8px; border-left:3px solid #8b5cf6;">📎 บิลแนบ / ค่าสาธารณูปโภค</div>';
            html += '<div style="font-size:11px; color:#6b7280;">' + visibleAttachRows.length + ' รายการ (แสดงในไฟล์จริง)</div>';
            html += '</div>';
        }
    }
    
    // Signature section
    if (inclSig && (preparer || reviewer || approver)) {
        html += '<div style="margin-top:40px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:20px;">';
        [['ผู้จัดทำ', preparer], ['ผู้ตรวจสอบ', reviewer], ['ผู้อนุมัติ', approver]].forEach(([role, name]) => {
            html += '<div style="text-align:center;">';
            html += '<div style="border-bottom:1px solid #9ca3af; margin-bottom:6px; padding-bottom:32px;"></div>';
            if (name) html += '<div style="font-size:12px; font-weight:600;">' + name + '</div>';
            html += '<div style="font-size:11px; color:#6b7280;">(' + role + ')</div>';
            html += '</div>';
        });
        html += '</div>';
    }
    
    // Page footer
    html += '<div style="position:absolute; bottom:10mm; left:15mm; right:15mm; display:flex; justify-content:space-between; font-size:9px; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:6px;">';
    html += '<span>จัดทำโดย RDF Expense System</span>';
    html += '<span>พิมพ์เมื่อ: ' + new Date().toLocaleDateString('th-TH', {year:'numeric',month:'long',day:'numeric'}) + '</span>';
    html += '</div>';
    
    page.innerHTML = html;
};

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
window.exportSingleSection = function(section) {
    const format = document.getElementById('export-bills-format')?.value || 
                   document.getElementById('export-report-type') ? 'excel' : 'excel';
    const monthInput = document.getElementById('export-report-month');
    const reportMonth = monthInput?.value || '';
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
    const tableIds = {
        bills: 'full-bills-table',
        food: 'food-bills-table',
        attach: 'attached-bills-table'
    };

    const tableEl = document.getElementById(tableIds[section]);
    if (!tableEl) {
        if (typeof showToast === 'function') showToast('ไม่พบข้อมูลในหัวข้อนี้', 'error');
        return;
    }

    const rows = Array.from(tableEl.querySelectorAll('tbody tr'))
        .filter(r => !r.querySelector('td[colspan]'));

    if (rows.length === 0) {
        if (typeof showToast === 'function') showToast('ไม่มีข้อมูลในหัวข้อนี้', 'warning');
        return;
    }

    const fileName = (sectionNames[section] || section) + (monthLabel ? '_' + monthLabel : '');

    // Build CSV
    const headers = Array.from(tableEl.querySelectorAll('thead th'))
        .map(th => th.textContent.trim())
        .filter(h => h && h !== 'เครื่องมือ' && h !== 'หลักฐาน');
    
    let csvContent = headers.map(h => '"' + h.replace(/"/g, '""') + '"').join(',') + '\n';
    rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'))
            .slice(0, headers.length)
            .map(td => '"' + (td.textContent.trim().replace(/"/g, '""')) + '"');
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
                if (typeof lucide !== 'undefined') lucide.createIcons();
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
    if (!value) return;
    try {
        await apiCall('updateSystemConfig', { [key]: value });
        appAlert('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
        renderSettingsTab();
    } catch (err) {
        appAlert('บันทึกการตั้งค่าไม่สำเร็จ: ' + err.message, 'error');
    }
};

window.saveSystemSetting = async function(key, value) {
    try {
        await apiCall('updateSystemConfig', { [key]: value });
        appAlert('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
        renderSettingsTab();
    } catch (err) {
        appAlert('บันทึกการตั้งค่าไม่สำเร็จ: ' + err.message, 'error');
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
    if (uploadInput) uploadInput.value = config.maxUploadSizeMb || 2;

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
