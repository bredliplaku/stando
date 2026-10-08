// Config
let isAdmin = false;
let isGlobalAdmin = false;
let adminCourses = [];
const CLIENT_ID = '740588046540-npg0crodtcuinveu6bua9rd6c3hb2s1m.apps.googleusercontent.com';
const LOGS_STORAGE_KEY = 'attendance_logs';
// Storage bucket for absence attachments (limits enforced by the bucket)
const ATTACHMENTS_BUCKET = 'absence-attachments';

// Supabase Auth (sessions auto-refresh; the anon key is public-safe ONLY with RLS enabled)
const SUPABASE_URL = 'https://yeuxwdijlpgfgajjjebj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlldXh3ZGlqbHBnZmdhampqZWJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNDE4NzYsImV4cCI6MjA5NTcxNzg3Nn0.YvO3Ug023m5Biy-rr0qwafzy1u51-kBOie-eGGu5Y64';
const supabaseClient = typeof supabase !== 'undefined' ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// Marks a kiosk (NFC) session so it auto-expires
const KIOSK_MODE_KEY = 'kiosk_mode';

// Raw nonce for the current One Tap prompt (its SHA-256 hash is sent to Google)
let oneTapRawNonce = null;

// App state
let courseData = {};
let isScanning = false;
let nfcSupported = false;
let nfcReader = null;
let filter = '';
let dbFilter = '';
let databaseMap = {}; // Map UIDs to {name, email} objects
let uidToPrimaryUidMap = {};
let currentSort = localStorage.getItem('logs_sort') || 'date-desc';
let currentDbSort = localStorage.getItem('db_sort') || 'name-asc';
let soundEnabled = localStorage.getItem('sound_enabled') !== 'false';
let isSignedIn = false; // User is signed in
let currentUser = null; // Current user info
let currentCourse = ''; // Currently selected course
let availableCourses = []; // Populated from Supabase after sign-in
let isOnline = navigator.onLine;
let isSyncing = false;
let isInitializing = true;
let isChangingCourses = false;
let pendingNotifications = [];
let criticalErrorsOnly = true;
let lastScannedUID = null;
let courseIDMap = {}; // Object to store course information - name to ID mapping
let courseInfoMap = {};
let courseDictionary = {};
let loadingTasks = new Set(['session', 'auth', 'courses', 'database']);
let cooldownUIDs = new Set();
let nfcAbortController = null;
let guestCourse = null; // Track the course global admin is "visiting" but not officially admin of
let scanClockInterval = null;
let globalNotificationCount = 0;
let myNotificationCount = 0;

// Auto syncing
let autoSyncInterval = null;
let autoSyncEnabled = true;
let lastSyncTime = 0;
let pendingChanges = false;
const courseSyncRequests = new Map();
const protectedCacheKeys = new Set();
let nfcLoginInProgress = false;
let storageSaveFailed = false;
let syncAttempts = 0;
const MAX_SYNC_ATTEMPTS = 5;
const SYNC_INTERVAL = 60000; // Auto-sync every 60 seconds
const SYNC_RETRY_INTERVAL = 15000; // Retry failed syncs after 15 seconds
const ADMIN_REFRESH_INTERVAL = 30000; // Auto-refresh admin dashboard every 30 seconds
let adminAutoRefreshInterval = null;
let activeRequests = new Map(); // Track active requests per course
let studentLogCache = {};
let currentRequestId = 0; // Global request counter
let databaseLoadPromise = null;
let databaseCache = null;
let databaseCacheTime = 0;
const DATABASE_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let initInProgress = false;
let lastNotificationKey = '';
let lastNotificationTime = 0;
let isBulkMode = false;
let selectedLogIds = new Set(); // Stores IDs of selected rows
let hideOtherCourseAbsences = true;
let cachedAbsences = [];
let lastCheckedLogId = null; // For Shift+Click logic
let activeSessionCategory = null;
let activeSessionGroup = null;
let currentCourseSections = {}; // Parsed structure

// Pagination State
let logsCurrentPage = 1;
let dbCurrentPage = 1;
const ITEMS_PER_PAGE = 25; // Number of items per page

// DOM Elements
let tabs, tabContents, importExcelBtn, excelInput, filterInput, sortSelect,
    dbFilterInput, importBtn, importInput, exportBtn, clearBtn, addLogBtn,
    addEntryBtn, exportExcelBtn, clearDbBtn, logsTbody, databaseTbody,
    emptyLogs, emptyDatabase, filteredCount, dbEntryCount, totalScans,
    lastScan, databaseStatus, notificationArea, successSound, errorSound,
    syncBtn, syncStatus, syncText, loginBtn, logoutBtn, loginContainer,
    userContainer, userName, userAvatar, scanHistoryModule;


function checkLoadingCompletion() {
    if (loadingTasks.size === 0) {
        setTimeout(showMainContent, 100); // Short delay for rendering
    } else {
    }
}

// --- Dialog Scroll Fix Helpers ---
let dialogOpenCount = 0; // Track nested dialogs

// Detect if device supports touch (for virtual keyboard handling)
function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function syncDialogMode() {
    if (typeof document === 'undefined' || !document.body) return;
    const openBackdrops = document.querySelectorAll('.dialog-backdrop');
    dialogOpenCount = openBackdrops.length;
    if (dialogOpenCount === 0) {
        document.body.classList.remove('dialog-open');
        if (document.documentElement) document.documentElement.classList.remove('dialog-open');
        document.body.style.overflow = '';
        if (document.documentElement) document.documentElement.style.overflow = '';
    } else {
        document.body.classList.add('dialog-open');
        // Reset burn-in transform to prevent dialog offset
        document.body.style.transform = '';
    }
}

function openDialogMode() {
    if (typeof document === 'undefined' || !document.body) return;
    document.body.classList.add('dialog-open');
    document.body.style.transform = '';
    syncDialogMode();
    setTimeout(syncDialogMode, 0);
}

function closeDialogMode() {
    syncDialogMode();
    setTimeout(syncDialogMode, 0);
}

// Emergency reset function - call this if scroll gets stuck
function resetDialogMode() {
    syncDialogMode();
}

if (typeof window !== 'undefined') {
    window.syncDialogMode = syncDialogMode;
    window.openDialogMode = openDialogMode;
    window.closeDialogMode = closeDialogMode;
    window.resetDialogMode = resetDialogMode;
}

// Prevent auto-scroll on focus for non-touch devices
// Touch devices need scroll for virtual keyboard visibility
document.addEventListener('focusin', function (e) {
    // Only prevent scroll on non-touch devices when dialog is open
    if (!isTouchDevice() && dialogOpenCount > 0) {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
            // Check if the element is inside a dialog
            if (target.closest('.dialog')) {
                // Prevent the browser's default scroll-into-view behavior
                e.preventDefault();
                // Focus without scrolling
                target.focus({ preventScroll: true });
            }
        }
    }
}, true); // Use capture phase to intercept early

/**
* Helper to get/create the persistent Device ID
*/
function getDeviceFingerprint() {
    let deviceId = localStorage.getItem('attendance_device_id');
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem('attendance_device_id', deviceId);
    }
    return deviceId;
}

// Helper to decode the Google ID Token
// Helper to decode the Google ID Token
function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}

async function handleOneTapResponse(response) {
    const responsePayload = parseJwt(response.credential);
    console.log("One Tap Auto-Sign-In Detected for:", responsePayload.email);

    const loginBtn = document.getElementById('login-btn');

    // 1. UI State: Show "Verifying" spinner
    if (loginBtn) {
        loginBtn.dataset.originalText = loginBtn.innerHTML;
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Verifying...';
        loginBtn.style.cursor = "wait";
    }

    // 2. Exchange the Google ID token for a Supabase session (no popup, no redirect)
    try {
        const { error } = await supabaseClient.auth.signInWithIdToken({
            provider: 'google',
            token: response.credential,
            nonce: oneTapRawNonce // raw nonce; Google received its SHA-256 hash
        });
        if (error) throw error;

        onSuccessfulAuth(false);
    } catch (err) {
        console.error("One Tap sign-in failed:", err);
        if (loginBtn) {
            loginBtn.disabled = false;
            if (loginBtn.dataset.originalText) loginBtn.innerHTML = loginBtn.dataset.originalText;
            loginBtn.style.backgroundColor = "";
            loginBtn.style.cursor = "pointer";
        }
    }
}

async function sha256Hex(str) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
* Parses "Theory A, Theory B, Lab" into { Theory: ['A', 'B'], Lab: [] }
*/
function parseAvailableSections(sectionString) {
    if (!sectionString) return {};
    const map = {};
    const items = sectionString.split(',').map(s => s.trim()).filter(Boolean);

    items.forEach(item => {
        // Split "Theory A" -> ["Theory", "A"]
        // Split "Lab" -> ["Lab"]
        const parts = item.split(' ');
        const cat = parts[0];
        const grp = parts[1] || ''; // Empty string if no group

        if (!map[cat]) map[cat] = [];
        if (grp && !map[cat].includes(grp)) map[cat].push(grp);
    });
    return map;
}

/**
 * Shows a dialog to Add or Edit a Staff Member.
 */
function showStaffEditorDialog(staffData = null) {
    const isEdit = !!staffData;
    const title = isEdit ? 'Edit Staff Member' : 'Add Staff Member';
    const icon = isEdit ? 'fa-user-pen' : 'fa-user-plus';
    const btnText = isEdit ? 'Save Changes' : 'Add Staff';

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    dialogBackdrop.style.zIndex = "10010";

    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');

    let activeNfcSession = { controller: null, button: null };

    const nameVal = isEdit ? (staffData.name || '') : '';
    const emailVal = isEdit ? staffData.email : '';
    const uidVal = isEdit ? staffData.uid : '';
    // An empty name shows the name from their Google account, once they have signed in.
    const googleName = isEdit ? (staffData.googleName || '') : '';
    const namePlaceholder = googleName || 'From their Google account';

    // Default to 'Lecturer' if adding new
    const roleVal = isEdit ? staffData.role : 'Lecturer';

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${title}</h3>
        <div class="dialog-content">

            <div class="form-group">
                <label class="dialog-label-fixed" for="staff-name">Name</label>
                <input type="text" id="staff-name" class="form-control" placeholder="${escapeHtml(namePlaceholder)}" value="${escapeHtml(nameVal)}" autocomplete="off">
            </div>
            <p class="form-hint">Leave empty to use the name from their Google account. Enter a name to add a title or change it.</p>

            <div class="form-group">
                <label class="dialog-label-fixed" for="staff-email">Email <span class="required">*</span></label>
                <input type="email" id="staff-email" class="form-control" placeholder="nsurname@epoka.edu.al" value="${escapeHtml(emailVal)}">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="staff-role">Role</label>
                <select id="staff-role" class="form-control">
                    <option value="Global" ${roleVal === 'Global' ? 'selected' : ''}>Administrator</option>
                    <option value="Lecturer" ${roleVal === 'Lecturer' ? 'selected' : ''}>Lecturer</option>
                    <option value="Student" ${roleVal === 'Student' ? 'selected' : ''}>Student</option>
                </select>
            </div>
            <p class="form-hint"><strong>Lecturer:</strong> can log in on trusted devices only and manages their courses. <strong>Student:</strong> can log in on any device and sees only their attendance.</p>

            <div class="form-group">
                <label class="dialog-label-fixed" for="staff-uid">UID <span class="required">*</span></label>
                <div class="admin-input-wrapper" style="margin:0; width:100%;">
                    <input type="text" id="staff-uid" class="form-control" placeholder="04:a2:3f:8a" value="${escapeHtml(uidVal)}">
                    ${nfcSupported ? '<button type="button" class="btn-blue btn-icon btn-sm scan-staff-uid-btn" title="Scan UID" aria-label="Scan UID"><i class="fa-solid fa-wifi" aria-hidden="true"></i></button>' : ''}
                </div>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="staff-converted-id">Card ID</label>
                <input type="text" id="staff-converted-id" class="form-control" placeholder="Calculated from the UID" value="${escapeHtml(convertUidToExternalId(uidVal))}" disabled>
            </div>

            <div id="staff-nfc-status" style="margin-top:10px;"></div>
        </div>
        <div class="dialog-actions">
            <button type="button" id="cancel-staff-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button type="button" id="save-staff-btn" class="btn-green"><i class="fa-solid fa-check"></i> ${btnText}</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const uidInput = dialog.querySelector('#staff-uid');
    const convertedInput = dialog.querySelector('#staff-converted-id');
    const statusContainer = dialog.querySelector('#staff-nfc-status');
    const scanBtn = dialog.querySelector('.scan-staff-uid-btn');

    // Real-time calculation from UID to ID
    if (uidInput && convertedInput) {
        uidInput.addEventListener('input', () => {
            const raw = uidInput.value.trim();
            convertedInput.value = convertUidToExternalId(raw) || '';
        });
    }

    if (scanBtn) {
        scanBtn.addEventListener('click', () => {
            if (activeNfcSession.button === scanBtn) {
                if (activeNfcSession.controller) activeNfcSession.controller.abort();
                activeNfcSession = { controller: null, button: null };
                scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                statusContainer.innerHTML = '';
            } else {
                if (activeNfcSession.controller) activeNfcSession.controller.abort();
                scanBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                const controller = startNfcForInputDialog(uidInput, statusContainer, scanBtn);
                activeNfcSession = { controller, button: scanBtn };
            }
        });
    }

    const close = () => {
        if (activeNfcSession.controller) activeNfcSession.controller.abort();
        document.body.removeChild(dialogBackdrop);
    };
    dialog.querySelector('#cancel-staff-btn').onclick = close;

    dialog.querySelector('#save-staff-btn').onclick = async (e) => {
        const name = document.getElementById('staff-name').value.trim();
        const email = document.getElementById('staff-email').value.trim();
        const rawUid = document.getElementById('staff-uid').value.trim();
        const convId = document.getElementById('staff-converted-id')?.value.trim();
        const uid = convId || convertUidToExternalId(rawUid) || rawUid;
        const role = document.getElementById('staff-role').value;
        const btn = e.currentTarget;

        // The name is optional: empty means the name from their Google account.
        const emailInput = document.getElementById('staff-email');
        const uidInput = document.getElementById('staff-uid');
        emailInput.setAttribute('aria-invalid', String(!email));
        uidInput.setAttribute('aria-invalid', String(!uid));
        if (!email || !uid) {
            showNotification('error', 'Missing Info', 'Email and UID are required.');
            (!email ? emailInput : uidInput).focus();
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';

        try {
            const payload = {
                actionType: isEdit ? 'edit' : 'add',
                name, email, uid, role
            };
            if (isEdit) payload.rowIndex = staffData.rowIndex;

            await callWebApp('manageStaff_Admin', payload, 'POST');

            showNotification('success', 'Success', `Staff member ${isEdit ? 'updated' : 'added'}.`);

            document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
            closeDialogMode();
            showGlobalSettingsDialog();

            setTimeout(() => {
                const staffTab = document.querySelector('.settings-tab-btn[data-target="sect-staff"]');
                if (staffTab) staffTab.click();
            }, 100);

        } catch (err) {
            showNotification('error', 'Error', err.message);
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check"></i> ${btnText}`;
        }
    };
}

/**
* Generates HTML options for a Session Select dropdown based on the current course.
* @param {string} selectedValue - The value to pre-select (e.g., "Theory A").
* @returns {string} HTML string of <option> tags.
*/
function generateSessionOptions(selectedValue = '') {
    if (!currentCourse || !courseInfoMap[currentCourse]) return '<option value="Default">Default</option>';

    const rawSections = courseInfoMap[currentCourse].availableSections || '';
    const sectionsMap = parseAvailableSections(rawSections); // Uses your existing parser
    const categories = Object.keys(sectionsMap);

    if (categories.length === 0) return '<option value="Default">Default</option>';

    let html = '';

    categories.forEach(cat => {
        const groups = sectionsMap[cat] || [];
        if (groups.length > 0) {
            groups.forEach(grp => {
                const val = `${cat} ${grp}`;
                const isSel = val === selectedValue ? 'selected' : '';
                html += `<option value="${val}" ${isSel}>${val}</option>`;
            });
        } else {
            // Category with no specific groups
            const isSel = cat === selectedValue ? 'selected' : '';
            html += `<option value="${cat}" ${isSel}>${cat}</option>`;
        }
    });

    return html;
}

/**
* Generates Session Toggle Buttons.
* @param {string} prefix - ID prefix.
* @param {boolean} includeInherit - Show "Same as previous".
* @param {boolean} isCompact - Reduces padding/size for dialogs.
*/


/**
* Generates Session Toggle Buttons.
* @param {string} prefix - ID prefix.
* @param {boolean} includeInherit - Show "Same as previous".
* @param {boolean} isCompact - Reduces padding/size for dialogs.
*/
function renderSessionSelectorHTML(prefix, includeInherit = false, isCompact = false) {
    if (!currentCourse || !courseInfoMap[currentCourse]) return '';

    const rawSections = courseInfoMap[currentCourse].availableSections || '';
    const sectionsMap = parseAvailableSections(rawSections);
    const categories = Object.keys(sectionsMap);

    if (categories.length === 0) return '';

    // Compact styles
    const btnStyle = isCompact ? 'padding: 8px 12px; font-size: 0.9em; min-width: auto;' : 'flex:1;';
    const rowStyle = isCompact ? 'margin-bottom:8px; justify-content:flex-start; gap:8px;' : 'margin-bottom:8px; justify-content:flex-start; gap:5px;';

    // 1. Inherit Button
    let inheritHtml = '';
    if (includeInherit) {
        inheritHtml = `
        <div class="course-buttons-container" style="${rowStyle}">
            <div class="course-button active" id="${prefix}-btn-inherit" data-val="INHERIT" style="${btnStyle} width:100%; text-align:center;">
                <i class="fa-solid fa-clock-rotate-left"></i>&nbsp; ${prefix === 'bulk' && includeInherit ? 'Latest / Same as Previous' : 'Same as Previous'}
            </div>
        </div>`;
    }

    // 2. Category Row
    let catHtml = '';
    const icons = { 'theory': 'fa-book', 'lab': 'fa-desktop', 'practice': 'fa-pen-to-square' };

    categories.forEach(cat => {
        const lowerCat = cat.toLowerCase();
        const iconClass = icons[lowerCat] || 'fa-tag';
        const isActive = !includeInherit && cat === categories[0] ? 'active' : '';

        catHtml += `<div class="course-button ${isActive}" data-type="category" data-val="${cat}" style="${btnStyle}">
            <i class="fa-solid ${iconClass}"></i>&nbsp; ${cat}
        </div>`;
    });

    // 3. Group Row
    let groupRowsHtml = '';
    categories.forEach(cat => {
        const groups = sectionsMap[cat] || [];
        const isVisible = !includeInherit && cat === categories[0] ? 'flex' : 'none';

        if (groups.length > 0) {
            let btns = '';
            groups.forEach((grp, idx) => {
                const isActive = (!includeInherit && idx === 0) ? 'active' : '';
                // Groups are always small squares
                btns += `<div class="course-button ${isActive}" data-type="group" data-val="${grp}" style="min-width:40px; padding:8px 0; justify-content:center;"><b>${grp}</b></div>`;
            });

            groupRowsHtml += `<div class="course-buttons-container group-row" id="${prefix}-groups-${cat}" style="display:${isVisible}; ${rowStyle}">${btns}</div>`;
        }
    });

    return `
    <div id="${prefix}-session-wrapper" style="margin-top:5px;">
        <input type="hidden" id="${prefix}-selected-session" value="${includeInherit ? 'INHERIT' : categories[0] + ' ' + (sectionsMap[categories[0]]?.[0] || '')}">
        ${inheritHtml}
        <div class="course-buttons-container" id="${prefix}-cat-row" style="${rowStyle}">
            ${catHtml}
        </div>
        ${groupRowsHtml}
    </div>`;
}

/**
 * Attaches event listeners to the generated Session Selector.
 * @param {string} containerIdPrefix - The prefix used in renderSessionSelectorHTML.
 * @param {Object} sectionsMap - The parsed sections object.
 */


/**
 * Attaches event listeners to the generated Session Selector.
 * @param {string} containerIdPrefix - The prefix used in renderSessionSelectorHTML.
 * @param {Object} sectionsMap - The parsed sections object.
 */
function setupSessionToggleListeners(containerIdPrefix, sectionsMap) {
    const wrapper = document.getElementById(`${containerIdPrefix}-session-wrapper`);
    if (!wrapper) return;

    const input = document.getElementById(`${containerIdPrefix}-selected-session`);
    const inheritBtn = document.getElementById(`${containerIdPrefix}-btn-inherit`);
    const catRow = document.getElementById(`${containerIdPrefix}-cat-row`);
    const groupRows = wrapper.querySelectorAll('.group-row');

    const updateValue = () => {
        if (inheritBtn && inheritBtn.classList.contains('active')) {
            input.value = 'INHERIT';
            return;
        }

        const activeCat = catRow.querySelector('.course-button.active');
        if (!activeCat) {
            input.value = '';
            return;
        }

        const catVal = activeCat.dataset.val;
        const activeGroupRow = document.getElementById(`${containerIdPrefix}-groups-${catVal}`);
        let groupVal = '';

        if (activeGroupRow) {
            const activeGrp = activeGroupRow.querySelector('.course-button.active');
            if (activeGrp) groupVal = activeGrp.dataset.val;
        }

        // Construct session string (e.g., "Theory A" or just "Theory")
        input.value = groupVal ? `${catVal} ${groupVal}` : catVal;
    };

    // 1. Inherit Click
    if (inheritBtn) {
        inheritBtn.addEventListener('click', () => {
            inheritBtn.classList.add('active');
            // Deactivate all categories
            catRow.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
            // Hide all groups
            groupRows.forEach(r => r.style.display = 'none');
            updateValue();
        });
    }

    // 2. Category Click
    catRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (!btn) return;

        // Activate Category
        if (inheritBtn) inheritBtn.classList.remove('active');
        catRow.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const catVal = btn.dataset.val;

        // Show relevant Group Row, hide others
        groupRows.forEach(row => {
            if (row.id === `${containerIdPrefix}-groups-${catVal}`) {
                row.style.display = 'flex';
                // Auto-select first group if none active
                if (!row.querySelector('.course-button.active')) {
                    const first = row.querySelector('.course-button');
                    if (first) first.classList.add('active');
                }
            } else {
                row.style.display = 'none';
            }
        });
        updateValue();
    });

    // 3. Group Click
    groupRows.forEach(row => {
        row.addEventListener('click', (e) => {
            const btn = e.target.closest('.course-button');
            if (!btn) return;

            row.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateValue();
        });
    });
}

// --- SMART VERTICAL SESSION CONTROLS ---

function renderSessionControls(courseName) {
    const controls = document.getElementById('session-controls');
    const catGroup = document.getElementById('session-category-group');

    // Safety check
    if (!courseInfoMap || !courseInfoMap[courseName]) {
        controls.style.display = 'none';
        return;
    }

    const rawSections = courseInfoMap[courseName].availableSections || '';
    currentCourseSections = parseAvailableSections(rawSections);
    const categories = Object.keys(currentCourseSections);

    if (categories.length === 0) {
        controls.style.display = 'none';
        activeSessionCategory = null;
        activeSessionGroup = null;
        return;
    }

    // 1. Auto-select Category Logic
    // If no category selected, or current one invalid, pick first
    if (!activeSessionCategory || !categories.includes(activeSessionCategory)) {
        activeSessionCategory = categories[0];
        activeSessionGroup = null; // Reset group
    }

    // 2. Render Categories
    catGroup.innerHTML = '';
    const icons = { 'theory': 'fa-book', 'lab': 'fa-desktop', 'practice': 'fa-pen-to-square' };

    categories.forEach(cat => {
        const lowerCat = cat.toLowerCase();
        const iconClass = icons[lowerCat] || 'fa-tag';

        const btn = document.createElement('div');
        btn.setAttribute('class', 'course-button');
        btn.setAttribute('role', 'button');
        btn.tabIndex = 0;
        btn.dataset.category = cat;
        btn.innerHTML = `<i class="fa-solid ${iconClass} tab-icon" aria-hidden="true"></i><span class="tab-label" data-label="${escapeHtml(cat)}">${escapeHtml(cat)}</span>`;

        btn.onclick = () => selectSessionCategory(cat);

        if (activeSessionCategory === cat) btn.classList.add('active');
        catGroup.appendChild(btn);
    });

    // 3. Render Groups for the active category
    renderGroupsForCategory(activeSessionCategory);

    // 4. SMART VISIBILITY CHECK
    // Hide Category Row if only 1 category exists
    const showCategories = categories.length > 1;
    catGroup.style.display = showCategories ? 'flex' : 'none';

    // Group visibility is determined inside renderGroupsForCategory
    const grpContainer = document.getElementById('session-group-container');
    const showGroups = grpContainer.style.display !== 'none';

    // Only show main container if at least one row is visible
    controls.style.display = (showCategories || showGroups) ? 'flex' : 'none';

    // Apply row-aware rounding to session button containers
    requestAnimationFrame(() => {
        updateButtonRows(catGroup);
        updateButtonRows(document.getElementById('session-group-container'));
    });
}

function selectSessionCategory(category) {
    activeSessionCategory = category;
    activeSessionGroup = null; // Reset group

    // Visual Update
    const catGroup = document.getElementById('session-category-group');
    Array.from(catGroup.children).forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.category ?? btn.innerText.trim()) === category);
    });

    renderGroupsForCategory(category);

    // Re-check parent visibility (Group row might have appeared/disappeared)
    const grpContainer = document.getElementById('session-group-container');
    const categories = Object.keys(currentCourseSections);
    const showCategories = categories.length > 1;
    const showGroups = grpContainer.style.display !== 'none';

    document.getElementById('session-controls').style.display = (showCategories || showGroups) ? 'flex' : 'none';
}

function renderGroupsForCategory(category) {
    const groups = currentCourseSections[category] || [];
    const grpContainer = document.getElementById('session-group-container');

    // 1. Auto-select Group Logic
    if (groups.length > 0) {
        if (!activeSessionGroup || !groups.includes(activeSessionGroup)) {
            activeSessionGroup = groups[0];
        }
    } else {
        activeSessionGroup = null;
    }

    // 2. Render Buttons
    grpContainer.innerHTML = '';

    groups.forEach(grp => {
        const btn = document.createElement('div');
        btn.setAttribute('class', 'course-button');
        btn.setAttribute('role', 'button');
        btn.tabIndex = 0;
        btn.innerHTML = `<b>${escapeHtml(grp)}</b>`;

        btn.onclick = () => selectSessionGroup(grp);

        if (activeSessionGroup === grp) btn.classList.add('active');
        grpContainer.appendChild(btn);
    });

    // 3. SMART VISIBILITY CHECK (Groups)
    // Hide Group Row if <= 1 group exists
    if (groups.length <= 1) {
        grpContainer.style.display = 'none';
    } else {
        grpContainer.style.display = 'flex';
    }

    // Apply row-aware rounding after group buttons are rendered
    requestAnimationFrame(() => updateButtonRows(grpContainer));
}

function selectSessionGroup(group) {
    activeSessionGroup = group;
    const grpContainer = document.getElementById('session-group-container');
    Array.from(grpContainer.children).forEach(btn => {
        if (btn.innerText.trim() === group) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

// --- Absence History Logic ---

// 1. Setup Listener
function setupAbsenceHistory() {
    const historyBtn = document.getElementById('absence-history-btn');
    if (historyBtn) {
        historyBtn.addEventListener('click', showAbsenceHistoryDialog);
    }
    // My courses / All courses: choosing the other option toggles the filter.
    const scopeSwitch = document.getElementById('absence-filter-btn');
    if (scopeSwitch) {
        scopeSwitch.addEventListener('click', (event) => {
            const option = event.target.closest('button[data-scope]');
            if (option && option.getAttribute('aria-pressed') !== 'true') toggleAbsenceFilter();
        });
    }
}

function toggleAbsenceFilter() {
    hideOtherCourseAbsences = !hideOtherCourseAbsences;
    syncAbsenceFilterBtn();
    const tbody = document.getElementById('absences-tbody');
    if (tbody) {
        // Dim, never blank, while the list changes.
        tbody.style.transition = 'opacity 0.12s ease-out';
        tbody.style.opacity = '0.5';
        setTimeout(() => {
            renderAbsencesTable(cachedAbsences);
            tbody.style.transition = 'opacity 0.2s ease-out';
            tbody.style.opacity = '1';
        }, 120);
    } else {
        renderAbsencesTable(cachedAbsences);
    }
}

// Slides the thumb by toggling data-active; the switch itself is never re-rendered.
function syncAbsenceFilterBtn() {
    const scopeSwitch = document.getElementById('absence-filter-btn');
    if (!scopeSwitch) return;
    const scope = hideOtherCourseAbsences ? 'mine' : 'all';
    scopeSwitch.dataset.active = scope;
    scopeSwitch.title = hideOtherCourseAbsences ? 'Showing my courses only' : 'Showing all courses';
    scopeSwitch.querySelectorAll('button[data-scope]').forEach(option => {
        option.setAttribute('aria-pressed', String(option.dataset.scope === scope));
    });
}


async function showAbsenceHistoryDialog() {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.style.maxWidth = '900px';
    dialog.style.maxHeight = '85vh';
    dialog.setAttribute('role', 'dialog');

    dialog.innerHTML = `
    <div class="settings-modal-header">
        <h3 style="margin:0;"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Request History</h3>
        <button type="button" id="close-hist-btn" class="btn-icon icon-only-btn" title="Close" aria-label="Close history"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>
    <div class="dialog-content" style="overflow-y:auto; padding-top:0;">

        <div class="filter-container history-filter-bar">
            <div class="search filter-search">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input type="search" id="hist-search" class="filter-input" placeholder="Search name, course, date or reason..." aria-label="Search requests">
            </div>
            <select id="hist-filter-status" class="sort-dropdown" aria-label="Filter by status">
                <option value="All">All</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
            </select>
        </div>

        <div id="history-list-container" style="margin-top:15px;">
            <div class="loading-spinner" style="margin:40px auto;"></div>
        </div>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // Close Logic
    const close = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    dialog.querySelector('#close-hist-btn').onclick = close;

    // The sticky filter bar gains its glass backdrop only while it floats over the list.
    const historyScroller = dialog.querySelector('.dialog-content');
    const historyBar = dialog.querySelector('.history-filter-bar');
    let stuckFrame = 0;
    historyScroller.addEventListener('scroll', () => {
        if (stuckFrame) return;
        stuckFrame = requestAnimationFrame(() => {
            stuckFrame = 0;
            historyBar.classList.toggle('is-stuck', historyScroller.scrollTop > 0);
        });
    }, { passive: true });

    // Fetch Data
    try {
        const history = await callWebApp('getAbsenceHistory_Admin', {}, 'POST');
        const container = dialog.querySelector('#history-list-container');

        if (!history || history.length === 0) {
            container.innerHTML = `<div class="empty-logs">No requests found.</div>`;
            return;
        }

        const renderList = () => {
            const searchText = dialog.querySelector('#hist-search').value.trim().toLowerCase();
            const statusFilter = dialog.querySelector('#hist-filter-status').value;

            const filtered = history.filter(req => {
                const haystack = [req.studentName, req.studentEmail, req.course, String(req.course || '').replace(/_/g, ' '),
                    req.absenceDate, req.reasonType, req.session].map(value => String(value || '').toLowerCase());
                const matchesText = !searchText || haystack.some(value => value.includes(searchText));
                const matchesStatus = statusFilter === 'All' || req.status === statusFilter;
                return matchesText && matchesStatus;
            });

            if (filtered.length === 0) {
                container.innerHTML = `<div class="empty-logs">No requests match these filters.</div>`;
                return;
            }

            container.innerHTML = filtered.map(req => {
                // Determine status color/icon
                let statusBadge = '';
                if (req.status === 'Approved') statusBadge = `<span style="color:var(--success-color); font-weight:bold; font-size:0.85em; background:#e8f5e9; padding:2px 8px; border-radius:10px;">Approved</span>`;
                else if (req.status === 'Rejected') statusBadge = `<span style="color:var(--danger-color); font-weight:bold; font-size:0.85em; background:#ffebee; padding:2px 8px; border-radius:10px;">Rejected</span>`;
                else statusBadge = `<span style="color:var(--warning-color); font-weight:bold; font-size:0.85em; background:#fff3e0; padding:2px 8px; border-radius:10px;">Pending</span>`;

                // --- Session Badge ---
                let sessionBadge = '';
                if (req.session && req.session !== 'Default') {
                    sessionBadge = `<span class="session-badge">${escapeHtml(req.session)}</span>`;
                }

                return `
        <div class="request-list-item clickable-hist-row" style="border:1px solid #eee; padding:10px; margin-bottom:8px; border-radius:8px; cursor:pointer;">
            <div style="flex-grow:1;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <strong>${escapeHtml(req.studentName)}</strong>
                    ${statusBadge}
                </div>
                <div style="font-size:0.9em; color:#666; display:flex; align-items:center;">
                    ${escapeHtml(String(req.course || '').replace(/_/g, ' '))} ${sessionBadge}
                    <span style="margin:0 6px;">&bull;</span> 
                    ${escapeHtml(req.absenceDate)}
                </div>
                <div style="font-size:0.85em; opacity:0.7; margin-top:2px;">
                    ${escapeHtml(req.reasonType)}
                </div>
            </div>
        </div>`;
            }).join('');

            // Attach Click Listeners
            container.querySelectorAll('.clickable-hist-row').forEach((row, index) => {
                row.onclick = () => {
                    const req = filtered[index]; // Use filtered array index
                    showPermissionDetailsDialog({
                        requestId: req.requestID,
                        studentName: req.studentName,
                        studentEmail: req.studentEmail,
                        course: req.course,
                        session: req.session, // <--- Pass session
                        absenceDate: req.absenceDate,
                        hours: req.hours,
                        reasonType: req.reasonType,
                        description: req.description,
                        attachmentUrl: req.attachmentUrl
                    }, true); // true = readOnly
                };
            });
        };

        // Initial Render
        renderList();

        // Filter Listeners
        dialog.querySelector('#hist-search').addEventListener('input', renderList);
        dialog.querySelector('#hist-filter-status').addEventListener('change', renderList);

    } catch (e) {
        dialog.querySelector('#history-list-container').innerHTML = `<div class="error-message">Failed to load history: ${escapeHtml(e.message)}</div>`;
    }
}

/**
* Escapes HTML characters to prevent XSS attacks.
* @param {string} str - The raw string.
* @returns {string} The escaped string safe for innerHTML.
*/
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Pauses execution for a specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to sleep.
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function renderTableSkeletons() {
    const tbody = document.getElementById('logs-tbody');
    if (!tbody) return;

    let html = '';
    // Five rows matching the table: Name, Date, Time and, for the course's admins, Actions.
    const actionsCell = isAdminForCourse(currentCourse) ? '<td><span class="skeleton-bar short"></span></td>' : '';
    const selectCell = isBulkMode ? '<td class="select-column"></td>' : '';
    for (let i = 0; i < 5; i++) {
        html += `
        <tr class="skeleton-row">
            ${selectCell}<td><span class="skeleton-bar medium"></span></td><td class="date-column"><span class="skeleton-bar short"></span></td><td><span class="skeleton-bar medium"></span></td>${actionsCell}</tr>`;
    }
    tbody.innerHTML = html;

    // Also update the count to "..."
    const countEl = document.getElementById('filtered-count');
    if (countEl) countEl.textContent = '...';
}

/**
* Check admin status from server
*/
async function checkAdminStatus() {
    try {
        const result = await callWebApp('checkAdminStatus', {}, 'POST');

        isAdmin = result.isAdmin;
        isGlobalAdmin = result.isGlobalAdmin;
        adminCourses = result.courses;

        console.log('Admin status:', {
            isAdmin,
            isGlobalAdmin,
            courses: adminCourses
        });

        return result;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return { isAdmin: false, courses: [] };
    }
}

/**
 * Check if user is admin for specific course
 */
function isAdminForCourse(courseName) {
    if (isGlobalAdmin) return true; // Global admins have access to all
    return adminCourses.includes(courseName);
}

/**
 * Finds and removes all data related to this app from localStorage.
 */
function clearAllAppData() {
    const keysToRemove = [];
    // Find all keys used by this application.
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('attendance_') || key.startsWith('sb-') || key.startsWith('eis_pref_') || key.startsWith(SCAN_LOCK_KEY) || [KIOSK_MODE_KEY, 'theme', 'logs_sort', 'db_sort', 'last_active_course', 'stando_view'].includes(key)) {
            keysToRemove.push(key);
        }
    }

    // Remove the collected keys.
    keysToRemove.forEach(key => {
        localStorage.removeItem(key);
    });

    // Trigger exit animation if cat is visible
    const cat = document.getElementById('cat-companion');
    if (cat && cat.classList.contains('visible')) {
        cat.classList.remove('visible');
        // Wait for animation (500ms) before reloading
        setTimeout(() => {
            window.location.reload();
        }, 500);
    } else {
        // Refresh immediately if no cat
        window.location.reload();
    }
}

// Pending changes may belong to courses that are not loaded in this session.
function hasUnsyncedLocalChanges() {
    if (refreshPendingChanges()) return true;
    const accountPrefix = LOGS_STORAGE_KEY + '_account_';
    return Object.keys(localStorage).some(key => {
        if (!key.startsWith(LOGS_STORAGE_KEY + '_')) return false;
        try {
            const data = JSON.parse(localStorage.getItem(key));
            // Pre-account caches have no marker and are uploaded as pending.
            return key.startsWith(accountPrefix) ? data?.pending === true : data?.logs?.length > 0;
        } catch { return false; }
    });
}

// Clearing local data also discards attendance that has not reached the server.
function confirmClearAllAppData() {
    const unsynced = hasUnsyncedLocalChanges();
    showConfirmationDialog({
        title: '<i class="fa-solid fa-bomb" style="color:var(--danger-color);"></i> Clear local data?',
        message: unsynced
            ? '<strong>This device has attendance changes that are not synced yet.</strong> Clearing now deletes them permanently. Cancel and sync first unless you are sure.<br><br>You will also be signed out.'
            : 'This removes cached logs and preferences from this device and signs you out. Your data on the server is not affected.',
        confirmText: unsynced ? 'Delete unsynced changes' : 'Clear',
        isDestructive: true,
        onConfirm: clearAllAppData
    });
}

/**
 * Normalises a name string for reliable comparison.
 * Converts to lowercase and removes all accents from any character.
 * @param {string} str - The name string to normalise.
 * @returns {string} The normalised name.
 */
function normalizeName(str) {
    if (!str) return '';
    return str
        .toLowerCase() // 1. Make everything lowercase
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // 2. Separate accents from letters, then remove the accents
        .replace(/\s+/g, ' ') // 3. Clean up whitespace
        .trim(); // 4. Trim the ends
}

function updateScanClock() {
    const scanBtn = document.getElementById('scan-button');
    if (!scanBtn || !scanBtn.classList.contains('is-scanning')) return;

    // Get device time
    const now = new Date();
    // Format: 10:45 (or 10:45 PM depending on locale)
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    scanBtn.innerHTML = `
        <div class="scan-time-display">
            <span class="scan-time-digits">${timeString}</span>
            <span class="scan-time-text">Stop scanning</span>
        </div>`;
}

function updateAdminDashboardBar(absencesCount, registrationsCount, isLoading = false, myAbsencesCount = absencesCount) {
    const bar = document.getElementById('admin-dashboard-bar');

    // 1. Force Clean State if not global admin
    if (!isGlobalAdmin) {
        const regView = document.getElementById('pending-registrations-view');
        if (regView) regView.classList.remove('expanded');
    }

    if (!isAdmin || !bar) {
        if (bar) bar.style.display = 'none';
        return;
    }

    bar.style.display = 'flex';

    if (isLoading) {
        bar.innerHTML = `<div class="action-chip loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking requests...</div>`;
        return;
    }

    // Auto-drive filter state based on counts
    if (isGlobalAdmin && adminCourses.length > 0) {
        hideOtherCourseAbsences = myAbsencesCount > 0;
        const filterBtn = document.getElementById('absence-filter-btn');
        if (filterBtn) {
            filterBtn.style.display = absencesCount > myAbsencesCount ? '' : 'none';
            syncAbsenceFilterBtn();
        }
    }

    let html = '';

    // 2. Generate Chips
    if (absencesCount > 0) {
        const isAbsExpanded = document.getElementById('pending-absences-view')?.classList.contains('expanded') ? 'active' : '';
        if (myAbsencesCount > 0) {
            html += `
            <div class="action-chip has-items ${isAbsExpanded}" id="chip-absences" onclick="toggleAdminView('pending-absences-view', this)">
                <i class="fa-solid fa-hand-point-up"></i>
                <span>Requests for Permission</span>
                <span class="badge">${myAbsencesCount}</span>
            </div>`;
        } else {
            html += `
            <div class="action-chip ${isAbsExpanded}" id="chip-absences" onclick="toggleAdminView('pending-absences-view', this)">
                <i class="fa-solid fa-hand-point-up"></i>
                <span>Requests for Permission</span>
            </div>`;
        }
    }

    if (registrationsCount > 0 && isGlobalAdmin) {
        const isRegExpanded = document.getElementById('pending-registrations-view')?.classList.contains('expanded') ? 'active' : '';
        html += `
        <div class="action-chip has-items ${isRegExpanded}" id="chip-registrations" onclick="toggleAdminView('pending-registrations-view', this)">
            <i class="fa-solid fa-id-card"></i> 
            <span>Pending Registrations</span>
            <span class="badge">${registrationsCount}</span>
        </div>`;
    }

    // 3. "All Clean" State with Fade Out
    if (html === '') {
        // Only show if it wasn't already showing "All caught up" to prevent loop
        if (!bar.querySelector('.clean')) {
            html = `<div class="action-chip clean"><i class="fa-solid fa-check-circle"></i> All caught up</div>`;
            bar.innerHTML = html;

            // Trigger Fade Out after 2.5 seconds
            setTimeout(() => {
                const cleanChip = bar.querySelector('.clean');
                if (cleanChip) {
                    cleanChip.classList.add('fading-out'); // Add CSS animation class
                    // Remove from DOM after animation finishes (0.5s)
                    setTimeout(() => {
                        if (bar.contains(cleanChip)) bar.removeChild(cleanChip);
                    }, 500);
                }
            }, 2500);
        }
    } else {
        bar.innerHTML = html;
    }
}

function toggleAdminView(viewId, chipElement) {
    const view = document.getElementById(viewId);
    if (!view) return;

    const isExpanded = view.classList.contains('expanded');

    if (isExpanded) {
        view.classList.remove('expanded');
        if (chipElement) chipElement.classList.remove('active');
    } else {
        view.classList.add('expanded');
        if (chipElement) chipElement.classList.add('active');

        setTimeout(() => {
            view.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 300);
    }
}


/**
 * Adds a new log entry one hour after the latest existing entry for a group.
 * @param {Object} group - The log group to add the time to.
 */
function addPlusOneHourLog(group) {
    if (!isAdmin) return;

    // Find the full log object with the latest timestamp
    const latestLog = group.originalLogs.reduce((prev, current) =>
        (prev.timestamp > current.timestamp) ? prev : current
    );

    const newDate = new Date(latestLog.timestamp);
    newDate.setHours(newDate.getHours() + 1);

    let newLog = {
        uid: group.originalLogs[0]?.uid, // Use the group's main UID
        timestamp: newDate.getTime(),
        id: Date.now() + Math.random().toString(36).substring(2, 11),
        manual: true,
        session: latestLog.session || 'Default' // <--- COPY SESSION FROM LATEST LOG
    };

    newLog = touchLogForEdit(newLog, currentUser?.email);

    // Add log to the correct course data array
    courseData[currentCourse].logs.unshift(newLog);

    saveAndMarkChanges(currentCourse);

    updateUI();

    if (isOnline && isSignedIn && isAdmin) {
        syncLogsWithSheet().catch(err => {
            console.error('Error syncing after adding +1 hour log:', err);
        });
    }
}

window.buildUIDToPrimaryUidMap = function () {
    uidToPrimaryUidMap = {};

    // For each student in database (keyed by Index / dbKey)
    Object.keys(databaseMap).forEach(index => {
        const student = databaseMap[index];
        if (!student) return;

        // 1. Map Card IDs (uids array in Supabase)
        if (student.uids && Array.isArray(student.uids)) {
            student.uids.forEach(rawId => {
                const s = String(rawId || '').trim();
                if (!s) return;
                uidToPrimaryUidMap[s] = index;
                uidToPrimaryUidMap[s.toLowerCase()] = index;
                uidToPrimaryUidMap[s.toUpperCase()] = index;
                const convertedUid = convertExternalIdToUid(s);
                if (convertedUid && convertedUid !== s) {
                    uidToPrimaryUidMap[convertedUid] = index;
                }
            });
        }

        // 2. Map Hardware UIDs (hardware_uids array in Supabase)
        if (student.hardware_uids && Array.isArray(student.hardware_uids)) {
            student.hardware_uids.forEach(rawUid => {
                const s = String(rawUid || '').trim();
                if (!s) return;
                uidToPrimaryUidMap[s] = index;
                uidToPrimaryUidMap[s.toLowerCase()] = index;
                uidToPrimaryUidMap[s.toUpperCase()] = index;
                const convertedId = convertUidToExternalId(s);
                if (convertedId && convertedId !== s) {
                    uidToPrimaryUidMap[convertedId] = index;
                }
            });
        }
    });
};

/**
 * Converts a 4-byte NFC Card Hardware UID ("9a:0b:b6:88") to the decimal Card ID ("11930522")
 * by reversing the first 3 bytes and reading them as a big-endian hex number.
 */
function convertUidToExternalId(rawUid) {
    if (typeof rawUid !== 'string' && typeof rawUid !== 'number') return '';
    const s = String(rawUid).trim();
    const bytes = s.split(':');
    if (bytes.length !== 4 || !bytes.every(b => /^[0-9a-fA-F]{2}$/.test(b))) {
        return s;
    }
    const decimal = parseInt(bytes[2] + bytes[1] + bytes[0], 16);
    return isNaN(decimal) ? s : String(decimal);
}

/**
 * Converts a decimal Card ID ("11930522") to a 4-byte NFC Card Hardware UID ("9a:0b:b6:88").
 */
function convertExternalIdToUid(id) {
    if (!id && id !== 0) return '';
    const cleanId = String(id).trim();
    if (/^[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}:[0-9a-fA-F]{2}$/.test(cleanId)) {
        return cleanId.toLowerCase();
    }
    if (!/^\d+$/.test(cleanId)) return '';
    const num = Number(cleanId);
    if (!Number.isSafeInteger(num) || num <= 0) return '';
    const hex = num.toString(16).padStart(6, '0');
    if (hex.length > 6) return '';
    const b2 = hex.slice(0, 2);
    const b1 = hex.slice(2, 4);
    const b0 = hex.slice(4, 6);
    const b3 = (parseInt(b0, 16) ^ parseInt(b1, 16) ^ parseInt(b2, 16)).toString(16).padStart(2, '0');
    return `${b0}:${b1}:${b2}:${b3}`.toLowerCase();
}

// Dual lookup: matches raw Card UIDs, Card IDs, or cross-converted values
function lookupPrimaryUid(rawUid) {
    if (!rawUid) return null;
    const s = String(rawUid).trim();
    return uidToPrimaryUidMap[s] ||
        uidToPrimaryUidMap[s.toLowerCase()] ||
        uidToPrimaryUidMap[s.toUpperCase()] ||
        uidToPrimaryUidMap[convertUidToExternalId(s)] ||
        uidToPrimaryUidMap[convertExternalIdToUid(s)] || null;
}

// Cross-format equality for duplicate detection
function uidsEquivalent(a, b) {
    if (!a || !b) return false;
    const normA = String(a).trim().toLowerCase();
    const normB = String(b).trim().toLowerCase();
    return normA === normB ||
        convertUidToExternalId(normA) === normB ||
        normA === convertUidToExternalId(normB) ||
        convertExternalIdToUid(normA) === normB ||
        normA === convertExternalIdToUid(normB) ||
        convertUidToExternalId(normA) === convertUidToExternalId(normB);
}

/**
     * @returns {Array} The array of logs for the current course and user.
     */
function getLogsForCurrentUser() {
    if (!isSignedIn || !currentCourse) return [];
    return courseData[currentCourse]?.logs || [];
}

function addToTombstones(id, course = currentCourse) {
    // Ensure the data structure for the course exists.
    if (!courseData[course]) {
        courseData[course] = { logs: [], tombstones: new Set() };
    }
    // Add the ID to the in-memory tombstone set.
    courseData[course].tombstones.add(id);

    saveAndMarkChanges(course);
}

// Setup all event listeners in one place
function setupEventListeners() {
    // Set up tab navigation
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');
            const newTabContent = document.getElementById(tabId);
            const oldTabContent = document.querySelector('.tab-content.active');
            const courseButtons = document.getElementById('course-buttons-container');

            // Do nothing if clicking the already active tab
            if (oldTabContent === newTabContent) {
                return;
            }

            // Prevent non-global admins AND non-admins from accessing database tab
            if (tabId === 'database-tab' && !isGlobalAdmin) {
                return; // Only global admins can access database tab
            }

            // Hide or show the course buttons based on the selected tab
            if (courseButtons) {
                const sessionControls = document.getElementById('session-controls');

                if (tabId === 'database-tab') {
                    courseButtons.style.display = 'none';
                    if (sessionControls) sessionControls.style.display = 'none'; // <--- HIDE
                } else {
                    courseButtons.style.display = isSignedIn ? 'flex' : 'none';
                    // Only show session controls if a course is selected and has sections
                    if (sessionControls && currentCourse && courseInfoMap[currentCourse]?.availableSections) {
                        // Re-trigger render logic to decide if it should be visible
                        renderSessionControls(currentCourse);
                    }
                }
            }

            // Update the active state on the tab buttons
            document.querySelectorAll('.tab').forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            closeRowMenus();

            // Transition the content panes
            if (oldTabContent) {
                oldTabContent.classList.remove('active');
            }
            if (newTabContent) {
                newTabContent.classList.add('active');
            }
            // Show or hide the floating date bar for the tab now in view.
            if (typeof window._stickyDateScrollHandler === 'function') window._stickyDateScrollHandler();
        });
    });

    // Add this inside setupEventListeners()
    document.addEventListener('click', (e) => {
        // Only run if Bulk Mode is active
        if (isBulkMode) {
            const target = e.target;

            // Define safe zones (clicking here won't cancel)
            const isTable = target.closest('.logs-table');
            const isBulkBar = target.closest('#bulk-actions-bar');
            const isToggleBtn = target.closest('.logs-actions button'); // The toggle button itself
            const isDialog = target.closest('.dialog-backdrop'); // Don't cancel if a dialog is open

            // If clicked outside all safe zones, turn off bulk mode
            if (!isTable && !isBulkBar && !isToggleBtn && !isDialog) {
                toggleBulkMode();
            }
        }
    });

    // Button event listeners
    const importExcelBtn = document.getElementById('import-excel-btn');
    const excelInput = document.getElementById('excel-input');
    const filterInput = document.getElementById('filter-input');
    const sortSelect = document.getElementById('sort-select');
    const dbFilterInput = document.getElementById('db-filter-input');
    const importBtn = document.getElementById('import-btn');
    const importInput = document.getElementById('import-input');
    const exportBtn = document.getElementById('export-btn');
    const clearBtn = document.getElementById('clear-btn');
    const addLogBtn = document.getElementById('add-log-btn');
    const addEntryBtn = document.getElementById('add-entry-btn');
    const exportExcelBtn = document.getElementById('export-excel-btn');
    const clearDbBtn = document.getElementById('clear-db-btn');
    const syncBtn = document.getElementById('sync-btn');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const dbSortSelect = document.getElementById('db-sort-select');

    const registerUidBtn = document.getElementById('register-uid-btn');
    if (registerUidBtn) registerUidBtn.addEventListener('click', showRegisterUIDDialog);

    // The photo and name chip opens Settings, My Courses or the profile.
    const profileChip = document.getElementById('student-profile-chip');
    if (profileChip) profileChip.addEventListener('click', () => {
        if (!isSignedIn) return;
        if (isGlobalAdmin) showGlobalSettingsDialog();
        else if (isAdmin) showAdminProfileDialog();
        else showStudentProfileDialog();
    });

    // Div-based choices (tabs, course and section buttons) answer Enter and Space.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.matches('div[role="button"], div[role="tab"], div[role="checkbox"]')) return;
        event.preventDefault();
        target.click();
    });

    const requestPermissionBtn = document.getElementById('request-permission-btn');
    if (requestPermissionBtn) requestPermissionBtn.addEventListener('click', showRequestPermissionDialog);

    const scanBtn = document.getElementById('scan-button');
    if (scanBtn) {
        scanBtn.addEventListener('click', () => {
            // Check if the button is in the 'is-scanning' (stop) state
            if (scanBtn.classList.contains('is-scanning')) {
                stopScanning();
            } else {
                startScanningLocked();
            }
        });
    }

    document.addEventListener('focusin', (event) => {
        const target = event.target;
        // Check if the focus event happened on an input or textarea inside any of our dialogs.
        const isDialogInput = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && target.closest('.dialog');

        if (isDialogInput) {
            // When an input is focused, the mobile keyboard appears.
            // We wait a moment (300ms) for the keyboard animation to start and the viewport to resize.
            setTimeout(() => {
                // This command tells the browser to smoothly scroll the focused input 
                // into the center of the available view area.
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    });

    logsTbody.addEventListener('click', (event) => {
        const targetRow = event.target.closest('tr[data-key]');
        if (!targetRow) return;

        const key = targetRow.dataset.key;

        // Re-calculate the specific group data for the clicked row to ensure it's always correct
        const logsForCurrentCourse = getLogsForCurrentUser();
        const grouped = {};
        logsForCurrentCourse.forEach(log => {
            const dateObj = new Date(log.timestamp);
            if (isNaN(dateObj.getTime())) return;
            const scannedUid = log.uid;
            const dbKey = lookupPrimaryUid(scannedUid);

            const studentData = dbKey ? databaseMap[dbKey] : null;
            const name = studentData ? studentData.name : 'Unknown';
            const uidsForDisplay = studentData ? (studentData.hardware_uids || studentData.uids || [scannedUid]) : [scannedUid];

            const day = String(dateObj.getDate()).padStart(2, '0');
            const month = String(dateObj.getMonth() + 1).padStart(2, '0');
            const year = dateObj.getFullYear();
            const date = `${day}-${month}-${year}`;

            const groupKey = `${date}_${scannedUid}`;

            if (!grouped[groupKey]) {
                grouped[groupKey] = {
                    key: groupKey,
                    date,
                    dateObj,
                    uid: scannedUid,
                    dbKey: dbKey,
                    name: name,
                    studentData: studentData,
                    uidsForDisplay: uidsForDisplay,
                    originalLogs: []
                };
            }
            grouped[groupKey].originalLogs.push(log);
        });

        const group = grouped[key];
        if (!group) {
            console.error("Could not find group data for key:", key);
            return;
        }

        // Use reliable class-based detection for button clicks
        if (event.target.closest('.add-user-btn')) {
            // Use the first display UID which is the actual scanned UID for unknown users
            showAddEntryFromLog(group.uidsForDisplay[0]);
        } else if (event.target.closest('.add-time-btn')) {
            addPlusOneHourLog(group);
        } else if (event.target.closest('.delete-log-btn')) {
            confirmDeleteLog(group);
        } else if (event.target.closest('.edit-log-btn')) {
            showEditLogDialog(group);
        }
    });

    if (importExcelBtn) importExcelBtn.addEventListener('click', showStudentImportGuide);
    if (excelInput) excelInput.addEventListener('change', handleExcelFile);
    if (filterInput) filterInput.addEventListener('input', debounce(handleFilterChange, 300));
    if (sortSelect) sortSelect.addEventListener('change', handleSortChange);
    if (dbFilterInput) dbFilterInput.addEventListener('input', handleDbFilterChange);
    if (dbSortSelect) dbSortSelect.addEventListener('change', handleDbSortChange);
    if (importBtn) importBtn.addEventListener('click', () => importInput.click());
    if (importInput) importInput.addEventListener('change', handleImportFile);
    if (exportBtn) exportBtn.addEventListener('click', exportLogs);
    if (clearBtn) clearBtn.addEventListener('click', clearLogs);
    if (addLogBtn) addLogBtn.addEventListener('click', showAddLogEntryDialog);
    if (addEntryBtn) addEntryBtn.addEventListener('click', showAddEntryDialog);
    if (exportExcelBtn) exportExcelBtn.addEventListener('click', exportDatabaseToExcel);
    if (clearDbBtn) clearDbBtn.addEventListener('click', clearDatabase);
    if (loginBtn) {
        // Use direct event listener without arrow function to ensure proper 'this' binding
        loginBtn.addEventListener('click', handleAuthClick);
    } else {
        console.error('Login button not found!');
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleSignoutClick);
        logoutBtn.addEventListener('click', () => {
            const cat = document.getElementById('cat-companion');
            if (cat) {
                cat.classList.remove('visible');
                // Wait for transition to finish
                setTimeout(() => {
                    cat.style.display = 'none';
                }, 400);
            }
        });
    }

    // Table header sort listeners
    document.querySelectorAll('.logs-table .sortable').forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.getAttribute('data-sort');
            currentSort = (currentSort === `${sortKey}-asc`) ? `${sortKey}-desc` : `${sortKey}-asc`;
            logsCurrentPage = 1;
            localStorage.setItem('logs_sort', currentSort);
            sortSelect.value = currentSort;

            // Add the same logic here
            const logsTable = document.querySelector('.logs-table');
            if (currentSort.startsWith('date')) {
                logsTable.classList.add('sorting-by-date');
            } else {
                logsTable.classList.remove('sorting-by-date');
            }

            updateSortIcons();
            updateLogsList();
        });
    });

    // --- Database table sort listeners ---
    document.querySelectorAll('.database-table .sortable').forEach(header => {
        header.addEventListener('click', () => {
            const sortKey = header.getAttribute('data-sort');
            // Toggle direction or switch to the new sort key
            currentDbSort = (currentDbSort.startsWith(sortKey) && currentDbSort.endsWith('asc')) ? `${sortKey}-desc` : `${sortKey}-asc`;
            dbCurrentPage = 1;
            localStorage.setItem('db_sort', currentDbSort);
            document.getElementById('db-sort-select').value = currentDbSort;
            updateDbSortIcons(); // We will create this function next
            updateDatabaseList();
        });
    });
    setupAbsenceHistory();

    // --- Global Click Interceptor for Backdrop & Cancel/Close Buttons ---
    document.addEventListener('click', (e) => {
        // 1. Backdrop click
        if (e.target.classList && e.target.classList.contains('dialog-backdrop')) {
            // Ignore if clicking on confirmation backdrop itself
            if (e.target.classList.contains('confirmation-backdrop')) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            window.confirmCloseDialog(e.target);
            return;
        }

        // 2. Intercept Cancel / Close buttons inside any dialog (except confirmation modal)
        const confirmModal = e.target.closest('.confirmation-dialog, [role="alertdialog"]');
        if (confirmModal) return;

        const cancelBtn = e.target.closest(
            'button[id*="cancel"], button[id*="close"], .dialog-actions button.btn-red, ' +
            '#cancel-edit-c, #cancel-staff-btn, #cancel-trust-btn, #close-settings-btn, #cancel-reg-btn, ' +
            '#cancel-add-log-btn, #cancel-manual-btn, #cancel-custom-btn, #cancel-db-import-btn, ' +
            '#cancel-duplicate-btn, #cancel-request-btn, #cancel-approve-btn, #cancel-reject-btn, ' +
            '#cancel-details-btn, #close-details-btn, #cancel-add-btn'
        );

        if (cancelBtn) {
            const backdrop = cancelBtn.closest('.dialog-backdrop');
            if (backdrop && !backdrop.classList.contains('confirmation-backdrop')) {
                const dialog = backdrop.querySelector('.dialog') || backdrop;
                if (window.isDialogDirty(dialog)) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    window.confirmCloseDialog(backdrop);
                }
            }
        }
    }, true);

    // --- Global Keyboard Shortcuts (Escape & Ctrl+S) ---
    document.addEventListener('keydown', (e) => {
        // 1. Escape Key: Safe Close with Dirty Check
        if (e.key === 'Escape' || e.key === 'Esc') {
            const openBackdrops = document.querySelectorAll('.dialog-backdrop');
            if (openBackdrops.length > 0) {
                const topBackdrop = openBackdrops[openBackdrops.length - 1];
                if (topBackdrop.classList.contains('confirmation-backdrop')) {
                    topBackdrop.remove();
                    if (document.querySelectorAll('.dialog-backdrop').length === 0) closeDialogMode();
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                window.confirmCloseDialog(topBackdrop);
                return;
            }
        }

        // 2. Ctrl+S Key: Modal Save or Main Page Sync
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.code === 'KeyS')) {
            e.preventDefault();
            e.stopPropagation();

            const openBackdrops = document.querySelectorAll('.dialog-backdrop');
            if (openBackdrops.length > 0) {
                const topBackdrop = openBackdrops[openBackdrops.length - 1];
                const topDialog = topBackdrop.querySelector('.dialog') || topBackdrop;

                const saveBtn = topDialog.querySelector(
                    '.dialog-actions #save-edit-c, .dialog-actions #save-staff-btn, .dialog-actions #save-edit-log-btn, ' +
                    '.dialog-actions #confirm-db-entry-btn, .dialog-actions #confirm-add-btn, .dialog-actions #confirm-add-log-btn, ' +
                    '.dialog-actions #save-manual-log-btn, .dialog-actions #submit-register-btn, .dialog-actions #submit-request-btn, ' +
                    '.dialog-actions #dialog-confirm-btn, .dialog-actions #confirm-trust-btn, .dialog-actions #confirm-approve-btn, ' +
                    '.dialog-actions #apply-btn, .dialog-actions #replace-btn, .dialog-actions #merge-logs-btn, .dialog-actions #merge-db-btn, ' +
                    '.dialog-actions #save-settings-btn, .dialog-actions #save-custom-btn, .dialog-actions #confirm-reg-btn, ' +
                    '.dialog-actions button.btn-green, .dialog-actions .btn-green, .dialog-actions button[type="submit"], ' +
                    '#save-edit-c, #save-staff-btn, #save-edit-log-btn, #confirm-db-entry-btn, #confirm-add-btn, #confirm-add-log-btn, ' +
                    '#save-manual-log-btn, #submit-register-btn, #submit-request-btn, #dialog-confirm-btn'
                );

                if (saveBtn && !saveBtn.disabled && saveBtn.offsetParent !== null) {
                    saveBtn.click();
                }
                return;
            }

            // Main website refresh
            const activeTab = document.querySelector('.tab.active')?.getAttribute('data-tab');
            const targetRefreshBtnId = (activeTab === 'database-tab') ? 'database-refresh-btn' : 'scanner-refresh-btn';

            if (isAdmin) {
                syncData();
            } else if (typeof handleManualRefresh === 'function') {
                handleManualRefresh(targetRefreshBtnId);
            } else if (typeof syncData === 'function') {
                syncData();
            } else if (typeof updateUI === 'function') {
                updateUI();
            }
        }
    }, true);

    // Auto-snapshot input values and sync dialog scroll mode on dialog creation/removal
    const dialogObserver = new MutationObserver((mutations) => {
        syncDialogMode();
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    const backdrops = node.classList?.contains('dialog-backdrop') ? [node] : node.querySelectorAll?.('.dialog-backdrop');
                    if (backdrops && backdrops.length > 0) {
                        backdrops.forEach(bd => window.snapshotDialogInputs(bd));
                        setTimeout(() => {
                            backdrops.forEach(bd => window.snapshotDialogInputs(bd));
                            syncDialogMode();
                        }, 60);
                    }
                }
            });
            if (mutation.removedNodes && mutation.removedNodes.length > 0) {
                mutation.removedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    const backdrops = node.matches('.dialog-backdrop') ? [node] : node.querySelectorAll('.dialog-backdrop');
                    backdrops.forEach(backdrop => backdrop.dispatchEvent(new Event('dialogclose')));
                });
                syncDialogMode();
                setTimeout(syncDialogMode, 50);
            }
        });
    });
    dialogObserver.observe(document.body, { childList: true, subtree: true });
}

// --- Universal Dialog Dirty Checking & Unsaved Changes Protection ---
/**
 * Checks if a dialog has any unsaved changes or newly added input.
 */
function isDialogDirty(dialog) {
    if (!dialog) return false;

    // 1. Custom dirty check if dialog registered one
    if (typeof dialog._checkDirty === 'function') {
        try {
            if (dialog._checkDirty()) return true;
        } catch (err) {
            console.warn('Error in custom dialog dirty check:', err);
        }
    }

    // 2. Check all editable inputs, selects, textareas
    const inputs = dialog.querySelectorAll('input, select, textarea');
    for (const input of inputs) {
        if (input.id && (input.id.includes('search') || input.id.includes('filter'))) continue;
        if (input.disabled || input.readOnly) continue;

        if (input.type === 'checkbox' || input.type === 'radio') {
            const initial = (input._initialChecked !== undefined) ? input._initialChecked : input.defaultChecked;
            if (input.checked !== initial) return true;
        } else if (input.type === 'file') {
            if (input.files && input.files.length > 0) return true;
        } else {
            const initial = (input._initialValue !== undefined) ? input._initialValue : (input.defaultValue || '');
            const current = input.value || '';
            if (!initial.trim() && !current.trim()) continue;
            if (current !== initial) return true;
        }
    }

    // 3. Check for toggle buttons or reason cards changed from baseline
    const interactiveToggles = dialog.querySelectorAll('.toggle-button, .reason-card');
    for (const toggle of interactiveToggles) {
        if (toggle._initialActive !== undefined) {
            const isCurrentlyActive = toggle.classList.contains('active') || toggle.classList.contains('selected');
            if (isCurrentlyActive !== toggle._initialActive) return true;
        }
    }

    return false;
}
if (typeof window !== 'undefined') window.isDialogDirty = isDialogDirty;

/**
 * Snapshots the initial values of all inputs and toggles in a dialog.
 */
function snapshotDialogInputs(dialog) {
    if (!dialog) return;
    dialog.querySelectorAll('input, select, textarea').forEach(input => {
        if (input.type === 'checkbox' || input.type === 'radio') {
            input._initialChecked = input.checked;
        } else {
            input._initialValue = input.value;
        }
    });
    dialog.querySelectorAll('.toggle-button, .reason-card').forEach(toggle => {
        toggle._initialActive = toggle.classList.contains('active') || toggle.classList.contains('selected');
    });
}
if (typeof window !== 'undefined') window.snapshotDialogInputs = snapshotDialogInputs;

/**
 * Requests closing a dialog with unsaved changes protection.
 */
function confirmCloseDialog(backdropOrDialog, onDismiss) {
    if (!backdropOrDialog) return;
    const backdrop = backdropOrDialog.classList?.contains('dialog-backdrop')
        ? backdropOrDialog
        : backdropOrDialog.closest?.('.dialog-backdrop');
    const dialog = backdrop ? (backdrop.querySelector('.dialog') || backdrop) : backdropOrDialog;

    const performClose = () => {
        if (typeof onDismiss === 'function') {
            onDismiss();
        }
        if (backdrop && document.body.contains(backdrop)) {
            backdrop.dispatchEvent(new Event('dialogclose'));
            backdrop.remove();
            closeDialogMode();
        }
    };

    if (isDialogDirty(dialog)) {
        showConfirmationDialog({
            title: '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning-color);"></i> Discard Changes?',
            message: 'You have unsaved changes. Are you sure you want to discard them?',
            confirmText: 'Discard',
            cancelText: 'Keep Editing',
            isDestructive: true,
            onConfirm: performClose
        });
        return false;
    } else {
        performClose();
        return true;
    }
}
if (typeof window !== 'undefined') window.confirmCloseDialog = confirmCloseDialog;

// --- People: title-aware ordering and avatars ---

// Titles count only at the start of a name or after a comma ("Jane Doe, PhD"),
// so a surname such as "Ma" is not mistaken for one.
const TITLE_WORDS = new Set(['prof', 'professor', 'assoc', 'associate', 'asst', 'assist', 'assistant',
    'dr', 'phd', 'mr', 'mrs', 'ms', 'msc', 'ma', 'pm', 'ba', 'bsc', 'acad']);
function splitLecturerName(name) {
    const [main, ...after] = String(name || '').split(',');
    const words = main.trim().split(/\s+/).filter(Boolean);
    const key = word => word.toLowerCase().replace(/\./g, '');
    const titles = [];
    while (words.length > 1 && TITLE_WORDS.has(key(words[0]))) titles.push(key(words.shift()));
    for (const part of after) {
        const tokens = part.trim().split(/\s+/).map(key).filter(Boolean);
        if (tokens.length && tokens.every(t => TITLE_WORDS.has(t))) titles.push(...tokens);
    }
    return { titles, name: words.join(' ') };
}
function lecturerTitleRank(name) {
    const titles = new Set(splitLecturerName(name).titles);
    if (titles.has('assoc') || titles.has('associate')) return 2;
    if (titles.has('asst') || titles.has('assist') || titles.has('assistant')) return 2.5;
    if (titles.has('prof') || titles.has('professor')) return 1;
    if (titles.has('dr') || titles.has('phd')) return 3;
    if (['mr', 'mrs', 'ms', 'msc', 'ma', 'pm'].some(t => titles.has(t))) return 4;
    if (titles.has('ba') || titles.has('bsc')) return 5;
    return 6;
}
function compareLecturers(a, b) {
    return lecturerTitleRank(a) - lecturerTitleRank(b) ||
        splitLecturerName(a).name.localeCompare(splitLecturerName(b).name, undefined, { sensitivity: 'base' }) ||
        String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
}

// Initials sit underneath the photo, so a missing or broken photo shows them instead.
function avatarInitials(name) {
    return String(splitLecturerName(name).name || name || '').split(/[\s@._-]+/).filter(Boolean)
        .slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase();
}
function avatarContentHtml(name, photo) {
    return escapeHtml(avatarInitials(name)) + (photo
        ? `<img src="${escapeHtml(photo)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">`
        : '');
}
function userAvatarHtml(name, photo, className = 'user-avatar') {
    return `<span class="${className}" aria-hidden="true">${avatarContentHtml(name, photo)}</span>`;
}

// --- Row actions: a quiet Edit and a ⋯ menu (Delete is never one tap away) ---

function rowEditButtonHtml(label, className = '', attrs = '') {
    return `<button type="button" class="row-edit-btn ${className}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" ${attrs}><i class="fa-solid fa-pen" aria-hidden="true"></i><span>Edit</span></button>`;
}

// items: [{ label, icon, className, attrs, danger }]. Items keep the classes and
// data attributes of the buttons they replace, so existing handlers still apply.
function rowMenuHtml(items, label = 'More actions') {
    return `<div class="row-menu">
        <button type="button" class="row-menu-btn" aria-haspopup="menu" aria-expanded="false" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><i class="fa-solid fa-ellipsis" aria-hidden="true"></i></button>
        <div class="row-menu-list" role="menu" hidden>${items.map(item =>
        `<button type="button" role="menuitem" class="${item.className || ''}${item.danger ? ' is-danger' : ''}" ${item.attrs || ''}><i class="${item.icon}" aria-hidden="true"></i>${escapeHtml(item.label)}</button>`).join('')}</div>
    </div>`;
}

// An open menu is moved to <body> and fixed to the viewport, so tables, dialogs
// and transformed containers never clip or offset it. It returns to its row on close.
function closeRowMenus() {
    document.querySelectorAll('.row-menu-list:not([hidden])').forEach(list => {
        const home = list._home;
        list.hidden = true;
        list._home = null;
        home?.querySelector('.row-menu-btn')?.setAttribute('aria-expanded', 'false');
        if (home?.isConnected) home.appendChild(list);
        else list.remove();
    });
}

function toggleRowMenu(button) {
    const wasOpen = button.getAttribute('aria-expanded') === 'true';
    closeRowMenus();
    const menu = button.closest('.row-menu');
    const list = menu?.querySelector(':scope > .row-menu-list');
    if (wasOpen || !list) return;
    list._home = menu;
    document.body.appendChild(list);
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const r = button.getBoundingClientRect();
    const width = list.offsetWidth, height = list.offsetHeight;
    const viewWidth = document.documentElement.clientWidth, viewHeight = window.innerHeight;
    list.style.left = `${Math.max(8, Math.min(r.right - width, viewWidth - width - 8))}px`;
    const below = r.bottom + 6;
    list.style.top = `${below + height > viewHeight - 8 ? Math.max(8, r.top - 6 - height) : below}px`;
    list.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}

function setupRowMenus() {
    // Capture on window runs before the page's own document handlers.
    window.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        const toggle = target?.closest('.row-menu-btn');
        if (toggle) { toggleRowMenu(toggle); return; }
        const item = target?.closest('.row-menu-list [role="menuitem"]');
        const list = item?.closest('.row-menu-list');
        if (item && list?._home) {
            // Run the item from its row, so row and table handlers see the click.
            // dispatchEvent, not click(): click() is ignored while this click is still in progress.
            event.preventDefault();
            event.stopImmediatePropagation();
            closeRowMenus();
            if (!item.disabled) item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return;
        }
        if (!target?.closest('.row-menu-list')) closeRowMenus();
    }, true);
    window.addEventListener('keydown', event => {
        const open = document.querySelector('.row-menu-list:not([hidden])');
        if (!open) return;
        if (event.key === 'Escape') {
            // Close the menu only, not the dialog underneath it.
            event.preventDefault();
            event.stopImmediatePropagation();
            const button = open._home?.querySelector('.row-menu-btn');
            closeRowMenus();
            button?.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const items = [...open.querySelectorAll('[role="menuitem"]:not(:disabled)')];
            const index = items.indexOf(document.activeElement);
            event.preventDefault();
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        } else if (event.key === 'Tab') {
            closeRowMenus();
        }
    }, true);
    document.addEventListener('scroll', closeRowMenus, { capture: true, passive: true });
    window.addEventListener('resize', closeRowMenus, { passive: true });
}

// --- Courses: display order (newest academic year, Summer → Spring → Fall, then code) ---

const TERM_ORDER = { Summer: 0, Spring: 1, Fall: 2 };
// Fall opens an academic year; Spring and Summer close it.
function courseTerm(info) {
    const raw = String(info?.startDate || '').trim();
    if (!raw) return null;
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const date = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(raw);
    if (isNaN(date.getTime())) return null;
    const year = date.getFullYear(), month = date.getMonth() + 1;
    const season = month >= 8 ? 'Fall' : month <= 5 ? 'Spring' : 'Summer';
    const academicStart = season === 'Fall' ? year : year - 1;
    return {
        season,
        academicStart,
        academicYear: `${academicStart}–${academicStart + 1}`,
        label: `${season} ${year}`,
        date
    };
}

function compareCoursesForDisplay(aEntry, bEntry) {
    const a = courseTerm(aEntry[1]), b = courseTerm(bEntry[1]);
    if (a && b) {
        if (a.academicStart !== b.academicStart) return b.academicStart - a.academicStart;
        if (a.season !== b.season) return TERM_ORDER[a.season] - TERM_ORDER[b.season];
    } else if (a || b) {
        return a ? -1 : 1; // Courses without a term come last.
    }
    return courseCodeComparator(aEntry, bEntry);
}

// --- 3. Non-Global Admin Profile & Settings ---
function showGlobalSettingsDialog() {
    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog settings-dialog');
    dialog.style.maxWidth = '1000px';
    dialog.style.height = '85vh';
    dialog.setAttribute('role', 'dialog');

    // --- Variables for Bomb ---
    let avatarClickCount = 0;
    let lastAvatarClickTime = 0;

    // --- HTML STRUCTURE ---
    dialog.innerHTML = `
    <div class="settings-modal-header">
        <div class="settings-modal-identity">
            <div class="settings-avatar" id="admin-profile-pic-container">
                ${userAvatarHtml(currentUserDisplayName(), currentUser.picture, 'user-avatar user-avatar-lg')}
            </div>
            <div class="settings-modal-heading">
                <h3>Settings</h3>
                <div class="settings-modal-sub">Administrator</div>
            </div>
        </div>
        <button type="button" id="close-settings-btn" class="btn-icon icon-only-btn" title="Close" aria-label="Close settings"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>

    <div class="settings-tabs-container" role="tablist">
        <button type="button" class="settings-tab-btn active" data-target="sect-courses" role="tab" aria-selected="true"><i class="fa-solid fa-book-open tab-icon" aria-hidden="true"></i><span class="tab-label" data-label="Courses">Courses</span></button>
        <button type="button" class="settings-tab-btn" data-target="sect-staff" role="tab" aria-selected="false"><i class="fa-solid fa-user-tie tab-icon" aria-hidden="true"></i><span class="tab-label" data-label="Staff">Staff</span></button>
        <button type="button" class="settings-tab-btn" data-target="sect-devices" role="tab" aria-selected="false"><i class="fa-solid fa-laptop-code tab-icon" aria-hidden="true"></i><span class="tab-label" data-label="Trusted Devices">Trusted Devices</span></button>
    </div>

    <div class="dialog-content" style="padding:0; position:relative; display:flex; flex-direction:column; overflow:hidden;">

        <div id="settings-loader" class="settings-loader-overlay">
            <div class="loading-spinner"></div>
        </div>

        <div id="sect-courses" class="settings-section" style="display:flex; flex-direction:column; height:100%;">
            <div class="settings-controls-bar">
                <div class="input-with-icon search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input type="search" id="course-search-input" class="settings-search-input" placeholder="Search courses..." aria-label="Search courses">
                </div>
                ${settingsSortSelectHtml('settings-course-sort')}
                <button type="button" id="add-new-course-btn" class="btn-green btn-sm" title="New course" aria-label="New course">
                    <i class="fa-solid fa-plus" aria-hidden="true"></i><span class="btn-text">New Course</span>
                </button>
            </div>
            <div class="settings-scroll" id="settings-courses-container"></div>
        </div>

        <div id="sect-staff" class="settings-section" style="display:none; flex-direction:column; height:100%;">
            <div class="settings-controls-bar">
                <div class="input-with-icon search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input type="search" id="staff-search-input" class="settings-search-input" placeholder="Search staff..." aria-label="Search staff">
                </div>
                <button type="button" id="add-staff-btn" class="btn-green btn-sm" title="Add staff" aria-label="Add staff">
                    <i class="fa-solid fa-user-plus" aria-hidden="true"></i><span class="btn-text">Add Staff</span>
                </button>
            </div>
            <div class="settings-scroll" id="settings-staff-container"></div>
        </div>

        <div id="sect-devices" class="settings-section" style="display:none; flex-direction:column; height:100%;">
            <div class="settings-scroll">
                <div class="settings-device-note">
                    <div class="settings-device-id">
                        <strong>This device</strong>
                        <small class="selectable">${escapeHtml(getDeviceFingerprint())}</small>
                    </div>
                    <button type="button" id="register-this-device-btn" class="btn-blue btn-sm">
                        <i class="fa-solid fa-fingerprint" aria-hidden="true"></i> Register This Device
                    </button>
                </div>
                <div class="settings-group-label">Trusted devices</div>
                <div id="devices-tbody" class="settings-list"></div>
            </div>
        </div>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    StandoWebsite.addDownloadControl(dialog.querySelector('#sect-courses'), { forGlobalAdmin: true });

    // --- BOMB LOGIC (Restored) ---
    const profilePicContainer = dialog.querySelector('#admin-profile-pic-container');
    if (profilePicContainer) {
        profilePicContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            const now = Date.now();
            if (now - lastAvatarClickTime > 1000) avatarClickCount = 0;
            lastAvatarClickTime = now;
            avatarClickCount++;
            if (avatarClickCount === 5) {
                profilePicContainer.innerHTML = `<div style="width:100%; height:100%; border-radius:50%; background:#f44336; display:flex; align-items:center; justify-content:center; color:white; font-size:2em;"><i class="fa-solid fa-bomb"></i></div>`;
                profilePicContainer.onclick = confirmClearAllAppData;
                avatarClickCount = 0;
            }
        });
    }

    // --- LOGIC ---

    // 1. Tab Switching with Dirty Form Check
    dialog.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;

            // Check if active section has dirty inputs
            const activeSection = dialog.querySelector('.settings-section[style*="display: flex"], .settings-section[style*="display:flex"]');
            let isSectionDirty = false;
            if (activeSection) {
                const inputs = activeSection.querySelectorAll('input, select, textarea');
                for (const input of inputs) {
                    if (input.id && (input.id.includes('search') || input.id.includes('filter'))) continue;
                    if (input.disabled || input.readOnly) continue;
                    if (input.type === 'checkbox' || input.type === 'radio') {
                        if (input._initialChecked !== undefined && input.checked !== input._initialChecked) {
                            isSectionDirty = true; break;
                        }
                    } else if (input._initialValue !== undefined && input.value !== input._initialValue) {
                        isSectionDirty = true; break;
                    }
                }
            }

            // The header and tabs stay put; only the section's content fades in.
            const switchTab = () => {
                closeRowMenus();
                dialog.querySelectorAll('.settings-tab-btn').forEach(b => {
                    b.classList.remove('active');
                    b.setAttribute('aria-selected', 'false');
                });
                dialog.querySelectorAll('.settings-section').forEach(s => s.style.display = 'none');
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');
                const target = document.getElementById(btn.dataset.target);
                if (target) {
                    target.classList.remove('loaded');
                    target.style.display = 'flex';
                    void target.offsetWidth;
                    target.classList.add('loaded');
                }
            };

            if (isSectionDirty) {
                showConfirmationDialog({
                    title: '<i class="fa-solid fa-triangle-exclamation" style="color:var(--warning-color);"></i> Discard Changes?',
                    message: 'You have unsaved changes in this tab. Are you sure you want to discard them?',
                    confirmText: 'Discard',
                    cancelText: 'Keep Editing',
                    isDestructive: true,
                    onConfirm: switchTab
                });
            } else {
                switchTab();
            }
        });
    });

    // 2. Search Listeners
    const searchInput = document.getElementById('course-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderCoursesInSettings(courseInfoMap, e.target.value);
        });
    }
    bindSettingsSortSelect(dialog.querySelector('#settings-course-sort'),
        () => renderCoursesInSettings(courseInfoMap, searchInput ? searchInput.value : ''));

    let loadedStaffList = [];
    const staffSearchInput = document.getElementById('staff-search-input');
    if (staffSearchInput) {
        staffSearchInput.addEventListener('input', (e) => {
            renderStaffInSettings(loadedStaffList, e.target.value);
        });
    }

    // 3. Load Data
    const loadSettingsData = async () => {
        try {
            const [courseInfo, globalData] = await Promise.all([
                callWebApp('getCourseInfo', {}, 'POST'),
                callWebApp('getGlobalSettingsData', {}, 'POST')
            ]);

            const loader = document.getElementById('settings-loader');
            if (loader) loader.style.display = 'none';

            courseInfoMap = courseInfo;
            loadedStaffList = globalData.staff || [];
            // Course rows show lecturers by name where the staff list knows them.
            settingsStaffNames = new Map(loadedStaffList
                .filter(s => s && s.email && (s.name || s.googleName))
                .map(s => [String(s.email).trim().toLowerCase(), staffDisplayName(s)]));

            // Render Courses
            renderCoursesInSettings(courseInfo);

            // Render Staff (Grouped by position & sorted alphabetically ignoring titles)
            renderStaffInSettings(loadedStaffList);

            // --- RENDER DEVICES (Safe Mode) ---
            const deviceBody = document.getElementById('devices-tbody');
            if (deviceBody && globalData.devices) {
                const myId = getDeviceFingerprint();
                const isRegistered = globalData.devices.some(d => d.id === myId);

                const regBtn = document.getElementById('register-this-device-btn');
                if (isRegistered && regBtn) {
                    regBtn.disabled = true;
                    regBtn.innerHTML = '<i class="fa-solid fa-check-circle"></i> Trusted';
                    regBtn.classList.replace('btn-blue', 'btn-green');
                }

                deviceBody.innerHTML = globalData.devices.length ? globalData.devices.map(d => `
                <div class="settings-row${d.id === myId ? ' is-selected' : ''}">
                    <div class="settings-row-main">
                        <span class="settings-row-title">${escapeHtml(d.name)}${d.id === myId ? ' <span class="settings-row-state">This device</span>' : ''}</span>
                        <span class="settings-row-people">${escapeHtml(d.owner)}</span>
                    </div>
                    <div class="settings-row-meta">
                        <span class="settings-row-sub">${escapeHtml(d.date)}</span>
                    </div>
                    <div class="card-actions">
                        ${rowMenuHtml([{
                            label: 'Remove device', icon: 'fa-solid fa-trash', danger: true, className: 'delete-device-btn',
                            attrs: `data-row-index="${escapeHtml(String(d.rowIndex))}" data-name="${escapeHtml(d.name)}"`
                        }], `More actions for ${d.name}`)}
                    </div>
                </div>
            `).join('') : '<div class="settings-empty">No trusted devices.</div>';

                // Attach Device Listeners (The Critical Fix)
                deviceBody.querySelectorAll('.delete-device-btn').forEach(btn => {
                    btn.onclick = () => window.deleteTrustedDevice(btn.dataset.rowIndex, btn.dataset.name);
                });
            }

        } catch (e) {
            console.error(e);
            showNotification('error', 'Error', 'Failed to load settings: ' + e.message);
            const loader = document.getElementById('settings-loader');
            if (loader) loader.style.display = 'none';
        }
    };

    loadSettingsData();

    // 4. Action Buttons
    document.getElementById('register-this-device-btn').onclick = () => {
        const dialogBackdrop = document.createElement('div');
        dialogBackdrop.setAttribute('class', 'dialog-backdrop');
        dialogBackdrop.style.zIndex = "10010";

        const dialog = document.createElement('div');
        dialog.setAttribute('class', 'dialog');
        dialog.setAttribute('role', 'dialog');

        dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-laptop-medical"></i> Trust This Device</h3>
        <div class="dialog-content">
            <p>Give this device a friendly name (e.g., "A-131 Tablet").</p>
            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-quote-right"></i> Name</label>
                <input type="text" id="new-device-name" class="form-control" placeholder="Device Name">
            </div>
        </div>
        <div class="dialog-actions">
            <button id="cancel-trust-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="confirm-trust-btn" class="btn-green"><i class="fa-solid fa-check"></i> Trust</button>
        </div>
    `;

        dialogBackdrop.appendChild(dialog);
        document.body.appendChild(dialogBackdrop);

        setTimeout(() => dialog.querySelector('#new-device-name').focus(), 100);

        const closeTrust = () => dialogBackdrop.remove();

        dialog.querySelector('#cancel-trust-btn').onclick = closeTrust;

        dialog.querySelector('#confirm-trust-btn').onclick = async (e) => {
            const name = dialog.querySelector('#new-device-name').value.trim();
            if (!name) {
                showNotification('warning', 'Name Required', 'Please enter a device name.');
                return;
            }

            const btn = e.target;
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';

            try {
                await callWebApp('registerDevice_Admin', {
                    deviceName: name,
                    deviceId: getDeviceFingerprint()
                }, 'POST');

                showNotification('success', 'Registered', 'Device is now trusted.');

                document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                closeDialogMode();

                showGlobalSettingsDialog();

                setTimeout(() => {
                    const tab = document.querySelector('.settings-tab-btn[data-target="sect-devices"]');
                    if (tab) tab.click();
                }, 100);

            } catch (err) {
                showNotification('error', 'Error', err.message);
                closeTrust();
            }
        };
    };

    document.getElementById('add-staff-btn').onclick = () => showStaffEditorDialog(null);
    document.getElementById('add-new-course-btn').onclick = () => showCourseEditorDialog(null);

    const close = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };
    document.getElementById('close-settings-btn').onclick = close;
}

/**
* Bridges the HTML onclick event to the Editor Dialog.
*/
window.editStaffKey = (rowIndex, name, uid, email, role, googleName = '') => {
    showStaffEditorDialog({
        rowIndex: rowIndex,
        name: name,
        uid: uid,
        email: email,
        role: role,
        googleName: googleName
    });
};

window.deleteTrustedDevice = (rowIndex, name) => {
    showConfirmationDialog({
        title: '<i class="fa-solid fa-laptop-slash" style="color:var(--danger-color);"></i> Untrust Device?',
        message: `Are you sure you want to remove <strong>${escapeHtml(name)}</strong>? It will require a Google Login to re-register.`,
        confirmText: '<i class="fa-solid fa-trash"></i> Untrust', // Added Icon
        cancelText: '<i class="fa-solid fa-xmark"></i> Cancel',   // Added Icon
        isDestructive: true,
        onConfirm: () => {
            callWebApp('deleteDevice_Admin', { rowIndex }, 'POST')
                .then(() => {
                    document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                    closeDialogMode();

                    showGlobalSettingsDialog();

                    // Auto-switch back to "Devices" tab
                    setTimeout(() => {
                        const tab = document.querySelector('.settings-tab-btn[data-target="sect-devices"]');
                        if (tab) tab.click();
                    }, 100);
                })
                .catch(err => showNotification('error', 'Error', err.message));
        }
    });
};

window.deleteStaffKey = (rowIndex, name) => {
    showConfirmationDialog({
        title: '<i class="fa-solid fa-user-xmark" style="color:var(--danger-color);"></i> Revoke Access?',
        message: `Are you sure you want to revoke key for <strong>${escapeHtml(name)}</strong>? They will no longer be able to log in via NFC.`,
        confirmText: '<i class="fa-solid fa-trash"></i> Revoke', // Added Icon
        cancelText: '<i class="fa-solid fa-xmark"></i> Cancel',   // Added Icon
        isDestructive: true,
        onConfirm: () => {
            callWebApp('manageStaff_Admin', { actionType: 'delete', rowIndex }, 'POST')
                .then(() => {
                    document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                    closeDialogMode();

                    showGlobalSettingsDialog();

                    // Auto-switch back to "Staff" tab
                    setTimeout(() => {
                        const tab = document.querySelector('.settings-tab-btn[data-target="sect-staff"]');
                        if (tab) tab.click();
                    }, 100);
                })
                .catch(err => showNotification('error', 'Error', err.message));
        }
    });
};


// // --- 2. Course Editor (Renaming Support + Clean Code + Validation) ---
function showCourseEditorDialog(courseName, courseData = null) {
    const isNew = !courseName;
    const title = isNew ? 'New Course' : 'Edit Course';
    const data = courseData || {};
    const val = (v) => v !== undefined && v !== null ? v : '';

    // 1. LOGIC: Display clean course code (strip internal archive/EIS ID suffix)
    const cleanCourseName = isNew ? '' : getCleanCourseCode(courseName, data.eisId);
    const displayCourseName = cleanCourseName;

    const formatDate = (d) => {
        if (!d) return '';
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
        try {
            const date = new Date(d);
            if (isNaN(date.getTime())) return '';
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        } catch (e) { return ''; }
    };

    const canEditSensitive = isGlobalAdmin;
    const disabledAttr = canEditSensitive ? '' : 'disabled';
    const readOnlyStyle = canEditSensitive ? '' : 'style="background-color:#f5f5f5; color:#666; cursor:not-allowed;"';

    let currentSections = [];
    if (data.availableSections) {
        currentSections = data.availableSections.split(',').map(s => s.trim()).filter(Boolean);
    }

    let currentAdmins = new Set();
    if (data.adminEmails) {
        data.adminEmails.split(',').forEach(e => currentAdmins.add(e.trim().toLowerCase()));
    }

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    dialogBackdrop.style.zIndex = "10002";
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');

    // --- ADMIN ACCESS HTML ---
    let adminSectionHtml = '';
    if (isGlobalAdmin) {
        adminSectionHtml = `
        <div class="form-group" style="margin-bottom:5px; margin-top:15px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-user-shield"></i> Admins</label>
            <div class="input-with-icon" style="flex-grow:1;">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="admin-search-input" class="form-control" placeholder="Search staff...">
            </div>
        </div>
        
        <div style="position:relative;">
            <div id="admin-staff-loader" style="position:absolute; inset:0; display:flex; justify-content:center; align-items:center; z-index:10; background:var(--card-background); border-radius:8px;">
                <div class="loading-spinner" style="width:30px; height:30px; border-width:3px; margin:0;"></div>
            </div>
            <div id="admin-selection-list" class="student-list-container" style="margin-left:115px; height:200px; min-height:160px; margin-bottom:5px;"></div>
        </div>
        <div id="admin-count-hint" style="text-align:right; font-size:0.85em; color:var(--primary-color); font-weight:600;">${currentAdmins.size} selected</div>
        <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">`;
    }

    let eisWarning = !isGlobalAdmin ? `<small style="color:var(--warning-color); display:block; margin-top:4px;"><i class="fa-solid fa-lock"></i> Admin only.</small>` : '';

    let groupButtonsHtml = '';
    for (let i = 0; i < 4; i++) {
        const char = String.fromCharCode(65 + i);
        groupButtonsHtml += `<div class="course-button" data-val="${char}" role="button" tabindex="0" style="min-width:35px; padding:6px 0; font-size:0.9em;"><b>${char}</b></div>`;
    }

    dialog.innerHTML = `
    <h3 class="dialog-title"><i class="fa-solid fa-book-open"></i> ${title}</h3>
    <div class="dialog-content">
        
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-heading"></i> Course Code</label>
            <div class="input-with-icon" style="flex-grow:1;">
                <i class="fa-solid fa-font"></i>
                <input id="edit-c-name" class="form-control" value="${escapeHtml(displayCourseName)}" ${disabledAttr} placeholder="e.g. CE 101">
            </div>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-fingerprint"></i> EIS ID</label>
            <div style="flex-grow:1;">
                <div class="input-with-icon">
                    <i class="fa-solid fa-id-badge"></i>
                    <input id="edit-c-eis" class="form-control" value="${escapeHtml(val(data.eisId))}" placeholder="e.g. 12345" ${disabledAttr} ${readOnlyStyle}>
                </div>
                ${eisWarning}
            </div>
        </div>
        
        <div class="form-group" style="align-items:flex-start; margin-top: 15px;">
            <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-layer-group"></i> Sections</label>
            
            <div style="flex-grow:1; min-width:0; display:flex; flex-direction:column; gap:10px;">
                <div id="section-builder-list" class="admin-pills-list" style="width:100%; box-sizing:border-box; min-height:40px; border-radius:8px; padding:5px; font-size:0.85em;"></div>

                <div class="admin-tool-bar" style="flex-direction:column; gap:8px; align-items:stretch; padding:10px;">
                    <div id="new-sec-cat" class="course-buttons-container segmented-choices" style="margin:0; width:100%; display:flex;">
                        <div class="course-button active" data-val="Theory" role="button" tabindex="0" style="flex:1; text-align:center; padding:6px; font-size:0.85em; min-width:0;"><i class="fa-solid fa-book tab-icon" aria-hidden="true"></i><span class="tab-label" data-label="Theory">Theory</span></div>
                        <div class="course-button" data-val="Lab" role="button" tabindex="0" style="flex:1; text-align:center; padding:6px; font-size:0.85em; min-width:0;"><i class="fa-solid fa-desktop tab-icon" aria-hidden="true"></i><span class="tab-label" data-label="Lab">Lab</span></div>
                        <div class="course-button" data-val="Practice" role="button" tabindex="0" style="flex:1; text-align:center; padding:6px; font-size:0.85em; min-width:0;"><i class="fa-solid fa-pen-to-square tab-icon" aria-hidden="true"></i><span class="tab-label" data-label="Practice">Practice</span></div>
                    </div>
                    <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                        <div id="new-sec-grp" class="course-buttons-container segmented-choices" style="margin:0; flex-wrap:nowrap; flex:1;">
                            ${groupButtonsHtml}
                        </div>
                        <button id="btn-add-section" class="btn-green btn-sm" style="padding:8px 15px; flex-shrink:0; margin-left:10px; font-size:0.85em;">
                            <i class="fa-solid fa-plus"></i> Add
                        </button>
                    </div>
                </div>
            </div>
        </div>

        ${adminSectionHtml}

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-calendar"></i> Start Date</label>
            <input type="date" id="edit-c-start" class="form-control" value="${formatDate(data.startDate)}" ${disabledAttr} ${readOnlyStyle}>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-calendar-check"></i> End Date</label>
            <input type="date" id="edit-c-end" class="form-control" value="${formatDate(data.endDate)}" ${disabledAttr} ${readOnlyStyle}>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-plane-departure"></i> Hol. Start</label>
            <input type="date" id="edit-c-holiday-start" class="form-control" value="${formatDate(data.holidayStartDate)}" ${disabledAttr} ${readOnlyStyle}>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-calendar-minus"></i> Hol. Weeks</label>
            <div class="input-with-icon" style="flex-grow:1;">
                <i class="fa-solid fa-hashtag"></i>
                <input type="number" id="edit-c-holidays" class="form-control" value="${escapeHtml(val(data.holidayWeeks))}" ${disabledAttr} ${readOnlyStyle}>
            </div>
        </div>

        ${(!isNew && isGlobalAdmin) ? `
        <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
        <div class="form-group" style="align-items:center;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-box-archive"></i> Archive</label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; flex-grow:1;">
                <input type="checkbox" id="edit-c-archived" ${data.archived ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--warning-color);">
                <span style="font-size:0.9em; opacity:0.7;">Archive this course (hide from active list)</span>
            </label>
        </div>` : ''}

    </div>
    <div class="dialog-actions">
        ${(!isNew && isGlobalAdmin) ? '<button type="button" id="delete-course-btn" class="btn-red tint-danger" style="margin-right:auto;"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>' : ''}
        <button id="cancel-edit-c" class="btn-blue"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="save-edit-c" class="btn-green"><i class="fa-solid fa-floppy-disk"></i> Save</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- Section Builder Logic ---
    const sectionListContainer = document.getElementById('section-builder-list');
    const catContainer = document.getElementById('new-sec-cat');
    const grpContainer = document.getElementById('new-sec-grp');
    const addSectionBtn = document.getElementById('btn-add-section');

    let newSectionCat = 'Theory';
    let newSectionGrp = 'A';

    const updateAvailableOptions = (forceSelectFirst = false) => {
        Array.from(grpContainer.children).forEach(btn => {
            const grp = btn.dataset.val;
            const fullSec = `${newSectionCat} ${grp}`;
            if (currentSections.includes(fullSec)) btn.classList.add('disabled');
            else btn.classList.remove('disabled');
        });

        const currentGrpBtn = grpContainer.querySelector(`[data-val="${newSectionGrp}"]`);
        const firstAvailable = grpContainer.querySelector('.course-button:not(.disabled)');

        if (forceSelectFirst || !currentGrpBtn || currentGrpBtn.classList.contains('disabled')) {
            if (firstAvailable) {
                Array.from(grpContainer.children).forEach(b => b.classList.remove('active'));
                firstAvailable.classList.add('active');
                newSectionGrp = firstAvailable.dataset.val;
            }
        } else {
            Array.from(grpContainer.children).forEach(b => b.classList.remove('active'));
            currentGrpBtn.classList.add('active');
        }
    };

    const renderSections = () => {
        sectionListContainer.innerHTML = '';
        currentSections.forEach((sec, index) => {
            const pill = document.createElement('div');
            pill.setAttribute('class', 'admin-pill-item');
            pill.innerHTML = `<b>${sec}</b> <i class="fa-solid fa-times remove-pill" style="margin-left:8px; cursor:pointer; color:var(--danger-color);" data-index="${index}"></i>`;
            sectionListContainer.appendChild(pill);
        });
        sectionListContainer.querySelectorAll('.remove-pill').forEach(btn => {
            btn.onclick = (e) => {
                currentSections.splice(parseInt(e.target.dataset.index), 1);
                renderSections(); updateAvailableOptions();
            };
        });
    };
    renderSections();

    const bindToggleGroup = (container, onClick) => {
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.course-button');
            if (btn && !btn.classList.contains('disabled')) {
                Array.from(container.children).forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                onClick(btn.dataset.val);
                if (container === catContainer) updateAvailableOptions(true);
            }
        });
    };
    bindToggleGroup(catContainer, (val) => newSectionCat = val);
    bindToggleGroup(grpContainer, (val) => newSectionGrp = val);
    updateAvailableOptions(true);

    addSectionBtn.onclick = () => {
        const fullSection = `${newSectionCat} ${newSectionGrp}`;
        if (!currentSections.includes(fullSection)) {
            currentSections.push(fullSection);
            const catOrderMap = { 'Theory': 1, 'Lab': 2, 'Practice': 3 };
            currentSections.sort((a, b) => {
                const [catA, grpA] = a.split(' ');
                const [catB, grpB] = b.split(' ');
                if (catOrderMap[catA] !== catOrderMap[catB]) return catOrderMap[catA] - catOrderMap[catB];
                return grpA.localeCompare(grpB);
            });
            renderSections(); updateAvailableOptions();
        } else {
            showNotification('warning', 'Duplicate', 'Section already exists.');
        }
    };

    // --- ADMIN STAFF PICKER LOGIC ---
    if (isGlobalAdmin) {
        const listContainer = document.getElementById('admin-selection-list');
        const searchInput = document.getElementById('admin-search-input');
        const countHint = document.getElementById('admin-count-hint');
        const loader = document.getElementById('admin-staff-loader');
        let staffList = [];

        // 1. Render Function
        const renderStaffList = (filter = '') => {
            listContainer.innerHTML = '';
            const lowerFilter = filter.toLowerCase();
            const filtered = staffList.filter(s =>
                staffDisplayName(s).toLowerCase().includes(lowerFilter) ||
                String(s.email || '').toLowerCase().includes(lowerFilter)
            );

            if (filtered.length === 0) {
                listContainer.innerHTML = `<div style="padding:20px; text-align:center; opacity:0.6;">No staff found</div>`;
                return;
            }

            filtered.forEach(staff => {
                const emailLower = staff.email.toLowerCase();
                const isSelected = currentAdmins.has(emailLower);

                const div = document.createElement('div');
                div.setAttribute('class', `student-item ${isSelected ? 'selected' : ''}`);
                div.setAttribute('role', 'checkbox');
                div.setAttribute('aria-checked', String(isSelected));
                div.tabIndex = 0;
                const shown = staffDisplayName(staff);

                div.innerHTML = `
                            ${userAvatarHtml(shown, staff.photo, 'user-avatar settings-row-avatar')}
                            <div class="student-info" style="flex-grow:1;">
                                <div class="student-name">${escapeHtml(shown)}</div>
                                <div class="student-uid">${escapeHtml(staff.role === 'Global' ? 'Administrator' : (staff.role || 'Staff'))} &bull; ${escapeHtml(staff.email)}</div>
                            </div>
                            ${isSelected ? '<i class="fa-solid fa-check student-item-check" aria-hidden="true"></i>' : ''}
                        `;

                div.onclick = () => {
                    if (isSelected) currentAdmins.delete(emailLower);
                    else currentAdmins.add(emailLower);
                    renderStaffList(searchInput.value);
                    countHint.textContent = `${currentAdmins.size} selected`;
                };
                listContainer.appendChild(div);
            });
        };

        // 2. Fetch Data
        callWebApp('getGlobalSettingsData', {}, 'POST')
            .then(data => {
                if (loader) loader.style.display = 'none';
                if (data && data.staff) {
                    staffList = data.staff;
                    staffList.sort((a, b) => compareLecturers(staffDisplayName(a), staffDisplayName(b)));
                    renderStaffList();
                }
            })
            .catch(e => {
                if (loader) loader.style.display = 'none';
                listContainer.innerHTML = `<div class="error-message">Failed to load staff list.</div>`;
            });

        // 3. Search Listener
        searchInput.addEventListener('input', (e) => renderStaffList(e.target.value));
    }

    const close = () => document.body.removeChild(dialogBackdrop);
    dialog.querySelector('#cancel-edit-c').onclick = close;

    // --- Save Logic ---
    dialog.querySelector('#save-edit-c').onclick = async (e) => {
        const btn = e.currentTarget;
        const nameInput = document.getElementById('edit-c-name');
        const rawName = nameInput.value.trim();
        const isArchived = (isGlobalAdmin && !isNew && document.getElementById('edit-c-archived'))
            ? document.getElementById('edit-c-archived').checked
            : (data.archived || false);
        const eisInput = document.getElementById('edit-c-eis');
        const eisVal = eisInput.value.trim();
        clearInputError(nameInput);
        clearInputError(eisInput);
        let systemName;
        try {
            systemName = StandoData.resolveCourseName({ code: rawName, eisId: eisVal,
                originalName: courseName, originalData: data, archived: isArchived, courses: courseInfoMap });
        } catch (error) {
            showInputError(error.message.startsWith('EIS ID') ? eisInput : nameInput, error.message);
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        if (currentSections.length === 0) {
            showNotification('error', 'Missing Data', 'Please add at least one section.');
            btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
            return;
        }

        const finalAdminString = Array.from(currentAdmins).join(', ');

        const payload = {
            originalName: courseName,
            courseName: systemName, // SEND UNDERSCORES
            defaultHours: data.defaultHours || '2',
            startDate: document.getElementById('edit-c-start').value,
            endDate: document.getElementById('edit-c-end').value,
            holidayStartDate: document.getElementById('edit-c-holiday-start').value,
            holidayWeeks: document.getElementById('edit-c-holidays').value,
            eisId: eisVal,
            availableSections: currentSections.join(', '),
            adminEmails: isGlobalAdmin ? finalAdminString : (data.adminEmails || '')
        };
        if (isGlobalAdmin && !isNew) payload.archived = isArchived;

        try {
            const res = await callWebApp('saveCourseSettings_Admin', payload, 'POST');
            if (res.result === 'success') {
                // Refresh the picker too, so restored and new courses are usable immediately.
                await refreshCoursePicker('Course saved.');
                showNotification('success', 'Saved', 'Course updated.');
                close();
                document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                closeDialogMode();
                if (isGlobalAdmin) showGlobalSettingsDialog();
                else showAdminProfileDialog();
            } else { throw new Error(res.message); }
        } catch (err) {
            showNotification('error', 'Save Failed', err.message);
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save';
        }
    };

    if (!isNew && isGlobalAdmin) {
        dialog.querySelector('#delete-course-btn').onclick = () => {
            // The server deletes the course together with all of its attendance logs.
            const logCount = courseData[courseName]?.logs?.length;
            showConfirmationDialog({
                title: `<i class="fa-solid fa-trash" style="color:var(--danger-color);"></i> Delete ${escapeHtml(cleanCourseName)}?`,
                message: `This deletes the course <strong>and all of its attendance logs</strong>${logCount ? ` (${logCount} loaded)` : ''}. Export the logs first if you may need them. To hide a course but keep its records, archive it instead.<br><br>This cannot be undone.`,
                confirmText: '<i class="fa-solid fa-trash"></i> Delete Course',
                cancelText: '<i class="fa-solid fa-xmark"></i> Cancel',
                isDestructive: true,
                onConfirm: async () => {
                    await callWebApp('saveCourseSettings_Admin', { originalName: courseName, isDelete: true }, 'POST');
                    await refreshCoursePicker('Course deleted.');
                    showNotification('delete', 'Deleted', 'Course and its logs removed.');
                    close();
                    document.querySelectorAll('.dialog-backdrop').forEach(el => el.remove());
                    closeDialogMode();
                    showGlobalSettingsDialog();
                }
            });
        };
    }
}


// Reloads the course list behind the picker after a course is added, edited or deleted.
async function refreshCoursePicker(savedMessage) {
    try {
        const [info, courses] = await Promise.all([
            callWebApp('getCourseInfo'), callWebApp('getAvailableCourses')
        ]);
        courseInfoMap = info;
        availableCourses = Object.keys(courses).filter(name => !info[name]?.archived);
        courseDictionary = Object.fromEntries(availableCourses.map(name => [name, courses[name]]));
        courseIDMap = Object.fromEntries(Object.entries(info).map(([name, metadata]) => [name, metadata.eisId]));
        // A deleted or renamed course cannot stay selected; routing picks the next one.
        if (currentCourse && !info[currentCourse]) {
            if (!courseData[currentCourse]?.pending) delete courseData[currentCourse];
            if (guestCourse === currentCourse) guestCourse = null;
            currentCourse = '';
            window.location.hash = '';
            updateUI();
        }
        populateCourseButtons();
    } catch (refreshError) {
        showNotification('warning', 'Refresh Needed', `${savedMessage} Reload the page to refresh the course list.`);
    }
}

// --- 3. Non-Global Admin Profile & Settings ---
function showAdminProfileDialog() {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog settings-dialog');
    dialog.style.maxWidth = '1000px';
    dialog.style.height = '85vh';
    dialog.setAttribute('role', 'dialog');

    // --- Variables for Bomb ---
    let avatarClickCount = 0;
    let lastAvatarClickTime = 0;

    // --- Header (Unified "Global Settings" Look) ---
    const headerHtml = `
    <div class="settings-modal-header">
        <div class="settings-modal-identity">
            <div class="settings-avatar" id="non-admin-profile-pic-container">
                ${userAvatarHtml(currentUserDisplayName(), currentUser.picture, 'user-avatar user-avatar-lg')}
            </div>
            <div class="settings-modal-heading">
                <h3>My Courses</h3>
                <div class="settings-modal-sub">${escapeHtml(currentUserDisplayName())}</div>
            </div>
        </div>
        <button type="button" id="close-profile-btn" class="btn-icon icon-only-btn" title="Close" aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>`;

    // --- HTML Structure (Unified with Global Settings) ---
    dialog.innerHTML = `
    ${headerHtml}
    <div class="dialog-content" style="padding:0; position:relative; display:flex; flex-direction:column; overflow:hidden;">
        <div id="profile-loader" class="settings-loader-overlay">
            <div class="loading-spinner"></div>
        </div>
        <div class="settings-section" style="display:flex; flex-direction:column; height:100%;">
            <div class="settings-controls-bar">
                <div class="input-with-icon search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input type="search" id="lecturer-course-search-input" class="settings-search-input" placeholder="Search courses..." aria-label="Search courses">
                </div>
                ${settingsSortSelectHtml('lecturer-course-sort')}
            </div>
            <div class="settings-scroll" id="lecturer-courses-container"></div>
        </div>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    StandoWebsite.addDownloadControl(dialog.querySelector('#lecturer-courses-container').parentElement);

    // --- Bomb Logic ---
    const profilePicContainer = dialog.querySelector('#non-admin-profile-pic-container');
    profilePicContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        const now = Date.now();
        if (now - lastAvatarClickTime > 1000) avatarClickCount = 0;
        lastAvatarClickTime = now;
        avatarClickCount++;
        if (avatarClickCount === 5) {
            profilePicContainer.innerHTML = `<div style="width:100%; height:100%; border-radius:50%; background:#f44336; display:flex; align-items:center; justify-content:center; color:white; font-size:2em;"><i class="fa-solid fa-bomb"></i></div>`;
            profilePicContainer.onclick = confirmClearAllAppData;
            avatarClickCount = 0;
        }
    });

    const close = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };
    dialog.querySelector('#close-profile-btn').onclick = close;

    // --- Async Data Fetch ---
    (async () => {
        await fetchCourseInfo();
        const loader = dialog.querySelector('#profile-loader');
        if (loader) loader.style.display = 'none';

        const myCourseDict = {};
        availableCourses.forEach(c => {
            if (courseInfoMap[c]) myCourseDict[c] = courseInfoMap[c];
        });

        renderCoursesInSettings(myCourseDict, '', 'lecturer-courses-container');

        const searchInput = dialog.querySelector('#lecturer-course-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                renderCoursesInSettings(myCourseDict, e.target.value, 'lecturer-courses-container');
            });
        }
        bindSettingsSortSelect(dialog.querySelector('#lecturer-course-sort'),
            () => renderCoursesInSettings(myCourseDict, searchInput ? searchInput.value : '', 'lecturer-courses-container'));
    })();
}

/**
* Shows the Student Profile Dialog (Revamped Design)
*/
async function showStudentProfileDialog() {
    // 1. Find IDs & UIDs (Local)
    let userIDs = [];
    let userUIDs = [];
    for (const dbKey in databaseMap) {
        const entry = databaseMap[dbKey];
        if (entry.email && entry.email.toLowerCase() === currentUser.email.toLowerCase()) {
            userIDs = entry.uids || [];
            userUIDs = entry.hardware_uids || (entry.uids ? entry.uids.map(convertExternalIdToUid).filter(Boolean) : []);
            break;
        }
    }

    // 2. Build ID / UID Badges HTML (Compact)
    let uidContent = '';
    const maxCount = Math.max(userIDs.length, userUIDs.length);
    if (maxCount > 0) {
        const badges = [];
        for (let i = 0; i < maxCount; i++) {
            const idVal = userIDs[i] || (userUIDs[i] ? convertUidToExternalId(userUIDs[i]) : '');
            const hwVal = userUIDs[i] || (userIDs[i] ? convertExternalIdToUid(userIDs[i]) : '');
            if (idVal || hwVal) {
                badges.push(`
                    <li class="profile-uid-badge" style="display:inline-flex; align-items:center; gap:6px; padding:4px 10px; margin:3px; font-size:0.85em; background:rgba(0,0,0,0.04); border-radius:6px;">
                        <span><i class="fa-solid fa-id-card" style="opacity:0.6; margin-right:2px;"></i> ${escapeHtml(idVal || '—')}</span>
                        ${hwVal ? `<span style="opacity:0.3;">|</span><span style="font-family:monospace; opacity:0.8;"><i class="fa-solid fa-wifi" style="font-size:0.85em; opacity:0.6; margin-right:2px;"></i>${escapeHtml(hwVal)}</span>` : ''}
                    </li>
                `);
            }
        }
        uidContent = `<ul class="profile-uid-list" style="margin:6px 0; padding:0; display:flex; flex-wrap:wrap; justify-content:center; list-style:none;">${badges.join('')}</ul>`;
    } else {
        uidContent = `<p style="text-align:center; opacity:0.6; font-style:italic; font-size:0.85em; margin:6px 0;">No IDs linked.</p>`;
    }

    // 3. Compact Base HTML
    const profileHtml = `
<div style="user-select:none; -webkit-user-select:none;">
    <div class="profile-header-section" style="display:flex; flex-direction:column; align-items:center; text-align:center; gap:8px; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid rgba(0,0,0,0.06);">
        <a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer" class="profile-avatar-link" title="Manage Google Account" aria-label="Manage Google Account">
            ${userAvatarHtml(currentUserDisplayName(), currentUser.picture, 'user-avatar user-avatar-lg')}
        </a>
        <div style="text-align:center; max-width:100%;">
            <h3 class="profile-name-large" style="margin:0 0 3px 0; font-size:1.15em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(currentUserDisplayName())}</h3>
            <p class="profile-email-large" style="margin:0; font-size:0.85em; opacity:0.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(currentUser.email)}</p>
        </div>
    </div>

    <div class="form-section-title" style="margin-top:0; font-size:0.9em; text-align:center;">My Card IDs</div>
    ${uidContent}

    <div class="form-section-title" style="margin-top:14px; font-size:0.9em; text-align:center;">Permission History</div>
    <div id="student-requests-loader" style="text-align:center; padding:15px; opacity:0.6; font-size:0.9em;">
        <i class="fa-solid fa-circle-notch fa-spin"></i> Loading requests...
    </div>
    <div id="student-requests-list" style="max-height:220px; overflow-y:auto; padding-right:2px;"></div>
</div>
`;

    // 4. Show Dialog
    showAlertDialog('', profileHtml);

    // 5. Fetch & Render Requests
    try {
        const requests = await callWebApp('getStudentAbsenceRequests', {}, 'POST');
        const loader = document.getElementById('student-requests-loader');
        const listContainer = document.getElementById('student-requests-list');

        if (loader) loader.style.display = 'none';
        if (!listContainer) return;

        if (!requests || requests.length === 0) {
            listContainer.innerHTML = `<div class="empty-logs" style="padding:10px; font-size:0.85em;">No requests found.</div>`;
        } else {
            // Build Cards with Clean Course Name (no EIS ID)
            const cardsHtml = requests.map(req => {
                const statusClass = `status-${String(req.status || 'pending').toLowerCase()}`;
                const cleanCourse = getCleanCourseCode(req.course, courseInfoMap[req.course]?.eisId);

                // Admin note logic
                let noteHtml = '';
                if (req.adminNotes) {
                    noteHtml = `<div class="req-note" style="margin-top:4px; font-size:0.8em; padding:4px 8px; background:rgba(0,0,0,0.03); border-radius:4px;"><i class="fa-solid fa-reply" style="margin-right:5px; opacity:0.6;"></i> <strong>Reply:</strong> ${escapeHtml(req.adminNotes)}</div>`;
                } else if (req.reason) {
                    noteHtml = `<div class="req-note" style="margin-top:4px; font-size:0.8em; font-style:italic; opacity:0.8;">"${escapeHtml(req.reason)}"</div>`;
                }

                return `
        <div class="req-card ${statusClass}" style="margin-bottom:8px; padding:8px 12px; border-radius:6px; border-left:3px solid var(--primary-color); background:rgba(0,0,0,0.02);">
            <div class="req-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <div class="req-course" style="font-size:0.92em; font-weight:600;">${escapeHtml(cleanCourse)}</div>
                <div class="req-status-pill" style="font-size:0.75em; padding:2px 8px;">${escapeHtml(req.status)}</div>
            </div>
            <div class="req-details" style="font-size:0.82em; opacity:0.8; display:flex; gap:12px;">
                <span><i class="fa-regular fa-calendar" style="margin-right:4px;"></i>${escapeHtml(req.absenceDate)}</span>
                <span><i class="fa-regular fa-clock" style="margin-right:4px;"></i>${escapeHtml(req.hours)}</span>
            </div>
            ${noteHtml}
        </div>`;
            }).join('');

            listContainer.innerHTML = cardsHtml;
        }

    } catch (err) {
        const loader = document.getElementById('student-requests-loader');
        if (loader) {
            loader.innerHTML = `<span style="color:var(--danger-color); font-size:0.85em;"><i class="fa-solid fa-exclamation-circle"></i> Failed to load requests.</span>`;
        }
    }
}

// Function to show the main content when ready
function showMainContent() {
    const loadingIndicator = document.getElementById('app-loading');
    const mainContainer = document.getElementById('main-container');

    // Crossfade: the page fades in underneath while the skeleton fades out.
    if (mainContainer) mainContainer.classList.remove('content-hidden');
    if (loadingIndicator) loadingIndicator.classList.add('is-done');

    // After the fade (0.35s in the stylesheet), remove the skeleton.
    setTimeout(() => {
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
        // Re-enable scrolling
        document.body.classList.remove('is-loading');

        // --- Ensure auth UI state (hiding modules) is applied correctly ---
        updateAuthUI();
        updateUI();

    }, 400);

    isInitializing = false;
    criticalErrorsOnly = false;
    processPendingNotifications();
}

function handleRouting() {
    if (isInitializing) {
        return;
    }

    const hash = getRouteCourse();

    // If no hash, go to default course
    if (!hash) {
        // If we were on a guest course, clear it
        if (guestCourse) {
            const oldGuestCourse = guestCourse;
            guestCourse = null;
            if (courseData[oldGuestCourse] && !courseData[oldGuestCourse].pending) delete courseData[oldGuestCourse];
            populateCourseButtons();
        }

        const defaultCourse = (currentCourse && availableCourses.includes(currentCourse)) ? currentCourse : (availableCourses.length > 0 ? availableCourses[0] : '');
        if (defaultCourse) {
            // Use replaceState to avoid firing hashchange again
            history.replaceState(null, null, '#' + defaultCourse);
            if (currentCourse !== defaultCourse) {
                handleCourseChange(defaultCourse);
            }
        }
        return;
    }

    // Optimization: If hash is already the active course, do nothing.
    if (hash === currentCourse) {
        return;
    }

    // Case 1: Is it an official, available course? (Fastest check)
    if (availableCourses.includes(hash)) {
        if (guestCourse) {
            // We are switching from a guest course to an official one
            const oldGuestCourse = guestCourse;
            guestCourse = null;
            if (courseData[oldGuestCourse] && !courseData[oldGuestCourse].pending) delete courseData[oldGuestCourse];
            populateCourseButtons();
        }
        handleCourseChange(hash); // This is an authorized change
        return;
    }

    // Case 2: Is it a guest course for a Global Admin?
    // We check courseInfoMap, which is the *full* list of all courses.
    if (isGlobalAdmin && courseInfoMap[hash]) {
        const oldGuestCourse = guestCourse;
        guestCourse = hash; // Set new guest course

        // Unload old guest course if it was different
        if (oldGuestCourse && oldGuestCourse !== hash && courseData[oldGuestCourse] && !courseData[oldGuestCourse].pending) {
            delete courseData[oldGuestCourse];
        }

        populateCourseButtons(); // Redraw buttons to include the new guest one
        handleCourseChange(hash); // Load the guest course data
        return;
    }

    // Case 3: Is it an unauthorized course for a non-Global Admin?
    if (!isGlobalAdmin && courseInfoMap[hash]) {
        console.warn('Access denied to course:', hash);
        showNotification('error', 'Access Denied', 'You do not have access to this course.');
        // Redirect to current (or default) course
        window.location.hash = currentCourse || (availableCourses.length > 0 ? availableCourses[0] : '');
        return;
    }

    // Case 4: The course doesn't exist at all (not in the full map).
    if (!courseInfoMap[hash]) {
        console.warn('Course not found:', hash);
        showNotification('error', 'Not Found', 'The course you tried to access does not exist.');
        // Redirect to current (or default) course
        window.location.hash = currentCourse || (availableCourses.length > 0 ? availableCourses[0] : '');
        return;
    }
}

/**
* Update sort icons in the database table headers.
*/
function updateDbSortIcons() {
    // Reset all sort icons in the database table
    document.querySelectorAll('.database-table .sort-icon').forEach(icon => {
        const i = document.createElement('i');
        i.className = 'sort-icon fa-solid fa-sort';
        icon.replaceWith(i);
    });

    // Set the active sort icon
    const [field, direction] = currentDbSort.split('-');
    const header = document.querySelector(`.database-table .sortable[data-sort="${field}"]`);
    if (header) {
        const icon = header.querySelector('.sort-icon');
        if (icon) {
            const i = document.createElement('i');
            i.className = `sort-icon fa-solid fa-sort-${direction === 'asc' ? 'up' : 'down'}`;
            icon.replaceWith(i);
        }
    }
}

/**
* Handle sort dropdown change for the database.
*/
function handleDbSortChange() {
    currentDbSort = document.getElementById('db-sort-select').value;
    dbCurrentPage = 1;
    localStorage.setItem('db_sort', currentDbSort); // Save the choice
    updateDbSortIcons();
    updateDatabaseList();
}

// New function to update sync button appearance and behavior
function updateSyncButton() {
    const syncBtn = document.getElementById('sync-btn');
    if (!syncBtn) return;

    // Update button text to show auto-sync status
    if (autoSyncEnabled) {
        syncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        syncBtn.title = 'Auto-sync enabled (click to sync now)';
        syncBtn.classList.add('auto-sync-enabled');
    } else {
        syncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        syncBtn.title = 'Manual sync mode';
        syncBtn.classList.remove('auto-sync-enabled');
    }
}

/**
* Export logs to JSON file.
*/
function exportLogs() {
    // Use getLogsForCurrentUser() to ensure we get the correct data subset
    const logsForCurrentCourse = getLogsForCurrentUser();

    if (logsForCurrentCourse.length === 0) {
        showNotification('warning', 'Export Failed', 'No logs to export');
        return;
    }

    // Format timestamps for export AND include session
    const exportData = logsForCurrentCourse.map(log => ({
        ...log, // This grabs uid, id, manual, version, etc.
        timestamp: new Date(log.timestamp).toISOString(),
        session: log.session || '' // Explicitly include session
    }));

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${currentCourse || 'attendance'}_logs.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
    showNotification('success', 'Export Complete', 'Logs exported to JSON file');
}

/**
 * Export database to Excel file.
 */
function exportDatabaseToExcel() {
    const rows = StandoData.studentExportRows(databaseMap);
    if (rows.length === 1) return showNotification('warning', 'Export Failed', 'There are no students to export.');
    writeStudentWorkbook(rows, 'students.xlsx');
    showNotification('success', 'Export Complete', `${rows.length - 1} students exported. This file can be imported again.`);
}

function writeStudentWorkbook(rows, filename) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 30 }, { wch: 24 }, { wch: 38 }, { wch: 28 }];
    worksheet['!autofilter'] = { ref: worksheet['!ref'] };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');
    XLSX.writeFile(workbook, filename);
}

function showStudentImportGuide() {
    if (!isAdmin) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="student-import-title">
        <h3 class="dialog-title" id="student-import-title"><i class="fa-solid fa-file-import"></i> Import Students</h3>
        <div class="dialog-content">
            <p>Choose an Excel or CSV file. You can select a sheet and assign its columns before importing.</p>
            <div class="table-container">
                <table class="database-table">
                    <thead><tr><th>Name</th><th>Card ID</th><th>Email</th></tr></thead>
                    <tbody><tr><td>Example Student</td><td>001234</td><td>student@example.edu</td></tr></tbody>
                </table>
            </div>
            <p>Keep Card IDs as text to preserve leading zeros. Use the template if you need a starting file.</p>
            <button type="button" id="student-template-btn" class="btn-blue btn-sm"><i class="fa-solid fa-download"></i> Download Template</button>
        </div>
        <div class="dialog-actions">
            <button type="button" id="cancel-student-guide" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button type="button" id="choose-student-file" class="btn-green"><i class="fa-solid fa-folder-open"></i> Choose File</button>
        </div></div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#student-template-btn').onclick = () => writeStudentWorkbook([StandoData.studentColumns.slice(0, 3)], 'student_import_template.xlsx');
    backdrop.querySelector('#cancel-student-guide').onclick = () => backdrop.remove();
    backdrop.querySelector('#choose-student-file').onclick = () => {
        backdrop.remove();
        excelInput.click();
    };
}

/**
 * Applies the selected theme (light, dark, or auto) to the document.
 * @param {string} theme - The theme to apply: 'auto', 'light', or 'dark'.
 */
function applyTheme(theme) {
    const isDarkMode = (theme === 'dark') || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark-mode', isDarkMode);

    // Find the theme-color meta tag and update it
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', isDarkMode ? '#000000' : '#f4f4f4');
    }

    const toggleBtn = document.querySelector('#theme-toggle-btn');
    if (toggleBtn) {
        const oldIcon = toggleBtn.querySelector('i, svg');
        if (oldIcon) {
            const i = document.createElement('i');
            if (theme === 'light') {
                i.className = 'fa-solid fa-sun';
                toggleBtn.title = 'Switch to Dark Mode';
            } else if (theme === 'dark') {
                i.className = 'fa-solid fa-moon';
                toggleBtn.title = 'Switch to Auto Mode';
            } else {
                i.className = 'fa-solid fa-circle-half-stroke';
                toggleBtn.title = 'Switch to Light Mode';
            }
            oldIcon.replaceWith(i);
        }
    }
}

/**
         * Sets up the theme toggle button and applies the stored/system theme on load.
         */
function setupThemeToggle() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (!themeToggleBtn) return;

    let currentTheme = localStorage.getItem('theme') || 'auto';
    applyTheme(currentTheme); // Apply theme on initial load

    themeToggleBtn.addEventListener('click', () => {
        const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        // Determine the next theme in the cycle
        switch (currentTheme) {
            case 'auto':
                currentTheme = isSystemDark ? 'light' : 'dark';
                break;
            case 'light':
                currentTheme = isSystemDark ? 'auto' : 'dark';
                break;
            case 'dark':
                currentTheme = isSystemDark ? 'light' : 'auto';
                break;
        }

        localStorage.setItem('theme', currentTheme);
        applyTheme(currentTheme);
    });

    // Listen for changes in the system's preferred color scheme
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        if (localStorage.getItem('theme') === 'auto' || !localStorage.getItem('theme')) {
            applyTheme('auto');
        }
    });
}

// New function to setup the enhanced sync button
function setupEnhancedSyncButton() {
    syncBtn = document.getElementById('sync-btn');
    if (!syncBtn) return;
    autoSyncEnabled = localStorage.getItem('auto_sync_enabled') !== 'false';
    updateSyncButton();
    let pressTimer;
    let longPress = false;
    const cancelPress = () => clearTimeout(pressTimer);
    syncBtn.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        longPress = false;
        cancelPress();
        pressTimer = setTimeout(() => {
            longPress = true;
            autoSyncEnabled = !autoSyncEnabled;
            localStorage.setItem('auto_sync_enabled', String(autoSyncEnabled));
            updateSyncButton();
            showNotification('info', autoSyncEnabled ? 'Auto-Sync Enabled' : 'Auto-Sync Disabled',
                autoSyncEnabled ? 'Changes will sync automatically when online.' : 'Use the sync button to upload changes.');
            if (autoSyncEnabled && pendingChanges) autoSyncData();
        }, 800);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(event => syncBtn.addEventListener(event, cancelPress));
    syncBtn.addEventListener('click', () => {
        if (!longPress) syncData();
        longPress = false;
    });
    syncBtn.title = 'Sync changes (Ctrl+S). Hold to toggle automatic sync.';
    syncBtn.setAttribute('aria-label', 'Sync attendance changes');
}

function setupSoundToggle() {
    const button = document.getElementById('sound-toggle-btn');
    if (!button) return;
    const render = () => {
        button.setAttribute('aria-pressed', String(soundEnabled));
        button.title = soundEnabled ? 'Mute scan sounds' : 'Enable scan sounds';
        button.innerHTML = '<i class="fa-solid ' + (soundEnabled ? 'fa-volume-high' : 'fa-volume-xmark') + '"></i>';
    };
    button.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem('sound_enabled', String(soundEnabled));
        render();
    });
    render();
}

/**
* Clears the local database cache to force a re-fetch from the server.
*/
function invalidateDatabaseCache() {
    databaseCache = null;
    databaseCacheTime = 0;
}

// Add this function to implement auto-save and auto-sync
function setupAutoSync() {
    // Setup auto-sync interval
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
    }

    autoSyncInterval = setInterval(() => {
        if (!autoSyncEnabled) return;

        // Only sync if online, signed in, and we have pending changes or it's been 3+ minutes
        const timeSinceLastSync = Date.now() - lastSyncTime;
        if (isOnline && isSignedIn && (pendingChanges || timeSinceLastSync > 180000)) {
            autoSyncData();
        }
    }, SYNC_INTERVAL);

    // Also sync whenever we detect coming back online
    window.addEventListener('online', () => {
        updateOnlineStatus();
        // Wait a moment for connection to stabilize
        setTimeout(() => {
            if (pendingChanges && isOnline && isSignedIn) {
                autoSyncData();
            }
        }, 2000);
    });

    // --- Admin Dashboard Auto-Refresh ---
    // Start auto-refresh for admin views after a short delay
    setTimeout(() => {
        if (isAdmin && isSignedIn) {
            startAdminAutoRefresh();
        }
    }, 5000); // Wait 5s after init to start polling

    // Pause/resume auto-refresh when tab visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAdminAutoRefresh();
        } else if (isAdmin && isSignedIn) {
            // Refresh immediately when tab becomes visible, then restart interval
            silentRefreshAdminViews();
            startAdminAutoRefresh();
        }
    });
}

// Auto-sync function with retry logic
async function autoSyncData() {
    if (!autoSyncEnabled || !isOnline || !isSignedIn || isSyncing) return;

    try {
        isSyncing = true;
        updateSyncStatus("Syncing...", "syncing");

        await syncLogsWithSheet();

        // Reset state after successful sync
        refreshPendingChanges();
        lastSyncTime = Date.now();
        syncAttempts = 0;
        const now = new Date();
        const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        updateSyncStatus(pendingChanges ? 'Pending sync...' : `Synced (${time})`, pendingChanges ? 'waiting' : 'success');

        // Hide success indication after a few seconds
        setTimeout(() => {
            if (!pendingChanges && isOnline && !isSyncing) {
                updateSyncStatus("Online", "online");
            }
        }, 3000);
    } catch (error) {
        console.error('Sync error!:', error);
        syncAttempts++;

        // Update UI to show sync failed
        updateSyncStatus("Sync failed!", "error");

        if (syncAttempts < MAX_SYNC_ATTEMPTS) {
            // Schedule retry with exponential backoff
            const retryDelay = SYNC_RETRY_INTERVAL * Math.pow(2, syncAttempts - 1);
            updateSyncStatus(`Retry in ${Math.round(retryDelay / 1000)} s...`, "waiting");

            setTimeout(() => {
                if (isOnline && isSignedIn) {
                    autoSyncData();
                }
            }, retryDelay);
        }
    } finally {
        isSyncing = false;
    }
}

/**
* Converts a comma-separated string of hours into HTML pills.
* @param {string} hoursString - e.g., "8:40, 9:40"
* @returns {string} - HTML string of <span class="time-tag">...</span>
*/
function formatHoursAsPills(hoursString) {
    if (!hoursString) return 'N/A';

    return hoursString.split(',')
        .map(hour => hour.trim())
        .filter(hour => hour)
        .map(hour => `<span class="time-tag">${escapeHtml(hour)}</span>`)
        .join(' ');
}

/**
* Direct EIS Export function with interactive UI, performance fixes, and dynamic sections.
*/

async function showDirectEisExportDialog(prefilledDateStr = null) {
    if (!isAdmin || !currentCourse) {
        showNotification('warning', 'No Course Selected', 'Please select a course first.');
        return;
    }

    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');

    const formattedCourseName = currentCourse.replace(/_/g, ' ');

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-list-check"></i> Add to EIS</h3>
        <div class="dialog-content">
            <div class="dialog-loader" style="display:flex; justify-content:center; align-items:center; padding: 50px 0;">
                <div class="loading-spinner"></div>
            </div>
            
            <div class="dialog-main-content" style="display:none; opacity:0; transition: opacity 0.3s ease;">
                
                <div class="form-group">
                    <label class="dialog-label-fixed"><i class="fa-solid fa-book"></i> Course</label>
                    <input id="export-course-display" class="form-control" value="${escapeHtml(formattedCourseName)}" disabled>
                </div>

                <div class="form-group">
                    <label class="dialog-label-fixed"><i class="fa-solid fa-calendar-week"></i> Week</label>
                    <select id="export-week" class="form-control"></select>
                </div>

                <div class="form-group">
                    <label class="dialog-label-fixed"><i class="fa-regular fa-calendar-days"></i> Date</label>
                    <input type="date" id="export-date" class="form-control">
                </div>

                <div class="form-group">
                    <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Topic</label>
                    <input type="text" id="export-topic" class="form-control" value="Lecture">
                </div>

                <div class="form-group" style="align-items:flex-start;">
                    <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-users"></i> Group</label>
                    <div style="flex-grow:1; display:flex; flex-direction:column; gap:8px;">
                        <div id="export-cat-group" class="course-buttons-container" style="margin-bottom:0; justify-content:flex-start;"></div>
                        <div id="export-subgroup-group" class="course-buttons-container" style="margin-bottom:0; justify-content:flex-start; display:none;"></div>
                    </div>
                </div>

                <div class="form-group" style="align-items:flex-start;">
                    <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-tag"></i> Category</label>
                    <div id="export-section-group" class="course-buttons-container" style="margin-bottom:0; width:100%; display:flex; gap:8px;">
                        <div class="course-button active" data-value="theory" style="flex:1; text-align:center; padding: 8px 5px; font-size: 0.9em; min-width: 0;"><i class="fa-solid fa-book"></i>&nbsp; Theory</div>
                        <div class="course-button" data-value="lab" style="flex:1; text-align:center; padding: 8px 5px; font-size: 0.9em; min-width: 0;"><i class="fa-solid fa-desktop"></i>&nbsp; Lab</div>
                        <div class="course-button" data-value="practice" style="flex:1; text-align:center; padding: 8px 5px; font-size: 0.9em; min-width: 0;"><i class="fa-solid fa-pen-to-square"></i>&nbsp; Practice</div>
                    </div>
                </div>

                <div class="collapsible-trigger" style="width: fit-content; margin-left: auto; display:flex; align-items:center; margin-top:15px; margin-bottom:0; cursor:pointer;">
                    <span style="margin-right:5px;">More Options</span> <i class="fa-solid fa-chevron-down" style="font-size:0.8em;"></i>
                </div>
                
                <div class="collapsible-content">
                    
                    <div class="custom-hours-container">
                        <div style="display:flex; align-items:center;">
                            <input type="checkbox" id="manual-hours-check" style="margin-right:8px; width:16px; height:16px;">
                            <label for="manual-hours-check" style="margin:0; font-weight:500; cursor:pointer;">Set Custom Hours</label>
                        </div>
                        <input type="number" id="hours-custom-input" class="form-control" style="width:30px; height:15px; padding:2px 5px; text-align: right; display:none;" value="2" min="1" max="25">
                    </div>

                    <label><input type="checkbox" id="mark-exempted-option"> Always mark exempted students as absent</label>
                    <label><input type="checkbox" id="new-tab-option"> Open EIS in new tab</label>
                    <label><input type="checkbox" id="mark-missing-option"> Mark students without UID as absent</label>
                    <hr>
                    <button id="save-export-btn" class="btn-blue btn-sm" style="width:100%; justify-content:center;"><i class="fa-solid fa-file-export"></i> Export to File</button>
                </div>
            </div>
        </div>
        <div class="dialog-actions">
            <button id="cancel-export-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="confirm-eis-export-btn" class="btn-green"><i class="fa-solid fa-wand-magic-sparkles"></i> Add to EIS</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    try { await fetchCourseInfo(); } catch (e) { }
    const eisId = courseIDMap[currentCourse.trim()] || courseIDMap[currentCourse];
    if (!eisId) {
        document.body.removeChild(dialogBackdrop); closeDialogMode();
        showNotification('error', 'EIS ID Missing', `ID for "${currentCourse}" is not set.`); return;
    }
    document.getElementById('export-course-display').value = `${formattedCourseName} (ID: ${eisId})`;

    const closeDialog = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    const courseMetadata = getCourseMetadata(currentCourse);
    const rawSections = courseMetadata?.availableSections || '';
    const sectionsMap = parseAvailableSections(rawSections);
    const categories = Object.keys(sectionsMap);

    let defaultCategory = categories.length > 0 ? categories[0] : 'Theory';
    let defaultSubgroup = (categories.length > 0 && sectionsMap[defaultCategory].length > 0) ? sectionsMap[defaultCategory][0] : null;

    let selectedCategory = defaultCategory;
    let selectedSubgroup = defaultSubgroup;
    let selectedSection = selectedCategory.toLowerCase();

    const catContainer = document.getElementById('export-cat-group');
    const subContainer = document.getElementById('export-subgroup-group');
    const sectionContainer = document.getElementById('export-section-group');

    const updateSectionToggle = () => {
        sectionContainer.querySelectorAll('.course-button').forEach(btn => {
            if (btn.dataset.value === selectedSection.toLowerCase()) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    };

    const renderSubgroups = () => {
        const groups = sectionsMap[selectedCategory] || [];
        subContainer.innerHTML = '';
        if (groups.length > 0 && !selectedSubgroup) selectedSubgroup = groups[0];
        subContainer.style.display = groups.length > 0 ? 'flex' : 'none';

        groups.forEach(grp => {
            const btn = document.createElement('div');
            btn.setAttribute('class', `course-button ${selectedSubgroup === grp ? 'active' : ''}`);
            btn.innerHTML = `<b>${grp}</b>`;
            btn.style.padding = "8px 15px"; btn.style.minWidth = "35px";
            btn.onclick = () => { selectedSubgroup = grp; renderSubgroups(); };
            subContainer.appendChild(btn);
        });
    };

    const renderCategories = () => {
        catContainer.innerHTML = '';
        const icons = { 'theory': 'fa-book', 'lab': 'fa-desktop', 'practice': 'fa-pen-to-square' };
        categories.forEach(cat => {
            const lowerCat = cat.toLowerCase();
            const iconClass = icons[lowerCat] || 'fa-tag';
            const btn = document.createElement('div');
            btn.setAttribute('class', `course-button ${selectedCategory === cat ? 'active' : ''}`);
            btn.innerHTML = `<i class="fa-solid ${iconClass}"></i>&nbsp; ${cat}`;
            btn.style.padding = "8px 12px"; btn.style.fontSize = "0.9em"; btn.style.minWidth = "auto";
            btn.onclick = () => {
                selectedCategory = cat; selectedSubgroup = null; selectedSection = cat.toLowerCase();
                updateSectionToggle(); renderCategories(); renderSubgroups();
            };
            catContainer.appendChild(btn);
        });
    };

    renderCategories(); renderSubgroups(); updateSectionToggle();

    sectionContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (!btn) return;
        selectedSection = btn.dataset.value;
        updateSectionToggle();
    });

    // Date & Week
    const weekSelect = document.getElementById('export-week');
    for (let i = 1; i <= 14; i++) weekSelect.innerHTML += `<option value="${i}">Week ${i}</option>`;
    const dateInput = document.getElementById('export-date');
    // EIS offers weeks 1–14; a value outside the options would leave the select blank.
    const setWeek = week => { weekSelect.value = String(Math.min(Math.max(Number(week) || 1, 1), 14)); };
    if (prefilledDateStr) {
        const [day, month, year] = prefilledDateStr.split('-');
        dateInput.value = `${year}-${month}-${day}`;
        setWeek(courseMetadata ? calculateWeekForDate(courseMetadata, new Date(dateInput.value)) : 1);
    } else {
        dateInput.value = courseMetadata ? getSuggestedDate(courseMetadata) : localDateString();
        setWeek(courseMetadata ? calculateCurrentWeek(courseMetadata) : 1);
    }
    // Picking another date moves the week with it.
    dateInput.addEventListener('change', () => {
        if (courseMetadata && dateInput.value) setWeek(calculateWeekForDate(courseMetadata, new Date(dateInput.value)));
    });

    // --- HOURS LOGIC (Custom Toggle) ---
    const hoursInput = document.getElementById('hours-custom-input');
    const manualCheck = document.getElementById('manual-hours-check');

    hoursInput.value = parseInt(courseMetadata?.defaultHours || 2);
    manualCheck.addEventListener('change', (e) => {
        hoursInput.style.display = e.target.checked ? 'block' : 'none';
    });

    // Prefs
    ['mark-exempted-option', 'new-tab-option', 'mark-missing-option'].forEach(id => {
        const cb = document.getElementById(id);
        const saved = localStorage.getItem(`eis_pref_${id}`);
        if (saved !== null) cb.checked = JSON.parse(saved);
        else if (id !== 'mark-exempted-option') cb.checked = true;
        cb.addEventListener('change', () => localStorage.setItem(`eis_pref_${id}`, cb.checked));
    });

    dialog.querySelector('.collapsible-trigger').onclick = (e) => {
        const content = e.currentTarget.nextElementSibling;
        content.classList.toggle('is-open');
        const chevronEl = e.currentTarget.querySelector('i, svg');
        if (chevronEl) {
            const i = document.createElement('i');
            i.className = content.classList.contains('is-open') ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
            i.style.fontSize = '0.8em';
            chevronEl.replaceWith(i);
        }
        content.style.marginTop = content.classList.contains('is-open') ? '10px' : '0';
    };

    const prepareData = () => {
        let targetSession = selectedCategory;
        if (selectedSubgroup) targetSession += ' ' + selectedSubgroup;
        const sectionParam = selectedSubgroup ? targetSession : 'ALL';

        const logsForCourse = courseData[currentCourse]?.logs || [];
        const uidCounts = {};
        const selectedDateStr = dateInput.value;

        logsForCourse.forEach(log => {
            const logDateStr = localDateString(new Date(log.timestamp));
            if (logDateStr !== selectedDateStr) return;
            const logSession = log.session || 'Default';
            let isMatch = (logSession === targetSession);
            if (logSession === 'Default' && categories.length <= 1) isMatch = true;
            if (isMatch) {
                const primaryKey = lookupPrimaryUid(log.uid);
                if (primaryKey) uidCounts[primaryKey] = (uidCounts[primaryKey] || 0) + 1;
            }
        });

        const nameMap = {};
        Object.entries(databaseMap).forEach(([k, v]) => nameMap[k] = v.name);

        return {
            parameters: {
                week: weekSelect.value,
                hours: hoursInput.value,
                category: selectedSection,
                date: dateInput.value,
                topic: document.getElementById('export-topic').value,
                course: currentCourse,
                section: sectionParam
            },
            options: {
                markMissingAsAbsent: document.getElementById('mark-missing-option').checked,
                markExemptedAsAbsent: document.getElementById('mark-exempted-option').checked,
                manualHours: document.getElementById('manual-hours-check').checked // <-- KEY FLAG
            },
            attendance: uidCounts,
            nameMap: nameMap
        };
    };

    document.getElementById('confirm-eis-export-btn').onclick = () => {
        const data = prepareData();
        copyToClipboard(JSON.stringify(data)).then(() => {
            const url = `https://eis.epoka.edu.al/courseattendance/${eisId}/newcl`;
            showNotification('success', 'Copied', `Data for ${selectedCategory} ${selectedSubgroup || ''} copied.`);
            if (document.getElementById('new-tab-option').checked) window.open(url, '_blank');
            else window.location.href = url;
            closeDialog();
        }).catch(() => showNotification('error', 'Error', 'Clipboard failed.'));
    };

    document.getElementById('save-export-btn').onclick = () => {
        const data = prepareData();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
        const a = document.createElement('a');
        a.href = dataStr; a.download = `eis_${currentCourse}_${data.parameters.date}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showNotification('success', 'Saved', 'File exported.');
    };

    document.getElementById('cancel-export-btn').onclick = closeDialog;

    const loader = dialog.querySelector('.dialog-loader');
    const content = dialog.querySelector('.dialog-main-content');
    setTimeout(() => { loader.style.display = 'none'; content.style.display = 'block'; void content.offsetWidth; content.style.opacity = '1'; }, 300);
}

/**
* Adds or subtracts business days (skipping Sat/Sun) to a date.
* @param {Date} startDate - The starting date.
* @param {number} days - Number of business days to add (positive) or subtract (negative).
* @returns {Date} The calculated date.
*/
function addBusinessDays(startDate, days) {
    let count = 0;
    const currentDate = new Date(startDate);
    const direction = days > 0 ? 1 : -1;

    while (count < Math.abs(days)) {
        currentDate.setDate(currentDate.getDate() + direction);
        const day = currentDate.getDay();
        if (day !== 0 && day !== 6) { // 0 is Sunday, 6 is Saturday
            count++;
        }
    }
    return currentDate;
}

/**
 * Copy text to clipboard
 * @param {string} text - Text to copy
 * @returns {Promise} - Resolves when copied successfully
 */
function copyToClipboard(text) {
    // Use modern clipboard API if available
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
    } else {
        // Fallback for older browsers
        return new Promise((resolve, reject) => {
            try {
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';  // Prevent scrolling to bottom
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);

                if (successful) {
                    resolve();
                } else {
                    reject(new Error('Clipboard copy failed'));
                }
            } catch (err) {
                reject(err);
            }
        });
    }
}

/**
* Initialize the application.
* Sets up event listeners, checks NFC support, and prepares the UI.
*/
function init() {
    const hasStoredSession =
        Object.keys(localStorage).some(k => k.startsWith('sb-') && k.includes('auth-token'));
    if (!hasStoredSession) {
        localStorage.removeItem('last_active_course');
    }

    document.body.classList.add('is-loading');
    isInitializing = true;

    // --- Assign DOM Elements ---
    tabs = document.querySelectorAll('.tab');
    tabContents = document.querySelectorAll('.tab-content');
    importExcelBtn = document.getElementById('import-excel-btn');
    excelInput = document.getElementById('excel-input');
    filterInput = document.getElementById('filter-input');
    sortSelect = document.getElementById('sort-select');
    dbFilterInput = document.getElementById('db-filter-input');
    importBtn = document.getElementById('import-btn');
    importInput = document.getElementById('import-input');
    exportBtn = document.getElementById('export-btn');
    clearBtn = document.getElementById('clear-btn');
    addLogBtn = document.getElementById('add-log-btn');
    addEntryBtn = document.getElementById('add-entry-btn');
    exportExcelBtn = document.getElementById('export-excel-btn');
    clearDbBtn = document.getElementById('clear-db-btn');
    logsTbody = document.getElementById('logs-tbody');
    databaseTbody = document.getElementById('database-tbody');
    emptyLogs = document.getElementById('empty-logs');
    emptyDatabase = document.getElementById('empty-database');
    filteredCount = document.getElementById('filtered-count');
    dbEntryCount = document.getElementById('db-entry-count');
    totalScans = document.getElementById('total-scans');
    lastScan = document.getElementById('last-scan');
    databaseStatus = document.getElementById('database-status');
    notificationArea = document.getElementById('in-page-notification-area');
    successSound = document.getElementById('success-sound');
    errorSound = document.getElementById('error-sound');
    syncBtn = document.getElementById('sync-btn');
    syncStatus = document.getElementById('sync-status');
    syncText = document.getElementById('sync-text');
    loginBtn = document.getElementById('login-btn');
    logoutBtn = document.getElementById('logout-btn');
    loginContainer = document.getElementById('login-container');
    userContainer = document.getElementById('user-container');
    userName = document.getElementById('user-name');
    userAvatar = document.getElementById('user-avatar');
    scanHistoryModule = document.getElementById('scan-history-module');

    cleanupOldLocalStorage();

    setupThemeToggle();
    setupSoundToggle();

    setupCatCompanion();

    // Start with nfcSupported as false
    nfcSupported = false;

    // Update current year in footer
    updateYear();

    // Set up online/offline listeners
    updateOnlineStatus();
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    window.addEventListener('hashchange', handleRouting, false);

    // Check if NFC is supported - ONLY in Google Chrome on Android
    const isAndroid = /Android/i.test(navigator.userAgent);

    // This is a more specific check for Google Chrome, excluding other Chromium browsers
    const isGoogleChrome = /Chrome/i.test(navigator.userAgent) && !/SamsungBrowser|OPR|Brave|YaBrowser/i.test(navigator.userAgent);

    if (isAndroid && isGoogleChrome && 'NDEFReader' in window) {
        console.log('NFC support detected (Google Chrome on Android with NDEFReader)');
        nfcSupported = true;
    } else {
        console.log('NFC not supported on this device/browser');
        nfcSupported = false;

        // Only show notification on mobile devices where NFC might be expected
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
            pendingNotifications.push({
                type: 'warning',
                title: 'NFC Unsupported',
                message: 'NFC scanning is only supported in Chrome on Android.'
            });
        }
    }

    updateScanButtons();

    // Set up event listeners
    setupEventListeners();
    setupScanLock();

    // Round the header chips per visual row (the scan chips and the sign-in chips)
    document.querySelectorAll('.app-info').forEach(appInfoEl => {
        requestAnimationFrame(() => updateButtonRows(appInfoEl));
        if (!appInfoEl._rowObserver) {
            appInfoEl._rowObserver = new ResizeObserver(() => updateButtonRows(appInfoEl));
            appInfoEl._rowObserver.observe(appInfoEl);
        }
    });
    setupRowMenus();
    setupRefreshButtons();

    // Restore and apply the last saved sort UI state
    sortSelect.value = currentSort;
    document.getElementById('db-sort-select').value = currentDbSort;
    updateSortIcons();
    updateDbSortIcons();

    if (currentSort.startsWith('date')) {
        document.querySelector('.logs-table').classList.add('sorting-by-date');
    }

    // Set up auto-sync with the new combined button approach
    setupAutoSync();
    setupEnhancedSyncButton();
    setupAuthStateTracking();

    // Scanning never starts on its own; the user starts it manually.

    // This prevents the phone from sleeping and killing the sync process
    if ('wakeLock' in navigator) {
        let wakeLock = null;
        const requestWakeLock = async () => {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Screen Wake Lock active');
            } catch (err) {
                console.warn(`Wake Lock failed: ${err.name}, ${err.message}`);
            }
        };

        // Request immediately
        requestWakeLock();

        // Re-request if the user minimizes and returns
        document.addEventListener('visibilitychange', async () => {
            if (wakeLock !== null && document.visibilityState === 'visible') {
                requestWakeLock();
            }
        });

        // AMOLED Burn-in Prevention: Subtle pixel shifting every 2 minutes
        // Shifts content by ±2 pixels - imperceptible to users but prevents static burn-in
        // Note: Applied to main-container to avoid breaking position:fixed elements (notifications, cat)
        const mainContainer = document.getElementById('main-container');
        if (mainContainer) {
            setInterval(() => {
                // Only apply shift when no dialogs are open
                if (dialogOpenCount === 0) {
                    const shiftX = Math.floor(Math.random() * 5) - 2; // -2 to +2 pixels
                    const shiftY = Math.floor(Math.random() * 5) - 2;
                    mainContainer.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
                }
                // The lock screen can stay up for a whole lesson.
                const lockInner = document.querySelector('#scan-lock .scan-lock-inner');
                if (lockInner) {
                    lockInner.style.transform = `translate(${Math.floor(Math.random() * 5) - 2}px, ${Math.floor(Math.random() * 5) - 2}px)`;
                }
            }, 120000); // Every 2 minutes
        }


    }
}


function processPendingNotifications() {
    if (pendingNotifications.length > 0) {
        // Only show the most recent notification of each type
        const uniqueNotifications = {};
        for (const notification of pendingNotifications) {
            uniqueNotifications[notification.type + notification.title] = notification;
        }

        // Display only the unique notifications
        Object.values(uniqueNotifications).forEach(notification => {
            showNotification(
                notification.type,
                notification.title,
                notification.message,
                notification.duration
            );
        });

        pendingNotifications = [];
    }
}

/**
 * Helper function that your existing initGoogleApi() is trying to call
 */
function gisLoaded() {
    return new Promise((resolve) => {
        // If google identity services is already loaded, resolve immediately
        if (typeof google !== 'undefined' && google.accounts) {
            resolve();
        } else {
            // Wait a bit and try again
            setTimeout(() => resolve(), 100);
        }
    });
}

/**
 * Initialize authentication (Supabase session + Google One Tap).
 */
async function initGoogleApi() {
    if (initInProgress) return;
    initInProgress = true;
    isInitializing = true;

    try {
        await gisLoaded();

        // Restores a stored session or consumes an OAuth redirect
        const { data: { session } } = await supabaseClient.auth.getSession();

        // Restore the course anchor saved before an OAuth redirect
        const originalHash = sessionStorage.getItem('redirect_hash');
        if (originalHash !== null) {
            sessionStorage.removeItem('redirect_hash');
            if (history.replaceState) {
                history.replaceState(null, null, window.location.pathname + window.location.search + originalHash);
            }
        }

        if (session) {
            onSuccessfulAuth(true);
        } else {
            // Not signed in: show One Tap (hashed nonce to Google, raw to Supabase)
            oneTapRawNonce = crypto.randomUUID();
            const hashedNonce = await sha256Hex(oneTapRawNonce);

            if (typeof google !== 'undefined' && google.accounts?.id) {
                google.accounts.id.initialize({
                    client_id: CLIENT_ID,
                    callback: handleOneTapResponse,
                    nonce: hashedNonce,
                    auto_select: true, // Auto-signin returning users
                    cancel_on_tap_outside: false,
                    use_fedcm_for_prompt: true
                });

                google.accounts.id.prompt();
            }

            isInitializing = false;
            showMainContent();
        }

    } catch (error) {
        console.error('initGoogleApi error:', error);
        isInitializing = false;
        showMainContent();

        // FORCE UI RESET: Ensure login button is visible and clickable
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            loginBtn.disabled = false;
            if (loginBtn.dataset.originalText) loginBtn.innerHTML = loginBtn.dataset.originalText;
            loginBtn.style.backgroundColor = "";
            loginBtn.style.cursor = "pointer";
        }
    } finally {
        initInProgress = false;
    }
}

/**
* Loads data in phases for a fast boot
*/
async function onSuccessfulAuth(isRestore = false) {
    isSignedIn = true;

    // Deep link from an email: open the RLS-protected attachment after sign-in
    const attachmentParam = new URLSearchParams(window.location.search).get('attachment');
    if (attachmentParam) {
        history.replaceState(null, null, window.location.pathname + window.location.hash);
        resolveEmailAttachmentLink(attachmentParam);
    }

    // Show cat companion with transition
    const cat = document.getElementById('cat-companion');
    if (cat) {
        cat.style.display = 'block';
        // Force reflow
        void cat.offsetHeight;
        cat.classList.add('visible');
    }

    try {
        // --- PHASE 1: CRITICAL BOOT ---

        // 1. Get user info from the Supabase session.
        // In Kiosk mode, 'currentUser' is already set by handleNfcReading.
        if (!currentUser) {
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (!session) throw new Error('No active session.');
            const meta = session.user.user_metadata || {};
            currentUser = {
                email: session.user.email,
                name: meta.full_name || meta.name || session.user.email,
                picture: normalizeGooglePhotoUrl(meta.avatar_url || meta.picture)
            };
        }

        // Update UI (Moved outside the if-block so it runs for both modes)
        console.log('User:', currentUser.email);
        renderUserChip();

        // 2. Get ALL boot data in ONE call (Admin Status + Course List)
        // This goes to YOUR backend, which knows how to handle the Kiosk token.
        const bootData = await callWebApp('getBootData', {}, 'POST');

        // 3. Process Admin Status from boot data
        if (bootData.adminStatus) {
            isAdmin = bootData.adminStatus.isAdmin || false;
            isGlobalAdmin = bootData.adminStatus.isGlobalAdmin || false;
            adminCourses = bootData.adminStatus.courses || [];
            console.log('Admin status:', { isAdmin, isGlobalAdmin, adminCourses });
        }

        // A staff member's custom name (for example with a title) replaces the
        // Google name in the top bar. Loaded alongside the rest; never blocks.
        sbGetStaffProfiles().then(profiles => {
            const own = profiles.get(String(currentUser?.email || '').trim().toLowerCase());
            if (own?.name && currentUser) {
                currentUser.staffName = own.name;
                renderUserChip();
            }
        });

        // 4. Process Available Courses from boot data
        const fetchedCourseDict = bootData.courses;
        if (fetchedCourseDict && typeof fetchedCourseDict === 'object') {
            courseDictionary = fetchedCourseDict;
            availableCourses = Object.keys(courseDictionary);

            const filteredDict = {};
            availableCourses.forEach(course => {
                if (courseDictionary[course]) {
                    filteredDict[course] = courseDictionary[course];
                }
            });
            courseDictionary = filteredDict;

            // Determine which course to show first
            const hashCourse = getRouteCourse();
            const lastActiveCourse = localStorage.getItem('last_active_course');

            if (hashCourse) {
                if (availableCourses.includes(hashCourse)) {
                    currentCourse = hashCourse;
                } else if (isGlobalAdmin && bootData.courseInfo?.[hashCourse]) {
                    currentCourse = hashCourse;
                    guestCourse = hashCourse;
                } else {
                    currentCourse = (lastActiveCourse && availableCourses.includes(lastActiveCourse)) ? lastActiveCourse : (availableCourses.length > 0 ? availableCourses[0] : null);
                }
            } else if (lastActiveCourse && availableCourses.includes(lastActiveCourse)) {
                currentCourse = lastActiveCourse;
            } else if (availableCourses.length > 0) {
                currentCourse = availableCourses[0];
            } else {
                currentCourse = null;
            }
        }

        // 5. Process Database
        if (bootData.database) {
            databaseMap = bootData.database;
            databaseCache = bootData.database;
            databaseCacheTime = Date.now();
            window.buildUIDToPrimaryUidMap();
            updateDatabaseStatus();
        }

        // 6. Process Course Info
        if (bootData.courseInfo) {
            courseInfoMap = bootData.courseInfo;
            Object.entries(courseInfoMap).forEach(([courseName, metadata]) => {
                if (metadata && metadata.eisId) {
                    courseIDMap[courseName] = metadata.eisId;
                }
            });

            // Strip archived courses from the official available list so they
            // behave like guest courses (button appears on visit, gone when leaving)
            availableCourses = availableCourses.filter(c => !courseInfoMap[c]?.archived);
            Object.keys(courseDictionary).forEach(c => {
                if (courseInfoMap[c]?.archived) delete courseDictionary[c];
            });

            // If the boot-selected course is archived, treat it as a guest visit
            // (global admin) or fall back to first active course (everyone else)
            if (currentCourse && courseInfoMap[currentCourse]?.archived) {
                if (isGlobalAdmin) {
                    guestCourse = currentCourse;
                } else {
                    currentCourse = availableCourses[0] || null;
                }
            }
        }

        // --- PHASE 2: SHOW THE APP ---
        isInitializing = false;
        // A lock left on by this account covers the app before it is usable.
        restoreScanLock();
        showMainContent();
        updateAuthUI();
        handleRouting();
        populateCourseButtons();
        updatePageTitle();
        updateUI();

        // --- PHASE 3: BACKGROUND DATA LOADING ---
        (async () => {
            try {
                if (currentCourse) {
                    // REPLACED: Use safe loader instead of direct fetch
                    await loadAndMergeCourseData(currentCourse);

                    // Background load others
                    if (isAdmin && !isGlobalAdmin) {
                        setTimeout(loadRemainingCourseAdminLogs, 1000);
                    } else if (!isAdmin) {
                        setTimeout(loadRemainingStudentLogs, 1000);
                    }
                }

                updateUI();

                if (isAdmin) {
                    refreshAdminViews();
                }
            } catch (backgroundError) {
                console.error('Error during background data load:', backgroundError);
            }
        })();

        // --- PHASE 4: SESSION AUTO-DESTRUCT (KIOSK ONLY) ---
        const isKioskMode = !!localStorage.getItem(KIOSK_MODE_KEY);

        if (isKioskMode) {
            // Set this to MATCH your Backend.js SESSION_DURATION (in milliseconds)
            // e.g. 10800 * 1000 for 3 hours
            const SESSION_TIMEOUT_MS = 1800 * 1000;

            if (window.sessionTimer) clearTimeout(window.sessionTimer);

            window.sessionTimer = setTimeout(() => {
                console.warn("Kiosk session time limit reached. Signing out...");
                handleSignoutClick(); // clears the kiosk flag, ends the session, reloads
            }, SESSION_TIMEOUT_MS);
        }

    } catch (bootError) {
        console.error('Error during auth:', bootError);
        showNotification('error', 'Authentication Error', 'Failed to complete sign-in. Please try again.');
        isInitializing = false;
        showMainContent();
        updateAuthUI();
    }
}

/**
 * Saves the data for a single, specified course to local storage.
 * @param {string} courseName - The name of the course to save.
 */
function courseStorageKey(courseName) {
    const account = (currentUser?.email || '').trim().toLowerCase();
    const scope = isAdmin && isAdminForCourse(courseName) ? 'admin' : 'student';
    return account ? LOGS_STORAGE_KEY + '_account_' + encodeURIComponent(account) + '_' + scope + '_' + courseName : null;
}

function refreshPendingChanges() {
    pendingChanges = Object.values(courseData).some(data => data.pending === true);
    return pendingChanges;
}

function saveCourseToLocalStorage(courseName) {
    const data = courseData[courseName];
    const storageKey = courseStorageKey(courseName);
    if (!storageKey || !data) return false;
    try {
        if (protectedCacheKeys.has(storageKey)) throw new Error('Unreadable cache could not be backed up.');
        localStorage.setItem(storageKey, JSON.stringify({
            logs: data.logs,
            tombstones: Array.from(data.tombstones || []),
            pending: data.pending === true,
            revision: data.revision || 0,
            savedAt: Date.now()
        }));
        return true;
    } catch (error) {
        console.error('Could not save attendance on this device:', error);
        if (!storageSaveFailed) {
            showNotification('error', 'Local Save Failed', 'Keep this page open and sync or export your logs. Device storage is full or unavailable.', 0);
        }
        storageSaveFailed = true;
        return false;
    }
}

// Helper function to clean up old localStorage data
function cleanupOldLocalStorage() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(LOGS_STORAGE_KEY + '_account_')) continue;
        try {
            const data = JSON.parse(localStorage.getItem(key));
            // Legacy caches have no reliable dirty marker; never discard them here.
            if (data.pending === false && !data.tombstones?.length && data.savedAt < cutoff) localStorage.removeItem(key);
        } catch { /* Keep unrecognised data available for recovery. */ }
    }
}

function normalizeGooglePhotoUrl(url) {
    if (!url) return url;
    // Strip any existing size param, then append =s96-c for the CDN-cached 96px version.
    // This avoids 429s caused by multiple img tags hitting the same uncached URL.
    return url.replace(/=s\d+(-c)?$/, '') + '=s96-c';
}

// A card held against the back of a phone. Without motion it shows the card in place.
function cardTapAnimationHtml() {
    return `
        <svg class="card-tap" viewBox="0 0 200 150" aria-hidden="true" focusable="false">
            <g class="tap-phone">
                <rect class="tap-phone-body" x="60" y="6" width="80" height="138" rx="14"/>
                <rect class="tap-phone-camera" x="69" y="16" width="24" height="40" rx="8"/>
                <circle class="tap-phone-lens" cx="81" cy="28" r="6"/>
                <circle class="tap-phone-lens" cx="81" cy="44" r="6"/>
            </g>
            <g class="tap-waves">
                <circle cx="100" cy="80" r="40"/>
                <circle cx="100" cy="80" r="40"/>
            </g>
            <g transform="translate(58 53)">
                <g class="tap-card">
                    <rect class="tap-card-body" width="84" height="54" rx="6"/>
                    <rect class="tap-card-chip" x="9" y="14" width="14" height="11" rx="2"/>
                    <rect class="tap-card-photo" x="60" y="9" width="16" height="20" rx="3"/>
                    <rect class="tap-card-line" x="9" y="34" width="42" height="4" rx="2"/>
                    <rect class="tap-card-line" x="9" y="42" width="28" height="4" rx="2"/>
                </g>
            </g>
            <g class="tap-check">
                <circle cx="146" cy="22" r="13"/>
                <path d="M140 22.5l4.2 4.2 7.8-8.4"/>
            </g>
        </svg>`;
}

// A typed Card ID: the digits a scan shows, or a colon-separated hardware UID.
// Scanned 4-byte cards never exceed 16777215, so longer numbers are a printed number.
function parseTypedCardId(value) {
    const text = String(value || '').replace(/\s+/g, '').toLowerCase();
    if (/^\d+$/.test(text)) {
        const cardId = text.replace(/^0+(?=\d)/, '');
        if (cardId.length > 8 || Number(cardId) < 1 || Number(cardId) > 0xFFFFFF) return null;
        return { cardId, hardwareUid: convertExternalIdToUid(cardId) };
    }
    if (/^([0-9a-f]{2}:){3,9}[0-9a-f]{2}$/.test(text)) {
        return { cardId: convertUidToExternalId(text), hardwareUid: text };
    }
    return null;
}

// Students register their card by scanning it. Phones that cannot scan (iPhones)
// are guided to have a friend's Android phone scan it, then type the Card ID.
function showRegisterUIDDialog() {
    if (!isSignedIn || isAdmin || !currentUser) return;

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog reg-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'reg-dialog-title');
    dialog.innerHTML = `
        <h3 class="dialog-title" id="reg-dialog-title"><i class="fa-solid fa-id-card"></i> Register your card</h3>
        <div class="dialog-content reg-content"></div>
        <div class="dialog-actions"></div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const content = dialog.querySelector('.reg-content');
    const actions = dialog.querySelector('.dialog-actions');
    const userAgent = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/i.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(userAgent);
    let nfcController = null;
    let ownCard = null;
    let friendCard = null;
    let typedCardId = '';
    let manualReason = '';
    let currentStep = '';

    const stopReader = () => {
        if (nfcController) nfcController.abort();
        nfcController = null;
    };

    const closeDialog = () => {
        stopReader();
        dialogBackdrop.remove();
        closeDialogMode();
    };
    dialogBackdrop.addEventListener('dialogclose', stopReader, { once: true });

    const notice = (heading, body) => `
        <div class="reg-notice"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span><strong>${heading}</strong> ${body}</span></div>`;
    const statusHtml = `
        <div class="reg-status is-ready" role="status" aria-live="polite"><span class="reg-status-dot" aria-hidden="true"></span><span class="reg-status-text">Ready to scan</span></div>
        <div class="reg-retry" hidden>
            <button type="button" class="btn-blue" data-action="retry">Try again</button>
            <button type="button" class="reg-link" data-action="manual">Type the Card ID instead</button>
        </div>`;
    const accountHtml = () => `<p class="reg-account">Sending as <strong>${escapeHtml(currentUser.name)}</strong> · ${escapeHtml(currentUser.email)}</p>`;
    const progressHtml = (step) => `
        <div class="reg-progress"><span class="is-active"></span><span class="${step === 2 ? 'is-active' : ''}"></span><em>Step ${step} of 2</em></div>`;

    const STATUS = {
        ready: ['is-ready', 'Ready to scan'],
        unreadable: ['is-error', "Couldn't read the card. Hold it still against the phone."],
        off: ['is-error', "Turn on NFC in your phone's settings, then try again."],
        denied: ['is-error', 'Allow Stando to use NFC, then try again.'],
        unsupported: ['is-error', "This phone can't scan cards."]
    };
    const setStatus = (key) => {
        const status = content.querySelector('.reg-status');
        if (!status) return;
        const [className, text] = STATUS[key];
        status.className = `reg-status ${className}`;
        status.querySelector('.reg-status-text').textContent = text;
        // A failed start needs the user; a failed read keeps listening.
        const retry = content.querySelector('.reg-retry');
        if (retry) retry.hidden = !['off', 'denied', 'unsupported'].includes(key);
    };

    // Reads one card, then stops listening.
    const readCard = (onRead) => {
        stopReader();
        const controller = new AbortController();
        nfcController = controller;
        setStatus('ready');
        const reader = new NDEFReader();
        reader.onreading = ({ serialNumber }) => {
            if (controller.signal.aborted) return;
            if (typeof serialNumber !== 'string' || !serialNumber.trim()) {
                setStatus('unreadable');
                return;
            }
            stopReader();
            playSound(true);
            onRead({ cardId: convertUidToExternalId(serialNumber), hardwareUid: serialNumber });
        };
        reader.onreadingerror = () => {
            if (!controller.signal.aborted) setStatus('unreadable');
        };
        reader.scan({ signal: controller.signal }).catch(err => {
            if (controller.signal.aborted || err.name === 'AbortError') return;
            console.warn('Card scan failed:', err);
            setStatus(err.name === 'NotAllowedError' ? 'denied' : err.name === 'NotSupportedError' ? 'unsupported' : 'off');
        });
    };

    const submit = (card, submitBtn) => {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';
        const restore = () => {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
        };

        callWebApp('submitRegistration', {
            action: 'submitRegistration',
            name: currentUser.name,
            email: currentUser.email,
            uid: card.cardId,
            hardwareUid: card.hardwareUid
        }, 'POST')
            .then(data => {
                if (data && data.result === 'success') {
                    showNotification('success', 'Submission Sent!', 'Your card application has been sent for approval.');
                    closeDialog();
                } else {
                    const errorMessage = (data && data.message) ? data.message : 'An unknown error occurred.';
                    console.error('Script Error:', errorMessage);
                    showNotification('error', 'Submission Failed', errorMessage);
                    restore();
                }
            }).catch(err => {
                console.error('API Error:', err);
                showNotification('error', 'Submission Failed', `A network error occurred: ${err.message}`);
                restore();
            });
    };

    const steps = {
        // Android with NFC: scan your own card.
        scan() {
            content.innerHTML = `
                ${notice("Scan your card. Don't type the number printed on it.", "Your Card ID is a different number, stored in the card's chip.")}
                ${cardTapAnimationHtml()}
                <p class="reg-instruction">Hold your card flat against the <strong>back of your phone</strong> and keep it still until it beeps.</p>
                <p class="reg-hint">No beep? Slide the card slowly around the back, towards the camera.</p>
                ${statusHtml}
                <div class="reg-friend"><span>Helping a friend with an iPhone?</span><button type="button" class="reg-link" data-action="friend">Scan a friend's card</button></div>`;
            actions.innerHTML = `<button type="button" id="cancel-register-btn" class="btn-red" data-action="cancel">Cancel</button>`;
            readCard(card => { ownCard = card; show('review'); });
        },
        review() {
            content.innerHTML = `
                <div class="reg-result"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span class="reg-result-label">Your Card ID</span><span class="reg-result-id">${escapeHtml(ownCard.cardId)}</span></div>
                <p class="reg-instruction">Card scanned. Submit it to send it for approval.</p>
                ${accountHtml()}
                <div class="reg-center"><button type="button" class="btn-blue" data-action="rescan">Scan again</button></div>`;
            actions.innerHTML = `
                <button type="button" id="cancel-register-btn" class="btn-red" data-action="cancel">Cancel</button>
                <button type="button" id="submit-register-btn" class="btn-green" data-action="submit">Submit</button>`;
        },
        // Android with NFC: read a classmate's card so they can type its Card ID.
        friend() {
            content.innerHTML = `
                <p class="reg-instruction"><strong>Scan a friend's card.</strong> Hold their card flat against the back of your phone. Their Card ID appears here for them to type on their phone.</p>
                ${cardTapAnimationHtml()}
                ${statusHtml}
                <p class="reg-hint">Nothing is sent or saved to your account.</p>`;
            actions.innerHTML = `
                <button type="button" id="reg-back-btn" class="btn-red" data-action="back">Back</button>
                <button type="button" id="reg-close-btn" class="btn-red" data-action="cancel">Close</button>`;
            readCard(card => { friendCard = card; show('friendResult'); });
        },
        friendResult() {
            content.innerHTML = `
                <div class="reg-result is-friend"><span class="reg-result-label">Your friend's Card ID</span><span class="reg-result-id">${escapeHtml(friendCard.cardId)}</span></div>
                <p class="reg-instruction">Your friend types this number in <strong>Register Card ID</strong> on their own phone.</p>
                <div class="reg-center"><button type="button" class="btn-blue" data-action="friend">Scan another card</button></div>`;
            actions.innerHTML = `
                <button type="button" id="reg-back-btn" class="btn-red" data-action="back">Back</button>
                <button type="button" id="reg-done-btn" class="btn-blue" data-action="cancel">Done</button>`;
        },
        // No NFC here (iPhone, computer, another browser): a friend scans the card.
        manualHelp() {
            const reason = manualReason || (isIos
                ? "iPhones can't scan cards in Stando, so ask a friend with an Android phone to scan it for you."
                : isAndroid
                    ? 'To scan with this phone, open Stando in Google Chrome. Or ask a friend with an Android phone to scan it for you.'
                    : "This device can't scan cards. Ask a friend with an Android phone to scan it for you.");
            content.innerHTML = `
                ${progressHtml(1)}
                ${notice('Your card must be scanned.', "Your Card ID is stored in the card's chip. It is not the number printed on your card.")}
                <p class="reg-instruction">${reason}</p>
                ${cardTapAnimationHtml()}
                <ol class="reg-list">
                    <li>Your friend opens Stando in Chrome and taps <strong>Register Card ID</strong>, then <strong>Scan a friend's card</strong>.</li>
                    <li>Hold your card flat against the back of their phone until it beeps.</li>
                    <li>Their screen shows your <strong>Card ID</strong>. Type it in the next step.</li>
                </ol>
                <p class="reg-hint">Not signed in? Your friend can tap <strong>Start scanning</strong> on the Stando sign-in page instead.</p>`;
            actions.innerHTML = `
                ${nfcSupported
                    ? '<button type="button" id="reg-back-btn" class="btn-red" data-action="back">Back</button>'
                    : '<button type="button" id="cancel-register-btn" class="btn-red" data-action="cancel">Cancel</button>'}
                <button type="button" id="reg-next-btn" class="btn-blue" data-action="next">Next</button>`;
        },
        manualEntry() {
            content.innerHTML = `
                ${progressHtml(2)}
                <div class="form-group">
                    <label class="dialog-label-fixed" for="register-card-id">Card ID</label>
                    <input type="text" id="register-card-id" class="form-control reg-id-input" inputmode="numeric" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="30" placeholder="e.g. 11930522" value="${escapeHtml(typedCardId)}" aria-describedby="register-card-id-hint">
                </div>
                <p class="form-hint" id="register-card-id-hint">Type the digits from your friend's screen, not the number printed on your card.</p>
                ${accountHtml()}`;
            actions.innerHTML = `
                <button type="button" id="reg-back-btn" class="btn-red" data-action="back">Back</button>
                <button type="button" id="submit-register-btn" class="btn-green" data-action="submit" ${typedCardId.trim() ? '' : 'disabled'}>Submit</button>`;
            const input = content.querySelector('#register-card-id');
            input.addEventListener('input', () => {
                typedCardId = input.value;
                clearInputError(input);
                actions.querySelector('#submit-register-btn').disabled = !input.value.trim();
            });
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') actions.querySelector('#submit-register-btn').click();
            });
            if (!isTouchDevice()) input.focus({ preventScroll: true });
        }
    };

    const BACK = { friend: 'scan', friendResult: 'scan', manualHelp: 'scan', manualEntry: 'manualHelp' };

    function show(step) {
        stopReader();
        currentStep = step;
        content.classList.remove('reg-step-in');
        void content.offsetWidth;
        content.classList.add('reg-step-in');
        content.scrollTop = 0;
        steps[step]();
    }

    dialog.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button || button.disabled) return;
        switch (button.dataset.action) {
            case 'cancel': closeDialog(); break;
            case 'back': show(BACK[currentStep] || 'scan'); break;
            case 'retry': show(currentStep); break;
            case 'rescan': show('scan'); break;
            case 'friend': show('friend'); break;
            case 'next': show('manualEntry'); break;
            case 'manual':
                manualReason = "This phone couldn't scan the card. Ask a friend with an Android phone to scan it for you.";
                show('manualHelp');
                break;
            case 'submit': {
                if (currentStep === 'review') {
                    submit(ownCard, button);
                    break;
                }
                const input = content.querySelector('#register-card-id');
                const card = parseTypedCardId(input.value);
                if (!card) {
                    showInputError(input, "That isn't a Card ID. Check the number on your friend's screen.");
                    input.focus();
                    break;
                }
                submit(card, button);
                break;
            }
        }
    });

    // One reader at a time: this dialog's scan replaces the attendance scan.
    if (nfcSupported && (isScanning || nfcReader)) stopScanning();
    show(nfcSupported ? 'scan' : 'manualHelp');
}

/**
* Show registration dialog with pre-filled UID (for Admin scanning unknown card)
*/
function showRegisterUIDDialogWithPrefill(prefillUid) {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const actionText = isGlobalAdmin ? 'Add to Database' : 'Submit Request';
    const infoText = isGlobalAdmin
        ? 'Add this student directly to the database.'
        : 'Submit a registration request for approval.';

    const initHw = (prefillUid && prefillUid.includes(':')) ? prefillUid : convertExternalIdToUid(prefillUid);
    const initId = (prefillUid && !prefillUid.includes(':')) ? prefillUid : convertUidToExternalId(prefillUid);

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-address-card"></i> Register Student</h3>
        <div class="dialog-content">
            
            <div class="dialog-disclaimer" style="margin-bottom:15px;">
                <i class="fa-solid fa-circle-info"></i> <strong>New Card:</strong> ${infoText}
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="register-name">Name <span class="required">*</span></label>
                <input type="text" id="register-name" class="form-control" placeholder="Full Name" autocomplete="off">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="register-email">Email <span class="required">*</span></label>
                <input type="email" id="register-email" class="form-control" placeholder="student@epoka.edu.al" autocomplete="off">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="register-prefill-hw-uid"><i class="fa-solid fa-wifi"></i> UID</label>
                <input type="text" id="register-prefill-hw-uid" class="form-control" value="${escapeHtml(initHw)}" placeholder="04:a2:3f:8a">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="register-prefill-student-id"><i class="fa-solid fa-id-card"></i> Card ID</label>
                <input type="text" id="register-prefill-student-id" class="form-control" value="${escapeHtml(initId)}" placeholder="Auto-calculated from UID" disabled style="opacity:0.75; cursor:not-allowed; background:rgba(0,0,0,0.04);">
            </div>

        </div>
        <div class="dialog-actions">
            <button id="cancel-register-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="submit-register-btn" class="btn-green"><i class="fa-solid fa-check"></i> ${actionText}</button>
        </div>
    `;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };

    const prefillHwInput = document.getElementById('register-prefill-hw-uid');
    const prefillIdInput = document.getElementById('register-prefill-student-id');

    // Real-time calculation from UID to ID
    if (prefillHwInput && prefillIdInput) {
        prefillHwInput.addEventListener('input', () => {
            const raw = prefillHwInput.value.trim();
            prefillIdInput.value = convertUidToExternalId(raw) || '';
        });
    }

    document.getElementById('cancel-register-btn').addEventListener('click', closeDialog);

    const submitBtn = document.getElementById('submit-register-btn');
    submitBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('register-name');
        const emailInput = document.getElementById('register-email');

        // Clear previous errors
        clearInputError(nameInput);
        clearInputError(emailInput);

        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const rawHw = prefillHwInput.value.trim();
        const rawId = prefillIdInput.value.trim();
        const uid = rawId || convertUidToExternalId(rawHw) || rawHw;
        const hardwareUid = rawHw || convertExternalIdToUid(rawId) || rawId;

        // Validation
        let isValid = true;
        if (name === '') {
            showInputError(nameInput, 'Name is required.');
            isValid = false;
        }
        if (!isValidEmail(email)) {
            showInputError(emailInput, 'A valid email is required.');
            isValid = false;
        }
        if (!uid && !hardwareUid) {
            showInputError(prefillIdInput, 'UID or ID is required.');
            isValid = false;
        }
        if (!isValid) return;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

        try {
            const submissionData = {
                name: name,
                email: email,
                uid: uid,
                hardwareUid: hardwareUid,
                sentBy: {
                    name: currentUser?.name || 'Admin',
                    email: currentUser?.email || ''
                }
            };

            if (isGlobalAdmin) {
                // Global admins add directly
                const result = await callWebApp('addEntryToDatabase_Admin', submissionData, 'POST');
                if (result && result.result === 'success') {
                    showNotification('success', 'Added', `${name} added to database.`);
                    invalidateDatabaseCache();
                    await fetchDatabaseFromSheet();
                    window.buildUIDToPrimaryUidMap();
                    updateUI();
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Failed to add entry');
                }
            } else {
                // Non-global admins submit request
                const result = await callWebApp('submitRegistration', submissionData, 'POST');
                if (result && result.result === 'success') {
                    showNotification('success', 'Sent', `Registration request sent for ${name}.`);
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Submission failed');
                }
            }
        } catch (error) {
            showNotification('error', 'Error', error.message);
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> ${actionText}`;
        }
    });
}

/**
 * Checks for duplicates in the local databaseMap.
 * @param {object} entry - The new entry to check {name, email, uid}.
 * @returns {object | null} A match object if found, or null.
 */
function findDuplicateInDatabase(entry) {
    const norm = (str) => (str || '').toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const newUid = norm(entry.uid);
    const newHwUid = norm(entry.hardwareUid);
    const newName = norm(entry.name);
    const newEmail = norm(entry.email);

    for (const [dbKey, studentData] of Object.entries(databaseMap)) {
        if (studentData.isStaff) continue; // Staff cards are managed in Settings.
        const existingUids = (studentData.uids || []).map(norm);
        const existingHwUids = (studentData.hardware_uids || []).map(norm);
        const existingName = norm(studentData.name);
        const existingEmail = norm(studentData.email);

        const duplicateData = {
            index: dbKey,
            name: studentData.name,
            uids: studentData.uids || [],
            hardware_uids: studentData.hardware_uids || [],
            uid: (studentData.uids || []).join(', '),
            hardwareUid: (studentData.hardware_uids || []).join(', '),
            email: studentData.email || '',
            rowIndex: parseInt(dbKey)
        };

        if (existingUids.some(eu => uidsEquivalent(eu, newUid) || (newHwUid && uidsEquivalent(eu, newHwUid)))) return { type: 'uid', duplicate: duplicateData };
        if (existingHwUids.some(eu => uidsEquivalent(eu, newUid) || (newHwUid && uidsEquivalent(eu, newHwUid)))) return { type: 'uid', duplicate: duplicateData };
        if (newEmail && existingEmail && existingEmail === newEmail) return { type: 'email', duplicate: duplicateData };
        if (existingName === newName) return { type: 'name', duplicate: duplicateData };
    }
    return null;
}

/**
 * Creates the warning dialog for adding a new entry that is a duplicate.
 * This version modifies the local databaseMap directly.
 */
function showDuplicateWarningForNewEntry(newData, duplicates, onCompleteCallback) {
    openDialogMode();
    const existing = duplicates[0];
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // --- Comparison logic ---
    const norm = (str) => (str || '').toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const isNameMatch = norm(newData.name) === norm(existing.name);
    const isEmailMatch = norm(newData.email) === norm(existing.email);
    const existingUids = (existing.uids || (existing.uid || '').toString().split(',')).map(norm);
    const existingHwUids = (existing.hardware_uids || (existing.hardwareUid || '').toString().split(',')).map(norm);
    const isUidMatch = existingUids.includes(norm(newData.uid)) || existingHwUids.includes(norm(newData.hardwareUid || newData.uid));

    // --- Format Existing IDs and UIDs ---
    let existingIdsList = [];
    if (existing.uids && Array.isArray(existing.uids) && existing.uids.length > 0) {
        existingIdsList = existing.uids;
    } else if (existing.uid) {
        existingIdsList = existing.uid.split(',').map(s => s.trim());
    } else if (existing.hardware_uids && existing.hardware_uids.length > 0) {
        existingIdsList = existing.hardware_uids.map(convertUidToExternalId).filter(Boolean);
    }

    let existingHwList = [];
    if (existing.hardware_uids && Array.isArray(existing.hardware_uids) && existing.hardware_uids.length > 0) {
        existingHwList = existing.hardware_uids;
    } else if (existing.hardwareUid) {
        existingHwList = existing.hardwareUid.split(',').map(s => s.trim());
    } else if (existingIdsList.length > 0) {
        existingHwList = existingIdsList.map(convertExternalIdToUid).filter(Boolean);
    }

    const existingIdsDisplay = existingIdsList.length > 0 ? existingIdsList.join(', ') : '—';
    const existingHwDisplay = existingHwList.length > 0 ? existingHwList.join(', ') : '—';

    // --- Format New Data ID and UID ---
    const rawNewId = newData.uid ? String(newData.uid).trim() : '';
    const rawNewHw = (newData.hardwareUid || newData.hardware_uid) ? String(newData.hardwareUid || newData.hardware_uid).trim() : '';

    const newStudentId = (rawNewId && !rawNewId.includes(':'))
        ? rawNewId
        : (rawNewHw ? convertUidToExternalId(rawNewHw) : (rawNewId ? convertUidToExternalId(rawNewId) : '—'));

    const newHardwareUid = (rawNewHw && rawNewHw.includes(':'))
        ? rawNewHw
        : (rawNewId ? (convertExternalIdToUid(rawNewId) || rawNewId) : (rawNewHw || '—'));

    // --- Dynamic HTML ---
    const nameActionHTML = isNameMatch ?
        '<span style="opacity: 0.6; font-size: 0.85em; white-space: nowrap; min-width: 90px; text-align: right;">(Matches)</span>' :
        `<div class="field-action" style="display:flex; align-items:center; gap:6px; white-space:nowrap; min-width:90px; justify-content:flex-end; margin:0;"><input type="checkbox" id="replace-name-check" data-field="name" style="cursor:pointer; margin:0;"><label for="replace-name-check" style="margin:0; cursor:pointer; font-weight:600; font-size:0.9em;">Replace</label></div>`;

    const emailActionHTML = isEmailMatch ?
        '<span style="opacity: 0.6; font-size: 0.85em; white-space: nowrap; min-width: 90px; text-align: right;">(Matches)</span>' :
        `<div class="field-action" style="display:flex; align-items:center; gap:6px; white-space:nowrap; min-width:90px; justify-content:flex-end; margin:0;"><input type="checkbox" id="replace-email-check" data-field="email" style="cursor:pointer; margin:0;"><label for="replace-email-check" style="margin:0; cursor:pointer; font-weight:600; font-size:0.9em;">Replace</label></div>`;

    const uidActionHTML = isUidMatch ?
        '<span style="opacity: 0.6; font-size: 0.85em; white-space: nowrap; min-width: 120px; text-align: right;">(Exists)</span>' :
        `<div class="field-action" style="white-space:nowrap; min-width:120px; margin:0;">
            <select id="uid-action-select" class="form-control" style="padding:4px 8px; font-size:0.85em; height:34px;">
                <option value="none" selected>Do Nothing</option>
                <option value="merge">Merge</option>
                <option value="replace">Replace</option>
            </select>
        </div>`;

    dialog.innerHTML = `
    <h3 class="dialog-title" style="color: var(--warning-color);"><i class="fa-solid fa-triangle-exclamation"></i> Similar Entry Found</h3>
    <div class="dialog-content">
        <p style="margin-bottom: 15px;">An entry with similar data already exists.</p>
        
        <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; margin-bottom: 15px;">
            <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">Existing Data</div>
            
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
                <input class="form-control" value="${escapeHtml(existing.name)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-id-card"></i> Card ID(s)</label>
                <input class="form-control" value="${escapeHtml(existingIdsDisplay)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID(s)</label>
                <input class="form-control" value="${escapeHtml(existingHwDisplay)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
                <input class="form-control" value="${escapeHtml(existing.email || 'N/A')}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">
        
        <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">New Entry</div>
        
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
            <input class="form-control" value="${escapeHtml(newData.name)}" disabled style="flex: 1;">
            ${nameActionHTML}
        </div>
        
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
            <input class="form-control" value="${escapeHtml(newData.email)}" disabled style="flex: 1;">
            ${emailActionHTML}
        </div>
        
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-id-card"></i> Card ID</label>
            <input class="form-control" value="${escapeHtml(newStudentId)}" disabled style="flex: 1;">
            ${uidActionHTML}
        </div>
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID</label>
            <input class="form-control" value="${escapeHtml(newHardwareUid)}" disabled style="flex: 1;">
            <span style="min-width: 120px;"></span>
        </div>
    </div>
    <div class="dialog-actions">
        <button id="cancel-duplicate-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="add-anyway-btn" class="btn-orange"><i class="fa-solid fa-user-plus"></i> Add as Separate</button>
        <button id="apply-btn" class="btn-green"><i class="fa-solid fa-floppy-disk"></i> Apply Changes</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };
    const addAnywayBtn = document.getElementById('add-anyway-btn');
    const applyBtn = document.getElementById('apply-btn');
    const actionControls = dialog.querySelectorAll('[data-field="name"], [data-field="email"], #uid-action-select');

    const updateButtonStates = () => {
        const isAnyActionSelected = Array.from(actionControls).some(control =>
            (control.type === 'checkbox' && control.checked) ||
            (control.tagName === 'SELECT' && control.value !== 'none')
        );
        addAnywayBtn.disabled = isAnyActionSelected;
        applyBtn.disabled = !isAnyActionSelected;
    };

    actionControls.forEach(control => control.addEventListener('change', updateButtonStates));
    updateButtonStates();
    document.getElementById('cancel-duplicate-btn').addEventListener('click', closeDialog);

    const studentId = newStudentId !== '—' ? newStudentId : (newData.uid || '');
    const hwUid = newHardwareUid !== '—' ? newHardwareUid : (newData.hardwareUid || '');

    // Each choice writes only the one student it affects, then reloads the list
    // so the table and scan lookups use the server's ids.
    const runAction = async (button, action) => {
        const idleLabel = button.innerHTML;
        addAnywayBtn.disabled = true;
        applyBtn.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
        try {
            await action();
            invalidateDatabaseCache();
            await fetchDatabaseFromSheet().catch(error => console.warn('Could not reload the student list:', error));
            onCompleteCallback();
            closeDialog();
        } catch (error) {
            showNotification('error', 'Save Failed', error.message || 'Please try again.');
            button.innerHTML = idleLabel;
            updateButtonStates();
        }
    };

    addAnywayBtn.addEventListener('click', () => runAction(addAnywayBtn, async () => {
        await callWebApp('addEntryToDatabase_Admin', {
            name: newData.name, email: newData.email, uid: studentId, hardwareUid: hwUid
        });
        showNotification('success', 'Entry Added', `Added ${newData.name} as a separate entry.`);
    }));

    applyBtn.addEventListener('click', () => runAction(applyBtn, async () => {
        const existingEntryData = databaseMap[existing.index];
        if (!existingEntryData) throw new Error('The existing entry is no longer in the list. Reload and try again.');

        const nameCheck = dialog.querySelector('#replace-name-check');
        const emailCheck = dialog.querySelector('#replace-email-check');
        const uidSelect = dialog.querySelector('#uid-action-select');
        const update = { dbKey: existing.index };

        if (nameCheck && nameCheck.checked) update.name = newData.name;
        if (emailCheck && emailCheck.checked) update.email = newData.email;
        if (uidSelect && uidSelect.value === 'merge') {
            const uids = [...(existingEntryData.uids || [])];
            const hardwareUids = [...(existingEntryData.hardware_uids || [])];
            if (studentId && !uids.includes(studentId)) uids.push(studentId);
            if (hwUid && !hardwareUids.includes(hwUid)) hardwareUids.push(hwUid);
            Object.assign(update, { uids, hardwareUids });
        } else if (uidSelect && uidSelect.value === 'replace') {
            Object.assign(update, { uids: studentId ? [studentId] : [], hardwareUids: hwUid ? [hwUid] : [] });
        }

        await callWebApp('updateStudentInDatabase_Admin', update);
        showNotification('success', 'Entry Updated', `Updated details for ${update.name || existingEntryData.name}.`);
    }));
}

/**
 * Shows an editable dialog to approve a registration with loading feedback.
 */
function showApproveDialog(registration) {
    const norm = (str) => (str || '').toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const newUid = norm(registration.uid);
    const newName = norm(registration.name);
    const newEmail = norm(registration.email);

    let match = null;

    // Iterate through the local database to find a match. Staff cards are
    // managed in Settings and are not students that a registration can update.
    for (const [dbKey, studentData] of Object.entries(databaseMap)) {
        if (studentData.isStaff) continue;
        const existingUids = (studentData.uids || []).map(norm);
        const existingHwUids = (studentData.hardware_uids || []).map(norm);
        const existingName = norm(studentData.name);
        const existingEmail = norm(studentData.email);

        const duplicateData = {
            index: dbKey,
            name: studentData.name,
            uids: studentData.uids || [],
            hardware_uids: studentData.hardware_uids || (studentData.uids ? studentData.uids.map(convertExternalIdToUid).filter(Boolean) : []),
            uid: (studentData.uids || []).join(', '),
            hardwareUid: (studentData.hardware_uids || (studentData.uids ? studentData.uids.map(convertExternalIdToUid).filter(Boolean) : [])).join(', '),
            email: studentData.email || '',
            // The student's id: approveRegistration updates students where id = rowIndex.
            rowIndex: parseInt(dbKey, 10)
        };

        // Priority 1: UID / ID Match
        if (existingUids.some(eu => uidsEquivalent(eu, newUid)) || existingHwUids.some(ehu => uidsEquivalent(ehu, newUid))) {
            match = { type: 'uid', duplicate: duplicateData };
            break;
        }
        // Priority 2: Email Match
        if (newEmail && existingEmail && existingEmail === newEmail) {
            match = { type: 'email', duplicate: duplicateData };
            break;
        }
        // Priority 3: Name Match
        if (existingName === newName) {
            if (!match) {
                match = { type: 'name', duplicate: duplicateData };
            }
        }
    }

    // --- DECISION POINT ---
    if (match) {
        // A duplicate was found, show the interactive warning dialog
        showDuplicateWarningDialog(registration, [match.duplicate]);
    } else {
        // No duplicates found, show the simple final approval dialog
        showFinalApprovalDialog(registration);
    }
}

/**
 * Step 2: Shows the final editable approval dialog for non-duplicate entries.
 */
function showFinalApprovalDialog(registration) {
    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const rawUid = (registration.uid || '').toString().trim();
    const isHex = rawUid.includes(':') || /^[0-9A-Fa-f]{8}$/.test(rawUid);
    const hexUid = isHex ? rawUid : (convertExternalIdToUid(rawUid) || rawUid);
    const decId = isHex ? (convertUidToExternalId(rawUid) || rawUid) : rawUid;

    dialog.innerHTML = `
    <h3 class="dialog-title">Approve Application</h3>
    <div class="dialog-content">
        <p style="margin-bottom:15px;">Please review and confirm the details below.</p>
        
        <div class="form-group">
            <label class="dialog-label-fixed" for="approve-name"><i class="fa-solid fa-quote-left"></i> Name</label>
            <input type="text" id="approve-name" class="form-control" value="${escapeHtml(registration.name)}">
        </div>
        
        <div class="form-group">
            <label class="dialog-label-fixed" for="approve-email"><i class="fa-solid fa-at"></i> Email</label>
            <input type="email" id="approve-email" class="form-control" value="${escapeHtml(registration.email)}">
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed" for="approve-id"><i class="fa-solid fa-id-card"></i> Card ID</label>
            <input type="text" id="approve-id" class="form-control" value="${escapeHtml(decId)}" disabled>
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed" for="approve-uid"><i class="fa-solid fa-wifi"></i> UID</label>
            <input type="text" id="approve-uid" class="form-control" value="${escapeHtml(hexUid)}" disabled>
        </div>
        
    </div> 
    <div class="dialog-actions">
        <button id="cancel-approve-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="confirm-approve-btn" class="btn-green"><i class="fa-solid fa-check"></i> Approve</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    document.getElementById('cancel-approve-btn').addEventListener('click', closeDialog);

    const confirmBtn = document.getElementById('confirm-approve-btn');
    confirmBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('approve-name');
        const emailInput = document.getElementById('approve-email');
        clearInputError(nameInput); clearInputError(emailInput);

        const finalName = nameInput.value.trim();
        const finalEmail = emailInput.value.trim();
        let isValid = true;
        if (finalName === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(finalEmail)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        if (!isValid) return;

        const idleLabel = confirmBtn.innerHTML;
        confirmBtn.disabled = true; confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Approving...';
        const finalData = {
            action: 'approveRegistration',
            approvalMode: 'final_approve',
            name: finalName,
            uid: decId,
            hardwareUid: hexUid,
            hardware_uid: hexUid,
            email: finalEmail,
            rowNumber: registration.rowNumber
        };
        callWebApp('approveRegistration', finalData, 'POST').then(result => {
            if (result && result.result === 'success') {
                showNotification('success', 'Approved!', `${finalData.name} has been added to the database.`);
                notifyIfEmailFailed(result, finalData.email);
                refreshDatabaseAfterApproval(); refreshAdminViews(); closeDialog();
            } else { throw new Error(result ? result.message : 'Approval failed.'); }
        }).catch(err => { showNotification('error', 'Approval Failed', err.message); confirmBtn.disabled = false; confirmBtn.innerHTML = idleLabel; });
    });
}

/**
* Creates the special dialog for handling duplicate registrations.
*/
function showDuplicateWarningDialog(newData, duplicates) {
    openDialogMode();
    const existing = duplicates[0];
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // --- Format Existing IDs and UIDs ---
    let existingIdsList = [];
    if (existing.uids && Array.isArray(existing.uids) && existing.uids.length > 0) {
        existingIdsList = existing.uids;
    } else if (existing.uid) {
        existingIdsList = existing.uid.split(',').map(s => s.trim());
    } else if (existing.hardware_uids && existing.hardware_uids.length > 0) {
        existingIdsList = existing.hardware_uids.map(convertUidToExternalId).filter(Boolean);
    }

    let existingHwList = [];
    if (existing.hardware_uids && Array.isArray(existing.hardware_uids) && existing.hardware_uids.length > 0) {
        existingHwList = existing.hardware_uids;
    } else if (existing.hardwareUid) {
        existingHwList = existing.hardwareUid.split(',').map(s => s.trim());
    } else if (existingIdsList.length > 0) {
        existingHwList = existingIdsList.map(convertExternalIdToUid).filter(Boolean);
    }

    const existingIdsDisplay = existingIdsList.length > 0 ? existingIdsList.join(', ') : '—';
    const existingHwDisplay = existingHwList.length > 0 ? existingHwList.join(', ') : '—';

    // --- Format New Data ID and UID ---
    const rawNewId = newData.uid ? String(newData.uid).trim() : '';
    const rawNewHw = (newData.hardwareUid || newData.hardware_uid) ? String(newData.hardwareUid || newData.hardware_uid).trim() : '';

    const newStudentId = (rawNewId && !rawNewId.includes(':'))
        ? rawNewId
        : (rawNewHw ? convertUidToExternalId(rawNewHw) : (rawNewId ? convertUidToExternalId(rawNewId) : '—'));

    const newHardwareUid = (rawNewHw && rawNewHw.includes(':'))
        ? rawNewHw
        : (rawNewId ? (convertExternalIdToUid(rawNewId) || rawNewId) : (rawNewHw || '—'));

    // --- Core comparison logic ---
    const norm = (str) => (str || '').toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const isNameMatch = norm(newData.name) === norm(existing.name);
    const isEmailMatch = norm(newData.email) === norm(existing.email);
    const isUidMatch = existingIdsList.map(norm).includes(norm(newStudentId)) || existingHwList.map(norm).includes(norm(newHardwareUid));

    // --- Dynamic HTML for checkboxes ---
    const nameActionHTML = isNameMatch ?
        '<span style="opacity: 0.6; font-size: 0.85em; white-space: nowrap; min-width: 90px; text-align: right;">(Matches)</span>' :
        `<div class="field-action" style="display:flex; align-items:center; gap:6px; white-space:nowrap; min-width:90px; justify-content:flex-end; margin:0;"><input type="checkbox" id="replace-name-check" data-field="name" style="cursor:pointer; margin:0;"><label for="replace-name-check" style="margin:0; cursor:pointer; font-weight:600; font-size:0.9em;">Replace</label></div>`;

    const emailActionHTML = isEmailMatch ?
        '<span style="opacity: 0.6; font-size: 0.85em; white-space: nowrap; min-width: 90px; text-align: right;">(Matches)</span>' :
        `<div class="field-action" style="display:flex; align-items:center; gap:6px; white-space:nowrap; min-width:90px; justify-content:flex-end; margin:0;"><input type="checkbox" id="replace-email-check" data-field="email" style="cursor:pointer; margin:0;"><label for="replace-email-check" style="margin:0; cursor:pointer; font-weight:600; font-size:0.9em;">Replace</label></div>`;

    const uidActionHTML = isUidMatch ?
        '<span style="opacity: 0.6; font-size: 0.85em; white-space: nowrap; min-width: 120px; text-align: right;">(Exists)</span>' :
        `<div class="field-action" style="white-space:nowrap; min-width:120px; margin:0;">
            <select id="uid-action-select" class="form-control" style="padding:4px 8px; font-size:0.85em; height:34px;">
                <option value="none" selected>Do Nothing</option>
                <option value="merge">Merge</option>
                <option value="replace">Replace</option>
            </select>
        </div>`;

    dialog.innerHTML = `
    <h3 class="dialog-title" style="color: var(--warning-color);"><i class="fa-solid fa-triangle-exclamation"></i> Similar Entry Found</h3>
    <div class="dialog-content">
        <p style="margin-bottom: 15px;">An entry with similar data already exists.</p>
        
        <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; margin-bottom: 15px;">
            <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">Existing Data</div>
            
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
                <input class="form-control" value="${escapeHtml(existing.name)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-id-card"></i> Card ID(s)</label>
                <input class="form-control" value="${escapeHtml(existingIdsDisplay)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 8px;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID(s)</label>
                <input class="form-control" value="${escapeHtml(existingHwDisplay)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
                <input class="form-control" value="${escapeHtml(existing.email || 'N/A')}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">
        
        <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">New Application</div>
        
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
            <input class="form-control" value="${escapeHtml(newData.name)}" disabled style="flex: 1;">
            ${nameActionHTML}
        </div>
        
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
            <input class="form-control" value="${escapeHtml(newData.email)}" disabled style="flex: 1;">
            ${emailActionHTML}
        </div>
        
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-id-card"></i> Card ID</label>
            <input class="form-control" value="${escapeHtml(newStudentId)}" disabled style="flex: 1;">
            ${uidActionHTML}
        </div>
        <div class="form-group" style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID</label>
            <input class="form-control" value="${escapeHtml(newHardwareUid)}" disabled style="flex: 1;">
            <span style="min-width: 120px;"></span>
        </div>

    </div>
    <div class="dialog-actions">
        <button id="cancel-duplicate-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="add-anyway-btn" class="btn-orange"><i class="fa-solid fa-user-plus"></i> Add as Separate</button>
        <button id="replace-btn" class="btn-green"><i class="fa-solid fa-floppy-disk"></i> Apply Changes</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };
    const addAnywayBtn = document.getElementById('add-anyway-btn');
    const replaceBtn = document.getElementById('replace-btn');
    const actionControls = dialog.querySelectorAll('[data-field="name"], [data-field="email"], #uid-action-select');

    // Function to manage button states
    const updateButtonStates = () => {
        const nameCheck = dialog.querySelector('#replace-name-check');
        const emailCheck = dialog.querySelector('#replace-email-check');
        const uidSelect = dialog.querySelector('#uid-action-select');

        const isAnyActionSelected = (nameCheck && nameCheck.checked) ||
            (emailCheck && emailCheck.checked) ||
            (uidSelect && uidSelect.value !== 'none');

        addAnywayBtn.disabled = isAnyActionSelected;
        replaceBtn.disabled = !isAnyActionSelected;
    };

    // Attach listeners and initialize states
    actionControls.forEach(control => control.addEventListener('change', updateButtonStates));
    updateButtonStates(); // Set initial state
    document.getElementById('cancel-duplicate-btn').addEventListener('click', closeDialog);

    // "Add as Separate" button listener
    addAnywayBtn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        const idleLabel = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
        const studentId = newStudentId !== '—' ? newStudentId : (newData.uid || '');
        const hwUid = newHardwareUid !== '—' ? newHardwareUid : (newData.hardwareUid || '');
        const payload = { ...newData, approvalMode: 'add_new_separate', uid: studentId, hardwareUid: hwUid, hardware_uid: hwUid };
        callWebApp('approveRegistration', payload, 'POST').then(result => {
            if (result && result.result === 'success') {
                showNotification('success', 'Action Complete', `Registration for ${newData.name} has been processed.`);
                notifyIfEmailFailed(result, newData.email);
                refreshDatabaseAfterApproval(); refreshAdminViews(); closeDialog();
            } else { throw new Error(result ? result.message : 'Action failed'); }
        }).catch(err => { showNotification('error', 'Action Failed', err.message); button.disabled = false; button.innerHTML = idleLabel; });
    });

    replaceBtn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        const nameCheck = dialog.querySelector('#replace-name-check');
        const emailCheck = dialog.querySelector('#replace-email-check');
        const uidSelect = dialog.querySelector('#uid-action-select');
        const updates = {};
        if (nameCheck && nameCheck.checked) updates.name = newData.name;
        if (emailCheck && emailCheck.checked) updates.email = newData.email;
        if (uidSelect && uidSelect.value !== 'none') updates.uid_action = uidSelect.value;

        const studentId = newStudentId !== '—' ? newStudentId : (newData.uid || '');
        const hwUid = newHardwareUid !== '—' ? newHardwareUid : (newData.hardwareUid || '');
        const payload = { ...newData, action: 'approveRegistration', approvalMode: 'custom_replace', duplicateRowIndex: existing.rowIndex, updates: updates, uid: studentId, hardwareUid: hwUid, hardware_uid: hwUid };
        const idleLabel = button.innerHTML;
        button.disabled = true; button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Approving...`;
        callWebApp('approveRegistration', payload, 'POST').then(result => {
            if (result && result.result === 'success') {
                showNotification('success', 'Action Complete', 'The entry has been updated.');
                notifyIfEmailFailed(result, newData.email);
                refreshDatabaseAfterApproval(); refreshAdminViews(); closeDialog();
            } else { throw new Error(result ? result.message : 'Action failed'); }
        }).catch(err => { showNotification('error', 'Action Failed', err.message); button.disabled = false; button.innerHTML = idleLabel; });
    });
}

/**
 * Helper function to smoothly refresh both admin lists.
 */
async function refreshAdminViews() {
    if (!isAdmin) return;

    // 1. Show Loading State
    updateAdminDashboardBar(0, 0, true);

    try {
        // 2. Fetch Data
        const [registrations, absences] = await Promise.all([
            callWebApp('getPendingRegistrations', {}, 'POST'),
            callWebApp('getPendingAbsences', {}, 'POST')
        ]);

        // Only count registrations if the user is a Global Admin
        const regCount = isGlobalAdmin ? registrations.length : 0;
        const absCount = absences.length;
        const myAbsCount = (isGlobalAdmin && adminCourses.length > 0)
            ? absences.filter(r => adminCourses.includes(r.course)).length
            : absCount;

        globalNotificationCount = regCount + absCount;
        myNotificationCount = regCount + myAbsCount;
        updatePageTitle();

        // 3. Update the Bar
        updateAdminDashboardBar(absCount, registrations.length, false, myAbsCount);

        // 4. Automatically collapse views if they are empty
        if (regCount === 0) {
            const regView = document.getElementById('pending-registrations-view');
            if (regView) regView.classList.remove('expanded');
        }

        if (absCount === 0) {
            const absView = document.getElementById('pending-absences-view');
            if (absView) absView.classList.remove('expanded');
        }

        // 5. Render Tables
        renderRegistrationsTable(registrations);
        renderAbsencesTable(absences);

    } catch (e) {
        console.error("Error refreshing admin views", e);
        updateAdminDashboardBar(0, 0, false);
    }
}

/**
 * Silent refresh - updates admin dashboard without showing loading spinner.
 * Used for background polling to avoid disrupting the user.
 */
async function silentRefreshAdminViews() {
    if (!isAdmin || !isOnline || !isSignedIn) return;

    try {
        const [registrations, absences] = await Promise.all([
            callWebApp('getPendingRegistrations', {}, 'POST'),
            callWebApp('getPendingAbsences', {}, 'POST')
        ]);

        const regCount = isGlobalAdmin ? registrations.length : 0;
        const absCount = absences.length;
        const myAbsCount = (isGlobalAdmin && adminCourses.length > 0)
            ? absences.filter(r => adminCourses.includes(r.course)).length
            : absCount;
        const newTotal = regCount + absCount;

        // Only update UI if counts changed
        if (newTotal !== globalNotificationCount) {
            globalNotificationCount = newTotal;
            myNotificationCount = regCount + myAbsCount;
            updatePageTitle();
            updateAdminDashboardBar(absCount, registrations.length, false, myAbsCount);
            renderRegistrationsTable(registrations);
            renderAbsencesTable(absences);

            // Notify user if new requests came in
            if (newTotal > 0) {
                console.log(`[Auto-Refresh] Updated: ${absCount} absences, ${regCount} registrations`);
            }
        }
    } catch (e) {
        console.warn("Silent admin refresh failed:", e.message);
    }
}

/**
 * Starts the auto-refresh interval for admin dashboard.
 */
function startAdminAutoRefresh() {
    if (adminAutoRefreshInterval) return; // Already running
    if (!isAdmin) return;

    console.log("[Admin Auto-Refresh] Started (every 30s)");
    adminAutoRefreshInterval = setInterval(silentRefreshAdminViews, ADMIN_REFRESH_INTERVAL);
}

/**
 * Stops the auto-refresh interval for admin dashboard.
 */
function stopAdminAutoRefresh() {
    if (adminAutoRefreshInterval) {
        clearInterval(adminAutoRefreshInterval);
        adminAutoRefreshInterval = null;
        console.log("[Admin Auto-Refresh] Stopped");
    }
}

function renderRegistrationsTable(registrations) {
    const tbody = document.getElementById('registrations-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!registrations || registrations.length === 0) return;

    registrations.forEach(reg => {
        const row = document.createElement('tr');

        let formattedTimestamp = reg.timestamp ? new Date(reg.timestamp).toLocaleString() : 'N/A';

        const rawUid = (reg.uid || '').toString().trim();
        const isHex = rawUid.includes(':') || /^[0-9A-Fa-f]{8}$/.test(rawUid);
        const hexUid = isHex ? rawUid : (convertExternalIdToUid(rawUid) || rawUid);
        const decId = isHex ? (convertUidToExternalId(rawUid) || rawUid) : rawUid;
        const uidCellDisplay = (hexUid && decId && hexUid !== decId)
            ? `<div style="display:flex; flex-direction:column; gap:2px;">
                 <span><span class="uid-badge">${escapeHtml(hexUid)}</span></span>
                 <span style="font-size:0.85em; opacity:0.75; font-family:monospace;"><i class="fa-solid fa-id-card" style="font-size:0.85em; opacity:0.6; margin-right:3px;"></i>${escapeHtml(decId)}</span>
               </div>`
            : `<span class="uid-badge">${escapeHtml(hexUid || reg.uid || 'N/A')}</span>`;

        row.innerHTML = `
            <td>${escapeHtml(reg.name) || 'N/A'}</td>
            <td>${uidCellDisplay}</td>
            <td style="font-size: 0.9em;">${escapeHtml(reg.email) || 'N/A'}</td>
            <td style="font-size: 0.9em;">${escapeHtml(formattedTimestamp)}</td>
            <td style="font-size: 0.9em;">${escapeHtml(reg.sentBy) || 'Unknown'}</td>
            <td class="actions-cell">
                <div class="actions-cell-content decision-pair">
                    <button type="button" class="decision-btn is-approve approve-reg-btn" title="Approve" aria-label="Approve ${escapeHtml(reg.name)}"><i class="fa-solid fa-check" aria-hidden="true"></i><span>Approve</span></button>
                    <button type="button" class="decision-btn is-reject reject-reg-btn" title="Reject" aria-label="Reject ${escapeHtml(reg.name)}"><i class="fa-solid fa-ban" aria-hidden="true"></i><span>Reject</span></button>
                </div>
            </td>
        `;

        // Attach inline listeners ONLY for buttons
        const approveBtn = row.querySelector('.approve-reg-btn');
        approveBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showApproveDialog(reg);
        });

        const rejectBtn = row.querySelector('.reject-reg-btn');
        rejectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showRejectDialog(reg);
        });

        tbody.appendChild(row);
    });

}

function renderAbsencesTable(requests) {
    cachedAbsences = requests || [];
    const tbody = document.getElementById('absences-tbody');
    if (!tbody) return;
    closeRowMenus();
    tbody.innerHTML = '';

    const isFiltering = isGlobalAdmin && adminCourses.length > 0 && hideOtherCourseAbsences;
    const displayRequests = isFiltering
        ? cachedAbsences.filter(r => adminCourses.includes(r.course))
        : cachedAbsences;

    if (!displayRequests || displayRequests.length === 0) return;

    displayRequests.forEach(req => {
        const row = document.createElement('tr');

        const isOtherCourse = isGlobalAdmin && adminCourses.length > 0 && !adminCourses.includes(req.course);
        row.setAttribute('class', 'clickable-request-row' + (isOtherCourse ? ' other-admin-course' : ''));

        // Add Session to dataset
        row.dataset.requestId = req.requestID;
        row.dataset.studentName = req.name;
        row.dataset.studentEmail = req.email;
        row.dataset.course = req.course;
        row.dataset.session = req.session || '';
        row.dataset.absenceDate = req.absenceDate;
        row.dataset.hours = req.hours;
        row.dataset.reasonType = req.reasonType;
        row.dataset.description = req.description;
        row.dataset.attachmentUrl = req.attachmentURL || req.attachmentUrl || '';

        // Create Session Badge (Cat Label style)
        let sessionBadge = '';
        if (req.session && req.session !== 'Default') {
            sessionBadge = `<span class="session-badge">${escapeHtml(req.session)}</span>`;
        }

        row.innerHTML = `
            <td class="person-cell">
                <div class="person-name">${escapeHtml(req.name)}</div>
                <small class="person-email">${escapeHtml(req.email)}</small>
            </td>
            <td>
                ${escapeHtml(req.course.replace(/_/g, ' '))}
                ${sessionBadge}
            </td>
            <td>${escapeHtml(req.absenceDate)}</td>
            <td class="times-cell">${formatHoursAsPills(req.hours)}</td>
            <td>${escapeHtml(req.reasonType)}</td>
            <td class="actions-cell">
                <div class="actions-cell-content card-actions">
                    ${rowMenuHtml([{
                        label: 'Delete request', icon: 'fa-solid fa-trash', danger: true, className: 'delete-absence-btn',
                        attrs: `data-request-id="${escapeHtml(String(req.requestID ?? ''))}" data-student-name="${escapeHtml(req.name)}"`
                    }], `More actions for ${req.name}`)}
                </div>
            </td>`;
        tbody.appendChild(row);
    });
    attachPermissionRowListeners();
    attachAbsenceActionListeners();
}

/**
 * Attaches click listeners to the clickable pending permission rows.
 */
function attachPermissionRowListeners() {
    document.querySelectorAll('.clickable-request-row').forEach(row => {
        row.addEventListener('click', function (e) {
            // --- Do not open dialog if a button inside the row was clicked ---
            if (e.target.closest('button')) {
                return;
            }

            e.stopPropagation();
            const data = { ...this.dataset };
            const isOtherCourse = isGlobalAdmin && adminCourses.length > 0 && !adminCourses.includes(data.course);
            showPermissionDetailsDialog(data, isOtherCourse);
        });
    });
}

/**
 * Attaches click listeners to the approve/reject/delete absence buttons.
 */
function attachAbsenceActionListeners() {
    // Delete buttons (Approve/Reject are now in the dialog)
    document.querySelectorAll('.delete-absence-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            const data = { ...this.dataset }; // Clone data
            showDeleteAbsenceDialog(data);
        });
    });
}

/**
* Shows a dialog with full details of a permission request.
* Used by both the Pending list and History list.
*/
function showPermissionDetailsDialog(data, isReadOnly = false) {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    let attachmentHtml = '<span style="opacity:0.5; font-style:italic;">No attachment</span>';
    if (data.attachmentUrl) {
        // openAttachment() handles both legacy Drive URLs and Storage paths
        attachmentHtml = `<a href="#" data-att="${escapeHtml(data.attachmentUrl)}" onclick="openAttachment(this.dataset.att); return false;" class="btn-attachment"><i class="fa-solid fa-paperclip"></i> View Document</a>`;
    }

    // Determine Action Buttons based on context
    let actionsHtml = '';
    if (isReadOnly) {
        actionsHtml = `<button id="close-details-btn" class="btn-blue"><i class="fa-solid fa-xmark"></i> Close</button>`;
    } else {
        actionsHtml = `
            <button id="close-details-btn" class="btn-blue" style="margin-right:auto;"><i class="fa-solid fa-xmark"></i> Close</button>
            <button id="reject-req-btn" class="btn-red"><i class="fa-solid fa-ban"></i> Reject</button>
            <button id="approve-req-btn" class="btn-green"><i class="fa-solid fa-check"></i> Approve</button>
        `;
    }

    // Handle session badge if present
    let sessionHtml = '';
    if (data.session && data.session !== 'Default') {
        sessionHtml = `<span style="background:#e3f2fd; color:var(--primary-color); font-weight:700; font-size:0.8em; padding:2px 8px; border-radius:4px; margin-left:10px;">${escapeHtml(data.session)}</span>`;
    }

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-circle-info"></i> Request Details</h3>
        <div class="dialog-content">
            <div class="form-group" style="align-items: flex-start;">
                <label class="dialog-label-fixed"><i class="fa-solid fa-user"></i> Student</label>
                <div class="form-control" style="border:none;">
                    <strong>${escapeHtml(data.studentName)}</strong><br>
                    <small style="opacity:0.7">${escapeHtml(data.studentEmail)}</small>
                </div>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-book"></i> Course</label>
                <div class="form-control" style="border:none; display:flex; align-items:center;">
                    ${escapeHtml(data.course ? data.course.replace(/_/g, ' ') : 'N/A')}
                    ${sessionHtml}
                </div>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-regular fa-clock"></i> Date/Time</label>
                <input class="form-control" value="${escapeHtml(data.absenceDate)} (${escapeHtml(data.hours)})" disabled>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-tag"></i> Reason</label>
                <input class="form-control" value="${escapeHtml(data.reasonType)}" disabled>
            </div>

            <div class="form-group" style="align-items:flex-start;">
                <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-align-left"></i> Description</label>
                <textarea class="form-control" rows="3" disabled>${escapeHtml(data.description || 'No description provided.')}</textarea>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed"><i class="fa-solid fa-paperclip"></i> Proof</label>
                <div style="flex-grow:1;">${attachmentHtml}</div>
            </div>
        </div>
        <div class="dialog-actions">
            ${actionsHtml}
        </div>
    `;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    document.getElementById('close-details-btn').addEventListener('click', closeDialog);

    if (!isReadOnly) {
        document.getElementById('approve-req-btn').addEventListener('click', () => {
            closeDialog();
            showApproveAbsenceDialog(data);
        });

        document.getElementById('reject-req-btn').addEventListener('click', () => {
            closeDialog();
            showRejectAbsenceDialog(data);
        });
    }
}

/**
* Shows the dialog for students to request an excused absence.
*/
function showRequestPermissionDialog() {
    if (!isSignedIn || isAdmin || !currentUser) return;

    const getLocalDateString = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const today = new Date();
    const minDateStr = getLocalDateString(addBusinessDays(today, -2));
    const maxDateStr = getLocalDateString(addBusinessDays(today, 7));
    const todayStr = getLocalDateString(today);

    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');

    // 1. Find all student identifiers
    let studentUIDs = [];
    if (currentUser && currentUser.email) {
        for (const dbKey in databaseMap) {
            const entry = databaseMap[dbKey];
            if (entry.email && entry.email.toLowerCase() === currentUser.email.toLowerCase()) {
                studentUIDs = (entry.uids || []).concat(entry.hardware_uids || []);
                break;
            }
        }
    }
    const norm = (str) => (str || '').toString().toLowerCase().trim();
    const normalizedUIDs = studentUIDs.map(norm);
    const userEmailNorm = norm(currentUser.email);
    const userNameNorm = norm(currentUser.name);

    // 2. Filter active (non-archived) courses where student has at least 1 entry
    const allActiveCourses = Object.keys(courseInfoMap)
        .sort((a, b) => compareCoursesForDisplay([a, courseInfoMap[a]], [b, courseInfoMap[b]]))
        .filter(courseName => !courseInfoMap[courseName]?.archived);

    const enrolledCourses = allActiveCourses.filter(courseName => {
        const logs = (courseData[courseName]?.logs || studentLogCache[courseName] || []);
        if (logs.length === 0) return false;
        return logs.some(log => {
            const logUidNorm = norm(log.uid);
            const logEmailNorm = norm(log.email);
            const logNameNorm = norm(log.name);
            return (
                (logUidNorm && normalizedUIDs.includes(logUidNorm)) ||
                (logEmailNorm && logEmailNorm === userEmailNorm) ||
                (logNameNorm && logNameNorm === userNameNorm) ||
                (normalizedUIDs.length === 0 && !logEmailNorm && logs.length > 0)
            );
        });
    });

    const isEnrolledEmpty = enrolledCourses.length === 0;
    const courseOptions = isEnrolledEmpty
        ? '<option value="" disabled selected>No enrolled courses available</option>'
        : '<option value="" disabled selected>Select Course...</option>' + enrolledCourses.map(courseName => {
            const cleanName = getCleanCourseCode(courseName, courseInfoMap[courseName]?.eisId);
            return `<option value="${escapeHtml(courseName)}">${escapeHtml(cleanName)}</option>`;
        }).join('');

    const emptyCourseExplanation = isEnrolledEmpty
        ? `<small id="no-enrolled-courses-msg" style="color:var(--text-muted, #777); font-size:0.8em; display:block; margin-top:4px;"><i class="fa-solid fa-circle-info"></i> No enrolled courses found with your attendance records yet.</small>`
        : '';

    const hoursList = ['8:40–9:30', '9:40–10:30', '10:40–11:30', '11:40–12:30', '12:40–13:30', '13:40–14:30', '14:40–15:30', '15:40–16:30', '16:00–16:50', '17:00–17:50', '18:00–18:50', '19:00–19:50'];
    const hourButtons = hoursList.map(h => `<button type="button" class="toggle-button" data-value="${h}" style="font-family:'Google Sans Flex', sans-serif; overflow:visible; text-overflow:clip; font-size:0.8em; padding:10px 2px;">${h}</button>`).join('');

    dialog.innerHTML = `
<h3 class="dialog-title"><i class="fa-solid fa-hand-point-up"></i> Request for Permission</h3>
<div class="dialog-content">

<div class="dialog-disclaimer">
        <i class="fa-solid fa-circle-info"></i> Per university regulations, absences are unexcused by default. Although missing a few classes is normal, this form is provided as a professional courtesy.
    </div>
    
    <div class="form-section-title" style="margin-top:0;">Details</div>
    
    <div class="form-group required">
        <label class="dialog-label-fixed"><i class="fa-solid fa-book"></i> Course</label>
        <div class="form-group-control">
            <select id="request-course" class="form-control" ${isEnrolledEmpty ? 'disabled' : ''}>
                ${courseOptions}
            </select>
            ${emptyCourseExplanation}
        </div>
    </div>

    <div id="request-session-container" style="display:none; margin-bottom:15px;">
        <div class="form-group required" style="align-items:flex-start;">
            <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-users"></i> Group</label>
            <div style="flex-grow:1;">
                <div id="req-session-wrapper"></div>
            </div>
        </div>
    </div>

    <div class="form-group required" style="align-items:flex-start;">
        <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-regular fa-calendar-days"></i> Date</label>
        <div class="form-group-control">
            <input type="date" id="request-date" class="form-control" value="" min="${minDateStr}" max="${maxDateStr}" required>
            <small style="color:#666; font-size:0.8em; display:block; margin-top:4px;">
                <i class="fa-solid fa-circle-info"></i> Select the date you were (or will be) absent.
            </small>
        </div>
    </div>

    <div class="form-group required" style="align-items:flex-start;">
        <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-regular fa-clock"></i> Hours</label>
        <div id="request-hours-group" class="form-group-control" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px;">
            ${hourButtons}
        </div>
    </div>


    <div class="form-section-title">Reason</div>

    <div id="reason-grid" class="reason-grid">
        <div class="reason-card" data-value="Medical">
            <i class="fa-solid fa-bed"></i>
            <span>Calling Sick</span>
        </div>
        <div class="reason-card" data-value="Conference">
            <i class="fa-solid fa-person-chalkboard"></i>
            <span>Academic Event</span>
        </div>
        <div class="reason-card" data-value="Official">
            <i class="fa-solid fa-person-military-pointing"></i>
            <span>Official Appointment</span>
        </div>
        <div class="reason-card" data-value="Bus">
            <i class="fa-solid fa-bus"></i>
            <span>Bus Issue</span>
        </div>
        <div class="reason-card" data-value="Club">
            <i class="fa-solid fa-people-robbery"></i>
            <span>Student Event</span>
        </div>
        <div class="reason-card" data-value="Confidential">
            <i class="fa-solid fa-user-tie"></i>
            <span>Personal Matter</span>
        </div>
    </div>
    
    <div id="reason-help-text" style="display:none; background-color:#e3f2fd; color:#0d47a1; padding:12px; border-radius:8px; margin-bottom:15px; font-size:0.9em; line-height:1.4; border-left:4px solid #2196F3;"></div>

    <div class="form-group" id="request-file-group" style="display:none; align-items:flex-start;">
        <label class="dialog-label-fixed" id="request-file-label" style="margin-top:10px;">Document</label>
        <div class="form-group-control">
           <input type="file" id="request-file-upload" class="form-control" accept=".pdf,image/*">
           <small style="opacity:0.7;">Max 5 MB</small>
        </div>
    </div>

    <div class="form-group" id="request-expl-group" style="display:none; align-items:flex-start;">
        <label class="dialog-label-fixed" id="request-expl-label" style="margin-top:10px;">Details</label>
        <textarea id="request-explanation" class="form-control form-group-control" rows="3"></textarea>
    </div>

    <div class="form-section-title" style="margin-top:20px;">Verification</div>
    <div class="form-group" style="align-items:flex-start;">
        <label class="dialog-label-fixed" style="margin-top:10px;"><i class="fa-solid fa-calculator"></i> Solve</label>
        <div class="form-group-control">
            <div id="captcha-question" style="font-size:1.2em; font-weight:600; margin-bottom:10px; font-family:'Google Sans Code', monospace; background:var(--card-background); color:var(--text-color); padding:10px 15px; border-radius:8px; text-align:center; border:1px solid var(--border-color, #ddd);-webkit-user-select: none;
            /* Safari */
            -moz-user-select: none;
            /* Firefox */
            -ms-user-select: none;
            /* IE10+/Edge */
            user-select: none;
            /* Standard */"></div>
            <div id="captcha-choices" class="course-buttons-container" style="margin-bottom:0; gap:8px; flex-wrap:nowrap;"></div>
        </div>
    </div>

</div>
<div class="dialog-actions">
    <button id="cancel-request-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
    <button id="submit-request-btn" class="btn-green" disabled><i class="fa-solid fa-paper-plane"></i> Submit</button>
</div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- Variables ---
    const courseSelect = document.getElementById('request-course');
    const sessionContainer = document.getElementById('request-session-container');
    const sessionWrapper = document.getElementById('req-session-wrapper');
    const reasonGrid = document.getElementById('reason-grid');
    const helpText = document.getElementById('reason-help-text');
    const fileGroup = document.getElementById('request-file-group');
    const fileLabel = document.getElementById('request-file-label');
    const explGroup = document.getElementById('request-expl-group');
    const explLabel = document.getElementById('request-expl-label');
    const explInput = document.getElementById('request-explanation');
    const submitBtn = document.getElementById('submit-request-btn');
    const hoursGroup = document.getElementById('request-hours-group');

    let selectedReason = null;
    let captchaAnswer = null;
    let captchaSolved = false;

    // --- CAPTCHA LOGIC ---
    function generateCaptcha() {
        captchaSolved = false;
        const captchaChoices = document.getElementById('captcha-choices');
        const captchaQuestion = document.getElementById('captcha-question');

        // Generate complex math expression with random templates
        const ops = ['+', '−', '×'];
        const getOp = () => ops[Math.floor(Math.random() * ops.length)];
        const getNum = (max = 10) => Math.floor(Math.random() * max) + 1;
        const toJs = (op) => op === '−' ? '-' : op === '×' ? '*' : '+';

        // Random numbers
        const a = getNum(12), b = getNum(10), c = getNum(8), d = getNum(6), e = getNum(5);
        const op1 = getOp(), op2 = getOp(), op3 = getOp();

        // Different expression templates
        const templates = [
            // (a op b) op c × d
            { display: `(${a} ${op1} ${b}) ${op2} ${c} × ${d}`, js: `(${a} ${toJs(op1)} ${b}) ${toJs(op2)} ${c} * ${d}` },
            // a × (b op c) op d
            { display: `${a} × (${b} ${op1} ${c}) ${op2} ${d}`, js: `${a} * (${b} ${toJs(op1)} ${c}) ${toJs(op2)} ${d}` },
            // a op b × (c op d)
            { display: `${a} ${op1} ${b} × (${c} ${op2} ${d})`, js: `${a} ${toJs(op1)} ${b} * (${c} ${toJs(op2)} ${d})` },
            // (a op b) × (c op d)
            { display: `(${a} ${op1} ${b}) × (${c} ${op2} ${d})`, js: `(${a} ${toJs(op1)} ${b}) * (${c} ${toJs(op2)} ${d})` },
            // a × b op c × d
            { display: `${a} × ${b} ${op1} ${c} × ${d}`, js: `${a} * ${b} ${toJs(op1)} ${c} * ${d}` },
            // (a op b op c) × d
            { display: `(${a} ${op1} ${b} ${op2} ${c}) × ${d}`, js: `(${a} ${toJs(op1)} ${b} ${toJs(op2)} ${c}) * ${d}` },
            // a op (b × c op d)
            { display: `${a} ${op1} (${b} × ${c} ${op2} ${d})`, js: `${a} ${toJs(op1)} (${b} * ${c} ${toJs(op2)} ${d})` },

            // TEMPLATES
            // a + b + c + d
            { display: `${a} + ${b} + ${c} + ${d}`, js: `${a} + ${b} + ${c} + ${d}` },
            // (a + b) × (c - d)
            { display: `(${a} + ${b}) × (${c} − ${d})`, js: `(${a} + ${b}) * (${c} - ${d})` },
            // a × b − c × d
            { display: `${a} × ${b} − ${c} × ${d}`, js: `${a} * ${b} - ${c} * ${d}` },
            // (a × b) + (c × d)
            { display: `(${a} × ${b}) + (${c} × ${d})`, js: `(${a} * ${b}) + (${c} * ${d})` },
            // a + (b × c) - d
            { display: `${a} + (${b} × ${c}) − ${d}`, js: `${a} + (${b} * ${c}) - ${d}` },
            // (a - b) × (c + d)
            { display: `(${a} − ${b}) × (${c} + ${d})`, js: `(${a} - ${b}) * (${c} + ${d})` },
            // a × b + c - d
            { display: `${a} × ${b} + ${c} − ${d}`, js: `${a} * ${b} + ${c} - ${d}` },
            // a + b × c + d
            { display: `${a} + ${b} × ${c} + ${d}`, js: `${a} + ${b} * ${c} + ${d}` },
            // (a + b + c) × d
            { display: `(${a} + ${b} + ${c}) × ${d}`, js: `(${a} + ${b} + ${c}) * ${d}` },
            // a × (b - c) + d
            { display: `${a} × (${b} − ${c}) + ${d}`, js: `${a} * (${b} - ${c}) + ${d}` },
            // a - b + c - d
            { display: `${a} − ${b} + ${c} − ${d}`, js: `${a} - ${b} + ${c} - ${d}` },
            // a × (b + c + d)
            { display: `${a} × (${b} + ${c} + ${d})`, js: `${a} * (${b} + ${c} + ${d})` },
            // (a - b) - (c - d)
            { display: `(${a} − ${b}) − (${c} − ${d})`, js: `(${a} - ${b}) - (${c} - ${d})` },
            // a × b × c - d
            { display: `${a} × ${b} × ${c} − ${d}`, js: `${a} * ${b} * ${c} - ${d}` },
            // a + b - (c × d)
            { display: `${a} + ${b} − (${c} × ${d})`, js: `${a} + ${b} - (${c} * ${d})` },
            // (a × b) - (c + d)
            { display: `(${a} × ${b}) − (${c} + ${d})`, js: `(${a} * ${b}) - (${c} + ${d})` },
            // a × b × (c - d)
            { display: `${a} × ${b} × (${c} − ${d})`, js: `${a} * ${b} * (${c} - ${d})` },
            // (a + b) × c - d
            { display: `(${a} + ${b}) × ${c} − ${d}`, js: `(${a} + ${b}) * ${c} - ${d}` },
        ];

        const template = templates[Math.floor(Math.random() * templates.length)];
        captchaAnswer = eval(template.js);
        captchaQuestion.textContent = template.display + ' = ?';

        // Generate choices: 1 correct + 3 wrong
        const wrongAnswers = new Set();
        while (wrongAnswers.size < 3) {
            const offset = Math.floor(Math.random() * 40) - 20; // Random offset between -20 and +20
            const wrong = captchaAnswer + offset;
            if (wrong !== captchaAnswer && !wrongAnswers.has(wrong)) {
                wrongAnswers.add(wrong);
            }
        }

        const allChoices = [captchaAnswer, ...wrongAnswers];
        // Shuffle
        for (let i = allChoices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [allChoices[i], allChoices[j]] = [allChoices[j], allChoices[i]];
        }

        captchaChoices.innerHTML = allChoices.map(val =>
            `<div class="course-button captcha-choice" data-value="${val}" style="flex:1; min-width:0; padding:10px 8px; justify-content:center;">${val}</div>`
        ).join('');


        // Reset visual state
        captchaChoices.querySelectorAll('.captcha-choice').forEach(btn => {
            btn.classList.remove('active', 'correct', 'incorrect');
        });
    }

    // Initialize captcha
    generateCaptcha();

    // Handle captcha choice clicks
    document.getElementById('captcha-choices').addEventListener('click', (e) => {
        const btn = e.target.closest('.captcha-choice');
        if (!btn || captchaSolved) return;

        const chosen = parseInt(btn.dataset.value, 10);

        // Reset all buttons
        document.querySelectorAll('.captcha-choice').forEach(b => b.classList.remove('active', 'correct', 'incorrect'));

        if (chosen === captchaAnswer) {
            btn.classList.add('active', 'correct');
            btn.style.background = '#4caf50';
            btn.style.color = '#fff';
            captchaSolved = true;
        } else {
            btn.classList.add('incorrect');
            btn.style.background = '#f44336';
            btn.style.color = '#fff';
            // Generate new captcha after wrong answer
            setTimeout(() => {
                generateCaptcha();
            }, 1500);
        }
    });

    // --- SESSION SELECTOR LOGIC ---
    courseSelect.addEventListener('change', () => {
        const courseName = courseSelect.value;
        if (!courseName) return;

        const rawSections = courseInfoMap[courseName]?.availableSections || '';
        const sectionsMap = parseAvailableSections(rawSections);
        const categories = Object.keys(sectionsMap);

        if (categories.length > 0) {
            sessionContainer.style.display = 'block';

            let html = `<div id="req-session-controls" style="margin-top:5px;">`;
            html += `<input type="hidden" id="req-selected-session" value="">`;

            const icons = { 'theory': 'fa-book', 'lab': 'fa-desktop', 'practice': 'fa-pen-to-square' };
            let catHtml = '';
            categories.forEach((cat, idx) => {
                const icon = icons[cat.toLowerCase()] || 'fa-tag';
                catHtml += `<div class="course-button ${idx === 0 ? 'active' : ''}" data-type="cat" data-val="${cat}" style="flex:1; padding:8px 5px; font-size:0.9em; min-width:0;"><i class="fa-solid ${icon}"></i>&nbsp;${cat}</div>`;
            });
            html += `<div class="course-buttons-container" id="req-cat-row" style="display:flex; margin-bottom:8px; gap:5px; flex-wrap:nowrap;">${catHtml}</div>`;

            categories.forEach((cat, idx) => {
                const groups = sectionsMap[cat] || [];
                if (groups.length > 0) {
                    let grpHtml = '';
                    groups.forEach((grp, gIdx) => {
                        grpHtml += `<div class="course-button ${gIdx === 0 ? 'active' : ''}" data-type="grp" data-val="${grp}" style="min-width:35px; padding:8px 0; justify-content:center;"><b>${grp}</b></div>`;
                    });

                    const isInitialActive = (idx === 0);
                    const hasMultipleGroups = (groups.length > 1);
                    const grpDisplay = (isInitialActive && hasMultipleGroups) ? 'flex' : 'none';

                    html += `<div class="course-buttons-container req-grp-row" id="req-grp-${cat}" data-has-multiple="${hasMultipleGroups}" style="display:${grpDisplay}; gap:5px; margin-bottom:0;">${grpHtml}</div>`;
                }
            });
            html += `</div>`;
            sessionWrapper.innerHTML = html;

            updateRequestSessionValue();

            const catRow = document.getElementById('req-cat-row');
            catRow.addEventListener('click', (e) => {
                const btn = e.target.closest('.course-button');
                if (!btn) return;
                catRow.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const cat = btn.dataset.val;

                sessionWrapper.querySelectorAll('.req-grp-row').forEach(row => row.style.display = 'none');
                const targetRow = document.getElementById(`req-grp-${cat}`);

                if (targetRow && targetRow.dataset.hasMultiple === 'true') {
                    targetRow.style.display = 'flex';
                }
                updateRequestSessionValue();
            });

            sessionWrapper.querySelectorAll('.req-grp-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    const btn = e.target.closest('.course-button');
                    if (!btn) return;
                    row.querySelectorAll('.course-button').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    updateRequestSessionValue();
                });
            });

        } else {
            sessionContainer.style.display = 'none';
            sessionWrapper.innerHTML = '';
        }
    });

    function updateRequestSessionValue() {
        const catBtn = document.querySelector('#req-cat-row .active');
        if (!catBtn) return;
        const cat = catBtn.dataset.val;

        const grpRow = document.getElementById(`req-grp-${cat}`);
        let session = cat;

        if (grpRow) {
            const grpBtn = grpRow.querySelector('.active');
            if (grpBtn) session += ' ' + grpBtn.dataset.val;
        }
        document.getElementById('req-selected-session').value = session;
    }

    // --- Hours Logic ---
    courseSelect.addEventListener('change', () => {
        hoursGroup.querySelectorAll('.active').forEach(b => b.classList.remove('active'));
    });

    hoursGroup.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-button')) {
            if (!courseSelect.value) {
                showNotification('warning', 'Missing Info', 'Select a course first.');
                return;
            }
            e.target.classList.toggle('active');
        }
    });

    // --- REASON LOGIC ---
    reasonGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.reason-card');
        if (!card) return;

        document.querySelectorAll('.reason-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        selectedReason = card.dataset.value;

        // 1. RESET EVERYTHING
        helpText.style.display = 'none';
        helpText.style.background = '#e3f2fd'; // Reset info blue
        helpText.style.color = '#0d47a1';
        helpText.style.borderLeftColor = '#2196F3';

        fileGroup.style.display = 'none';
        explGroup.style.display = 'none';
        submitBtn.disabled = false;
        explInput.value = '';
        explInput.removeAttribute('minlength');
        explInput.placeholder = "";

        // Reset Labels
        fileLabel.innerHTML = 'Document';
        explLabel.innerHTML = 'Details';

        // 2. APPLY LOGIC
        switch (selectedReason) {
            case 'Medical': // Calling Sick
                // File Required, Expl Optional
                fileGroup.style.display = 'flex';
                fileLabel.innerHTML = 'Medical Report <span style="color:red">*</span>';

                explGroup.style.display = 'flex';
                explLabel.innerHTML = 'Explanation';

                helpText.innerHTML = `Please attach your Medical Report (Raporti Mjekësor) or any other documentation.`;
                helpText.style.display = 'block';
                break;

            case 'Conference':
                fileGroup.style.display = 'flex';
                fileLabel.innerHTML = 'Invitation <span style="color:red">*</span>';
                helpText.innerHTML = `Please attach your invitation letter.`;
                helpText.style.display = 'block';
                break;

            case 'Official': // Official Appointment
                // File Required, Expl Optional
                fileGroup.style.display = 'flex';
                fileLabel.innerHTML = 'Document <span style="color:red">*</span>';

                explGroup.style.display = 'flex';
                explLabel.innerHTML = 'Explanation';

                helpText.innerHTML = `Please attach your official summon (Court, Embassy, Police).`;
                helpText.style.display = 'block';
                break;

            case 'Bus':
                explGroup.style.display = 'flex';
                explInput.setAttribute('minlength', '20');
                explLabel.innerHTML = 'Explanation <span style="color:red">*</span>';

                fileGroup.style.display = 'flex';
                fileLabel.innerHTML = 'Attachment';
                helpText.innerHTML = `<strong>Note:</strong> Only applies to the university's bus line.`;
                helpText.style.display = 'block';
                break;

            case 'Club':
                submitBtn.disabled = true; // Disabled - Dean must email
                helpText.style.background = '#fff3e0';
                helpText.style.color = '#ef6c00';
                helpText.style.borderLeftColor = '#ff9800';
                helpText.innerHTML = `<i class="fa-solid fa-envelope"></i> The Dean of Students Office must email the lecturer to request permission on your behalf.`;
                helpText.style.display = 'block';
                break;

            case 'Confidential': // Personal Matter
                // Enabled, REQUIRED Explanation
                submitBtn.disabled = false;

                explGroup.style.display = 'flex';
                explLabel.innerHTML = 'Explanation <span style="color:red">*</span>';
                explInput.placeholder = "Please explain the situation in detail...";

                // Set min length for validation later
                explInput.setAttribute('minlength', '50');

                helpText.style.background = '#fff3e0';
                helpText.style.color = '#ef6c00';
                helpText.style.borderLeftColor = '#ff9800';
                helpText.innerHTML = `<i class="fa-solid fa-lock"></i> If you cannot write it here, please visit the lecturer's office to discuss in person.`;
                helpText.style.display = 'block';
                break;
        }
    });

    // --- SUBMIT LOGIC ---
    submitBtn.addEventListener('click', () => {
        const hours = Array.from(hoursGroup.querySelectorAll('.active')).map(b => b.dataset.value);
        const date = document.getElementById('request-date').value;
        const course = courseSelect.value;
        const file = document.getElementById('request-file-upload').files[0];
        const explanation = explInput.value.trim();

        const sessionInput = document.getElementById('req-selected-session');
        const session = sessionInput ? sessionInput.value : 'Default';

        // 1. General Validation
        let errors = [];
        if (!course) errors.push("Select a course.");
        if (!date) errors.push("Select a date.");
        // min/max only limit the picker; a typed date can fall outside them.
        else if (date < minDateStr || date > maxDateStr) errors.push("Choose a date from the last 2 working days up to 7 working days ahead.");
        if (hours.length === 0) errors.push("Select at least one hour.");
        if (!selectedReason) errors.push("Select a reason.");
        if (!captchaSolved) errors.push("Please solve the verification puzzle.");

        // 2. Reason Specific Validation
        if (selectedReason === 'Medical' && !file) errors.push("Medical report is required.");
        if (selectedReason === 'Official' && !file) errors.push("Official document is required.");
        if (selectedReason === 'Conference' && !file) errors.push("Event document is required.");

        // 3. Explanation Validation
        if (selectedReason === 'Bus') {
            if (!explanation) errors.push("Explanation is required for bus issues.");
            else if (explanation.length < 20) errors.push("Please explain the bus issue in detail (at least 20 characters).");
        }

        if (selectedReason === 'Confidential') {
            if (!explanation) errors.push("Explanation is required for personal matters.");
            else if (explanation.length < 50) errors.push("Please provide more detail for personal matters (at least 50 characters).");
        }

        // 4. Attachment validation (UX only — the Storage bucket enforces the same limits)
        if (file) {
            const ALLOWED_FILE_TYPES = [
                'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
                'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            ];
            if (file.size > 5 * 1024 * 1024) errors.push("Attachment is too large (max 5 MB).");
            if (file.type && !ALLOWED_FILE_TYPES.includes(file.type)) errors.push("Unsupported file type. Use a PDF, an image, or a Word document.");
        }

        if (errors.length > 0) {
            showNotification('warning', 'Missing Info', errors.join('\n'));
            return;
        }

        // Submit
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spin fa-circle-notch"></i> Sending...';

        const payload = {
            name: currentUser.name,
            email: currentUser.email,
            course: course,
            absenceDate: date,
            hours: hours.join(', '),
            reasonType: selectedReason,
            description: explanation,
            session: session
        };

        // The file is uploaded straight to Supabase Storage by the submit handler
        if (file) payload.file = file;
        sendRequest(payload);
    });

    async function sendRequest(payload) {
        try {
            const res = await callWebApp('submitAbsenceRequest', payload, 'POST');
            if (res.result === 'success') {
                showNotification('success', 'Sent', 'Request submitted.');
                document.body.removeChild(dialogBackdrop); closeDialogMode();
            } else throw new Error(res.message);
        } catch (e) {
            showNotification('error', 'Error', e.message);
            submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit';
        }
    }

    document.getElementById('cancel-request-btn').onclick = () => {
        document.body.removeChild(dialogBackdrop); closeDialogMode();
    };
}

// --- Dialogs for Admin Actions ---
function showApproveAbsenceDialog(data) {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // --- 1. Create Hour Toggle Buttons ---
    const originalHours = data.hours.split(',').map(h => h.trim());
    const hourButtons = originalHours.map(hour =>
        `<button type="button" class="toggle-button active" data-value="${hour}">${hour}</button>`
    ).join('');

    // --- 2. Create Default Message (with FIRST NAME) ---
    const firstName = data.studentName ? data.studentName.split(' ')[0] : 'Student';
    const greeting = `Dear ${firstName},`;

    const defaultMessage = "";

    // --- 3. Build Dialog HTML ---
    dialog.innerHTML = `
<h3 class="dialog-title">Approve Permission Request</h3>
<div class="dialog-content">
    <p>Approve hours for <strong>${escapeHtml(data.studentName)}</strong>. Unselect any hours you wish to deny.</p>
    
    <div class="form-group" style="align-items: flex-start;">
        <label>Hours</label>
        <div id="approve-hours-group" class="toggle-button-group" style="flex-wrap: wrap;">
            ${hourButtons}
        </div>
    </div>
    
    <hr style="margin: 20px 0;">

    <div class="form-group" style="align-items: flex-start;">
        <label for="approve-message-area">Email Message</label>
        <textarea id="approve-message-area" class="form-control" rows="6" placeholder="Add a custom message...">${defaultMessage}</textarea>
    </div>
    <div style="text-align: right; font-size: 0.8em; opacity: 0.7;">
        An approval email will be sent.
    </div>
</div>
<div class="dialog-actions">
    <button id="cancel-approve-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
    <button id="confirm-approve-btn" class="btn-green"><i class="fa-solid fa-check"></i> Approve</button>
</div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- 4. Add Event Listeners ---
    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    const confirmBtn = dialog.querySelector('#confirm-approve-btn');
    const cancelBtn = dialog.querySelector('#cancel-approve-btn');
    const messageArea = dialog.querySelector('#approve-message-area');
    const hoursGroup = dialog.querySelector('#approve-hours-group');

    // Multi-select toggle logic
    hoursGroup.addEventListener('click', (e) => {
        if (e.target.classList.contains('toggle-button')) {
            e.target.classList.toggle('active');

            const approvedCount = hoursGroup.querySelectorAll('.toggle-button.active').length;

            // Disable the confirm button if no hours are selected
            confirmBtn.disabled = (approvedCount === 0);
            if (approvedCount === 0) {
                confirmBtn.title = 'You must select at least one hour to approve.';
            } else {
                confirmBtn.title = 'Approve Selected Hours';
            }
        }
    });

    cancelBtn.addEventListener('click', closeDialog);

    confirmBtn.addEventListener('click', () => {
        const approvedHours = Array.from(hoursGroup.querySelectorAll('.toggle-button.active'))
            .map(btn => btn.dataset.value);


        const message = messageArea.value; // Get the message (it can be empty)


        // --- 5. Show Loading State ---
        const idleLabel = confirmBtn.innerHTML;
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Approving...';

        // --- 6. Call Backend ---
        callWebApp('approveAbsenceRequest', {
            requestID: data.requestId,
            studentName: data.studentName,
            studentEmail: data.studentEmail,
            originalHours: originalHours.join(', '),
            approvedHours: approvedHours.join(', '),
            customMessage: message,
            courseName: data.course
        }, 'POST')
            .then(result => {
                if (result && result.result === 'success') {
                    showNotification('success', 'Approved', `Permission for ${data.studentName} approved.`);
                    notifyIfEmailFailed(result, data.studentEmail);
                    refreshAdminViews();

                    if (result.newLogs && result.newLogs.length > 0) {
                        const courseName = result.newLogs[0].course || currentCourse;
                        if (courseData[courseName]) {
                            courseData[courseName].logs.unshift(...result.newLogs);
                            courseData[courseName].logs.sort((a, b) => b.timestamp - a.timestamp);
                            if (courseName === currentCourse) {
                                updateLogsList();
                            }
                        }
                    }
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Approval failed.');
                }
            })
            .catch(err => {
                showNotification('error', 'Approval Failed', err.message);
                confirmBtn.disabled = false;
                cancelBtn.disabled = false;
                confirmBtn.innerHTML = idleLabel;
            });
    });
}

function showRejectAbsenceDialog(data) {
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');

    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const defaultMessage = "";

    dialog.innerHTML = `
<h3 class="dialog-title">Reject Permission Request</h3>
<div class="dialog-content">
    <p>This will reject the request for <strong>${escapeHtml(data.studentName)}</strong>. The student will be notified by email.</p>
    <div class="form-group" style="margin-top: 15px;">
        <label for="reject-message-area">Reason</label>
        <textarea id="reject-message-area" class="form-control" rows="6" placeholder="Add a reason for rejection...">${defaultMessage}</textarea>
    </div>
</div>
<div class="dialog-actions">
    <button id="cancel-reject-btn" class="btn-blue"><i class="fa-solid fa-xmark"></i> Cancel</button>
    <button id="confirm-reject-btn" class="btn-red"><i class="fa-solid fa-ban"></i> Reject</button>
</div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    const confirmBtn = dialog.querySelector('#confirm-reject-btn');
    const cancelBtn = dialog.querySelector('#cancel-reject-btn');
    const messageArea = dialog.querySelector('#reject-message-area');

    cancelBtn.addEventListener('click', closeDialog);

    confirmBtn.addEventListener('click', () => {
        const message = messageArea.value;

        const idleLabel = confirmBtn.innerHTML;
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending...';

        callWebApp('rejectAbsenceRequest', {
            requestID: data.requestId,
            studentName: data.studentName,
            studentEmail: data.studentEmail,
            rejectionMessage: message,
            courseName: data.course
        }, 'POST')
            .then(result => {
                if (result && result.result === 'success') {
                    if (result.emailFailed) notifyIfEmailFailed(result, data.studentEmail);
                    else showNotification('success', 'Rejected', `Rejection email sent to ${data.studentName}.`);
                    refreshAdminViews();
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Rejection failed.');
                }
            })
            .catch(err => {
                showNotification('error', 'Rejection Failed', err.message);
                confirmBtn.disabled = false;
                cancelBtn.disabled = false;
                confirmBtn.innerHTML = idleLabel;
            });
    });
}

function showDeleteAbsenceDialog(data) {
    showConfirmationDialog({
        title: 'Delete Request?',
        message: `Are you sure you want to delete this pending request from <strong>${escapeHtml(data.studentName)}</strong>?<br><br><strong>This action is permanent and sends no email.</strong>`,
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: () => {
            callWebApp('deleteAbsenceRequest', { requestID: data.requestId }, 'POST')
                .then(result => {
                    if (result && result.result === 'success') {
                        showNotification('delete', 'Deleted', `Request from ${data.studentName} was deleted.`);
                        refreshAdminViews(); // Refresh the list
                    } else {
                        throw new Error(result?.message || 'Delete failed.');
                    }
                })
                .catch(err => showNotification('error', 'Delete Failed', err.message));
        }
    });
}

/**
 * Shows a custom dialog to reject a registration with a refined default message.
 */
function showRejectDialog(registration) {
    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    let firstName = "Student";
    let greeting = "Dear,";
    if (registration.name) {
        firstName = registration.name.split(' ')[0];
        greeting = `Dear ${firstName},`;
    }
    const defaultMessage = `I am writing to inform you that your application for your card has been rejected. This is typically because the information provided was incorrect or incomplete.\n\nPlease submit your registration again, ensuring all details are correct.`;

    dialog.innerHTML = `
    <h3 class="dialog-title">Reject Application</h3>
    <div class="dialog-content">
        <p style="margin-bottom:15px;">Edit the reason for rejection below.</p>
        
        <div class="form-group" style="align-items:flex-start;">
            <label class="dialog-label-fixed" style="margin-top:10px;">Reason</label>
            <textarea id="reject-message" class="form-control" rows="10">${defaultMessage}</textarea>
        </div>
        
        <p style="font-size:0.85em; color:#666; text-align:right; margin-top:5px;">This message will be emailed to ${escapeHtml(registration.email)}.</p>
    </div>
    <div class="dialog-actions">
        <button id="cancel-reject-btn" class="btn-blue"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="confirm-reject-btn" class="btn-red"><i class="fa-solid fa-ban"></i> Reject</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    document.getElementById('cancel-reject-btn').addEventListener('click', closeDialog);

    const confirmBtn = document.getElementById('confirm-reject-btn');
    confirmBtn.addEventListener('click', () => {
        const messageTextarea = document.getElementById('reject-message');
        clearInputError(messageTextarea);
        const message = messageTextarea.value.trim();
        if (!message) { showInputError(messageTextarea, 'Rejection message cannot be empty.'); return; }

        const idleLabel = confirmBtn.innerHTML;
        confirmBtn.disabled = true; confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Rejecting...';
        const data = { message: message, email: registration.email, rowNumber: registration.rowNumber, name: registration.name };
        callWebApp('rejectRegistration', data, 'POST').then(result => {
            if (result && result.result === 'success') {
                if (result.emailFailed) notifyIfEmailFailed(result, registration.email);
                else showNotification('success', 'Rejected', `Rejection email sent to ${registration.name}.`);
                refreshAdminViews(); closeDialog();
            } else { throw new Error(result ? result.message : 'Rejection failed.'); }
        }).catch(err => { showNotification('error', 'Rejection Failed', err.message); confirmBtn.disabled = false; confirmBtn.innerHTML = idleLabel; });
    });
}

async function callWebApp(action, payload = {}) {
    try {
        return await callSupabase(action, payload);
    } catch (error) {
        console.error(`Error calling Supabase action "${action}":`, error);
        throw error;
    }
}

// Sends a transactional email via the send-email Edge Function
async function invokeSendEmail(body) {
    const { data, error } = await supabaseClient.functions.invoke('send-email', { body });
    if (error) throw new Error('Email sending failed: ' + error.message);
    if (data && data.result === 'error') throw new Error('Email sending failed: ' + data.message);
}

// Emails follow a change that is already saved. A failed email must not report
// the change as failed, or a retry would repeat it (a second student, a second approval).
async function trySendEmail(body) {
    try {
        await invokeSendEmail(body);
        return false;
    } catch (error) {
        console.warn('Email not sent:', error);
        return true;
    }
}

// The action succeeded; only its email did not go out.
function notifyIfEmailFailed(result, recipient) {
    if (!result?.emailFailed) return;
    showNotification('warning', 'Email Not Sent',
        `The change was saved, but the email to ${recipient || 'the student'} could not be sent. Let them know directly.`, 10000);
}

// A newly approved card is recognised on the next scan, not only after a reload.
function refreshDatabaseAfterApproval() {
    invalidateDatabaseCache();
    fetchDatabaseFromSheet()
        .then(() => { window.buildUIDToPrimaryUidMap(); updateUI(); })
        .catch(error => console.warn('Could not reload the student list:', error));
}

// Opens an attachment: old rows hold full Drive URLs, new rows hold a Storage path
async function openAttachment(stored) {
    if (!stored) return;
    if (/^https?:\/\//i.test(stored)) { window.open(stored, '_blank'); return; }
    const { data, error } = await supabaseClient.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(stored, 300);
    if (error || !data) {
        showNotification('error', 'Attachment', 'Could not open the attachment.');
        return;
    }
    window.open(data.signedUrl, '_blank');
}
window.openAttachment = openAttachment;

// Same-tab variant for ?attachment= deep links from emails
async function resolveEmailAttachmentLink(stored) {
    if (/^https?:\/\//i.test(stored)) { window.location.href = stored; return; }
    const { data, error } = await supabaseClient.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(stored, 300);
    if (error || !data) {
        showNotification('error', 'Attachment', 'Could not open the attachment. Only course admins and the requester can view it.');
        return;
    }
    window.location.href = data.signedUrl;
}

// --- Direct path: Supabase under RLS (queries + SECURITY DEFINER RPCs) ---

// Unwraps a supabase-js response, throwing on error
function sbUnwrap({ data, error }) {
    if (error) throw new Error(error.message);
    return data;
}

async function sbSessionEmail() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        handleSignoutClick();
        throw new Error("User not signed in or token expired.");
    }
    return (session.user.email || '').toLowerCase();
}

function sbMapCourseInfo(rows) {
    const courseInfoMap = {};
    (rows || []).forEach(row => {
        if (!row.name) return;
        courseInfoMap[row.name] = {
            startDate: row.start_date || '',
            endDate: row.end_date || '',
            holidayWeeks: row.holiday_weeks != null ? row.holiday_weeks.toString() : '',
            holidayStartDate: row.holiday_start_date || '',
            defaultHours: row.default_hours != null ? row.default_hours.toString() : '',
            eisId: row.eis_id || '',
            adminEmails: row.admin_emails || '',
            availableSections: row.available_sections || '',
            archived: row.archived || false
        };
    });
    return courseInfoMap;
}

function sbMapDatabase(rows) {
    const database = {};
    (rows || []).forEach(row => {
        if (row.id) {
            database[row.id] = {
                name: row.name || '',
                email: row.email || '',
                uids: Array.isArray(row.uids) ? row.uids : (row.uids ? [row.uids] : []),
                hardware_uids: Array.isArray(row.hardware_uids) ? row.hardware_uids : (row.hardware_uids ? [row.hardware_uids] : [])
            };
        }
    });
    return database;
}

async function sbGetAdminStatus() {
    return sbUnwrap(await supabaseClient.rpc('check_admin_status'));
}

// Staff photos and Google names come from each person's sign-in record
// (public.staff_profiles). Global administrators get every staff member,
// anyone else only themselves. Missing data never blocks the page.
async function sbGetStaffProfiles() {
    try {
        const { data, error } = await supabaseClient.rpc('staff_profiles');
        if (error) throw error;
        return new Map((data || []).filter(row => row && row.email).map(row => [String(row.email).trim().toLowerCase(), {
            name: row.name || '',
            googleName: row.google_name || '',
            photo: normalizeGooglePhotoUrl(row.photo_url || '')
        }]));
    } catch (error) {
        console.warn('Staff profiles unavailable:', error?.message || error);
        return new Map();
    }
}

// The name shown for a staff member: their custom name, else their Google name, else the e-mail.
function staffDisplayName(staff) {
    return String(staff?.name || '').trim() || staff?.googleName || staff?.email || '';
}

async function sbGetCourseInfo() {
    const rows = sbUnwrap(await supabaseClient.from('courses')
        .select('name,start_date,end_date,holiday_weeks,holiday_start_date,default_hours,eis_id,admin_emails,available_sections,archived'));
    return sbMapCourseInfo(rows);
}

// Read every page so a large roster or course is not silently truncated.
// The factory supplies a fresh, deterministically ordered query for each page.
async function sbSelectAll(queryFactory) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; ) {
        const page = sbUnwrap(await queryFactory().range(offset, offset + pageSize - 1)) || [];
        if (page.length === 0) return rows;
        rows.push(...page);
        offset += page.length;
    }
}

async function sbGetDatabase() {
    const studentRows = await sbSelectAll(() => supabaseClient.from('students')
        .select('id,name,email,uids,hardware_uids').order('id'));

    let staffRows = [];
    let staffProfiles = new Map();
    try {
        const staffRes = await supabaseClient.from('staff').select('name,email,uid,role');
        staffRows = staffRes.data || [];
        // Staff without a custom name are shown by their Google name.
        if (staffRows.some(s => s && !String(s.name || '').trim())) staffProfiles = await sbGetStaffProfiles();
    } catch (e) {
        console.warn('Staff fetch skipped or failed:', e);
    }

    const mapped = sbMapDatabase(studentRows);

    // Merge staff members into databaseMap so scanned staff cards resolve their name!
    (staffRows || []).forEach(s => {
        if (!s || !s.uid) return;
        const profile = staffProfiles.get(String(s.email || '').trim().toLowerCase()) || {};
        const displayName = staffDisplayName({ name: s.name, googleName: profile.googleName, email: s.email });
        if (!displayName) return;
        s = { ...s, name: displayName };
        const key = s.name.toLowerCase().trim();
        const rawUid = String(s.uid).trim();
        const convId = convertUidToExternalId(rawUid);
        const cardUids = [rawUid];
        const studentIds = convId ? [convId] : [rawUid];

        if (!mapped[key]) {
            mapped[key] = {
                name: s.name,
                email: s.email || '',
                uids: studentIds,
                hardware_uids: cardUids,
                role: s.role || 'Staff',
                isStaff: true
            };
        } else {
            studentIds.forEach(u => {
                if (!mapped[key].uids.includes(u)) mapped[key].uids.push(u);
            });
            cardUids.forEach(u => {
                if (!mapped[key].hardware_uids.includes(u)) mapped[key].hardware_uids.push(u);
            });
        }
    });

    return mapped;
}

async function sbGetMyUids() {
    const email = await sbSessionEmail();
    const rows = sbUnwrap(await supabaseClient.from('students')
        .select('uids').ilike('email', email));
    const uids = [];
    (rows || []).forEach(r => {
        if (r.uids) {
            r.uids.forEach(u => {
                const s = String(u).trim();
                if (!s) return;
                uids.push(s);
                const conv = convertUidToExternalId(s);
                if (conv && conv !== s) uids.push(conv);
            });
        }
    });
    return [...new Set(uids)];
}

// { courseName: true } map of courses visible to the current user
async function sbGetAvailableCourses(adminStatus) {
    const status = adminStatus || await sbGetAdminStatus();
    const result = {};

    if (status.courses && status.courses.length > 0) {
        status.courses.forEach(name => { result[name] = true; });
        return result;
    }
    if (status.isGlobalAdmin) {
        const rows = sbUnwrap(await supabaseClient.from('courses').select('name'));
        (rows || []).forEach(c => { if (c.name) result[c.name] = true; });
        return result;
    }
    if (status.isAdmin) return result;

    // Student path: courses where they have attendance logs
    const uids = await sbGetMyUids();
    if (uids.length === 0) return result;
    const rows = await sbSelectAll(() => supabaseClient.from('attendance_logs')
        .select('course_name').in('uid', uids).order('log_id'));
    (rows || []).forEach(log => { if (log.course_name) result[log.course_name] = true; });
    return result;
}

async function callSupabase(action, payload = {}) {
    const courseName = ('courseName' in payload) ? (payload.courseName || '') : (currentCourse || '');

    switch (action) {

        // ------------------------- reads -------------------------

        case 'getBootData': {
            const adminStatus = await sbGetAdminStatus();
            const [courses, database, courseInfo] = await Promise.all([
                sbGetAvailableCourses(adminStatus),
                sbGetDatabase(),
                sbGetCourseInfo()
            ]);
            return { result: 'success', adminStatus, courses, database, courseInfo };
        }

        case 'checkAdminStatus':
            return sbGetAdminStatus();

        case 'getDatabase':
            return sbGetDatabase();

        case 'getCourseInfo':
            return sbGetCourseInfo();

        case 'getAvailableCourses':
            return sbGetAvailableCourses();

        case 'getCourseLogs_Admin': {
            const [tombstoneRows, logRows] = await Promise.all([
                sbSelectAll(() => supabaseClient.from('deleted_logs')
                    .select('log_id,deleted_at').eq('course_name', courseName).order('log_id')),
                sbSelectAll(() => supabaseClient.from('attendance_logs')
                    .select('uid,timestamp,log_id,manual,version,updated_at,updated_by,session')
                    .eq('course_name', courseName).order('log_id'))
            ]);

            const deletedMap = {};
            (tombstoneRows || []).forEach(row => {
                const t = new Date(row.deleted_at).getTime();
                if (!deletedMap[row.log_id] || t > deletedMap[row.log_id]) deletedMap[row.log_id] = t;
            });

            const logs = (logRows || [])
                .filter(row => {
                    const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
                    return !(deletedMap[row.log_id] && updatedAt < deletedMap[row.log_id]);
                })
                .map(row => ({
                    uid: row.uid,
                    timestamp: new Date(row.timestamp).getTime(),
                    id: row.log_id,
                    manual: row.manual || false,
                    version: row.version || 1,
                    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
                    updatedBy: row.updated_by || '',
                    session: row.session || ''
                }));

            return {
                logs,
                tombstones: Object.keys(deletedMap).map(id => ({ id, deletedAt: deletedMap[id] }))
            };
        }

        case 'getStudentLogs': {
            const uids = await sbGetMyUids();
            if (uids.length === 0) return [];
            const rows = await sbSelectAll(() => supabaseClient.from('attendance_logs')
                .select('uid,timestamp,log_id,manual,updated_by,session')
                .in('uid', uids).eq('course_name', courseName).order('log_id'));
            return (rows || []).map(row => ({
                uid: row.uid,
                timestamp: new Date(row.timestamp).getTime(),
                id: row.log_id,
                manual: row.manual || false,
                editedBy: row.updated_by || '',
                session: row.session || ''
            }));
        }

        case 'getPendingRegistrations': {
            const rows = sbUnwrap(await supabaseClient.from('registrations')
                .select('id,name,uid,email,submitted_at,sent_by')
                .order('submitted_at', { ascending: true }));
            return (rows || []).map(row => ({
                rowNumber: row.id,
                name: row.name || '',
                uid: row.uid || '',
                email: row.email || '',
                timestamp: row.submitted_at || '',
                sentBy: row.sent_by || ''
            }));
        }

        case 'getPendingAbsences': {
            const rows = sbUnwrap(await supabaseClient.from('absences')
                .select('*').eq('status', 'Pending')
                .order('submitted_at', { ascending: true }));
            return (rows || []).map(row => ({
                rowNumber: row.id,
                requestID: row.request_id,
                name: row.student_name,
                email: row.student_email,
                course: row.course || '',
                session: row.session || '',
                absenceDate: row.absence_date,
                hours: row.hours,
                reasonType: row.reason_type,
                description: row.description,
                attachmentURL: row.attachment_url || ''
            }));
        }

        case 'getAbsenceHistory_Admin': {
            const rows = sbUnwrap(await supabaseClient.from('absences')
                .select('*').order('submitted_at', { ascending: false }));
            return (rows || []).map(row => ({
                status: row.status,
                requestID: row.request_id,
                studentName: row.student_name,
                studentEmail: row.student_email,
                course: row.course || '',
                session: row.session || '',
                absenceDate: row.absence_date,
                hours: row.hours,
                reasonType: row.reason_type,
                description: row.description,
                attachmentUrl: row.attachment_url || '',
                adminNotes: row.admin_notes || ''
            }));
        }

        case 'getStudentAbsenceRequests': {
            const email = await sbSessionEmail();
            const rows = sbUnwrap(await supabaseClient.from('absences')
                .select('status,course,absence_date,hours,reason_type,admin_notes')
                .ilike('student_email', email)
                .order('submitted_at', { ascending: false }));
            return (rows || []).map(row => ({
                status: row.status,
                course: row.course,
                absenceDate: row.absence_date,
                hours: row.hours,
                reason: row.reason_type,
                adminNotes: row.admin_notes || ''
            }));
        }

        case 'getGlobalSettingsData': {
            const [staffRows, deviceRows, profiles] = await Promise.all([
                supabaseClient.from('staff')
                    .select('id,name,uid,email,role').order('id', { ascending: true }).then(sbUnwrap),
                supabaseClient.from('trusted_devices')
                    .select('id,name,device_id,owner,registered_at').order('id', { ascending: true }).then(sbUnwrap),
                sbGetStaffProfiles()
            ]);
            return {
                // name is the custom name (may be empty); googleName and photo come from sign-in.
                staff: (staffRows || []).map(row => {
                    const profile = profiles.get(String(row.email || '').trim().toLowerCase()) || {};
                    return {
                        rowIndex: row.id, name: row.name || '', uid: row.uid,
                        email: row.email, role: row.role || 'Student',
                        googleName: profile.googleName || '', photo: profile.photo || ''
                    };
                }),
                devices: (deviceRows || []).map(row => ({
                    rowIndex: row.id, name: row.name, id: row.device_id,
                    owner: row.owner, date: row.registered_at || ''
                }))
            };
        }

        // ------------------------- writes -------------------------

        case 'submitRegistration': {
            const email = await sbSessionEmail();
            const sentBy = payload.sentBy
                ? (payload.sentBy.name || payload.sentBy.email || email)
                : email;
            sbUnwrap(await supabaseClient.from('registrations').insert({
                name: payload.name || '',
                uid: payload.uid || '',
                email: payload.email || '',
                submitted_at: new Date().toISOString(),
                sent_by: sentBy
            }));
            return { result: 'success', message: 'Registration submitted successfully' };
        }

        case 'deleteAbsenceRequest': {
            sbUnwrap(await supabaseClient.from('absences').delete()
                .eq('request_id', payload.requestID));
            return { result: 'success', message: 'Request deleted.' };
        }

        case 'addEntryToDatabase_Admin': {
            const studentInsert = {
                name: payload.name,
                email: payload.email || '',
                uids: payload.uids ? (Array.isArray(payload.uids) ? payload.uids : [payload.uids]) : (payload.uid ? [payload.uid.trim()] : [])
            };
            if (payload.hardware_uids || payload.hardwareUid || payload.hardwareUids) {
                const hw = payload.hardware_uids || payload.hardwareUids || (payload.hardwareUid ? [payload.hardwareUid] : []);
                studentInsert.hardware_uids = Array.isArray(hw) ? hw : [hw];
            }
            sbUnwrap(await supabaseClient.from('students').insert(studentInsert));
            return { result: 'success', message: 'Entry added directly to database' };
        }

        case 'updateStudentInDatabase_Admin': {
            const patch = {};
            if (payload.name !== undefined) patch.name = payload.name;
            if (payload.email !== undefined) patch.email = payload.email;
            if (payload.uids !== undefined) {
                patch.uids = Array.isArray(payload.uids)
                    ? payload.uids
                    : payload.uids.toString().split(',').map(u => u.trim()).filter(Boolean);
            }
            if (payload.hardware_uids !== undefined || payload.hardwareUids !== undefined) {
                const hw = payload.hardware_uids || payload.hardwareUids;
                patch.hardware_uids = Array.isArray(hw)
                    ? hw
                    : hw.toString().split(',').map(u => u.trim()).filter(Boolean);
            }
            sbUnwrap(await supabaseClient.from('students').update(patch)
                .eq('id', parseInt(payload.dbKey)));
            return { result: 'success', message: 'Student updated successfully' };
        }

        case 'deleteEntryFromDatabase_Admin': {
            sbUnwrap(await supabaseClient.from('students').delete()
                .eq('id', parseInt(payload.dbKey)));
            return { result: 'success', message: 'Student deleted successfully' };
        }

        case 'manageStaff_Admin': {
            let role = 'Student';
            if (payload.role === 'Global') role = 'Global';
            if (payload.role === 'Lecturer') role = 'Lecturer';

            // An empty name means "use the name from their Google account".
            if (payload.actionType === 'add') {
                sbUnwrap(await supabaseClient.from('staff').insert({
                    name: payload.name || null, uid: payload.uid, email: payload.email, role
                }));
            } else if (payload.actionType === 'delete') {
                sbUnwrap(await supabaseClient.from('staff').delete()
                    .eq('id', parseInt(payload.rowIndex)));
            } else if (payload.actionType === 'edit') {
                sbUnwrap(await supabaseClient.from('staff').update({
                    name: payload.name || null, uid: payload.uid, email: payload.email, role
                }).eq('id', parseInt(payload.rowIndex)));
            }
            return { result: 'success' };
        }

        case 'registerDevice_Admin': {
            const existing = sbUnwrap(await supabaseClient.from('trusted_devices')
                .select('id').eq('device_id', payload.deviceId));
            if (existing && existing.length > 0) throw new Error('Device already registered.');
            sbUnwrap(await supabaseClient.from('trusted_devices').insert({
                name: payload.deviceName,
                device_id: payload.deviceId,
                owner: await sbSessionEmail(),
                registered_at: localDateString()
            }));
            return { result: 'success' };
        }

        case 'deleteDevice_Admin': {
            const id = parseInt(payload.rowIndex);
            if (isNaN(id) || id < 1) throw new Error('Invalid row index provided');
            sbUnwrap(await supabaseClient.from('trusted_devices').delete().eq('id', id));
            return { result: 'success' };
        }

        // ------------------- multi-step writes (RPCs) -------------------

        case 'deleteLog_Admin': {
            if (!payload.courseName || !payload.logId) throw new Error('Missing required parameters');
            return sbUnwrap(await supabaseClient.rpc('delete_log', {
                p_course: payload.courseName, p_log_id: payload.logId
            }));
        }

        case 'syncCourseLogs_Admin': {
            return sbUnwrap(await supabaseClient.rpc('sync_course_logs', {
                p_course: courseName,
                p_logs: payload.logs || [],
                p_tombstones: payload.tombstones || []
            }));
        }

        case 'syncDatabase_Admin': {
            return sbUnwrap(await supabaseClient.rpc('sync_students', {
                p_students: payload.databaseData || {}
            }));
        }

        case 'saveCourseSettings_Admin': {
            const result = sbUnwrap(await supabaseClient.rpc('save_course_settings', { p: payload }));
            if (result && result.result === 'error') throw new Error(result.message);
            return result;
        }

        // --------------- email / attachment workflows ---------------

        case 'submitAbsenceRequest': {
            const requestID = `${Date.now()}_${payload.email}`;
            let attachmentPath = '';

            if (payload.file) {
                const { data: { session } } = await supabaseClient.auth.getSession();
                const safeName = payload.file.name.replace(/[^\w.\-]+/g, '_');
                attachmentPath = `${session.user.id}/${Date.now()}_${safeName}`;
                const { error: uploadError } = await supabaseClient.storage
                    .from(ATTACHMENTS_BUCKET)
                    .upload(attachmentPath, payload.file, { contentType: payload.file.type });
                if (uploadError) throw new Error('Could not upload attachment: ' + uploadError.message);
            }

            sbUnwrap(await supabaseClient.from('absences').insert({
                request_id: requestID,
                submitted_at: new Date().toISOString(),
                status: 'Pending',
                student_name: payload.name,
                student_email: payload.email,
                course: payload.course,
                session: payload.session || '',
                absence_date: payload.absenceDate,
                hours: payload.hours,
                reason_type: payload.reasonType,
                description: payload.description,
                admin_notes: '',
                attachment_url: attachmentPath
            }));

            // Notify admins — a failed email must not lose the submitted request
            try {
                await invokeSendEmail({ template: 'absence_submitted', request_id: requestID });
            } catch (e) {
                console.warn('Admin notification email failed:', e);
            }

            return { result: 'success', message: 'Absence request submitted successfully' };
        }

        case 'approveAbsenceRequest': {
            const { requestID, studentEmail, originalHours, approvedHours, customMessage } = payload;
            if (!approvedHours || approvedHours.length === 0) throw new Error('No hours were selected for approval.');

            const reqRows = sbUnwrap(await supabaseClient.from('absences')
                .select('course,session,absence_date').eq('request_id', requestID));
            if (!reqRows || reqRows.length === 0) throw new Error(`Request ID ${requestID} not found.`);
            const req = reqRows[0];

            const studentRows = sbUnwrap(await supabaseClient.from('students')
                .select('uids').ilike('email', studentEmail));
            const studentUid = studentRows?.[0]?.uids?.[0];
            if (!studentUid) throw new Error(`Student ${studentEmail} not found in database.`);

            // Build the manual logs for the approved hours
            const [year, month, day] = String(req.absence_date).split('-').map(Number);
            const adminEmail = await sbSessionEmail();
            const newLogs = approvedHours.split(',').map(h => h.trim()).map(hourStr => {
                const timeMatch = hourStr.match(/(\d{1,2}):(\d{2})/);
                if (!timeMatch) throw new Error(`Invalid time format: ${hourStr}`);
                const ts = new Date(year, month - 1, day, Number(timeMatch[1]), Number(timeMatch[2])).getTime();
                return {
                    uid: studentUid, timestamp: ts, id: `${ts}_${studentUid}_manual`,
                    manual: true, version: 1, updatedAt: Date.now(), updatedBy: adminEmail,
                    course: req.course, session: req.session || 'Default'
                };
            });

            // Atomic: insert logs + flip the request status
            sbUnwrap(await supabaseClient.rpc('approve_absence', {
                p_request_id: requestID,
                p_approved_hours: approvedHours,
                p_logs: newLogs
            }));

            const emailFailed = await trySendEmail({
                template: 'absence_approved',
                request_id: requestID, approvedHours, originalHours, customMessage
            });

            return { result: 'success', message: `Approved ${newLogs.length} logs.`, newLogs, emailFailed };
        }

        case 'rejectAbsenceRequest': {
            const adminEmail = await sbSessionEmail();
            sbUnwrap(await supabaseClient.from('absences').update({
                status: 'Rejected',
                admin_notes: payload.rejectionMessage || `Rejected by ${adminEmail}`
            }).eq('request_id', payload.requestID));

            const emailFailed = await trySendEmail({
                template: 'absence_rejected',
                request_id: payload.requestID,
                rejectionMessage: payload.rejectionMessage || ''
            });

            return { result: 'success', message: 'Request rejected.', emailFailed };
        }

        case 'approveRegistration': {
            const studentId = (payload.uid && !payload.uid.includes(':'))
                ? payload.uid.trim()
                : (payload.hardwareUid ? convertUidToExternalId(payload.hardwareUid) : (payload.uid ? convertUidToExternalId(payload.uid) : ''));

            const hardwareUid = (payload.hardwareUid && payload.hardwareUid.includes(':'))
                ? payload.hardwareUid.trim()
                : (payload.uid ? (convertExternalIdToUid(payload.uid) || payload.uid.trim()) : (payload.hardwareUid || ''));

            if (payload.approvalMode === 'custom_replace') {
                const existing = sbUnwrap(await supabaseClient.from('students')
                    .select('id,uids,hardware_uids').eq('id', parseInt(payload.duplicateRowIndex)));
                if (!existing || existing.length === 0) throw new Error('Could not find existing student to update.');

                const student = existing[0];
                const updates = payload.updates || {};
                const patch = {};
                if (updates.name) patch.name = payload.name;
                if (updates.email) patch.email = payload.email;
                if (updates.uid_action) {
                    let uids = student.uids || [];
                    let hwUids = student.hardware_uids || [];
                    if (updates.uid_action === 'merge') {
                        if (studentId && !uids.includes(studentId)) uids = [...uids, studentId];
                        if (hardwareUid && !hwUids.includes(hardwareUid)) hwUids = [...hwUids, hardwareUid];
                        patch.uids = uids;
                        patch.hardware_uids = hwUids;
                    } else if (updates.uid_action === 'replace') {
                        patch.uids = studentId ? [studentId] : [];
                        patch.hardware_uids = hardwareUid ? [hardwareUid] : [];
                    }
                }
                if (Object.keys(patch).length > 0) {
                    sbUnwrap(await supabaseClient.from('students').update(patch).eq('id', student.id));
                }
            } else {
                sbUnwrap(await supabaseClient.from('students').insert({
                    name: payload.name,
                    email: payload.email,
                    uids: studentId ? [studentId] : [],
                    hardware_uids: hardwareUid ? [hardwareUid] : []
                }));
            }

            const regId = parseInt(payload.rowNumber);
            if (regId && !isNaN(regId)) {
                sbUnwrap(await supabaseClient.from('registrations').delete().eq('id', regId));
            }

            const emailFailed = await trySendEmail({
                template: 'registration_approved',
                name: payload.name || '', email: payload.email || ''
            });

            return { result: 'success', message: 'Registration approved and processed', emailFailed };
        }

        case 'rejectRegistration': {
            sbUnwrap(await supabaseClient.from('registrations').delete()
                .eq('id', parseInt(payload.rowNumber)));

            const emailFailed = !!(payload.email && payload.message) && await trySendEmail({
                template: 'registration_rejected',
                name: payload.name || '', email: payload.email, message: payload.message
            });

            return { result: 'success', message: 'Registration rejected', emailFailed };
        }

        default:
            throw new Error(`Unknown action: ${action}`);
    }
}

/**
 * Handle auth button click to sign in.
 */
function handleAuthClick(e) {
    if (e) e.preventDefault();

    // Save the course anchor so initGoogleApi() can restore it after the redirect
    sessionStorage.setItem('redirect_hash', window.location.hash);

    supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin + window.location.pathname
        }
    });
}

/**
 * Get course metadata for the specified course
 */
function getCourseMetadata(course) {
    // courseInfoMap is a top-level let, so it is not a property of window.
    return (course && courseInfoMap[course]) || null;
}

// YYYY-MM-DD in the device's time zone. toISOString() gives the UTC date,
// which is the previous day for scans shortly after midnight in Albania.
function localDateString(date = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
* Starts an NFC reader to populate a given input field.
* @param {HTMLInputElement} inputElement The input field to fill with the scanned UID.
* @param {HTMLElement} statusContainer The div where status messages will be shown.
* @returns {AbortController | null} The controller to stop the scan, or null if not supported.
*/
function startNfcForInputDialog(inputElement, statusContainer, scanButton) {
    if (!nfcSupported) {
        if (/Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            statusContainer.innerHTML = `<p style="text-align:center; font-size: 0.9em; opacity: 0.8;">NFC scanning requires Chrome on Android.</p>`;
        }
        return null;
    }

    statusContainer.style.minHeight = '48px';
    statusContainer.innerHTML = `<div class="sync-status syncing" style="justify-content: center; padding: 15px 0; font-size: 1em;"><i class="fa-solid fa-wifi"></i> <span>Ready to Scan...</span></div>`;

    // 1. Abort any existing controller before creating a new one
    if (window.activeNfcController) {
        window.activeNfcController.abort();
    }

    if (isScanning || nfcReader) stopScanning();

    const nfcController = new AbortController();
    window.activeNfcController = nfcController;
    inputElement.closest('.dialog-backdrop')?.addEventListener('dialogclose', () => nfcController.abort(), { once: true });
    nfcController.signal.addEventListener('abort', () => {
        if (window.activeNfcController === nfcController) window.activeNfcController = null;
    }, { once: true });
    const reader = new NDEFReader();

    reader.scan({ signal: nfcController.signal }).then(() => {
        reader.onreading = ({ serialNumber }) => {
            inputElement.value = serialNumber;
            inputElement.dispatchEvent(new Event('input', { bubbles: true }));
            inputElement.dataset.hardwareUid = serialNumber;
            playSound(true);
            statusContainer.innerHTML = `<div class="sync-status success" style="justify-content: center; padding: 15px 0; font-size: 1em;"><i class="fa-solid fa-circle-check"></i> <span>Card Scanned!</span></div>`;

            if (scanButton) {
                scanButton.disabled = true; // Deactivate the button
                scanButton.innerHTML = '<i class="fa-solid fa-check"></i>'; // Show a checkmark
            }
            // Fade out the status message after 2.5 seconds
            setTimeout(() => {
                statusContainer.innerHTML = '';
                statusContainer.style.minHeight = '0';
            }, 2000);

            nfcController.abort();
        };
    }).catch(err => {
        if (err.name !== 'AbortError') {
            statusContainer.innerHTML = `<div class="sync-status error" style="justify-content: center; padding: 15px 0; font-size: 1em;"><i class="fa-solid fa-circle-xmark"></i> <span>Scan failed. Is NFC on?</span></div>`;
        }
        if (window.activeNfcController === nfcController) window.activeNfcController = null;
    });

    return nfcController;
}

/**
* Handles the click on either refresh button.
* Shows a spinner, runs a full sync, then stops the spinner.
*/
/**
* REVISED: Handles refresh differently for Admins and Students.
*/
async function handleManualRefresh(buttonId) {
    if (isSyncing) return; // Don't refresh if already syncing

    const refreshBtn = document.getElementById(buttonId);
    if (!refreshBtn) return;

    const icon = refreshBtn.querySelector('i, svg');
    const originalIconClass = icon.getAttribute('class') || icon.className;

    // Start spinner
    const spinnerI = document.createElement('i');
    spinnerI.className = 'fa-solid fa-arrows-rotate fa-spin';
    icon.replaceWith(spinnerI);
    refreshBtn.disabled = true;

    try {
        if (isAdmin) {
            // --- ADMIN REFRESH (Full Sync) ---
            await syncData(); // Admins run the full sync

            await refreshAdminViews();

        } else {
            // --- STUDENT REFRESH (Course List + Current Logs) ---
            if (!isSignedIn) {
                showNotification('info', 'Please Sign In', 'Sign in to refresh your courses and logs.');
                return; // Nothing to refresh if not signed in
            }

            updateSyncStatus("Refreshing...", "syncing"); // Show temporary status

            // 1. Re-fetch Available Courses (using the efficient boot function)
            const bootData = await callWebApp('getBootData', {}, 'POST');
            const fetchedCourseDict = bootData.courses;

            if (fetchedCourseDict && typeof fetchedCourseDict === 'object') {
                // Update the global availableCourses list (exclude archived)
                availableCourses = Object.keys(fetchedCourseDict).filter(c => !courseInfoMap[c]?.archived);

                // Update the global course dictionary
                const filteredDict = {};
                availableCourses.forEach(course => {
                    if (fetchedCourseDict[course]) {
                        filteredDict[course] = fetchedCourseDict[course];
                    }
                });
                courseDictionary = filteredDict;

                // Check if the *currently selected* course is still valid
                if (currentCourse && !availableCourses.includes(currentCourse)) {
                    // If the current course is no longer available, switch to the first available one
                    currentCourse = availableCourses.length > 0 ? availableCourses[0] : null;
                    if (currentCourse) {
                        window.location.hash = currentCourse;
                        localStorage.setItem('last_active_course', currentCourse);
                    } else {
                        localStorage.removeItem('last_active_course');
                    }
                }

                // 2. Repopulate the Course Buttons
                populateCourseButtons(); // Redraw buttons with the new list

                // 3. Refresh Logs for the (potentially new) Current Course
                if (currentCourse) {
                    const serverLogs = await callWebApp('getStudentLogs', { courseName: currentCourse }, 'POST');
                    studentLogCache[currentCourse] = serverLogs;
                    courseData[currentCourse] = { logs: serverLogs, tombstones: new Set() };
                } else {
                    // Handle case where student has NO courses after refresh
                    courseData = {}; // Clear all local course data
                    studentLogCache = {};
                }

                // 4. Update the entire UI (including the log list)
                updateUI();

            } else {
                throw new Error("Could not fetch course list.");
            }
            updateSyncStatus("Online", "online"); // Revert status
        }

    } catch (error) {
        console.error('Manual refresh failed:', error);
        const errorMsg = isAdmin ? 'Could not sync data.' : 'Could not refresh courses/logs.';
        showNotification('error', 'Refresh Failed', `${errorMsg} ${error.message}`);
        updateSyncStatus("Error", "error"); // Show error status
    } finally {
        // Restore the original <i> icon (Font Awesome renders <i> as <svg>)
        const currentIcon = refreshBtn.querySelector('i, svg');
        if (currentIcon) {
            const restoreI = document.createElement('i');
            restoreI.className = 'fa-solid fa-arrows-rotate';
            currentIcon.replaceWith(restoreI);
        }
        refreshBtn.disabled = false;
        // Ensure sync status reverts if it wasn't an error
        if (!syncStatus.classList.contains('error')) {
            // Small delay to let the "success" message show briefly
            setTimeout(() => updateSyncStatus("Online", "online"), 2000);
        }
    }
}

function setupRefreshButtons() {
    const scannerRefreshBtn = document.getElementById('scanner-refresh-btn');
    const databaseRefreshBtn = document.getElementById('database-refresh-btn');

    if (scannerRefreshBtn) {
        scannerRefreshBtn.addEventListener('click', () => {
            handleManualRefresh('scanner-refresh-btn');
        });
    }

    if (databaseRefreshBtn) {
        databaseRefreshBtn.addEventListener('click', () => {
            handleManualRefresh('database-refresh-btn');
        });
    }
}

/**
 * Calculate the current week of the course
 * @param {Object} metadata - Course metadata with start_date, end_date, and holiday_weeks
 * @returns {number|null} Current week number or null if metadata is invalid
 */
function calculateCurrentWeek(metadata) {
    if (!metadata || !metadata.startDate) return null;

    const startDate = new Date(metadata.startDate);
    const today = new Date();
    const holidayWeeks = parseInt(metadata.holidayWeeks || 0);

    // Get the holiday start date, if it exists
    const holidayStartDate = metadata.holidayStartDate ? new Date(metadata.holidayStartDate) : null;

    if (isNaN(startDate.getTime())) return null;

    // Calculate the current calendar week of the semester
    const currentWeek = Math.ceil((today - startDate) / (7 * 24 * 60 * 60 * 1000));

    let adjustedWeek = currentWeek;

    // Only subtract holiday weeks if today's date is ON or AFTER the holiday start date
    if (holidayWeeks > 0 && holidayStartDate && !isNaN(holidayStartDate.getTime()) && today >= holidayStartDate) {
        adjustedWeek = currentWeek - holidayWeeks;
    }

    // Ensure week is within a valid range (at least 1)
    return Math.max(adjustedWeek, 1);
}

/**
 * Displays an error message for a specific input field.
 * @param {HTMLInputElement} inputElement The input field to validate.
 * @param {string} message The error message to display.
 */
function showInputError(inputElement, message) {
    inputElement.classList.add('is-invalid');
    const formGroup = inputElement.closest('.form-group');
    if (formGroup) {
        // Remove any existing error to prevent duplicates
        const existingError = formGroup.nextElementSibling;
        if (existingError && existingError.classList.contains('error-message')) {
            existingError.remove();
        }

        const errorElement = document.createElement('div');
        errorElement.setAttribute('class', 'error-message');
        errorElement.textContent = message;

        // This is the key: insert the error message AFTER the form group.
        formGroup.after(errorElement);
    }
}

/**
 * Clears any validation error from a specific input field.
 * @param {HTMLInputElement} inputElement The input field to clear.
 */
function clearInputError(inputElement) {
    inputElement.classList.remove('is-invalid');
    const formGroup = inputElement.closest('.form-group');
    if (formGroup) {
        // Look for the error message as the NEXT sibling
        const errorElement = formGroup.nextElementSibling;
        if (errorElement && errorElement.classList.contains('error-message')) {
            errorElement.remove();
        }
    }
}

/**
 * Get a suggested date for attendance export
 * @param {Object} metadata - Course metadata
 * @returns {string} Date string in YYYY-MM-DD format
 */
function getSuggestedDate(metadata) {
    // Current date is a good default
    const today = new Date();
    const todayStr = localDateString(today);

    // If we're on a weekend, suggest the previous Friday
    const dayOfWeek = today.getDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        const friday = new Date(today);
        // Go back to the previous Friday
        friday.setDate(today.getDate() - (dayOfWeek === 0 ? 2 : 1));
        return localDateString(friday);
    }

    return todayStr;
}

function handleSignoutClick() {
    // Clear kiosk + Supabase sessions and reload to ensure a clean state
    localStorage.removeItem(KIOSK_MODE_KEY);
    localStorage.removeItem('last_active_course');

    // Stop One Tap from silently signing the user straight back in
    if (typeof google !== 'undefined' && google.accounts?.id) {
        google.accounts.id.disableAutoSelect();
    }

    supabaseClient.auth.signOut({ scope: 'local' }).finally(() => window.location.reload());
}

// Update sync status indicator
function updateSyncStatus(message, status) {
    // When status is good (online/success), clear any previous error/warning messages.
    if (status === 'online' || status === 'success') {
        removeNotifications('error');
        removeNotifications('warning');
    }

    const syncText = document.getElementById('sync-text');
    const syncStatus = document.getElementById('sync-status');

    // If the browser is offline, ALWAYS show the offline status, regardless of the requested change.
    if (!isOnline) {
        if (syncText) syncText.textContent = 'Offline';
        if (syncStatus) syncStatus.setAttribute('class', 'sync-status offline');
        return; // Exit the function early
    }

    if (syncText) syncText.textContent = message;
    if (syncStatus) {
        syncStatus.setAttribute('class', 'sync-status ' + (status || 'offline'));
    }
}

// Photo over initials, the name, and a label for what the chip opens.
function renderUserChip() {
    if (!currentUser) return;
    const displayName = currentUserDisplayName();
    const avatar = document.getElementById('user-avatar');
    const name = document.getElementById('user-name');
    const chip = document.getElementById('student-profile-chip');
    if (avatar) avatar.innerHTML = avatarContentHtml(displayName, currentUser.picture);
    if (name) name.textContent = displayName;
    if (chip) {
        const opens = isGlobalAdmin ? 'Settings' : isAdmin ? 'My courses' : 'Profile';
        chip.title = opens;
        chip.setAttribute('aria-label', `${opens}: ${displayName}`);
    }
}

// The staff record's custom name when set, otherwise the Google account name.
function currentUserDisplayName() {
    return currentUser?.staffName || currentUser?.name || '';
}

// The next visit's startup skeleton matches this view (see the startup script in
// index.html). Not while starting up, before sign-in has been restored.
function rememberStartupView() {
    if (isInitializing) return;
    const view = !isSignedIn ? 'signed-out' : isGlobalAdmin ? 'global' : isAdmin ? 'lecturer' : 'student';
    try { localStorage.setItem('stando_view', view); } catch { /* The skeleton falls back to a student view. */ }
}

function updateAuthUI() {
    // --- Initial UI State ---
    if (loadingTasks.has('auth')) {
        loadingTasks.delete('auth');
        checkLoadingCompletion();
    }

    // Signed out, the sign-in card stands in for the header banner.
    const appHeader = document.querySelector('.app-header');
    if (appHeader) appHeader.style.display = isSignedIn ? 'block' : 'none';
    document.body.classList.toggle('signed-out', !isSignedIn);

    // Temporarily hide course buttons; we'll show them later if needed
    const courseButtonsContainer = document.getElementById('course-buttons-container');
    if (courseButtonsContainer) courseButtonsContainer.style.display = 'none';

    document.body.classList.toggle('is-admin', isAdmin);

    const sessionControls = document.getElementById('session-controls');
    if (!isAdmin && sessionControls) {
        sessionControls.style.setProperty('display', 'none', 'important');
    }

    // --- Sort Select Logic ---
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
        const options = Array.from(sortSelect.options);
        options.forEach(option => {
            const isStudentOnlyOption = option.value.includes('date');
            // Allow all options if Admin
            option.style.display = (isAdmin || isStudentOnlyOption) ? '' : 'none';
        });

        // Only reset sort if NOT Admin
        if (!isAdmin && !currentSort.startsWith('date')) {
            currentSort = 'date-desc';
            sortSelect.value = currentSort;
        }
    }

    // --- Element References ---
    const loginContainer = document.getElementById('login-container');
    const userContainer = document.getElementById('user-container');
    const tabsContainer = document.querySelector('.tabs');
    const directEisExportBtn = document.getElementById('direct-eis-export-btn');
    const logsHeader = document.querySelector('.logs-header');
    const filterContainer = document.querySelector('.filter-container');
    const tableContainer = document.querySelector('.table-container');
    const notSignedInMsgElement = document.getElementById('not-signed-in-message');

    // --- Core Auth UI Toggling ---
    if (loginContainer) loginContainer.style.display = isSignedIn ? 'none' : 'flex';
    if (userContainer) userContainer.style.display = isSignedIn ? 'flex' : 'none';
    if (tabsContainer) tabsContainer.style.display = isGlobalAdmin ? 'flex' : 'none';

    // Allow Export button in Lecturer Mode too
    // Allow Export button in Admin Mode
    if (directEisExportBtn) directEisExportBtn.style.display = isAdmin ? 'inline-block' : 'none';

    // --- Signed In State ---
    if (isSignedIn) {
        // The photo and name chip is the Settings / Profile entry point.
        renderUserChip();

        if (isAdmin) {
            document.body.classList.add('is-admin');
            const databaseTab = document.querySelector('.tab[data-tab="database-tab"]');
            if (databaseTab) {
                if (isGlobalAdmin) {
                    databaseTab.style.setProperty('display', 'flex', 'important');
                } else {
                    databaseTab.style.setProperty('display', 'none', 'important');
                    if (document.querySelector('.tab-content.active')?.id === 'database-tab') {
                        document.querySelector('.tab[data-tab="scanner-tab"]')?.click();
                    }
                }
            }
        } else {
            document.body.classList.remove('is-admin');
        }

        if (courseButtonsContainer) courseButtonsContainer.style.display = 'flex';
        if (notSignedInMsgElement) notSignedInMsgElement.remove();
        if (logsHeader) logsHeader.style.display = 'flex';
        if (filterContainer) filterContainer.style.display = 'flex';
        if (tableContainer) tableContainer.style.display = 'block';

        const hasActiveData = isSignedIn || (Object.keys(courseData).length > 0 && currentCourse);
        if (scanHistoryModule) scanHistoryModule.style.display = hasActiveData ? 'block' : 'none';

        // --- UID Column Visibility ---
        document.querySelectorAll('.uid-column').forEach(col => {
            col.style.display = isAdmin ? 'table-cell' : 'none';
        });

    } else {
        // --- Signed Out (Default) ---
        document.body.classList.remove('is-admin');

        // Hide course buttons
        if (courseButtonsContainer) courseButtonsContainer.style.display = 'none';

        // A scanned card's Card ID shows under the sign-in card.
        if (lastScannedUID) {
            let notSignedInMsg = notSignedInMsgElement;
            if (!notSignedInMsg) {
                notSignedInMsg = document.createElement('div');
                notSignedInMsg.id = 'not-signed-in-message';
                notSignedInMsg.setAttribute('class', 'not-signed-in-message');
                (loginContainer || document.getElementById('main-container'))?.appendChild(notSignedInMsg);
            }
            notSignedInMsg.innerHTML = `
                <p><i class="fa-solid fa-id-card"></i> Your Card ID is:</p>
                <h2 style="margin-top: 10px; font-weight: bold; font-family: monospace; font-size: 1.8em; letter-spacing: 1px; word-break: break-all; color: var(--primary-dark);">${escapeHtml(lastScannedUID)}</h2>`;
        } else if (notSignedInMsgElement) {
            notSignedInMsgElement.remove();
        }

        // --- CLEANUP ---
        if (logsHeader) logsHeader.style.display = 'none';
        if (filterContainer) filterContainer.style.display = 'none';
        if (tableContainer) tableContainer.style.display = 'none';
        if (scanHistoryModule) scanHistoryModule.style.display = 'none';
    }

    rememberStartupView();

    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) {
        syncBtn.disabled = !isOnline || !isSignedIn || isSyncing;
        syncBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }

    const emptyLogs = document.getElementById('empty-logs');
    if (emptyLogs) {
        // Show empty logs if Signed In
        if (isSignedIn) {
            const logsForCurrentCourse = courseData[currentCourse]?.logs || [];
            if (!currentCourse) {
                emptyLogs.innerHTML = '<i class="fa-solid fa-circle-info"></i> Please select a course to view attendance logs.';
                emptyLogs.style.display = 'block';
            } else if (logsForCurrentCourse.length === 0 && courseData[currentCourse]) {
                emptyLogs.innerHTML = '<i class="fa-solid fa-ghost"></i> No attendance records found for this course.';
                emptyLogs.style.display = 'block';
            } else if (!courseData[currentCourse]) {
                // Loading...
            } else {
                emptyLogs.style.display = 'none';
            }
        } else {
            emptyLogs.style.display = 'none';
        }
    }
}

/**
 * Switches the active course and loads data on-demand if needed.
 */
async function handleCourseChange(courseName) {
    if (currentCourse === courseName) return;
    isChangingCourses = true;
    currentCourse = courseName;
    logsCurrentPage = 1;
    selectedLogIds.clear();
    lastCheckedLogId = null;
    updateBulkUI();
    cooldownUIDs.clear();
    localStorage.setItem('last_active_course', courseName);
    renderSessionControls(courseName);
    beginLogsSwap();
    try {
        await loadAndMergeCourseData(courseName);
    } finally {
        if (currentCourse === courseName) {
            isChangingCourses = false;
            updateUI();
        }
    }
}

/**
 * Background loads remaining logs for a Course Admin... SLOWLY, to avoid rate-limits.
 */
async function loadRemainingCourseAdminLogs() {
    for (const course of availableCourses.filter(c => c !== currentCourse)) {
        if (!isSignedIn) return;
        if (!studentLogCache[course]) await loadAndMergeCourseData(course);
    }
}

/**
 * Background loads remaining logs for a Student
 */
async function loadRemainingStudentLogs() {
    for (const course of availableCourses.filter(c => c !== currentCourse)) {
        if (!isSignedIn) return;
        if (!studentLogCache[course]) await loadAndMergeCourseData(course);
    }
}

/**
 * Loads data for a single course from local storage.
 * @param {string} courseName - The name of the course to load.
 * @returns {Promise<{logs: Array, tombstones: Set}>}
 */
async function loadCourseFromLocalStorage(courseName) {
    const empty = () => ({ logs: [], tombstones: new Set(), pending: false, revision: 0 });
    if (!isSignedIn || !currentUser) return empty();
    const storageKey = courseStorageKey(courseName);
    let rawData;
    try {
        rawData = localStorage.getItem(storageKey);
        let legacy = false;
        // Only an authorized admin may recover the old shared cache.
        if (!rawData && isAdmin && isAdminForCourse(courseName)) {
            rawData = localStorage.getItem(LOGS_STORAGE_KEY + '_' + courseName);
            legacy = !!rawData;
        }
        if (!rawData) return empty();
        const parsed = JSON.parse(rawData);
        if (!parsed || !Array.isArray(parsed.logs)) throw new Error('Invalid cached log structure.');
        const writable = isAdmin && isAdminForCourse(courseName);
        const data = {
            logs: normalizeImportedLogs(parsed.logs),
            tombstones: new Set(writable && Array.isArray(parsed.tombstones) ? parsed.tombstones.map(String) : []),
            pending: writable && (legacy || parsed.pending === true || !!parsed.tombstones?.length),
            revision: Number(parsed.revision) || 0
        };
        return data;
    } catch (error) {
        if (rawData) {
            try { localStorage.setItem('attendance_cache_recovery_' + storageKey, rawData); }
            catch { protectedCacheKeys.add(storageKey); }
        }
        console.warn('Could not restore course cache:', error);
        showNotification('warning', 'Local Data Unavailable', 'Saved logs could not be read. The original cache has been kept; reconnect to reload server data.');
        return empty();
    }
}

// Add this to track authentication state better
function setupAuthStateTracking() {
    if (!supabaseClient) return;
    // Kiosk sessions end via the auto-destruct timer; skip the expiry warning
    // Track kiosk sign-outs as well as Google sessions.

    // React only if the session is lost for good (supabase-js auto-refreshes)
    supabaseClient.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' && isSignedIn) {
            isSignedIn = false;
            isAdmin = false;
            isGlobalAdmin = false;
            adminCourses = [];
            currentUser = null;
            currentCourse = '';
            courseData = {};
            databaseMap = {};
            databaseCache = null;
            studentLogCache = {};
            availableCourses = [];
            refreshPendingChanges();
            stopScanning();
            clearScanLock();
            stopAdminAutoRefresh();
            showNotification('warning', 'Session Expired', 'Please sign in again to continue.');
            updateAuthUI();
        }
    });
}


/**
 * Update online/offline status indicator.
 */
function updateOnlineStatus() {
    isOnline = navigator.onLine;
    const statusIcon = syncStatus.querySelector('i, svg');

    if (isOnline) {
        syncBtn.disabled = !isSignedIn || isSyncing;
        if (pendingChanges && !isSyncing) {
            syncText.textContent = 'Pending sync...';
            syncStatus.setAttribute('class', 'sync-status waiting');
        } else if (!isSyncing) {
            syncText.textContent = 'Online';
            syncStatus.setAttribute('class', 'sync-status online');
        }
    } else {
        syncText.textContent = pendingChanges ? 'Pending (offline)' : 'Offline';
        syncStatus.setAttribute('class', pendingChanges ? 'sync-status waiting' : 'sync-status offline');
        syncBtn.disabled = true;
    }
}

/**
 * Sync data with Google Sheets.
 * Fetches and updates both database and logs.
 */
async function syncData() {
    if (!isOnline || !isSignedIn || isSyncing) return;
    const courseName = currentCourse;
    const button = document.getElementById('sync-btn');
    isSyncing = true;
    button.disabled = true;
    updateSyncStatus('Syncing...', 'syncing');
    try {
        invalidateDatabaseCache();
        await fetchDatabaseFromSheet();
        window.buildUIDToPrimaryUidMap();
        await fetchCourseInfo();
        if (courseName) await loadAndMergeCourseData(courseName, { strict: true });
        if (isAdmin) {
            await syncLogsWithSheet();
            await refreshAdminViews();
        }
        lastSyncTime = Date.now();
        refreshPendingChanges();
        updateSyncStatus(pendingChanges ? 'Pending sync...' : 'Synced', pendingChanges ? 'waiting' : 'success');
    } catch (error) {
        console.error('Sync error:', error);
        updateSyncStatus('Sync failed', 'error');
        showNotification('warning', 'Sync Failed', 'Your pending changes are kept on this device. Reconnect and try again.');
    } finally {
        isSyncing = false;
        button.disabled = !isSignedIn || !isOnline;
        updateUI();
    }
}


/**
* Fetch database entries from Google Sheet with format detection
*/
async function fetchDatabaseFromSheet() {
    // Use cache if available and fresh
    const now = Date.now();
    if (databaseCache && (now - databaseCacheTime) < DATABASE_CACHE_DURATION) {
        databaseMap = databaseCache;
        return;
    }

    try {
        const result = await callWebApp('getDatabase', {}, 'POST');

        if (result && typeof result === 'object') {
            databaseMap = result;
            databaseCache = result;
            databaseCacheTime = now;
        } else {
            throw new Error('Invalid database format received');
        }
    } catch (error) {
        console.error('Error fetching database:', error);
        // If we have old cache, use it
        if (databaseCache) {
            console.warn('Using stale database cache due to fetch error');
            databaseMap = databaseCache;
        }
        throw error;
    }
}

/**
 * Returns the current active session string (e.g., "Theory A", "Lab", or "Default")
 */
function getCurrentActiveSession() {
    if (!activeSessionCategory) return 'Default';

    let session = activeSessionCategory;
    if (activeSessionGroup) {
        session += ' ' + activeSessionGroup;
    }
    return session;
}


/**
* Updates a log's version and updatedAt timestamp for an edit.
* @param {object} log - The log object to update.
* @param {string} [userEmail] - Optional: The email of the user making the change.
* @returns {object} The updated log object.
*/
function touchLogForEdit(log, userEmail) {
    log.version = (Number(log.version) || 0) + 1;
    log.updatedAt = Date.now();
    if (userEmail) log.updatedBy = userEmail;
    return log;
}


/**
 * Safely loads logs by prioritizing local data first.
 * Ensures offline scans appear immediately and are not wiped by an empty server response.
 */
async function loadAndMergeCourseData(courseName, { strict = false } = {}) {
    if (!courseName || !isSignedIn) return;
    const account = currentUser?.email;
    const requestId = ++currentRequestId;
    activeRequests.set(courseName, requestId);
    const localData = await loadCourseFromLocalStorage(courseName);
    if (!isSignedIn || currentUser?.email !== account) return;
    // A scan can arrive while storage or the server is loading. Keep the live state.
    if (!courseData[courseName]) courseData[courseName] = localData;
    refreshPendingChanges();
    if (!isOnline) return;
    try {
        const writable = isAdmin && isAdminForCourse(courseName);
        const response = await callWebApp(writable ? 'getCourseLogs_Admin' : 'getStudentLogs', { courseName });
        if (!isSignedIn || currentUser?.email !== account || activeRequests.get(courseName) !== requestId) return;
        const data = courseData[courseName];
        if (writable) {
            const tombstones = new Map((response.tombstones || []).map(t => typeof t === 'object' ? [String(t.id), t.deletedAt] : [String(t), Date.now()]));
            data.logs = mergeLogs(Array.isArray(response) ? response : response.logs, data.logs, data.tombstones, tombstones);
        } else {
            data.logs = normalizeImportedLogs(Array.isArray(response) ? response : []);
            data.tombstones = new Set();
            data.pending = false;
        }
        studentLogCache[courseName] = data.logs;
        saveCourseToLocalStorage(courseName);
        refreshPendingChanges();
    } catch (error) {
        console.warn('Could not refresh course ' + courseName, error);
        if (strict) throw error;
    } finally {
        if (activeRequests.get(courseName) === requestId) activeRequests.delete(courseName);
    }
}


/**
* Merges Server and Local logs using CRDT logic (Time-based Tombstones).
*/
function mergeLogs(serverLogs, localLogs, localTombstones, serverTombstonesMap) {
    serverLogs = Array.isArray(serverLogs) ? serverLogs : [];
    localLogs = Array.isArray(localLogs) ? localLogs : [];

    // serverTombstonesMap is now expected to be a Map: ID -> Timestamp
    // localTombstones is a Set of IDs (pending deletions locally)

    const combinedMap = new Map();

    // Helper to check if a log is "Dead"
    const isDead = (log) => {
        // 1. Is it pending deletion locally?
        if (localTombstones.has(log.id)) return true;

        // 2. Is it deleted on server? Check Timing.
        // If Server Tombstone exists AND Log is OLDER than Tombstone -> Dead.
        if (serverTombstonesMap.has(log.id)) {
            const deletedAt = serverTombstonesMap.get(log.id);
            const logTime = log.updatedAt || 0;
            if (logTime < deletedAt) return true;
        }
        return false;
    };

    // 1. Process Server Logs (The Truth)
    serverLogs.forEach(log => {
        if (!isDead(log)) {
            combinedMap.set(log.id, log);
        }
    });

    // 2. Process Local Logs (The Potential Updates)
    localLogs.forEach(localLog => {
        if (isDead(localLog)) return;

        const serverLog = combinedMap.get(localLog.id);

        if (!serverLog) {
            // Log exists locally but not on server.
            // Since we already checked isDead(), we know it wasn't deleted on the server.
            // Therefore, it must be a offline creation. Keep it.
            combinedMap.set(localLog.id, localLog);
        } else {
            // Log exists in both. Standard conflict resolution.
            const localVer = Number(localLog.version || 0);
            const serverVer = Number(serverLog.version || 0);

            if (localVer > serverVer) {
                combinedMap.set(localLog.id, localLog);
            } else if (localVer === serverVer) {
                if ((localLog.updatedAt || 0) > (serverLog.updatedAt || 0)) {
                    combinedMap.set(localLog.id, localLog);
                }
            }
        }
    });

    return Array.from(combinedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/**
* Centralized function to save course data and flag it for auto-sync.
*/
function saveAndMarkChanges(courseName) {
    const data = courseData[courseName];
    if (!data) return;
    data.pending = true;
    data.revision = (data.revision || 0) + 1;
    refreshPendingChanges();
    saveCourseToLocalStorage(courseName);
    if (!isOnline) updateSyncStatus('Pending (offline)', 'waiting');
    else if (isSignedIn && !isSyncing) updateSyncStatus('Pending sync...', 'waiting');
}


/**
* Syncs the logs for the CURRENTLY SELECTED course with its Google Sheet.
*/
async function syncLogsWithSheet() {
    if (!isOnline || !isSignedIn || !isAdmin) return;
    // Restore dirty markers for every authorized course, including after a reload.
    const courses = new Set([...availableCourses, ...Object.keys(courseData), currentCourse].filter(Boolean));
    const prefix = LOGS_STORAGE_KEY + '_account_' + encodeURIComponent((currentUser?.email || '').trim().toLowerCase()) + '_admin_';
    for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(prefix)) continue;
        try {
            const data = JSON.parse(localStorage.getItem(key));
            if (data?.pending) courses.add(key.slice(prefix.length));
        } catch { /* Leave unrecognised caches intact. */ }
    }
    for (const courseName of courses) {
        if (!isAdminForCourse(courseName)) continue;
        if (!courseData[courseName]) courseData[courseName] = await loadCourseFromLocalStorage(courseName);
        if (courseData[courseName].pending) await syncViaBackendAPI(courseName);
    }
    refreshPendingChanges();
}

async function syncViaBackendAPI(courseName = currentCourse) {
    if (!courseName || !isOnline || !isSignedIn || !isAdmin || !isAdminForCourse(courseName)) return;
    if (courseSyncRequests.has(courseName)) return courseSyncRequests.get(courseName);
    const data = courseData[courseName];
    if (!data) return;
    const revision = data.revision || 0;
    const logs = data.logs.map(log => ({ ...log }));
    const tombstones = Array.from(data.tombstones || []);
    const account = currentUser?.email;
    const request = (async () => {
        const result = await callWebApp('syncCourseLogs_Admin', { courseName, logs, tombstones });
        if (result?.result !== 'success') throw new Error(result?.message || 'Sync failed');
        if (!isSignedIn || currentUser?.email !== account) return;
        const latest = courseData[courseName];
        // Acknowledgement covers only the snapshot sent, never edits made in flight.
        if (latest && (latest.revision || 0) === revision) {
            tombstones.forEach(id => latest.tombstones.delete(id));
            latest.pending = false;
        }
        lastSyncTime = Date.now();
        saveCourseToLocalStorage(courseName);
        refreshPendingChanges();
    })();
    courseSyncRequests.set(courseName, request);
    try {
        await request;
    } finally {
        if (courseSyncRequests.get(courseName) === request) courseSyncRequests.delete(courseName);
    }
}

/**
* Syncs the current frontend databaseMap UP to the Google Sheet via Apps Script.
* ONLY callable by admins.
*/
async function syncDatabaseToSheet() {
    if (!isAdmin || !isOnline) {
        console.warn("Skipping DB sync: not an admin or offline.");
        return;
    }

    try {
        // Staff entries are keyed by name and live in the staff table, not students.
        const students = Object.fromEntries(studentEntries());
        const resultData = await callWebApp('syncDatabase_Admin', { databaseData: students }, 'POST');

        if (resultData && resultData.result === 'success') {
            console.log(`Successfully synced ${resultData.count} database entries via script.`);
            invalidateDatabaseCache(); // Invalidate cache after successful push
        } else {
            throw new Error(resultData ? resultData.message : 'Unknown error during database sync.');
        }

    } catch (error) {
        console.error('Error syncing database via script:', error);
        showNotification('error', 'Database Sync Error', `Failed to sync database: ${error.message}`);
        // Rethrow the error to be caught by the caller (e.g., completeAction)
        throw error;
    }
}


/**
 * Update sort icons in the table headers.
 */
function updateSortIcons() {
    // Reset the logs table's sort icons (the Student List has its own).
    document.querySelectorAll('.logs-table .sort-icon').forEach(icon => {
        const i = document.createElement('i');
        i.className = 'sort-icon fa-solid fa-sort';
        icon.replaceWith(i);
    });

    // Set sort icon for current sort field
    const [field, direction] = currentSort.split('-');
    const header = document.querySelector(`.logs-table .sortable[data-sort="${field}"]`);

    if (header) {
        const icon = header.querySelector('.sort-icon');
        if (icon) {
            const i = document.createElement('i');
            i.className = `sort-icon fa-solid fa-sort-${direction === 'asc' ? 'up' : 'down'}`;
            icon.replaceWith(i);
        }
    }
}

/**
 * Handle filter input change for logs.
 */
function handleFilterChange() {
    filter = filterInput.value.toLowerCase();
    logsCurrentPage = 1;
    updateLogsList();
}

/**
 * Handle sort dropdown change for logs.
 */
function handleSortChange() {
    currentSort = sortSelect.value;
    logsCurrentPage = 1;
    localStorage.setItem('logs_sort', currentSort);
    const logsTable = document.querySelector('.logs-table'); // Get the table

    // Add or remove class based on the sort option
    if (currentSort.startsWith('date')) {
        logsTable.classList.add('sorting-by-date');
    } else {
        logsTable.classList.remove('sorting-by-date');
    }

    updateSortIcons();
    updateLogsList();
}

/**
 * Handle filter input change for database.
 */
function handleDbFilterChange() {
    dbFilter = dbFilterInput.value.toLowerCase();
    dbCurrentPage = 1;
    updateDatabaseList();
}

/**
 * Add new database entry.
 */
function showAddEntryDialog() {
    if (!isAdmin) return;

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // State tracker for the NFC scan session
    let activeNfcSession = { controller: null, button: null };

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-user-plus"></i> Add New Student</h3>
        <div class="dialog-content">
            <p style="margin-bottom: 15px; opacity: 0.7;">Enter details for the new database entry.</p>
            
            <div class="form-group">
                <label class="dialog-label-fixed" for="add-name">Name <span class="required">*</span></label>
                <input type="text" id="add-name" class="form-control" placeholder="Full Name">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="add-email">Email <span class="required">*</span></label>
                <input type="email" id="add-email" class="form-control" placeholder="nsurname00@epoka.edu.al">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="add-hardware-uid"><i class="fa-solid fa-wifi"></i> UID</label>
                <div class="admin-input-wrapper" style="margin:0; width:100%;">
                    <input type="text" id="add-hardware-uid" class="form-control" placeholder="Optional legacy card UID">
                    ${nfcSupported ? '<button class="btn-blue btn-icon btn-sm scan-uid-btn" title="Scan UID" style="border-radius:6px;"><i class="fa-solid fa-wifi"></i></button>' : ''}
                </div>
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="add-student-id"><i class="fa-solid fa-id-card"></i> Card ID</label>
                <input type="text" id="add-student-id" class="form-control" placeholder="Card ID">
            </div>
            
            <div id="nfc-status-container" style="margin-top:10px;"></div>
        </div>
        <div class="dialog-actions">
            <button id="cancel-add-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="confirm-add-btn" class="btn-green"><i class="fa-solid fa-plus"></i> Add Student</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const close = () => {
        if (activeNfcSession.controller) activeNfcSession.controller.abort();
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    const hwInput = dialog.querySelector('#add-hardware-uid');
    const idInput = dialog.querySelector('#add-student-id');
    const nfcStatusContainer = dialog.querySelector('#nfc-status-container');
    const scanBtn = dialog.querySelector('.scan-uid-btn');

    // Legacy cards can fill an empty ID; an IT-supplied ID remains independent.
    if (hwInput && idInput) {
        let generatedId = '';
        hwInput.addEventListener('input', () => {
            if (!idInput.value || idInput.value === generatedId) {
                generatedId = convertUidToExternalId(hwInput.value.trim()) || '';
                idInput.value = generatedId;
            }
        });
    }

    if (scanBtn) {
        scanBtn.addEventListener('click', () => {
            if (activeNfcSession.button === scanBtn) {
                if (activeNfcSession.controller) activeNfcSession.controller.abort();
                activeNfcSession = { controller: null, button: null };
                scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                nfcStatusContainer.innerHTML = '';
                nfcStatusContainer.style.minHeight = '0';
            } else {
                if (activeNfcSession.controller) {
                    activeNfcSession.controller.abort();
                    activeNfcSession.button.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                }
                scanBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                const controller = startNfcForInputDialog(hwInput, nfcStatusContainer, scanBtn);
                activeNfcSession = { controller, button: scanBtn };
            }
        });
    }

    document.getElementById('cancel-add-btn').addEventListener('click', close);

    // --- Event Listener ---
    document.getElementById('confirm-add-btn').addEventListener('click', async () => {
        const nameInput = document.getElementById('add-name');
        const emailInput = document.getElementById('add-email');

        // --- Validation ---
        clearInputError(nameInput);
        clearInputError(emailInput);
        clearInputError(idInput);
        clearInputError(hwInput);
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const rawHw = hwInput.value.trim();
        const rawId = idInput.value.trim();
        const uid = rawId || convertUidToExternalId(rawHw) || rawHw;
        const hardwareUid = rawHw;

        let isValid = true;
        if (name === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(email)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        if (!uid && !hardwareUid) { showInputError(idInput, 'UID or ID is required.'); isValid = false; }
        if (!isValid) return;

        const submissionData = {
            name: name,
            email: email,
            uid: uid,
            hardwareUid: hardwareUid,
            sentBy: {
                name: currentUser?.name || '',
                email: currentUser?.email || ''
            }
        };

        // Check for local duplicates first
        const match = findDuplicateInDatabase(submissionData);
        if (match) {
            // The warning dialog saves the chosen change and reloads the list.
            const completeAction = () => {
                window.buildUIDToPrimaryUidMap();
                updateUI();
            };

            showDuplicateWarningForNewEntry(submissionData, [match.duplicate], completeAction);
            close(); // Close the current 'Add' dialog
            return;
        }

        // NO DUPLICATE: Use the fast backend call `addEntryToDatabase_Admin`
        const confirmBtn = document.getElementById('confirm-add-btn');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Adding...';

        try {
            const result = await callWebApp('addEntryToDatabase_Admin', submissionData, 'POST');

            if (result && result.result === 'success') {
                showNotification('success', 'Added to Database', `${name} has been added.`);

                // The entry was added on the backend. Invalidate our local cache
                // and re-fetch the *entire* database to get the new entry with its proper key.
                invalidateDatabaseCache();
                await fetchDatabaseFromSheet(); // This is the fast backend call 'getDatabase'

                window.buildUIDToPrimaryUidMap();
                updateUI(); // Re-render everything with the new data
                close(); // 
            } else {
                throw new Error(result?.message || 'Failed to add entry');
            }
        } catch (error) {
            showNotification('error', 'Submission Failed', error.message);
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Student';
        }
    });
}

function editDatabaseEntry(dbKey) {
    if (!isAdmin || !databaseMap[dbKey] || databaseMap[dbKey].isStaff) return;

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const entry = databaseMap[dbKey];
    let activeNfcSession = { controller: null, button: null };

    dialog.innerHTML = `
    <h3 class="dialog-title"><i class="fa-solid fa-user-pen"></i> Edit Student</h3>
    <div class="dialog-content">
        <div class="form-group">
            <label class="dialog-label-fixed" for="edit-name">Name <span class="required">*</span></label>
            <input type="text" id="edit-name" class="form-control" placeholder="Full Name" value="${escapeHtml(entry.name)}">
        </div>
        
        <div class="form-group">
            <label class="dialog-label-fixed" for="edit-email">Email <span class="required">*</span></label>
            <input type="email" id="edit-email" class="form-control" placeholder="nsurname00@epoka.edu.al" value="${escapeHtml(entry.email || '')}">
        </div>
        
        <hr style="margin: 15px 0; border:0; border-top:1px solid #eee;">
        
        <div id="uid-list-container"></div>
        
        <div style="display: flex; justify-content: flex-end; margin-top: 15px;">
             <button id="add-new-uid-row-btn" class="btn-blue btn-sm"><i class="fa-solid fa-plus"></i> Add UID / ID</button>
        </div>
        <div id="nfc-status-container" style="margin-top:10px;"></div>
    </div> 
    <div class="dialog-actions">
        <button id="cancel-request-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="submit-request-btn" class="btn-green"><i class="fa-solid fa-check"></i> Submit</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const uidListContainer = dialog.querySelector('#uid-list-container');
    const nfcStatusContainer = dialog.querySelector('#nfc-status-container');

    const createUidRow = (idVal = '', hwVal = '') => {
        const uidGroup = document.createElement('div');
        uidGroup.setAttribute('class', 'uid-edit-row');
        uidGroup.style.cssText = 'margin-bottom:12px; background:rgba(0,0,0,0.02); padding:10px 12px; border-radius:8px; border:1px solid rgba(0,0,0,0.06);';
        
        const initHw = hwVal;
        const initId = idVal || convertUidToExternalId(hwVal);

        uidGroup.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="font-weight:600; font-size:0.85em; opacity:0.8;"><i class="fa-solid fa-id-card"></i> Card ID</span>
                <button type="button" class="btn-red btn-sm remove-uid-btn" title="Remove" style="padding:3px 8px; border-radius:4px; font-size:0.8em; display:inline-flex; align-items:center; gap:4px; height:auto;"><i class="fa-solid fa-trash-can"></i> Remove</button>
            </div>
            <div class="form-group" style="margin-bottom:8px;">
                <label class="dialog-label-fixed" style="width:90px; min-width:90px;"><i class="fa-solid fa-wifi"></i> UID</label>
                <div style="flex-grow:1; display:flex; gap:6px;">
                    <input type="text" class="form-control hw-uid-input" value="${escapeHtml(initHw)}" placeholder="Optional legacy card UID">
                    ${nfcSupported ? '<button class="btn-blue btn-icon btn-sm scan-uid-btn" title="Scan UID" style="border-radius:6px;"><i class="fa-solid fa-wifi"></i></button>' : ''}
                </div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <label class="dialog-label-fixed" style="width:90px; min-width:90px;"><i class="fa-solid fa-id-card"></i> Card ID</label>
                <input type="text" class="form-control student-id-input" value="${escapeHtml(initId)}" placeholder="Card ID">
            </div>`;
        uidListContainer.appendChild(uidGroup);

        const hwInputEl = uidGroup.querySelector('.hw-uid-input');
        const idInputEl = uidGroup.querySelector('.student-id-input');

        let generatedId = '';
        hwInputEl.addEventListener('input', () => {
            if (!idInputEl.value || idInputEl.value === generatedId) {
                generatedId = convertUidToExternalId(hwInputEl.value.trim()) || '';
                idInputEl.value = generatedId;
            }
        });

        uidGroup.querySelector('.remove-uid-btn').addEventListener('click', () => {
            if (uidListContainer.querySelectorAll('.uid-edit-row').length > 1) {
                uidGroup.remove();
            } else {
                showNotification('warning', 'Cannot Remove', 'At least one Card/ID pair is required.');
            }
        });

        const scanBtn = uidGroup.querySelector('.scan-uid-btn');
        if (scanBtn) {
            scanBtn.addEventListener('click', () => {
                if (activeNfcSession.button === scanBtn) {
                    if (activeNfcSession.controller) activeNfcSession.controller.abort();
                    activeNfcSession = { controller: null, button: null };
                    scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                    nfcStatusContainer.innerHTML = '';
                    nfcStatusContainer.style.minHeight = '0';
                } else {
                    if (activeNfcSession.controller) {
                        activeNfcSession.controller.abort();
                        activeNfcSession.button.innerHTML = '<i class="fa-solid fa-wifi"></i>';
                    }
                    scanBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
                    const controller = startNfcForInputDialog(hwInputEl, nfcStatusContainer, scanBtn);
                    activeNfcSession = { controller, button: scanBtn };
                }
            });
        }
    };

    const count = Math.max((entry.uids || []).length, (entry.hardware_uids || []).length);
    if (count === 0) {
        createUidRow('', '');
    } else {
        for (let i = 0; i < count; i++) {
            createUidRow((entry.uids || [])[i] || '', (entry.hardware_uids || [])[i] || '');
        }
    }

    dialog.querySelector('#add-new-uid-row-btn').addEventListener('click', () => createUidRow());

    const closeDialog = () => {
        if (activeNfcSession.controller) activeNfcSession.controller.abort();
        if (document.body.contains(dialogBackdrop)) document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };

    document.getElementById('cancel-request-btn').addEventListener('click', closeDialog);

    document.getElementById('submit-request-btn').addEventListener('click', async () => {
        const nameInput = document.getElementById('edit-name');
        const emailInput = document.getElementById('edit-email');
        const rows = Array.from(dialog.querySelectorAll('.uid-edit-row'));

        clearInputError(nameInput);
        clearInputError(emailInput);
        const newName = nameInput.value.trim();
        const newEmail = emailInput.value.trim();
        let isValid = true;
        if (newName === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(newEmail)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }

        const finalUids = [];
        const finalHardwareUids = [];

        rows.forEach(row => {
            const hwEl = row.querySelector('.hw-uid-input');
            const idEl = row.querySelector('.student-id-input');
            clearInputError(hwEl);
            clearInputError(idEl);

            const rawHw = hwEl.value.trim();
            const rawId = idEl.value.trim();

            const studentId = rawId || convertUidToExternalId(rawHw);
            const hardwareUid = rawHw;

            if (!studentId && !hardwareUid) {
                showInputError(idEl, 'At least one ID or UID is required.');
                isValid = false;
            } else {
                if (studentId) finalUids.push(studentId);
                if (hardwareUid) finalHardwareUids.push(hardwareUid);
            }
        });

        if (!isValid) return;

        // 1. Update local map
        databaseMap[dbKey] = { name: newName, email: newEmail, uids: finalUids, hardware_uids: finalHardwareUids };

        // 2. UPDATE UI IMMEDIATELY
        window.buildUIDToPrimaryUidMap();
        updateUI();

        // 3. SHOW SUCCESS AND CLOSE DIALOG IMMEDIATELY
        showNotification('success', 'Entry Updated', `Updated details for ${newName}.`);
        closeDialog();

        // 4. SYNC IN THE BACKGROUND
        if (isOnline) {
            const updateData = {
                dbKey: dbKey,
                name: newName,
                email: newEmail,
                uids: finalUids,
                hardwareUids: finalHardwareUids
            };

            callWebApp('updateStudentInDatabase_Admin', updateData, 'POST')
                .then(() => {
                    invalidateDatabaseCache();
                })
                .catch((err) => {
                    console.error("Background sync failed:", err);
                    showNotification('error', 'Sync Failed', 'Changes saved locally but failed to sync.');
                });
        }
    });
}

/**
 * Delete database entry.
 * @param {string} uid - The UID of the entry to delete.
 */
function deleteDatabaseEntry(dbKey) {
    if (!isAdmin || databaseMap[dbKey]?.isStaff) return;
    const name = databaseMap[dbKey]?.name;
    if (!name) return;

    showConfirmationDialog({
        title: `Delete "${escapeHtml(name)}" ?`,
        message: `Are you sure you want to delete "${escapeHtml(name)}" (Key: ${escapeHtml(dbKey)}) from the database?`,
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: async () => {
            // 1. Optimistic UI update
            delete databaseMap[dbKey];
            window.buildUIDToPrimaryUidMap();
            updateUI();
            showNotification('delete', 'Entry Deleted', `Removed ${name} from the database.`);

            // 2. Sync deletion to backend
            if (isOnline && isSignedIn) {
                try {
                    await callWebApp('deleteEntryFromDatabase_Admin', { dbKey: dbKey }, 'POST');
                    invalidateDatabaseCache(); // Invalidate cache after successful delete
                } catch (err) {
                    console.error('Error deleting entry from backend:', err);
                    showNotification('error', 'Sync Error', 'Entry deleted locally but failed to sync.');
                    // Since it failed, force a re-fetch to get back the deleted item
                    // to keep UI consistent with the server.
                    await fetchDatabaseFromSheet();
                    window.buildUIDToPrimaryUidMap();
                    updateUI();
                }
            }
        }
    });
}

/**
* Fetch course information from COURSE_INFO sheet
* @returns {Promise} A promise that resolves when course info is fetched
*/
async function fetchCourseInfo() {
    try {
        const result = await callWebApp('getCourseInfo', {}, 'POST');
        if (result) {
            courseInfoMap = result;
            courseIDMap = {}; // Reset map
            Object.entries(result).forEach(([courseName, metadata]) => {
                if (metadata && metadata.eisId) {
                    // Ensure key matches the currentCourse variable exactly (trim just in case)
                    courseIDMap[courseName.trim()] = metadata.eisId;
                }
            });
        }
    } catch (e) {
        console.error('Error fetching course info:', e);
    }
}

/**
        * Displays a custom, non-blocking alert dialog.
        * @param {string} title - The title of the dialog. (This is now ignored but kept for compatibility)
        * @param {string} message - The main text/HTML for the user.
        */
function showAlertDialog(title, message) {
    openDialogMode(); // Prevent background scroll
    const existingDialog = document.querySelector('.dialog-backdrop');
    if (existingDialog) existingDialog.remove();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');

    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
        <div class="dialog-content" style="padding-top: 10px;">${message}
        </div><div class="dialog-actions">
            <button id="dialog-ok-btn" class="btn-blue">OK</button>
        </div>
    `; // Removed title and <p> wrapper, adjusted padding

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        // Add fade-out animation
        dialog.classList.add('dialog-fade-out');
        dialogBackdrop.classList.add('backdrop-fade-out'); // Also fade backdrop

        setTimeout(() => {
            if (document.body.contains(dialogBackdrop)) {
                document.body.removeChild(dialogBackdrop);
            }
            closeDialogMode(); // Restore background scrolling
        }, 300); // Match animation duration
    };

    document.getElementById('dialog-ok-btn').addEventListener('click', closeDialog);
    dialogBackdrop.addEventListener('click', (e) => {
        if (e.target === dialogBackdrop) closeDialog();
    });
}


/**
* Displays a custom confirmation dialog with dynamic button colors.
* @param {object} options - The options for the dialog.
* @param {boolean} [options.isDestructive=false] - If true, the confirm button will be red.
*/
function showConfirmationDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, onCancel, isDestructive = false }) {
    openDialogMode();

    const confirmBtnClass = isDestructive ? 'btn-red' : 'btn-green';
    const cancelBtnClass = 'btn-blue';

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop confirmation-backdrop');
    dialogBackdrop.style.zIndex = '10050';

    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog confirmation-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.innerHTML = `
        <h3 class="dialog-title">${title}</h3>
        <div class="dialog-content"><p>${message}</p></div>
        <div class="dialog-actions">
            <button id="dialog-cancel-btn" class="${cancelBtnClass}">${cancelText}</button>
            <button id="dialog-confirm-btn" class="${confirmBtnClass}">${confirmText}</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const confirmBtn = dialog.querySelector('#dialog-confirm-btn');
    const cancelBtn = dialog.querySelector('#dialog-cancel-btn');
    const closeConfirmDialog = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    confirmBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        confirmBtn.disabled = true;
        cancelBtn.disabled = true;
        try {
            // Keep form controls available while the callback reads selected options.
            if (typeof onConfirm === 'function') await onConfirm();
            closeConfirmDialog();
        } catch (error) {
            showNotification('error', 'Action Failed', error.message || 'Please try again.');
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    });

    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeConfirmDialog();
        if (typeof onCancel === 'function') onCancel();
        closeDialogMode();
    });
}

/**
 * Clear the entire database.
 */
function clearDatabase() {
    if (!isAdmin) return;

    showConfirmationDialog({
        title: 'Delete every student?',
        message: 'This removes every student and their card IDs from the Student List. Attendance logs are kept, but they will show as unknown cards. Staff are not affected. This cannot be undone.',
        confirmText: 'Delete all',
        isDestructive: true,
        onConfirm: async () => {
            if (!isOnline || !isSignedIn) throw new Error('Connect to the internet to change the student list.');
            // Keep staff so their scans still show a name; the dialog reports a failure.
            const staffOnly = Object.fromEntries(Object.entries(databaseMap).filter(([, data]) => data?.isStaff));
            const previous = databaseMap;
            databaseMap = staffOnly;
            try {
                await syncDatabaseToSheet();
            } catch (error) {
                databaseMap = previous;
                throw error;
            } finally {
                window.buildUIDToPrimaryUidMap();
                updateUI();
            }
            showNotification('delete', 'Students Deleted', 'The student list is now empty.');
        }
    });
}

/**
 * Shows a dialog to add a manual log entry with a searchable student list.
 */
function showAddLogEntryDialog() {
    if (!isAdmin) return;
    if (!currentCourse) {
        showNotification('warning', 'No Course', 'Select a course first.');
        return;
    }

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const now = new Date();
    const formattedDate = localDateString(now);
    const formattedTime = now.toTimeString().split(' ')[0].substring(0, 5);

    // Prepare Session Toggles
    const sessionHtml = renderSessionSelectorHTML('manual', false, true);

    // Prepare student list (1 unique entry per student in databaseMap)
    const studentList = [];
    Object.entries(databaseMap).forEach(([dbKey, data]) => {
        const primaryUid = (data.uids && data.uids.length > 0)
            ? data.uids[0]
            : (data.hardware_uids && data.hardware_uids.length > 0
                ? (convertUidToExternalId(data.hardware_uids[0]) || data.hardware_uids[0])
                : '');

        // Collect all searchable IDs and UIDs for this student
        const allUids = [...(data.uids || []), ...(data.hardware_uids || [])];

        // Readable subtitle with ID and UID (Global Admin only)
        const idParts = (data.uids && data.uids.length > 0) ? `ID: ${data.uids.join(', ')}` : '';
        const hwParts = (data.hardware_uids && data.hardware_uids.length > 0) ? `UID: ${data.hardware_uids.join(', ')}` : '';
        const subtitle = isGlobalAdmin
            ? [idParts, hwParts].filter(Boolean).join(' • ')
            : (data.email || '');

        studentList.push({
            name: data.name || 'Unknown',
            primaryUid: primaryUid,
            allUids: allUids,
            subtitle: subtitle,
            initials: (data.name || 'UN').substring(0, 2).toUpperCase()
        });
    });
    studentList.sort((a, b) => a.name.localeCompare(b.name));

    dialog.innerHTML = `
    <h3 class="dialog-title"><i class="fa-solid fa-clock"></i> Add Manual Log</h3>
    <div class="dialog-content">
        
        <div class="form-group" style="margin-bottom:0;">
            <label class="dialog-label-fixed"><i class="fa-solid fa-search"></i> Search</label>
            <input type="text" id="manual-name-search" class="form-control" placeholder="${isGlobalAdmin ? 'Type name, ID, or UID...' : 'Type student name...'}" autocomplete="off">
        </div>

        <div id="student-list-container" class="student-list-container" style="max-height:120px; min-height:80px; overflow-y:auto; margin-top:8px;"></div>
        <div id="selection-hint" style="font-size:0.85em; color:#888; margin-top:5px; text-align:right;">No student selected</div>

        <hr style="margin: 15px 0; border:0; border-top:1px solid #eee;">

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-calendar-days"></i> Date</label>
            <input type="date" id="manual-date" class="form-control" value="${formattedDate}">
        </div>

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-clock"></i> Time</label>
            <input type="time" id="manual-time" class="form-control" value="${formattedTime}">
        </div>

        <div class="form-group" style="align-items:flex-start; margin-top:15px;">
            <label class="dialog-label-fixed" style="margin-top:12px;"><i class="fa-solid fa-users"></i> Group</label>
            <div style="flex-grow:1;">
                ${sessionHtml || '<input type="text" id="manual-session-fallback" class="form-control" value="Default" disabled>'}
            </div>
        </div>

    </div>
    <div class="dialog-actions">
        <button id="cancel-manual-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="save-manual-log-btn" class="btn-green" disabled><i class="fa-solid fa-plus"></i> Add Entry</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- Activate Toggles ---
    if (sessionHtml) {
        const rawSections = courseInfoMap[currentCourse].availableSections || '';
        setupSessionToggleListeners('manual', parseAvailableSections(rawSections));

        // Auto-select based on Main UI State
        const currentActive = getCurrentActiveSession();
        if (currentActive && currentActive !== 'Default') {
            const [cat, grp] = currentActive.split(' ');

            // Trigger clicks to simulate selection
            const catBtn = document.querySelector(`#manual-cat-row .course-button[data-val="${cat}"]`);
            if (catBtn) catBtn.click();

            if (grp) {
                const grpBtn = document.querySelector(`#manual-groups-${cat} .course-button[data-val="${grp}"]`);
                if (grpBtn) grpBtn.click();
            }
        }
    }

    // --- Logic (Student Search) ---
    let selectedUid = null;
    const listContainer = dialog.querySelector('#student-list-container');
    const searchInput = dialog.querySelector('#manual-name-search');
    const saveBtn = dialog.querySelector('#save-manual-log-btn');
    const selectionHint = dialog.querySelector('#selection-hint');

    dialog._checkDirty = () => {
        const hasSelected = !!selectedUid;
        const searchVal = (searchInput?.value || '').trim();
        const manualDate = document.getElementById('manual-date')?.value;
        const manualTime = document.getElementById('manual-time')?.value;
        return hasSelected || searchVal !== '' || (manualDate && manualDate !== formattedDate) || (manualTime && manualTime !== formattedTime);
    };

    const renderList = (filterText = '') => {
        listContainer.innerHTML = '';
        const lowerFilter = filterText.toLowerCase().trim();
        if (!lowerFilter) {
            listContainer.innerHTML = `<div style="padding:15px; text-align:center; opacity:0.5; font-size:0.85em;"><i class="fa-solid fa-magnifying-glass" style="margin-right:5px;"></i>Type to search students...</div>`;
            return;
        }

        const filtered = studentList.filter(s =>
            s.name.toLowerCase().includes(lowerFilter) ||
            (isGlobalAdmin && s.allUids.some(u => u.toLowerCase().includes(lowerFilter)))
        );

        if (filtered.length === 0) {
            listContainer.innerHTML = `<div style="padding:15px; text-align:center; opacity:0.6; font-size:0.85em;">No results found</div>`;
            return;
        }

        const itemsToShow = filtered.slice(0, 50);
        itemsToShow.forEach(student => {
            const isSelected = selectedUid === student.primaryUid;
            const div = document.createElement('div');
            div.setAttribute('class', `student-item ${isSelected ? 'selected' : ''}`);
            div.innerHTML = `
                <div class="student-avatar-placeholder">${student.initials}</div>
                <div class="student-info">
                    <div class="student-name">${escapeHtml(student.name)}</div>
                    ${student.subtitle ? `<div class="student-uid" style="font-size:0.82em; opacity:0.75;">${escapeHtml(student.subtitle)}</div>` : ''}
                </div>`;
            div.onclick = () => selectStudent(student);
            listContainer.appendChild(div);
        });
    };

    const selectStudent = (student) => {
        selectedUid = student.primaryUid;
        renderList(searchInput.value);
        selectionHint.textContent = `Selected: ${student.name}`;
        selectionHint.style.color = "var(--primary-color)";
        saveBtn.disabled = false;
    };

    searchInput.addEventListener('input', (e) => renderList(e.target.value));
    renderList();

    const closeDialog = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    dialog.querySelector('#cancel-manual-btn').addEventListener('click', closeDialog);

    saveBtn.addEventListener('click', () => {
        if (!selectedUid) return;

        const manualDate = document.getElementById('manual-date').value;
        const manualTime = document.getElementById('manual-time').value;
        const timestamp = new Date(`${manualDate}T${manualTime}:00`).getTime();
        if (!manualDate || !manualTime || !Number.isFinite(timestamp)) {
            showNotification('warning', 'Missing Date or Time', 'Choose the date and time of the entry.');
            return;
        }

        let manualSession = 'Default';
        const sessionInput = document.getElementById('manual-selected-session');
        if (sessionInput) manualSession = sessionInput.value;

        let newLog = {
            uid: selectedUid,
            timestamp,
            id: Date.now() + Math.random().toString(36).substring(2, 11),
            manual: true,
            session: manualSession
        };

        newLog = touchLogForEdit(newLog, currentUser?.email);

        if (!courseData[currentCourse]) {
            courseData[currentCourse] = { logs: [], tombstones: new Set() };
        }

        courseData[currentCourse].logs.unshift(newLog);
        saveAndMarkChanges(currentCourse);
        updateUI();

        if (isOnline && isSignedIn) syncLogsWithSheet();

        showNotification('success', 'Entry Added', 'Manual log recorded.');
        closeDialog();
    });
}

/**
 * Validates an email string.
 * @param {string} email - The email to validate.
 * @returns {boolean} True if the email is valid, false otherwise.
 */
function isValidEmail(email) {
    if (!email || email.trim() === '') return false; // Check if empty
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // Basic email format regex
    return emailRegex.test(email);
}

/**
* Show dialog to edit a log entry group.
* @param {Object} group - The log group to edit.
*/
function showEditLogDialog(group) {
    if (!isAdmin) return;
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    group.originalLogs.sort((a, b) => a.timestamp - b.timestamp);
    const firstLog = group.originalLogs[0];
    const commonDateObj = new Date(firstLog.timestamp);
    const formattedDate = localDateString(commonDateObj);

    // --- Robustly determine Student Data, UID (Hardware), and ID (Converted) ---
    const dbKey = group.dbKey || lookupPrimaryUid(group.uid) || (databaseMap[group.uid] ? group.uid : null);
    const studentData = group.studentData || (dbKey ? databaseMap[dbKey] : null);

    let uidDisplay = '';
    let idDisplay = '';

    if (studentData) {
        if (studentData.hardware_uids && studentData.hardware_uids.length > 0) {
            uidDisplay = studentData.hardware_uids.join(', ');
        } else if (studentData.uids && studentData.uids.length > 0) {
            uidDisplay = studentData.uids.map(convertExternalIdToUid).filter(Boolean).join(', ');
        }

        if (studentData.uids && studentData.uids.length > 0) {
            idDisplay = studentData.uids.join(', ');
        } else if (studentData.hardware_uids && studentData.hardware_uids.length > 0) {
            idDisplay = studentData.hardware_uids.map(convertUidToExternalId).filter(Boolean).join(', ');
        }
    }

    if (!uidDisplay) {
        uidDisplay = (group.uid && group.uid.includes(':')) ? group.uid : (convertExternalIdToUid(group.uid) || group.uid);
    }
    if (!idDisplay) {
        idDisplay = (group.uid && !group.uid.includes(':')) ? group.uid : (convertUidToExternalId(group.uid) || group.uid);
    }

    let timestampFields = '';
    group.originalLogs.forEach((log, index) => {
        const timeObj = new Date(log.timestamp);
        const formattedTime = timeObj.getHours().toString().padStart(2, '0') + ':' + timeObj.getMinutes().toString().padStart(2, '0');
        const manualClass = (log.manual === true || log.manual === 'true') ? 'manual-timestamp-input' : '';

        // --- Session Dropdown ---
        const sessionLabel = log.session ? log.session : 'Default';
        const optionsHtml = generateSessionOptions(sessionLabel);

        timestampFields += `
        <div class="timestamp-edit-group" data-log-id="${log.id}">
            <div class="form-group" style="align-items:center;">
                <label class="dialog-label-fixed">Time ${index + 1}</label>
                
                <div style="flex-grow:1; display:flex; flex-direction:column; gap:5px;">
                    <div class="input-with-icon">
                        <i class="fa-regular fa-clock"></i>
                        <input type="time" class="form-control timestamp-time ${manualClass}" value="${formattedTime}">
                    </div>
                    <select class="form-control timestamp-session" style="font-size:0.85em; padding:4px 8px; height:auto;">
                        ${optionsHtml}
                    </select>
                </div>

                <button class="delete-time-btn btn-red btn-icon" data-index="${index}" title="Delete Timestamp" style="margin-left:10px; border-radius:6px;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        </div>`;
    });

    dialog.innerHTML = `
    <h3 class="dialog-title"><i class="fa-solid fa-pen-to-square"></i> Edit Log Entry</h3>
    <div class="dialog-content">
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-quote-right"></i> Name</label>
            <input type="text" id="edit-name" class="form-control" value="${escapeHtml(studentData?.name || group.name)}" disabled>
        </div>
        ${isGlobalAdmin ? `
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-id-card"></i> Card ID</label>
            <input type="text" id="edit-student-id" class="form-control" value="${escapeHtml(idDisplay)}" disabled>
        </div>
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID</label>
            <input type="text" id="edit-card-uid" class="form-control" value="${escapeHtml(uidDisplay)}" disabled>
        </div>
        ` : ''}
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-calendar-days"></i> Date</label>
            <input type="date" id="edit-date" class="form-control" value="${formattedDate}">
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <label class="inline-field-label" style="margin:0;">Timestamps</label>
            <div class="dialog-button-group">
                <button type="button" id="add-new-time-btn" class="btn-green btn-sm"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add Time</button>
                <button type="button" id="delete-all-logs-btn" class="btn-red btn-sm"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete All</button>
            </div>
        </div>
        
        <div id="timestamp-container">${timestampFields}</div>
    </div>
    <div class="dialog-actions">
        <button id="cancel-edit-log-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="save-edit-log-btn" class="btn-green"><i class="fa-solid fa-floppy-disk"></i> Save Changes</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const timestampContainer = document.getElementById('timestamp-container');

    // Add New Time Logic
    document.getElementById('add-new-time-btn').addEventListener('click', () => {
        const allTimes = timestampContainer.querySelectorAll('.timestamp-time');
        let newTimeValue = '12:00';

        if (allTimes.length > 0) {
            const latestTime = Array.from(allTimes).reduce((latest, current) => current.value > latest ? current.value : latest, '00:00');
            const [hours, minutes] = latestTime.split(':').map(Number);
            const nextHour = (hours + 1) % 24;
            newTimeValue = `${String(nextHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
        }

        const defaultSessionOptions = generateSessionOptions(getCurrentActiveSession());

        const newTimestampGroup = document.createElement('div');
        newTimestampGroup.setAttribute('class', 'timestamp-edit-group new-item-flash');
        newTimestampGroup.dataset.isNew = "true";
        newTimestampGroup.innerHTML = `
        <div class="form-group">
            <label class="dialog-label-fixed">New Time</label>
            <div class="input-with-icon" style="flex-grow:1; display:flex; flex-direction:column; gap:5px;">
                <div class="input-with-icon">
                    <i class="fa-regular fa-clock"></i>
                    <input type="time" class="form-control timestamp-time manual-timestamp-input" value="${newTimeValue}">
                </div>
                <select class="form-control timestamp-session" style="font-size:0.85em; padding:4px 8px; height:auto;">
                    ${defaultSessionOptions}
                </select>
            </div>
            <button class="delete-time-btn btn-red btn-icon" title="Remove" style="margin-left:10px;">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>`;

        timestampContainer.appendChild(newTimestampGroup);
        newTimestampGroup.querySelector('.delete-time-btn').addEventListener('click', function () {
            this.closest('.timestamp-edit-group').remove();
        });
    });

    const closeDialog = () => { if (document.body.contains(dialogBackdrop)) document.body.removeChild(dialogBackdrop); closeDialogMode(); };

    // Delete individual timestamp logic
    const logsToDelete = new Set();
    dialog.querySelectorAll('.delete-time-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const index = parseInt(this.getAttribute('data-index'));
            const logId = group.originalLogs[index].id;
            const timestampGroup = this.closest('.timestamp-edit-group');
            logsToDelete.add(logId);
            timestampGroup.classList.add('deleted');
            timestampGroup.style.display = 'none';
        });
    });

    // --- Delete All Logic ---
    document.getElementById('delete-all-logs-btn').addEventListener('click', () => {
        showConfirmationDialog({
            title: 'Delete Entire Entry?',
            message: `Are you sure you want to delete <strong>ALL ${group.originalLogs.length} timestamps</strong> for this date? This cannot be undone.`,
            confirmText: 'Delete All',
            isDestructive: true,
            onConfirm: () => {
                const idsToRemove = group.originalLogs.map(log => log.id);

                if (isGlobalAdmin) {
                    idsToRemove.forEach(id => addToTombstones(id));
                    courseData[currentCourse].logs = courseData[currentCourse].logs.filter(log => !idsToRemove.includes(log.id));
                    saveAndMarkChanges(currentCourse);
                    updateUI();
                    showNotification('delete', 'Deleted', 'All timestamps were deleted.');
                    if (isOnline && isSignedIn) syncLogsWithSheet();
                } else {
                    Promise.all(idsToRemove.map(id => deleteLogViaBackend(id)))
                        .then(() => {
                            courseData[currentCourse].logs = courseData[currentCourse].logs.filter(log => !idsToRemove.includes(log.id));
                            updateUI();
                            showNotification('delete', 'Deleted', 'All timestamps were deleted.');
                        })
                        .catch(err => {
                            showNotification('error', 'Error', 'Failed to delete some logs.');
                            console.error(err);
                        });
                }
                closeDialog();
            }
        });
    });

    // SAVE LOGIC
    document.getElementById('save-edit-log-btn').addEventListener('click', () => {
        const dateInput = document.getElementById('edit-date');
        const newDateStr = dateInput.value;
        const logsForCurrentCourse = courseData[currentCourse].logs;

        // An empty date or time would store an invalid timestamp.
        clearInputError(dateInput);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDateStr)) {
            showInputError(dateInput, 'Choose a date.');
            return;
        }
        const emptyTime = [...dialog.querySelectorAll('.timestamp-edit-group:not(.deleted) .timestamp-time')]
            .find(input => !/^\d{2}:\d{2}/.test(input.value));
        if (emptyTime) {
            showNotification('warning', 'Missing Time', 'Enter a time for every timestamp, or delete the ones you do not need.');
            emptyTime.focus();
            return;
        }
        const [year, month, day] = newDateStr.split('-').map(Number);

        // Update Existing Logs
        const visibleGroups = dialog.querySelectorAll('.timestamp-edit-group:not(.deleted)');
        visibleGroups.forEach(groupElement => {
            const logId = groupElement.getAttribute('data-log-id');
            if (!logId) return;

            const timeInput = groupElement.querySelector('.timestamp-time');
            const sessionInput = groupElement.querySelector('.timestamp-session');
            const [hours, minutes] = timeInput.value.split(':').map(Number);

            const log = logsForCurrentCourse.find(l => l.id === logId);
            if (log) {
                const newTimestampObj = new Date(year, month - 1, day, hours, minutes, 0);
                log.timestamp = newTimestampObj.getTime();
                log.manual = timeInput.classList.contains('manual-timestamp-input');
                log.session = sessionInput.value;
                touchLogForEdit(log, currentUser?.email);
            }
        });

        if (logsToDelete.size > 0) {
            courseData[currentCourse].logs = logsForCurrentCourse.filter(log => !logsToDelete.has(log.id));
            logsToDelete.forEach(id => addToTombstones(id));
        }

        const newTimestampGroups = dialog.querySelectorAll('.timestamp-edit-group[data-is-new="true"]');
        newTimestampGroups.forEach(newGroup => {
            const timeValue = newGroup.querySelector('.timestamp-time').value;
            const sessionValue = newGroup.querySelector('.timestamp-session').value;
            const [hours, minutes] = timeValue.split(':').map(Number);
            const newTimestampObj = new Date(year, month - 1, day, hours, minutes, 0);

            let newLog = {
                uid: group.originalLogs[0]?.uid,
                timestamp: newTimestampObj.getTime(),
                id: Date.now() + Math.random().toString(36).substring(2, 11),
                manual: true,
                session: sessionValue
            };
            newLog = touchLogForEdit(newLog, currentUser?.email);
            courseData[currentCourse].logs.unshift(newLog);
        });

        saveAndMarkChanges(currentCourse);
        if (isOnline && isSignedIn) {
            syncLogsWithSheet();
        }
        updateUI();
        closeDialog();
    });

    document.getElementById('cancel-edit-log-btn').addEventListener('click', closeDialog);
}

/**
 * Confirms deletion of the latest log or the entire group.
 */
function confirmDeleteLog(group) {
    if (!isAdmin) return;

    const logsForCurrentCourse = courseData[currentCourse]?.logs || [];

    if (group.originalLogs.length > 1) {
        // Case 1: Deleting just the latest timestamp
        const latestLog = group.originalLogs.reduce((latest, log) => log.timestamp > latest.timestamp ? log : latest);

        // 1. Optimistic UI Update: Remove the log locally first.
        courseData[currentCourse].logs = logsForCurrentCourse.filter(log => log.id !== latestLog.id);
        updateUI(); // Update UI immediately (FAST!)

        // 2. Call backend in the background.
        deleteLogViaBackend(latestLog.id)
            .then(() => {
                // Success! Show notification.
                showNotification('delete', 'Timestamp Deleted', 'Log removed.');
            })
            .catch(err => {
                // 3. Handle Failure: Revert the change.
                console.error('Delete failed, reverting UI:', err);
                showNotification('error', 'Delete Failed', 'Could not delete log, restoring.');
                // Add the log back and refresh
                courseData[currentCourse].logs.unshift(latestLog);
                updateUI(); // Refresh UI again to show the restored log
            });

    } else if (group.originalLogs.length === 1) {
        // Case 2: Deleting the last timestamp (show confirmation)
        showConfirmationDialog({
            title: 'Delete all logs for this date?',
            message: `This will remove all logs for ${escapeHtml(group.name)} on this date. This is the last timestamp.`,
            confirmText: 'Delete',
            isDestructive: true,
            onConfirm: () => {
                const idsToRemove = group.originalLogs.map(log => log.id);
                const removedLogs = logsForCurrentCourse.filter(log => idsToRemove.includes(log.id)); // Store what we're removing

                // 1. Optimistic UI Update
                courseData[currentCourse].logs = logsForCurrentCourse.filter(log => !idsToRemove.includes(log.id));
                updateUI();
                showNotification('delete', 'Entry Deleted', `All timestamps for ${group.name} were deleted.`);

                // 2. Call backend in the background
                Promise.all(idsToRemove.map(id => deleteLogViaBackend(id)))
                    .then(() => {
                        // Success!
                    })
                    .catch(err => {
                        // 3. Handle Failure: Revert
                        console.error('Bulk delete failed, reverting UI:', err);
                        showNotification('error', 'Delete Failed', 'Could not delete entry, restoring.');
                        courseData[currentCourse].logs.unshift(...removedLogs); // Add them back
                        updateUI();
                    });
            }
        });
    }
}

// --- Advanced Selection Logic ---

function handleLogCheckbox(e, logId) {
    e.stopPropagation();

    // Handle Shift+Click Range Selection
    if (e.shiftKey && lastCheckedLogId) {
        const checkboxes = Array.from(document.querySelectorAll('.bulk-checkbox'));
        const startIdx = checkboxes.findIndex(cb => cb.value === lastCheckedLogId);
        const endIdx = checkboxes.findIndex(cb => cb.value === logId);

        if (startIdx !== -1 && endIdx !== -1) {
            const low = Math.min(startIdx, endIdx);
            const high = Math.max(startIdx, endIdx);

            // Check everything in range
            for (let i = low; i <= high; i++) {
                checkboxes[i].checked = e.target.checked;
                // Extract ID from value (which might be comma separated if group)
                const ids = checkboxes[i].value.split(',');
                ids.forEach(id => {
                    if (e.target.checked) selectedLogIds.add(id);
                    else selectedLogIds.delete(id);
                });
            }
        }
    } else {
        // Normal Click
        const ids = e.target.value.split(',');
        ids.forEach(id => {
            if (e.target.checked) selectedLogIds.add(id);
            else selectedLogIds.delete(id);
        });
    }

    lastCheckedLogId = logId;
    updateBulkUI();
}

function toggleDateGroup(dateStr, isChecked) {
    // Find only rows that belong to this specific date
    // (We added data-date to the rows in the previous step)
    const rows = document.querySelectorAll(`tr[data-date="${dateStr}"]`);

    rows.forEach(row => {
        const cb = row.querySelector('.bulk-checkbox');
        if (cb) {
            cb.checked = isChecked;
            const ids = cb.value.split(',');
            ids.forEach(id => {
                if (isChecked) selectedLogIds.add(id);
                else selectedLogIds.delete(id);
            });
        }
    });
    updateBulkUI();
}

function toggleSelectAll(isChecked) {
    // Only select checkboxes inside the table BODY (ignoring the header one itself)
    const rowCheckboxes = document.querySelectorAll('#logs-tbody .bulk-checkbox');

    rowCheckboxes.forEach(cb => {
        cb.checked = isChecked;

        // The value contains the Log ID(s) for that row
        const ids = cb.value.split(',');

        ids.forEach(id => {
            if (isChecked) selectedLogIds.add(id);
            else selectedLogIds.delete(id);
        });
    });

    // Also visually toggle all Date Group checkboxes to match
    document.querySelectorAll('.day-separator-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });

    updateBulkUI();
}

function updateBulkUI() {
    const countBadge = document.getElementById('bulk-count');
    if (countBadge) countBadge.textContent = selectedLogIds.size;
}

// --- Bulk Operations ---

async function performBulkAction(action) {
    if (selectedLogIds.size === 0) return;

    let confirmMsg = "", confirmTitle = "";
    let extraHtml = "";

    // Enable inherit option for BOTH add1h AND sub1h
    const includeInherit = (action === 'add1h' || action === 'sub1h');
    const sessionHtml = renderSessionSelectorHTML('bulk', includeInherit);

    if (action === 'delete') {
        confirmTitle = `Delete ${selectedLogIds.size} Entries?`;
        confirmMsg = "Delete all logs for the selected rows? This cannot be undone.";
    } else if (action === 'add1h') {
        confirmTitle = `Add +1 Hour?`;
        confirmMsg = `Create a new log 1 hour later for every selected student.`;
        if (sessionHtml) extraHtml = `<div style="margin-top:15px; text-align:left;"><label class="inline-field-label">Target Session</label>${sessionHtml}</div>`;
    } else if (action === 'sub1h') {
        confirmTitle = `Delete Latest Hour?`;
        // Shorter message as requested
        confirmMsg = `Remove the latest log entry for the selected rows?`;
        if (sessionHtml) {
            extraHtml = `
            <div style="margin-top:15px; text-align:left;">
                <label class="inline-field-label">Target</label>
                ${sessionHtml}
                <div style="font-size:0.8em; color:#666; margin-top:5px; font-style:italic;">
                    "Latest" deletes the most recent log regardless of group.
                </div>
            </div>`;
        }
    }

    showConfirmationDialog({
        title: confirmTitle,
        message: confirmMsg + extraHtml,
        confirmText: "Confirm",
        isDestructive: action === 'delete' || action === 'sub1h',
        onConfirm: async () => {
            let targetSession = 'INHERIT';
            const sessionInput = document.getElementById('bulk-selected-session');
            if (sessionInput) targetSession = sessionInput.value;

            const allLogs = courseData[currentCourse].logs;
            const allSelectedIds = Array.from(selectedLogIds);
            let logsModified = false;

            // --- DELETE ALL ---
            if (action === 'delete') {
                allSelectedIds.forEach(id => addToTombstones(id));
                courseData[currentCourse].logs = allLogs.filter(l => !selectedLogIds.has(l.id));
                logsModified = true;
                showNotification('delete', 'Deleted', `Deleted selected logs.`);
            }

            // --- ADD +1 HOUR ---
            else if (action === 'add1h') {
                const newLogs = [];
                const groupsProcessed = new Set();
                allSelectedIds.forEach(id => {
                    const originalLog = allLogs.find(l => l.id === id);
                    if (!originalLog) return;
                    const d = new Date(originalLog.timestamp);
                    const key = `${originalLog.uid}_${d.getFullYear()}_${d.getMonth()}_${d.getDate()}`;

                    if (!groupsProcessed.has(key)) {
                        const siblings = allLogs.filter(l => l.uid === originalLog.uid && new Date(l.timestamp).toDateString() === d.toDateString());
                        if (siblings.length > 0) {
                            const latestSibling = siblings.reduce((prev, curr) => prev.timestamp > curr.timestamp ? prev : curr);
                            const newTime = new Date(latestSibling.timestamp);
                            newTime.setHours(newTime.getHours() + 1);

                            let finalSession = latestSibling.session;
                            if (targetSession !== 'INHERIT') finalSession = targetSession;

                            let newLog = { uid: latestSibling.uid, timestamp: newTime.getTime(), id: Date.now() + Math.random().toString(36).substring(2, 11), manual: true, session: finalSession };
                            newLogs.push(touchLogForEdit(newLog, currentUser?.email));
                            groupsProcessed.add(key);
                        }
                    }
                });
                courseData[currentCourse].logs.unshift(...newLogs);
                logsModified = true;
                showNotification('success', 'Added', `${newLogs.length} new logs.`);
            }

            // --- REMOVE -1 HOUR (Updated Logic) ---
            else if (action === 'sub1h') {
                const groupsProcessed = new Set();
                const idsToDelete = [];
                let ignoredCount = 0;

                allSelectedIds.forEach(id => {
                    const originalLog = allLogs.find(l => l.id === id);
                    if (!originalLog) return;
                    const d = new Date(originalLog.timestamp);
                    const key = `${originalLog.uid}_${d.getFullYear()}_${d.getMonth()}_${d.getDate()}`;

                    if (!groupsProcessed.has(key)) {
                        const siblings = allLogs.filter(l => l.uid === originalLog.uid && new Date(l.timestamp).toDateString() === d.toDateString());
                        let logToDelete = null;

                        // Logic to handle INHERIT vs Specific Session
                        if (targetSession === 'INHERIT') {
                            // Just find the absolute latest log, regardless of session
                            if (siblings.length > 0) {
                                logToDelete = siblings.reduce((prev, curr) => prev.timestamp > curr.timestamp ? prev : curr);
                            }
                        } else {
                            // Find latest log that MATCHES the target session
                            const matchingLogs = siblings.filter(l => (l.session || 'Default') === targetSession);
                            if (matchingLogs.length > 0) {
                                logToDelete = matchingLogs.reduce((prev, curr) => prev.timestamp > curr.timestamp ? prev : curr);
                            } else {
                                ignoredCount++; // Found student, but no log in that specific session
                            }
                        }

                        if (logToDelete) idsToDelete.push(logToDelete.id);
                        groupsProcessed.add(key);
                    }
                });

                if (idsToDelete.length > 0) {
                    idsToDelete.forEach(id => addToTombstones(id));
                    courseData[currentCourse].logs = allLogs.filter(l => !idsToDelete.includes(l.id));
                    logsModified = true;
                    showNotification('success', 'Updated', `Removed ${idsToDelete.length} logs.${ignoredCount > 0 ? ` (Ignored ${ignoredCount})` : ''}`);
                } else if (ignoredCount > 0) {
                    showNotification('info', 'No Action', `No logs found matching "${targetSession}".`);
                }
            }

            if (logsModified) {
                saveAndMarkChanges(currentCourse);
                toggleBulkMode();
                updateUI();
                if (isOnline && isSignedIn) syncLogsWithSheet();
            }
        }
    });

    // Activate toggles in dialog (Standard)
    if (extraHtml) {
        setTimeout(() => {
            const rawSections = courseInfoMap[currentCourse].availableSections || '';
            setupSessionToggleListeners('bulk', parseAvailableSections(rawSections));
        }, 0);
    }
}

function toggleBulkMode() {
    isBulkMode = !isBulkMode;
    selectedLogIds.clear(); // Clear selections on toggle

    const table = document.querySelector('.logs-table');
    const bulkBar = document.getElementById('bulk-actions-bar');

    // Toggle classes
    if (isBulkMode) {
        table.classList.add('bulk-mode');
        bulkBar.classList.add('visible');

        // Add Master Checkbox to Header if missing
        const theadRow = table.querySelector('thead tr');
        if (!theadRow.querySelector('.select-column-header')) {
            const th = document.createElement('th');
            th.setAttribute('class', 'select-column select-column-header');
            // Note: We do NOT use 'bulk-checkbox' class here to avoid selecting it in loops
            th.innerHTML = `<input type="checkbox" onclick="toggleSelectAll(this.checked)" style="cursor:pointer; width:18px; height:18px;">`;
            theadRow.insertBefore(th, theadRow.firstChild);
        }
    } else {
        table.classList.remove('bulk-mode');
        bulkBar.classList.remove('visible');

        // Remove Master Checkbox
        const th = table.querySelector('.select-column-header');
        if (th) th.remove();

        // Uncheck everything visually
        document.querySelectorAll('.bulk-checkbox').forEach(cb => cb.checked = false);
        document.querySelectorAll('.day-separator-checkbox').forEach(cb => cb.checked = false);
    }
    updateLogsList(); // Re-render rows to show/hide columns
    updateBulkUI();
}


/**
 * Delete a log via backend API (for non-global admins)
 * This ensures tombstones are written to DELETED_LOG_IDS sheet
 */
async function deleteLogViaBackend(logId) {
    try {
        const result = await callWebApp('deleteLog_Admin', {
            courseName: currentCourse,
            logId: logId
        }, 'POST');

        if (result && result.result === 'success') {
            return true;
        } else {
            throw new Error(result?.message || 'Delete failed');
        }
    } catch (error) {
        console.error('Backend delete error:', error);
        showNotification('error', 'Delete Failed', error.message);
        throw error;
    }
}

/**
 * Clear logs for the currently selected course.
 */
function clearLogs() {
    if (!isAdmin || !currentCourse || !courseData[currentCourse]) return;

    const onConfirmAction = () => {
        const currentLogs = courseData[currentCourse].logs;
        const currentTombstones = courseData[currentCourse].tombstones;

        // Add all existing log IDs to the tombstones for syncing the deletion.
        currentLogs.forEach(log => currentTombstones.add(log.id));

        // Clear the logs array.
        courseData[currentCourse].logs = [];

        saveAndMarkChanges(currentCourse);
        updateUI();

        if (isOnline && isSignedIn) {
            syncLogsWithSheet()
                .then(() => showNotification('delete', 'Logs Cleared', `All logs for ${currentCourse} have been removed.`))
                .catch(err => console.error('Error clearing logs:', err));
        }
    };

    showConfirmationDialog({
        title: `Delete logs for ${escapeHtml(currentCourse.replace(/_/g, ' '))}?`,
        message: 'This will remove all logs for the current course. This action cannot be undone.',
        confirmText: 'Delete',
        isDestructive: true,
        onConfirm: onConfirmAction
    });
}


/**
 * Handle file selection for Excel import.
 * @param {Event} event - The change event from the file input.
 */
function handleExcelFile(event) {
    if (!isAdmin) return;
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', raw: true });
            showStudentColumnMappingDialog(workbook, file.name);
        } catch (error) {
            console.error('Excel import error:', error);
            showNotification('error', 'Import Failed', error.message || 'Could not process the student file.');
        }
    };
    reader.onerror = () => showNotification('error', 'Import Failed', 'Failed to read the student file.');
    reader.readAsArrayBuffer(file);
    event.target.value = '';
}

function getStudentWorksheetRows(workbook, sheetName) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet?.['!ref']) return [];
    // Start at A1 so column letters and error row numbers match the original file.
    const range = { s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(worksheet['!ref']).e };
    return XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '', blankrows: true, range });
}

function showStudentColumnMappingDialog(workbook, fileName = '') {
    if (!isAdmin) return;
    if (!workbook.SheetNames.length) throw new Error('No worksheets were found in this file.');
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="import-mapping-title">
        <h3 class="dialog-title" id="import-mapping-title"><i class="fa-solid fa-file-import"></i> Import Students</h3>
        <div class="dialog-content">
            <p>${escapeHtml(fileName)}${fileName ? '<br>' : ''}Choose a sheet and match its columns.</p>
            <div class="form-group">
                <label class="dialog-label-fixed" for="import-sheet-select"><i class="fa-solid fa-table"></i> Worksheet</label>
                <select id="import-sheet-select" class="form-control">${workbook.SheetNames.map((name, index) => `<option value="${index}">${escapeHtml(name)}</option>`).join('')}</select>
            </div>
            <div class="form-group">
                <label class="dialog-label-fixed" for="import-start-row" id="import-row-label">Header Row</label>
                <input type="number" id="import-start-row" class="form-control" min="1" step="1" value="1">
            </div>
            <div class="form-group">
                <label for="import-has-headers" style="width:auto;"><input type="checkbox" id="import-has-headers" checked> This row contains column names</label>
            </div>
            <div class="form-section-title">Columns</div>
            <div class="form-group">
                <label class="dialog-label-fixed" for="import-map-name"><i class="fa-solid fa-user"></i> Name</label>
                <select id="import-map-name" class="form-control"></select>
            </div>
            <div class="form-group">
                <label class="dialog-label-fixed" for="import-map-card"><i class="fa-solid fa-id-card"></i> Card ID</label>
                <select id="import-map-card" class="form-control"></select>
            </div>
            <div class="form-group">
                <label class="dialog-label-fixed" for="import-map-email"><i class="fa-solid fa-at"></i> Email</label>
                <select id="import-map-email" class="form-control"></select>
            </div>
            <div class="form-section-title">Import Preview</div>
            <p id="import-preview-count" role="status"></p>
            <div class="table-container"><table class="database-table">
                <thead><tr><th>Row</th><th>Name</th><th>Card ID</th><th>Email</th></tr></thead>
                <tbody id="import-mapping-preview"></tbody>
            </table></div>
            <p id="import-mapping-error" class="error-message" role="alert" hidden></p>
        </div>
        <div class="dialog-actions">
            <button type="button" id="cancel-import-mapping" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button type="button" id="continue-import-mapping" class="btn-green"><i class="fa-solid fa-arrow-right"></i> Continue</button>
        </div></div>`;
    document.body.appendChild(backdrop);
    const sheetSelect = backdrop.querySelector('#import-sheet-select');
    const rowInput = backdrop.querySelector('#import-start-row');
    const headerCheck = backdrop.querySelector('#import-has-headers');
    const selects = { name: backdrop.querySelector('#import-map-name'), cardId: backdrop.querySelector('#import-map-card'), email: backdrop.querySelector('#import-map-email') };
    const previewBody = backdrop.querySelector('#import-mapping-preview');
    const previewCount = backdrop.querySelector('#import-preview-count');
    const errorText = backdrop.querySelector('#import-mapping-error');
    const nextButton = backdrop.querySelector('#continue-import-mapping');
    let rows = [];
    const nonempty = row => row.some(value => String(value ?? '').trim());
    const options = () => ({ startRow: Number(rowInput.value) - 1, hasHeaders: headerCheck.checked,
        mapping: Object.fromEntries(Object.entries(selects).map(([field, select]) => [field, Number(select.value)])) });
    const showError = error => { errorText.textContent = error.message; errorText.hidden = false; };

    const renderPreview = () => {
        const settings = options();
        const firstDataRow = settings.startRow + (settings.hasHeaders ? 1 : 0);
        const validRow = Number.isInteger(settings.startRow) && settings.startRow >= 0 && settings.startRow < rows.length;
        const sourceRows = validRow ? rows.map((row, index) => ({ row, index })).filter(item => item.index >= firstDataRow && nonempty(item.row)) : [];
        // Show partially mapped values too, so each selection is immediately visible.
        let preview = sourceRows.slice(0, 5).map(({ row, index }) => ({ rowNumber: index + 1,
            name: String(row[settings.mapping.name] ?? ''), uids: [String(row[settings.mapping.cardId] ?? '')],
            email: String(row[settings.mapping.email] ?? '') }));
        errorText.hidden = true;
        nextButton.disabled = false;
        try {
            preview = StandoData.previewStudentRows(rows, settings);
        } catch (error) {
            nextButton.disabled = true;
            showError(error);
        }
        previewBody.innerHTML = preview.map(student => `<tr><td>${student.rowNumber}</td><td>${escapeHtml(student.name) || '—'}</td><td>${escapeHtml(student.uids.join('; ')) || '—'}</td><td>${escapeHtml(student.email) || '—'}</td></tr>`).join('');
        previewCount.textContent = sourceRows.length ? `Showing ${preview.length} of ${sourceRows.length} rows.` : 'No data rows in this selection.';
    };

    const populateColumns = (suggest = true) => {
        const settings = options();
        const header = settings.hasHeaders ? (rows[settings.startRow] || []) : [];
        const sample = rows.slice(settings.startRow + (settings.hasHeaders ? 1 : 0)).find(nonempty) || [];
        const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
        const detected = StandoData.detectStudentColumns(header);
        const suggestions = { name: detected.name, cardId: detected.cardId >= 0 ? detected.cardId : detected.legacyUid, email: detected.email };
        const columnsHtml = Array.from({ length: width }, (_, index) => {
            const heading = String(header[index] ?? '').trim();
            const example = String(sample[index] ?? '').trim();
            const label = `${XLSX.utils.encode_col(index)}${heading ? ' — ' + heading : ''}${example ? ' · ' + example : ''}`;
            return `<option value="${index}">${escapeHtml(label.slice(0, 120))}</option>`;
        }).join('');
        Object.entries(selects).forEach(([field, select]) => {
            const value = suggest ? suggestions[field] : Number(select.value);
            select.innerHTML = `<option value="-1">${field === 'name' ? 'Choose a column' : 'Not imported'}</option>` + columnsHtml;
            select.value = String(value >= 0 && value < width ? value : -1);
        });
        renderPreview();
    };

    const loadSheet = () => {
        try {
            rows = getStudentWorksheetRows(workbook, workbook.SheetNames[Number(sheetSelect.value)]);
            const firstNonempty = rows.findIndex(nonempty);
            // Suggest a recognizable header while allowing title rows and arbitrary headings.
            const detectedRow = rows.slice(0, 25).findIndex(row => {
                const columns = StandoData.detectStudentColumns(row);
                return columns.name >= 0 && (columns.cardId >= 0 || columns.legacyUid >= 0 || columns.email >= 0);
            });
            rowInput.max = String(Math.max(1, rows.length));
            rowInput.value = String((detectedRow >= 0 ? detectedRow : Math.max(0, firstNonempty)) + 1);
            headerCheck.checked = true;
            backdrop.querySelector('#import-row-label').textContent = 'Header Row';
            populateColumns();
        } catch (error) {
            rows = [];
            previewBody.innerHTML = '';
            previewCount.textContent = 'This sheet could not be read.';
            nextButton.disabled = true;
            showError(error);
        }
    };
    sheetSelect.onchange = loadSheet;
    rowInput.oninput = () => populateColumns(headerCheck.checked);
    headerCheck.onchange = () => {
        backdrop.querySelector('#import-row-label').textContent = headerCheck.checked ? 'Header Row' : 'First Data Row';
        populateColumns(false);
    };
    Object.values(selects).forEach(select => select.onchange = renderPreview);
    backdrop.querySelector('#cancel-import-mapping').onclick = () => backdrop.remove();
    nextButton.onclick = () => {
        try {
            const students = StandoData.parseStudentRows(rows, options());
            showDatabaseImportDialog(students, () => document.body.appendChild(backdrop));
            backdrop.remove();
        } catch (error) { showError(error); }
    };
    const firstSheet = workbook.SheetNames.findIndex(name => workbook.Sheets[name]?.['!ref']);
    sheetSelect.value = String(Math.max(0, firstSheet));
    loadSheet();
}

/**
 * Show import dialog for database Excel data.
 * @param {Array} excelList - Validated student objects, including optional hardware_uids.
 */
function showDatabaseImportDialog(excelList, onBack = null) {
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'student-import-review-title');
    dialog.innerHTML = `
        <h3 class="dialog-title" id="student-import-review-title"><i class="fa-solid fa-file-import"></i> Import Students</h3>
        <div class="dialog-content">
            <p><strong>${excelList.length} students</strong>${excelList.length > 5 ? ' · Previewing first 5' : ''}</p>
            <div class="table-container"><table class="database-table"><thead><tr><th>Name</th><th>Card ID</th><th>Email</th></tr></thead><tbody>
                ${excelList.slice(0, 5).map(student => `<tr><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.uids.join('; '))}</td><td>${escapeHtml(student.email)}</td></tr>`).join('')}
            </tbody></table></div>
            <p>Merge adds new students and updates matching IDs or emails. Replace All replaces the entire list.</p>
            <p id="student-import-status" role="status" hidden></p>
        </div>
        <div class="dialog-actions">
            ${onBack ? '<button type="button" id="back-db-import-btn" class="btn-blue"><i class="fa-solid fa-arrow-left"></i> Back</button>' : ''}
            <button type="button" id="cancel-db-import-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button type="button" id="replace-db-btn" class="btn-orange"><i class="fa-solid fa-arrows-rotate"></i> Replace All</button>
            <button type="button" id="merge-db-btn" class="btn-green"><i class="fa-solid fa-code-merge"></i> Merge</button>
        </div>
    `;
    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    let saving = false;
    let savedPlan = null;
    const apply = async replace => {
        if (saving || !isSignedIn || !isAdmin) return;
        const status = dialog.querySelector('#student-import-status');
        status.hidden = false;
        if (!isOnline) { status.textContent = 'Connect to the internet to save this student list.'; return; }
        saving = true;
        dialog.querySelectorAll('button').forEach(button => button.disabled = true);
        status.textContent = savedPlan ? 'Reloading saved students…' : 'Saving students…';
        try {
            if (!savedPlan) {
                const plan = StandoData.planStudentImport(databaseMap, excelList, replace);
                const students = Object.fromEntries(Object.entries(plan.database).filter(([, student]) => !student.isStaff));
                const result = await callWebApp('syncDatabase_Admin', { databaseData: students }, 'POST');
                if (result?.result !== 'success') throw new Error(result?.message || 'Student import failed.');
                savedPlan = plan;
                invalidateDatabaseCache();
            }
            // Reload server keys before enabling edits/deletes on newly imported students.
            const freshDatabase = await callWebApp('getDatabase');
            databaseMap = freshDatabase;
            window.buildUIDToPrimaryUidMap();
            updateUI();
            dialogBackdrop.remove();
            showNotification('success', 'Import Complete', `${savedPlan.added} students added, ${savedPlan.updated} updated.`);
        } catch (error) {
            status.textContent = savedPlan
                ? 'Students were saved, but reloading failed. Select Reload students to retry.'
                : `Import failed: ${error.message}`;
        } finally {
            saving = false;
            dialog.querySelectorAll('button').forEach(button => button.disabled = false);
            if (savedPlan) {
                dialog.querySelector('#merge-db-btn').textContent = 'Reload students';
                dialog.querySelector('#replace-db-btn').disabled = true;
                if (backButton) backButton.disabled = true;
            }
        }
    };
    dialog.querySelector('#merge-db-btn').onclick = () => apply(false);
    dialog.querySelector('#replace-db-btn').onclick = () => showConfirmationDialog({
        title: '<i class="fa-solid fa-arrows-rotate"></i> Replace Student List?',
        message: 'This file will replace the entire student list. Students missing from the file will be deleted.',
        cancelText: '<i class="fa-solid fa-xmark"></i> Cancel',
        confirmText: '<i class="fa-solid fa-arrows-rotate"></i> Replace All', isDestructive: true, onConfirm: () => apply(true)
    });
    dialog.querySelector('#cancel-db-import-btn').onclick = () => { if (!saving) dialogBackdrop.remove(); };
    const backButton = dialog.querySelector('#back-db-import-btn');
    if (backButton) backButton.onclick = () => { if (!saving && !savedPlan) { dialogBackdrop.remove(); onBack(); } };
}

/**
 * Handle file selection for logs JSON import.
 * @param {Event} event - The change event from the file input.
 */
function normalizeImportedLogs(value) {
    if (!Array.isArray(value)) throw new Error('Logs must be an array.');
    const ids = new Set();
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
            !['string', 'number'].includes(typeof entry.uid) || !String(entry.uid).trim()) {
            throw new Error('Entry ' + (index + 1) + ' is missing a valid card ID.');
        }
        const rawTime = entry.timestamp;
        const timestamp = typeof rawTime === 'number' ? rawTime :
            (typeof rawTime === 'string' && rawTime.trim() ? new Date(rawTime).getTime() : NaN);
        if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) {
            throw new Error('Entry ' + (index + 1) + ' has an invalid timestamp.');
        }
        if (entry.id != null && !['string', 'number'].includes(typeof entry.id)) throw new Error('Invalid log ID.');
        const id = String(entry.id || crypto.randomUUID());
        if (ids.has(id)) throw new Error('Duplicate log ID at entry ' + (index + 1) + '.');
        ids.add(id);
        return {
            uid: String(entry.uid).trim(), timestamp, id,
            manual: entry.manual === true,
            session: typeof entry.session === 'string' ? entry.session : '',
            version: Number.isFinite(Number(entry.version)) ? Math.max(0, Number(entry.version)) : 0,
            updatedAt: Number(entry.updatedAt) || 0,
            updatedBy: typeof entry.updatedBy === 'string' ? entry.updatedBy : ''
        };
    }).sort((a, b) => b.timestamp - a.timestamp);
}

function handleImportFile(event) {
    if (!isAdmin || !currentCourse) return;
    const courseName = currentCourse;
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            showImportDialog(normalizeImportedLogs(JSON.parse(e.target.result)), courseName);
        } catch (error) {
            showNotification('error', 'Import Failed', error.message);
        }
    };
    reader.onerror = () => showNotification('error', 'Import Failed', 'Failed to read the file.');
    reader.readAsText(file);
}

/**
 * Show import dialog for logs.
 * @param {Array} importedLogs - The logs to import.
 */
function showImportDialog(importedLogs, courseName = currentCourse) {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.innerHTML = '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="logs-import-title">' +
        '<h3 class="dialog-title" id="logs-import-title"><i class="fa-solid fa-file-import"></i> Import Logs</h3><div class="dialog-content">' +
        '<p><strong>' + importedLogs.length + ' logs</strong> · ' + escapeHtml(getCleanCourseCode(courseName)) + '</p>' +
        '<p>Merge adds new logs and keeps existing entries. Replace All replaces this course\'s logs.</p></div>' +
        '<div class="dialog-actions"><button type="button" id="cancel-import-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>' +
        '<button type="button" id="replace-logs-btn" class="btn-orange"><i class="fa-solid fa-arrows-rotate"></i> Replace All</button>' +
        '<button type="button" id="merge-logs-btn" class="btn-green"><i class="fa-solid fa-code-merge"></i> Merge</button></div></div>';
    document.body.appendChild(backdrop);
    const apply = replace => {
        if (!isSignedIn || !isAdmin || !isAdminForCourse(courseName)) return;
        const data = courseData[courseName] ||= { logs: [], tombstones: new Set() };
        const incomingIds = new Set(importedLogs.map(log => log.id));
        const existingIds = new Set(data.logs.map(log => log.id));
        if (replace) data.logs.forEach(log => { if (!incomingIds.has(log.id)) data.tombstones.add(log.id); });
        const additions = importedLogs.filter(log => replace || (!existingIds.has(log.id) && !data.tombstones.has(log.id)))
            .map(log => touchLogForEdit({ ...log }, currentUser?.email));
        if (replace) incomingIds.forEach(id => data.tombstones.delete(id));
        data.logs = (replace ? additions : [...data.logs, ...additions]).sort((a, b) => b.timestamp - a.timestamp);
        saveAndMarkChanges(courseName);
        updateUI();
        backdrop.remove();
        showNotification('success', 'Import Complete', additions.length + ' entries imported.');
        if (isOnline) syncLogsWithSheet().catch(() => showNotification('warning', 'Upload Pending', 'Imported logs are saved on this device. Retry sync when connected.'));
    };
    backdrop.querySelector('#merge-logs-btn').onclick = () => apply(false);
    backdrop.querySelector('#replace-logs-btn').onclick = () => showConfirmationDialog({
        title: '<i class="fa-solid fa-arrows-rotate"></i> Replace Attendance Logs?', message: 'Existing entries not in this file will be deleted from this course.',
        cancelText: '<i class="fa-solid fa-xmark"></i> Cancel',
        confirmText: '<i class="fa-solid fa-arrows-rotate"></i> Replace All', isDestructive: true, onConfirm: () => apply(true)
    });
    backdrop.querySelector('#cancel-import-btn').onclick = () => backdrop.remove();
}


/**
* Creates a debounced function that delays invoking func until after wait milliseconds have elapsed
* since the last time the debounced function was invoked.
* @param {Function} func The function to debounce.
* @param {number} wait The number of milliseconds to delay.
* @returns {Function} Returns the new debounced function.
*/
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
* This version uses data-attributes for event delegation and no longer creates listeners in a loop.
*/
function updateLogsList() {
    const tableContainer = document.querySelector('#scanner-tab .table-container');
    if (isChangingCourses) {
        tableContainer.classList.add('reloading');
    }
    closeRowMenus();

    if (!currentCourse) {
        endLogsSwap();
        logsTbody.innerHTML = '';
        filteredCount.textContent = '0';
        emptyLogs.innerHTML = `<i class="fa-solid fa-hand-pointer" style="font-size: 3em; color: #ccc; margin-bottom: 10px;"></i>
                       <p style="font-size: 1.1em; margin-bottom: 5px;">Please select a course.</p>
                       <p style="font-size: 0.9em; color: #999;">Choose a course above to view its attendance history.</p>`;
        emptyLogs.style.display = 'block';
        tableContainer.classList.remove('reloading');
        const _fsb = document.getElementById('floating-sticky-bar'); if (_fsb) _fsb.style.display = 'none';
        return;
    }

    // If the data object for the current course hasn't been created yet,
    // it means Phase 3 is still running. Show a spinner.
    if (!courseData[currentCourse]) {
        // During a course switch the previous table stays, dimmed, until the
        // skeleton timer or the new data takes over.
        if (logsSwap) return;
        logsTbody.innerHTML = '';
        filteredCount.textContent = '0';
        emptyLogs.innerHTML = `<div class="loading-spinner" style="margin: 20px auto;"></div><p style="text-align: center;">Loading logs...</p>`;
        emptyLogs.style.display = 'block';
        tableContainer.classList.remove('reloading');
        const _fsb = document.getElementById('floating-sticky-bar'); if (_fsb) _fsb.style.display = 'none';
        return; // Stop here and wait for the next updateUI() call
    }

    const currentCourseLogs = getLogsForCurrentUser();

    // For students, the logs are already filtered by the backend
    // No need to filter again - this was causing empty tables!
    let logsToDisplay = currentCourseLogs;

    // --- DETECT LECTURER MODE ---
    const isLecturerMode = !isSignedIn && currentCourse && courseData[currentCourse];
    const showAdminFeatures = isAdmin || isLecturerMode; // Combine for Logic

    // Only apply additional filtering for admins
    // Students' logs are already filtered on the server by getStudentLogs
    // (The backend matches logs by the student's UIDs from the database)

    const grouped = {};
    logsToDisplay.forEach(log => {
        const dateObj = new Date(log.timestamp);
        if (isNaN(dateObj.getTime())) return;

        const scannedUid = log.uid; // The actual UID from the card
        const dbKey = lookupPrimaryUid(scannedUid);

        const studentData = dbKey ? databaseMap[dbKey] : null;
        const name = studentData ? studentData.name : 'Unknown';
        const uidsForDisplay = studentData ? (studentData.hardware_uids || studentData.uids || [scannedUid]) : [scannedUid];

        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        const date = `${day}-${month}-${year}`;

        // The key uses the specific card's UID (`scannedUid`), ensuring a separate row for each card.
        const key = `${date}_${scannedUid}`;

        if (!grouped[key]) {
            grouped[key] = {
                key: key,
                date,
                dateObj: new Date(year, month - 1, day),
                uid: scannedUid,
                dbKey: dbKey,
                name: name,
                studentData: studentData,
                uidsForDisplay: uidsForDisplay,
                originalLogs: []
            };
        }
        grouped[key].originalLogs.push(log);
    });

    let result = Object.values(grouped);

    if (filter) {
        result = result.filter(group => {
            const name = group.name || '';
            // The main UID for the group is now the specific one that was scanned
            const uidMatch = String(group.uid || '').toLowerCase().includes(filter);
            const date = group.date || '';
            const hasMatchingTime = group.originalLogs.some(log => {
                const timeObj = new Date(log.timestamp);
                const timeStr = `${String(timeObj.getHours()).padStart(2, '0')}:${String(timeObj.getMinutes()).padStart(2, '0')}`;
                return timeStr.includes(filter);
            });
            const sessionMatch = group.originalLogs.some(log =>
                (log.session || '').toLowerCase().includes(filter)
            );

            return normalizeName(name).includes(normalizeName(filter)) ||
                uidMatch ||
                date.includes(filter) ||
                hasMatchingTime ||
                sessionMatch;
        });
    }

    const finalLogCount = result.reduce((acc, group) => acc + group.originalLogs.length, 0);
    filteredCount.textContent = finalLogCount;

    const [field, direction] = currentSort.split('-');
    const sortMultiplier = direction === 'asc' ? 1 : -1;
    result.sort((a, b) => {
        if (field === 'date') {
            const dateCompare = sortMultiplier * (a.dateObj - b.dateObj);
            return dateCompare !== 0 ? dateCompare : a.name.localeCompare(b.name);
        }
        if (field === 'name') return sortMultiplier * a.name.localeCompare(b.name);
        if (field === 'uid') return sortMultiplier * (a.uid || '').localeCompare(b.uid || '');
        return 0;
    });

    // --- PAGINATION LOGIC ---
    const totalPages = Math.ceil(result.length / ITEMS_PER_PAGE);
    if (logsCurrentPage > totalPages) logsCurrentPage = Math.max(1, totalPages);

    const startIndex = (logsCurrentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedResult = result.slice(startIndex, endIndex);

    // Update count display to show pagination info
    if (result.length > ITEMS_PER_PAGE) {
        filteredCount.textContent = `${startIndex + 1}-${Math.min(endIndex, result.length)} of ${result.length}`;
    }

    // Render pagination controls
    renderLogsPagination(logsCurrentPage, totalPages);

    logsTbody.innerHTML = '';

    if (result.length === 0) {
        let emptyMessageHTML = `<i class="fa-solid fa-ghost" style="font-size: 3em; color: #ccc; margin-bottom: 10px;"></i>
                               <p style="font-size: 1.1em; margin-bottom: 5px;">No attendance records found.</p>`;
        if (isAdminForCourse(currentCourse)) {
            emptyMessageHTML += `<p style="font-size: 0.9em; color: #999;">Start scanning or try changing the filter.</p>`;
        } else {
            emptyMessageHTML += `<p style="font-size: 0.9em; color: #999;">There are no attendance records for you in this course.</p>`;
        }
        emptyLogs.innerHTML = emptyMessageHTML;
        emptyLogs.style.display = 'block';
    } else {
        emptyLogs.style.display = 'none';
    }

    // Use paginated result for rendering
    const resultToRender = paginatedResult;

    let currentDay = null;

    resultToRender.forEach((group) => {
        if (showAdminFeatures && currentSort.startsWith('date')) {
            const thisDay = group.date;
            if (thisDay !== currentDay) {
                currentDay = thisDay;
                const separatorRow = document.createElement('tr');
                separatorRow.setAttribute('class', 'day-separator');
                separatorRow.dataset.date = thisDay;
                const separatorCell = document.createElement('td');
                separatorCell.colSpan = 100; // Span across all columns (100 is effectively "all")


                const flexWrapper = document.createElement('div');
                flexWrapper.setAttribute('class', 'day-separator-content');

                // --- 1. DATE GROUP CHECKBOX ---
                if (isBulkMode) {
                    const dateCheckbox = document.createElement('input');
                    dateCheckbox.type = 'checkbox';
                    dateCheckbox.setAttribute('class', 'day-separator-checkbox'); // Different class than row checkboxes
                    dateCheckbox.title = `Select all logs for ${thisDay}`;
                    // Pass the specific date string to the toggle function
                    dateCheckbox.onclick = (e) => toggleDateGroup(thisDay, e.target.checked);
                    flexWrapper.appendChild(dateCheckbox);
                }

                const dateText = document.createElement('span');
                dateText.setAttribute('class', 'day-separator-date');
                dateText.innerHTML = `<i class="fa-solid fa-calendar-day"></i> ${escapeHtml(group.date)}`;
                flexWrapper.appendChild(dateText);
                const buttonContainer = document.createElement('div');
                buttonContainer.setAttribute('class', 'day-separator-actions');
                const dateForButton = thisDay;
                const eisBtn = document.createElement('button');
                eisBtn.setAttribute('class', 'btn-sm eis-day-btn');
                eisBtn.innerHTML = '<i class="fa-solid fa-list-check"></i> Add to EIS';
                eisBtn.title = 'Add to EIS for this day';
                eisBtn.setAttribute('aria-label', `Add attendance for ${group.date} to EIS`);
                eisBtn.onclick = (e) => { e.stopPropagation(); showDirectEisExportDialog(dateForButton); };
                buttonContainer.appendChild(eisBtn);
                flexWrapper.appendChild(buttonContainer);
                separatorCell.appendChild(flexWrapper);
                separatorRow.appendChild(separatorCell);
                logsTbody.appendChild(separatorRow);
            }
        }

        const row = document.createElement('tr');
        row.dataset.key = group.key;
        row.dataset.date = group.date; // --- Add date attribute for group selection ---
        if (group.name === 'Unknown') row.classList.add('unknown-row');

        // --- Bulk Checkbox Cell ---
        if (isBulkMode) {
            const selectCell = document.createElement('td');
            selectCell.setAttribute('class', 'select-column');
            const logIdsInGroup = group.originalLogs.map(l => l.id).join(','); // Join IDs

            // We use the first ID as the primary key for logic
            const primaryId = group.originalLogs[0].id;

            selectCell.innerHTML = `<input type="checkbox" class="bulk-checkbox" value="${logIdsInGroup}">`;
            const checkbox = selectCell.querySelector('input');

            if (selectedLogIds.has(primaryId)) checkbox.checked = true;

            // Use the new handler
            checkbox.addEventListener('click', (e) => handleLogCheckbox(e, logIdsInGroup));
            row.appendChild(selectCell);
        }

        const nameCell = document.createElement('td');
        nameCell.setAttribute('class', 'name-cell name-column');
        if (group.name === 'Unknown') {
            nameCell.innerHTML = `<span class="unknown-name-badge" title="Unknown card UID"><i class="fa-solid fa-id-card"></i> ${escapeHtml(group.uid || 'Unknown')}</span>`;
        } else {
            nameCell.textContent = group.name;
        }
        row.appendChild(nameCell);

        const dateCell = document.createElement('td');
        dateCell.setAttribute('class', 'date-cell date-column');
        dateCell.textContent = group.date;
        row.appendChild(dateCell);

        const timesCell = document.createElement('td');
        timesCell.setAttribute('class', 'times-cell times-cell-stacked');

        // 1. Group logs by CATEGORY ONLY (Theory, Lab, Practice)
        const categoryGroups = {};

        group.originalLogs.sort((a, b) => a.timestamp - b.timestamp).forEach(log => {
            const rawSession = log.session || 'Default';

            // Split "Theory A" -> ["Theory", "A"] -> "Theory"
            // Split "Default" -> "Default"
            const category = rawSession.split(' ')[0];

            if (!categoryGroups[category]) categoryGroups[category] = [];
            categoryGroups[category].push(log);
        });

        // 2. Render rows
        Object.entries(categoryGroups).forEach(([categoryName, logs]) => {
            const rowDiv = document.createElement('div');
            rowDiv.setAttribute('class', 'time-row');

            if (categoryName && categoryName !== 'Default') {
                const label = document.createElement('span');
                label.setAttribute('class', 'cat-label');
                label.textContent = categoryName;
                rowDiv.appendChild(label);
            }

            const pillContainer = document.createElement('div');
            pillContainer.setAttribute('class', 'pills-wrapper');

            logs.forEach(log => {
                const timeTag = document.createElement('span');
                timeTag.setAttribute('class', 'time-tag');
                if (log.manual === true || log.manual === 'true') {
                    timeTag.classList.add('manual', 'excused');

                    // Add click listener with 'warning' style and specific name
                    timeTag.addEventListener('click', (e) => {
                        e.stopPropagation(); // Stop the row from opening edit mode
                        showNotification(
                            'warning',
                            'Justified Absence',
                            `${group.name} was justified for this absence.`
                        );
                    });
                }

                const timeObj = new Date(log.timestamp);
                // Format time 00:00
                timeTag.textContent = `${String(timeObj.getHours()).padStart(2, '0')}:${String(timeObj.getMinutes()).padStart(2, '0')}`;
                pillContainer.appendChild(timeTag);
            });

            rowDiv.appendChild(pillContainer);
            timesCell.appendChild(rowDiv);
        });

        row.appendChild(timesCell);

        if (isAdminForCourse(currentCourse)) {
            const actionsCell = document.createElement('td');
            actionsCell.setAttribute('class', 'actions-cell admin-only');
            const actionsWrapper = document.createElement('div');
            actionsWrapper.setAttribute('class', 'actions-cell-content card-actions');

            // Edit stays visible; everything else is in the ⋯ menu, with the
            // destructive action last. Classes keep the tbody's click handler working.
            const menuItems = [];
            if (group.name === 'Unknown') {
                menuItems.push({ label: 'Register student', icon: 'fa-solid fa-user-plus', className: 'add-user-btn register-unknown-btn' });
            }
            menuItems.push(
                { label: 'Add 1 hour', icon: 'fa-solid fa-plus', className: 'add-time-btn' },
                { label: 'Delete latest time', icon: 'fa-solid fa-minus', className: 'delete-log-btn', danger: true }
            );
            actionsWrapper.innerHTML = rowEditButtonHtml(`Edit entry for ${group.name}`, 'edit-log-btn') +
                rowMenuHtml(menuItems, `More actions for ${group.name}`);

            if (group.name === 'Unknown') {
                // Open registration dialog instead of direct database add
                actionsWrapper.querySelector('.register-unknown-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    showRegisterUIDDialogWithPrefill(group.uid);
                });
            }

            actionsCell.appendChild(actionsWrapper);
            row.appendChild(actionsCell);
        }
        logsTbody.appendChild(row);
    });

    tableContainer.classList.remove('reloading');
    if (isChangingCourses) {
        isChangingCourses = false;
    }
    endLogsSwap();

    setupStickyDateBar();
}

// --- Course switches: keep the frame, swap only the content ---
// The previous table stays on screen, dimmed and inert, until the new one
// renders. A skeleton replaces it only if loading takes longer than 400ms.
let logsSwap = null;

function logsSwapParts() {
    return ['#scanner-tab .table-container', '#empty-logs', '#logs-pagination']
        .map(selector => document.querySelector(selector)).filter(Boolean);
}

function beginLogsSwap() {
    const content = document.querySelector('#scanner-tab .module-content');
    if (logsSwap) clearTimeout(logsSwap.timer);
    else if (content) {
        // Hold the height so the page doesn't collapse and re-expand.
        content.style.minHeight = content.offsetHeight + 'px';
        content.classList.remove('loaded');
    }
    logsSwapParts().forEach(part => { part.inert = true; });
    logsSwap = {
        timer: setTimeout(() => {
            if (!logsSwap) return;
            logsSwapParts().forEach(part => { part.inert = false; });
            const emptyState = document.getElementById('empty-logs');
            if (emptyState) emptyState.style.display = 'none';
            renderTableSkeletons();
        }, 400)
    };
}

function endLogsSwap() {
    if (!logsSwap) return;
    clearTimeout(logsSwap.timer);
    logsSwap = null;
    logsSwapParts().forEach(part => { part.inert = false; });
    const content = document.querySelector('#scanner-tab .module-content');
    if (!content) return;
    content.style.minHeight = '';
    void content.offsetWidth;
    content.classList.add('loaded');
}


function setupStickyDateBar() {
    let bar = document.getElementById('floating-sticky-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'floating-sticky-bar';

        const inner = document.createElement('div');
        inner.className = 'floating-bar-inner';

        const badge = document.createElement('div');
        badge.id = 'floating-date-badge';
        badge.className = 'day-separator-date';

        const eisBtn = document.createElement('button');
        eisBtn.id = 'floating-eis-btn';
        eisBtn.className = 'btn-sm eis-day-btn';
        eisBtn.innerHTML = '<i class="fa-solid fa-list-check"></i> Add to EIS';
        eisBtn.onclick = () => { if (bar._activeDate) showDirectEisExportDialog(bar._activeDate); };

        inner.appendChild(badge);
        inner.appendChild(eisBtn);
        bar.appendChild(inner);
        document.body.appendChild(bar);
    }

    const badge = bar.querySelector('#floating-date-badge');

    if (window._stickyDateScrollHandler) {
        window.removeEventListener('scroll', window._stickyDateScrollHandler, true);
    }

    let currentActiveDate = null;
    let exitTimer = null;

    function playAnim(name, duration, easing) {
        bar.style.animation = 'none';
        bar.offsetHeight;
        bar.style.animation = `${name} ${duration}ms ${easing} forwards`;
    }

    function enter(date) {
        bar._activeDate = date;
        badge.innerHTML = `<i class="fa-solid fa-calendar-day"></i> ${escapeHtml(date)}`;
        clearTimeout(exitTimer);
        bar.style.display = 'block';
        playAnim('badge-fly-in', 220, 'ease-out');
    }

    function swap(date) {
        bar._activeDate = date;
        // Fade out, swap text, fade back in
        badge.style.transition = 'opacity 80ms ease';
        badge.style.opacity = '0';
        clearTimeout(exitTimer);
        exitTimer = setTimeout(() => {
            badge.innerHTML = `<i class="fa-solid fa-calendar-day"></i> ${escapeHtml(date)}`;
            badge.style.opacity = '1';
        }, 80);
    }

    function exit() {
        bar._activeDate = null;
        bar.style.animation = 'badge-fly-out 200ms ease-in forwards';
        clearTimeout(exitTimer);
        exitTimer = setTimeout(() => { bar.style.display = 'none'; }, 200);
    }

    function onScroll() {
        // Only the scan history has day separators; other tabs never show the bar.
        const scannerActive = document.getElementById('scanner-tab')?.classList.contains('active');
        const rows = scannerActive ? document.querySelectorAll('tr.day-separator[data-date]') : [];
        let activeDate = null;
        for (const row of rows) {
            if (row.getBoundingClientRect().bottom <= 1) {
                activeDate = row.dataset.date;
            } else {
                break;
            }
        }

        if (activeDate === currentActiveDate) return;

        if (!activeDate) {
            currentActiveDate = null;
            exit();
        } else if (currentActiveDate === null) {
            currentActiveDate = activeDate;
            enter(activeDate);
        } else {
            currentActiveDate = activeDate;
            swap(activeDate);
        }
    }

    window._stickyDateScrollHandler = onScroll;
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    onScroll();
}

/**
* Calculate the course week for a specific date.
* @param {Object} metadata - Course metadata.
* @param {Date} forDate - The specific date to calculate the week for.
* @returns {number} The calculated week number.
*/
function calculateWeekForDate(metadata, forDate) {
    if (!metadata || !metadata.startDate) return 1;

    const startDate = new Date(metadata.startDate);
    const holidayWeeks = parseInt(metadata.holidayWeeks || 0);
    const holidayStartDate = metadata.holidayStartDate ? new Date(metadata.holidayStartDate) : null;

    if (isNaN(startDate.getTime())) return 1;

    const weekNumber = Math.ceil((forDate - startDate) / (7 * 24 * 60 * 60 * 1000));
    let adjustedWeek = weekNumber;

    if (holidayWeeks > 0 && holidayStartDate && !isNaN(holidayStartDate.getTime()) && forDate >= holidayStartDate) {
        adjustedWeek = weekNumber - holidayWeeks;
    }
    return Math.max(adjustedWeek, 1);
}

/**
 * Shows a dialog to add a new database entry, pre-filled with the UID.
 * @param {string} uid - The UID of the unknown person to add.
 */
function showAddEntryFromLog(uid) {
    if (!isAdmin) return;
    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const initHw = (uid && uid.includes(':')) ? uid : convertExternalIdToUid(uid);
    const initId = (uid && !uid.includes(':')) ? uid : convertUidToExternalId(uid);

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-user-plus"></i> Add to Database</h3>
        <div class="dialog-content"><p>Enter the details for the student with this card.</p>
        <div class="form-group">
            <label class="dialog-label-fixed" for="add-log-name">Name <span class="required">*</span></label>
            <input type="text" id="add-log-name" class="form-control" placeholder="Student's Full Name">
        </div>
        <div class="form-group">
            <label class="dialog-label-fixed" for="add-log-email">Email <span class="required">*</span></label>
            <input type="email" id="add-log-email" class="form-control" placeholder="nsurname00@epoka.edu.al">
        </div>
        <div class="form-group">
            <label class="dialog-label-fixed" for="add-log-hardware-uid">UID</label>
            <input type="text" id="add-log-hardware-uid" class="form-control" placeholder="04:a2:3f:8a" value="${escapeHtml(initHw)}">
        </div>
        <div class="form-group">
            <label class="dialog-label-fixed" for="add-log-student-id">Card ID</label>
            <input type="text" id="add-log-student-id" class="form-control" placeholder="Auto-calculated from UID" value="${escapeHtml(initId)}" disabled style="opacity:0.75; cursor:not-allowed; background:rgba(0,0,0,0.04);">
        </div>
        </div> <div class="dialog-actions">
            <button id="cancel-add-log-btn" class="btn-red"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="confirm-add-log-btn" class="btn-green"><i class="fa-solid fa-check"></i> Add Student</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const nameInput = dialog.querySelector('#add-log-name');
    const emailInput = dialog.querySelector('#add-log-email');
    const hwInput = dialog.querySelector('#add-log-hardware-uid');
    const idInput = dialog.querySelector('#add-log-student-id');

    // Real-time calculation from UID to ID
    if (hwInput && idInput) {
        hwInput.addEventListener('input', () => {
            const raw = hwInput.value.trim();
            idInput.value = convertUidToExternalId(raw) || '';
        });
    }

    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };

    dialog.querySelector('#cancel-add-log-btn').addEventListener('click', closeDialog);
    dialog.querySelector('#confirm-add-log-btn').addEventListener('click', async () => {
        // --- Validation ---
        clearInputError(nameInput);
        clearInputError(emailInput);
        clearInputError(idInput);
        clearInputError(hwInput);
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();
        const rawHw = hwInput.value.trim();
        const rawId = idInput.value.trim();
        const finalUid = rawId || convertUidToExternalId(rawHw) || rawHw;
        const finalHardwareUid = rawHw || convertExternalIdToUid(rawId) || rawId;

        let isValid = true;
        if (name === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(email)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        if (!finalUid && !finalHardwareUid) { showInputError(idInput, 'UID or ID is required.'); isValid = false; }
        if (!isValid) return;

        const confirmBtn = dialog.querySelector('#confirm-add-log-btn');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';

        try {
            const submissionData = {
                name: name,
                email: email,
                uid: finalUid,
                hardwareUid: finalHardwareUid,
                sentBy: {
                    name: currentUser?.name || '',
                    email: currentUser?.email || ''
                }
            };

            if (isGlobalAdmin) {
                const match = findDuplicateInDatabase({ name, email, uid: finalUid, hardwareUid: finalHardwareUid }); // Check for duplicates

                if (match) {
                    // DUPLICATE FOUND: the warning dialog saves the choice and reloads the list.
                    const completeAction = () => {
                        window.buildUIDToPrimaryUidMap();
                        updateUI();
                    };
                    showDuplicateWarningForNewEntry(submissionData, [match.duplicate], completeAction);
                    closeDialog(); // Close the current 'Add from Log' dialog
                    return; // Stop further execution here
                } else {
                    // NO DUPLICATE: Add directly to the database via backend
                    const result = await callWebApp('addEntryToDatabase_Admin', submissionData, 'POST');
                    if (result && result.result === 'success') {
                        showNotification('success', 'Added to Database', `${name} has been added.`);
                        invalidateDatabaseCache();
                        await fetchDatabaseFromSheet();
                        window.buildUIDToPrimaryUidMap(); // Use window scope
                        updateUI();
                        closeDialog();
                    } else {
                        throw new Error(result?.message || 'Failed to add entry');
                    }
                }
            } else {
                // Non-global admins submit a registration request
                const result = await callWebApp('submitRegistration', submissionData, 'POST');
                if (result && result.result === 'success') {
                    showNotification('success', 'Request Submitted', `Registration request for ${name} has been sent.`);
                    closeDialog();
                } else {
                    throw new Error(result?.message || 'Submission failed');
                }
            }
        } catch (error) {
            showNotification('error', 'Submission Failed', error.message);
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Add Student';
        }
    });
}

/**
 * Update the database list in the UI.
 */
// Staff cards are merged into databaseMap so scans show their names, but they
// are managed in Settings → Staff and have no row in the students table.
function studentEntries() {
    return Object.entries(databaseMap).filter(([, data]) => data && !data.isStaff);
}

function updateDatabaseList() {
    const students = studentEntries();
    const entries = students.filter(([dbKey, data]) => {
        if (!dbFilter) return true;
        const searchFilter = dbFilter.toLowerCase();
        const hasIdMatch = (data.uids || []).some(id => String(id).toLowerCase().includes(searchFilter));
        const hasUidMatch = (data.hardware_uids || []).some(uid => String(uid).toLowerCase().includes(searchFilter));
        return (data.name.toLowerCase().includes(searchFilter) ||
            (data.email && data.email.toLowerCase().includes(searchFilter)) ||
            hasIdMatch ||
            hasUidMatch);
    });

    entries.sort((a, b) => {
        const [field, direction] = currentDbSort.split('-');
        const multiplier = direction === 'asc' ? 1 : -1;
        let valA, valB;

        if (field === 'name') {
            valA = a[1].name;
            valB = b[1].name;
        } else if (field === 'email') {
            valA = a[1].email || '';
            valB = b[1].email || '';
        } else if (field === 'id') {
            valA = (a[1].uids && a[1].uids[0]) || '';
            valB = (b[1].uids && b[1].uids[0]) || '';
        } else {
            valA = (a[1].hardware_uids && a[1].hardware_uids[0]) || (a[1].uids && a[1].uids[0]) || '';
            valB = (b[1].hardware_uids && b[1].hardware_uids[0]) || (b[1].uids && b[1].uids[0]) || '';
        }
        return multiplier * String(valA).localeCompare(String(valB));
    });

    // --- PAGINATION LOGIC ---
    const totalPages = Math.ceil(entries.length / ITEMS_PER_PAGE);
    if (dbCurrentPage > totalPages) dbCurrentPage = Math.max(1, totalPages);

    const startIndex = (dbCurrentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedEntries = entries.slice(startIndex, endIndex);

    // Update count display
    const totalCount = students.length;
    if (entries.length > ITEMS_PER_PAGE) {
        dbEntryCount.textContent = `${startIndex + 1}-${Math.min(endIndex, entries.length)} of ${entries.length}`;
    } else {
        dbEntryCount.textContent = dbFilter ? `${entries.length} of ${totalCount}` : totalCount;
    }

    // Render pagination controls
    renderDbPagination(dbCurrentPage, totalPages);

    // An empty list and a search without matches need different messages.
    if (!emptyDatabase.dataset.emptyHtml) emptyDatabase.dataset.emptyHtml = emptyDatabase.innerHTML;
    if (totalCount === 0) {
        emptyDatabase.innerHTML = emptyDatabase.dataset.emptyHtml;
    } else if (entries.length === 0) {
        emptyDatabase.innerHTML = `<i class="fa-solid fa-magnifying-glass" style="font-size: 3em; color: #ccc; margin-bottom: 10px;" aria-hidden="true"></i>
            <p style="font-size: 1.1em; margin-bottom: 5px;">No students match "${escapeHtml(dbFilterInput.value.trim())}".</p>
            <p style="font-size: 0.9em; color: #999;">Search by name, card ID, UID or email.</p>`;
    }
    emptyDatabase.style.display = entries.length > 0 ? 'none' : 'block';
    closeRowMenus();
    databaseTbody.innerHTML = '';

    paginatedEntries.forEach(([dbKey, data]) => {
        const row = document.createElement('tr');
        
        // ID(s)
        const idList = (data.uids && data.uids.length > 0)
            ? data.uids
            : (data.hardware_uids || []).map(convertUidToExternalId).filter(Boolean);
        const idBadges = idList.length > 0
            ? idList.map(id => `<span class="uid-badge" style="background:#e3f2fd; color:#1565c0;">${escapeHtml(id)}</span>`).join(' ')
            : `<span style="opacity:0.4;">—</span>`;

        // UID(s)
        const hwList = data.hardware_uids || [];
        const hwBadges = hwList.length > 0
            ? hwList.map(uid => `<span class="uid-badge">${escapeHtml(uid)}</span>`).join(' ')
            : `<span style="opacity:0.4;">—</span>`;

        row.innerHTML = `
            <td class="name-cell">${escapeHtml(data.name)}</td>
            <td class="id-cell">${idBadges}</td>
            <td class="uid-cell">${hwBadges}</td>
            <td class="email-cell">${escapeHtml(data.email || '')}</td>
            <td class="actions-cell admin-only">
                <div class="actions-cell-content card-actions">
                    ${rowEditButtonHtml(`Edit ${data.name}`, 'edit-db-btn', `data-key="${escapeHtml(dbKey)}"`)}
                    ${rowMenuHtml([{
                        label: 'Delete student', icon: 'fa-solid fa-trash', danger: true, className: 'delete-db-btn',
                        attrs: `data-key="${escapeHtml(dbKey)}"`
                    }], `More actions for ${data.name}`)}
                </div>
            </td>
        `;
        row.querySelector('.edit-db-btn').addEventListener('click', () => editDatabaseEntry(dbKey));
        row.querySelector('.delete-db-btn').addEventListener('click', () => deleteDatabaseEntry(dbKey));
        databaseTbody.appendChild(row);
    });
}

/**
* Extracts a clean human-readable course code from a system name, stripping archive/EIS ID suffixes.
*/
function getCleanCourseCode(courseName, eisId) {
    return StandoData.cleanCourseCode(courseName, eisId || courseInfoMap[courseName]?.eisId);
}

/**
* Parses a course name into text and numeric components for smart sorting (e.g. "PIR 123" -> text: "PIR", num: 123).
*/
function parseCourseCode(courseName, eisId) {
    const clean = getCleanCourseCode(courseName, eisId).trim();
    const match = clean.match(/^([A-Za-z\s]+)?(\d+)?(.*)$/);
    if (!match) return { text: clean, num: 0, raw: clean };
    const text = (match[1] || '').trim();
    const num = match[2] ? parseInt(match[2], 10) : 0;
    const rest = (match[3] || '').trim();
    return { text, num, rest, raw: clean };
}

/**
* Sorts courses first by numeric code (123 then 211 then 322), then by text prefix.
* Cross-listed codes ("SWE / CE 101") come after all single codes, A–Z among themselves.
*/
function courseCodeComparator(aEntry, bEntry) {
    const aCode = getCleanCourseCode(aEntry[0], aEntry[1]?.eisId);
    const bCode = getCleanCourseCode(bEntry[0], bEntry[1]?.eisId);
    const crossA = String(aCode || '').includes('/'), crossB = String(bCode || '').includes('/');
    if (crossA !== crossB) return crossA ? 1 : -1;
    if (crossA) return String(aCode).localeCompare(String(bCode), undefined, { numeric: true, sensitivity: 'base' });

    const a = parseCourseCode(aEntry[0], aEntry[1]?.eisId);
    const b = parseCourseCode(bEntry[0], bEntry[1]?.eisId);

    // If numbers differ, sort by numeric code first (e.g. PIR 123 before CE 211 before CE 322)
    if (a.num !== b.num) {
        if (a.num === 0) return 1;
        if (b.num === 0) return -1;
        return a.num - b.num;
    }
    // If numbers are equal or absent, sort by text prefix
    const textComp = a.text.localeCompare(b.text);
    if (textComp !== 0) return textComp;
    return a.raw.localeCompare(b.raw);
}

// --- Settings course lists (global Settings and a lecturer's My Courses) ---

const SETTINGS_COURSE_SORTS = [
    ['term', 'Newest term'],
    ['code-asc', 'Code A–Z'],
    ['code-desc', 'Code Z–A'],
    ['date-desc', 'Newest start'],
    ['date-asc', 'Oldest start']
];
let settingsCourseSort = localStorage.getItem('settings_course_sort') || 'term';
if (!SETTINGS_COURSE_SORTS.some(([value]) => value === settingsCourseSort)) settingsCourseSort = 'term';
// Chosen filter pills, per list container.
const settingsCourseFacets = {};
// Staff e-mail → name, so course rows can name their lecturers.
let settingsStaffNames = new Map();

function settingsSortSelectHtml(id) {
    return `<select id="${id}" class="settings-sort-select" aria-label="Sort courses" title="Sort courses">${SETTINGS_COURSE_SORTS.map(([value, label]) =>
        `<option value="${value}"${value === settingsCourseSort ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
}

function bindSettingsSortSelect(select, rerender) {
    if (!select) return;
    select.value = settingsCourseSort;
    select.addEventListener('change', () => {
        settingsCourseSort = select.value;
        localStorage.setItem('settings_course_sort', settingsCourseSort);
        rerender();
    });
}

const COURSE_FACETS = [
    { id: 'semester', label: 'Semester' },
    { id: 'year', label: 'Academic year' },
    { id: 'lecturer', label: 'Lecturer' }
];
const LECTURER_PILLS = 6;

// A course's lecturers, by name where Settings' staff list or the loaded
// database (which includes staff) knows them, in title order.
function courseLecturers(info) {
    const staffInDatabase = email => Object.values(databaseMap)
        .find(entry => entry.isStaff && entry.email && entry.email.toLowerCase() === email)?.name;
    return String(info?.adminEmails || '').split(',').map(email => email.trim()).filter(Boolean)
        .map(email => settingsStaffNames.get(email.toLowerCase()) || staffInDatabase(email.toLowerCase()) || email)
        .sort(compareLecturers);
}

// Keys are normalised, so a name with titles groups with the same name without them.
function courseFacetValues(info, facet) {
    const term = courseTerm(info);
    if (facet === 'semester') return term ? [{ key: term.season, label: term.season }] : [];
    if (facet === 'year') return term ? [{ key: term.academicYear, label: term.academicYear, start: term.academicStart }] : [];
    return courseLecturers(info).map(name => {
        const label = (splitLecturerName(name).name || name).replace(/\s+/g, ' ');
        return { key: label.toLocaleLowerCase(), label, full: name };
    }).filter(value => value.key);
}

/**
* Renders the course list within the Settings dialog as compact rows.
* Handles Active & Archived grouping, sorting, search and filter pills.
* @param {Object} courseInfo - The dictionary of course metadata.
* @param {string} [filterText=''] - Optional text to filter the list.
*/
function renderCoursesInSettings(courseInfo, filterText = '', targetContainerId = 'settings-courses-container') {
    const container = document.getElementById(targetContainerId) || document.getElementById('settings-courses-container') || document.getElementById('settings-course-grid');
    if (!container) return;
    closeRowMenus();

    const facets = settingsCourseFacets[container.id] ||
        (settingsCourseFacets[container.id] = { semester: null, year: null, lecturer: null, expanded: false });

    // 1. Prepare Search Terms
    const lowerFilter = filterText.toLowerCase().trim();
    const strippedFilter = lowerFilter.replace(/\s+/g, '');

    // 2. Search
    const searched = Object.entries(courseInfo || {})
        .filter(([name, data]) => {
            if (!lowerFilter) return true;

            const nameLow = name.toLowerCase();
            const nameAsText = nameLow.replace(/_/g, ' ');
            const nameStripped = nameLow.replace(/_/g, '');
            const eisId = String(data.eisId || '');

            return nameLow.includes(lowerFilter) ||
                nameAsText.includes(lowerFilter) ||
                nameStripped.includes(strippedFilter) ||
                eisId.includes(lowerFilter);
        });

    // 3. Filter pills narrow the loaded rows. `except` leaves one group out, so
    // its own counts show what choosing another of its values would give.
    const matchesFacets = (entry, except = null) => COURSE_FACETS.every(({ id }) =>
        id === except || !facets[id] || courseFacetValues(entry[1], id).some(value => value.key === facets[id]));

    const byDate = (a, b) => String(a[1]?.startDate || '').localeCompare(String(b[1]?.startDate || ''));
    const sorters = {
        'term': compareCoursesForDisplay,
        'code-asc': courseCodeComparator,
        'code-desc': (a, b) => -courseCodeComparator(a, b),
        'date-asc': (a, b) => byDate(a, b) || courseCodeComparator(a, b),
        'date-desc': (a, b) => byDate(b, a) || courseCodeComparator(a, b)
    };
    const filteredCourses = searched.filter(entry => matchesFacets(entry))
        .sort(sorters[settingsCourseSort] || compareCoursesForDisplay);

    // A pill group appears only when it can narrow the list, or while one of
    // its pills is chosen so it can be cleared. Same order as the list.
    const facetsHtml = COURSE_FACETS.map(({ id, label }) => {
        const counts = new Map();
        searched.filter(entry => matchesFacets(entry, id)).forEach(entry => {
            new Map(courseFacetValues(entry[1], id).map(value => [value.key, value])).forEach(value => {
                const current = counts.get(value.key) || { ...value, count: 0 };
                current.count++;
                counts.set(value.key, current);
            });
        });
        if (facets[id] && !counts.has(facets[id])) counts.set(facets[id], { key: facets[id], label: facets[id], count: 0 });
        if (counts.size < 2 && !facets[id]) return '';
        let values = [...counts.values()].sort(
            id === 'year' ? (a, b) => (b.start || 0) - (a.start || 0) || a.key.localeCompare(b.key) :
                id === 'semester' ? (a, b) => (TERM_ORDER[a.key] ?? 9) - (TERM_ORDER[b.key] ?? 9) :
                    (a, b) => compareLecturers(a.full || a.label, b.full || b.label));
        let more = '';
        if (id === 'lecturer' && !facets.expanded && values.length > LECTURER_PILLS + 1) {
            const hidden = values.length - LECTURER_PILLS;
            values = values.filter((value, index) => index < LECTURER_PILLS || value.key === facets[id]);
            more = `<button type="button" class="more" data-facet-more>+${hidden} more</button>`;
        }
        return `<div class="settings-facet" role="group" aria-label="${label}"><span class="settings-facet-label">${label}</span>${values.map(value =>
            `<button type="button" data-facet="${id}" data-value="${escapeHtml(value.key)}" aria-pressed="${value.key === facets[id]}">${escapeHtml(value.label)}<span>${value.count}</span></button>`).join('')}${more}</div>`;
    }).join('');

    let html = facetsHtml ? `<div class="settings-facets">${facetsHtml}</div>` : '';

    // 4. Handle Empty State
    if (filteredCourses.length === 0) {
        html += `<div class="settings-empty">No courses found${filterText.trim() ? ` matching "${escapeHtml(filterText)}"` : ''}.</div>`;
    } else {
        const activeList = filteredCourses.filter(([_, d]) => !d.archived);
        const archivedList = filteredCourses.filter(([_, d]) => !!d.archived);
        const isArchivedCollapsed = localStorage.getItem('settings_archived_collapsed') !== 'false';

        // Code, then lecturers on a muted line; the term tells offerings apart.
        const courseRow = ([courseName, data]) => {
            const cleanCode = getCleanCourseCode(courseName, data.eisId);
            const term = courseTerm(data);
            const lecturers = courseLecturers(data);
            const people = lecturers.length ? lecturers.join(', ') : 'No lecturers assigned';
            const start = term ? term.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            return `
                <div class="settings-row${data.archived ? ' is-archived' : ''}">
                    <div class="settings-row-main">
                        <span class="settings-row-title"><strong>${escapeHtml(cleanCode)}</strong>${data.eisId ? ` <span class="settings-row-eis selectable">#${escapeHtml(String(data.eisId))}</span>` : ''}${data.archived ? ' <span class="settings-row-state">Archived</span>' : ''}</span>
                        <span class="settings-row-people${lecturers.length ? '' : ' is-empty'}" title="${escapeHtml(people)}">${escapeHtml(people)}</span>
                    </div>
                    ${term ? `<div class="settings-row-meta">
                        <span class="settings-row-term">${escapeHtml(term.label)}</span>
                        <span class="settings-row-sub" title="Start date">${escapeHtml(start)}</span>
                    </div>` : ''}
                    <div class="card-actions">
                        ${rowEditButtonHtml(`Edit ${cleanCode}`, 'edit-course-row-btn', `data-course-name="${escapeHtml(courseName)}"`)}
                    </div>
                </div>`;
        };
        const listHtml = (courses, kind) => courses.length
            ? `<div class="settings-list">${courses.map(courseRow).join('')}</div>`
            : `<div class="settings-empty">No ${kind} courses.</div>`;

        html += `
            <div class="settings-courses-group">
                <div class="settings-group-label">Active courses <span class="settings-group-count">${activeList.length}</span></div>
                ${listHtml(activeList, 'active')}
            </div>`;

        if (archivedList.length > 0 || !lowerFilter) {
            html += `
            <div class="settings-courses-group">
                <button type="button" class="settings-group-label settings-archived-toggle" id="settings-archived-toggle-btn" aria-expanded="${!isArchivedCollapsed}" aria-controls="settings-archived-wrapper">
                    <i class="fa-solid fa-chevron-right archived-toggle-chevron ${isArchivedCollapsed ? '' : 'is-open'}" id="archived-toggle-chevron" aria-hidden="true"></i>
                    Archived courses <span class="settings-group-count">${archivedList.length}</span>
                </button>
                <div class="settings-archived-collapse-wrapper ${isArchivedCollapsed ? '' : 'is-open'}" id="settings-archived-wrapper">
                    <div class="settings-archived-collapse-inner">${listHtml(archivedList, 'archived')}</div>
                </div>
            </div>`;
        }
    }

    container.innerHTML = html;

    // Attach Toggle Listener for the Archived Accordion
    const toggleBtn = container.querySelector('.settings-archived-toggle') || container.querySelector('#settings-archived-toggle-btn');
    if (toggleBtn) {
        toggleBtn.onclick = () => {
            const collapse = toggleBtn.getAttribute('aria-expanded') === 'true';
            localStorage.setItem('settings_archived_collapsed', collapse ? 'true' : 'false');
            toggleBtn.setAttribute('aria-expanded', String(!collapse));
            const wrapper = container.querySelector('.settings-archived-collapse-wrapper') || container.querySelector('#settings-archived-wrapper');
            const chevron = toggleBtn.querySelector('.archived-toggle-chevron') || toggleBtn.querySelector('#archived-toggle-chevron') || toggleBtn.querySelector('.fa-chevron-right');
            if (wrapper) wrapper.classList.toggle('is-open', !collapse);
            if (chevron) chevron.classList.toggle('is-open', !collapse);
        };
    }

    // Filter pills: bound once per list, re-rendering with the latest data and search.
    container._rerenderCourses = () => renderCoursesInSettings(courseInfo, filterText, targetContainerId);
    if (!container._facetsBound) {
        container._facetsBound = true;
        container.addEventListener('click', (event) => {
            const more = event.target.closest('[data-facet-more]');
            const pill = event.target.closest('[data-facet]');
            if (!more && !pill) return;
            const state = settingsCourseFacets[container.id];
            if (more) state.expanded = true;
            else state[pill.dataset.facet] = state[pill.dataset.facet] === pill.dataset.value ? null : pill.dataset.value;
            container._rerenderCourses();
            // Keep keyboard focus on the same pill after the list re-renders.
            const selector = pill
                ? `[data-facet="${pill.dataset.facet}"][data-value="${CSS.escape(pill.dataset.value)}"]`
                : '[data-facet="lecturer"]';
            container.querySelector(selector)?.focus({ preventScroll: true });
        });
    }

    // Attach Edit Listeners
    container.querySelectorAll('.edit-course-row-btn').forEach(btn => {
        btn.onclick = () => {
            const cName = btn.dataset.courseName;
            showCourseEditorDialog(cName, courseInfo[cName]);
        };
    });
}

/**
* Renders staff as compact rows grouped by role: staff by title, then name
* without titles; students A–Z.
*/
function renderStaffInSettings(staffList, filterText = '') {
    const container = document.getElementById('settings-staff-container');
    if (!container) return;
    closeRowMenus();
    container.innerHTML = '';

    const lowerFilter = filterText.toLowerCase().trim();
    const filtered = (staffList || []).filter(s => {
        if (!lowerFilter) return true;
        return (s.name && s.name.toLowerCase().includes(lowerFilter)) ||
            (s.googleName && s.googleName.toLowerCase().includes(lowerFilter)) ||
            (s.email && s.email.toLowerCase().includes(lowerFilter)) ||
            (s.role && s.role.toLowerCase().includes(lowerFilter));
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="settings-empty">No staff members found.</div>`;
        return;
    }

    // Group staff by position
    const roleGroups = [
        { name: 'Global Administrators', byTitle: true, items: filtered.filter(s => s.role === 'Global') },
        { name: 'Lecturers & Staff', byTitle: true, items: filtered.filter(s => s.role !== 'Global' && s.role !== 'Student') },
        { name: 'Students', byTitle: false, items: filtered.filter(s => s.role === 'Student') }
    ];

    let html = '';

    roleGroups.forEach(group => {
        if (group.items.length === 0) return;

        group.items.sort((a, b) => group.byTitle
            ? compareLecturers(staffDisplayName(a), staffDisplayName(b))
            : staffDisplayName(a).localeCompare(staffDisplayName(b), undefined, { sensitivity: 'base' }));

        // The custom name when set, otherwise the Google name; the photo comes from Google sign-in.
        const rows = group.items.map(s => {
            const role = s.role === 'Global' ? 'Administrator' : (s.role || 'Lecturer');
            const shown = staffDisplayName(s);
            const named = !!(s.name || s.googleName);
            const index = `data-row-index="${escapeHtml(String(s.rowIndex))}"`;
            return `
                <div class="settings-row is-person">
                    ${userAvatarHtml(shown, s.photo, 'user-avatar settings-row-avatar')}
                    <div class="settings-row-main">
                        <span class="settings-row-title">${escapeHtml(shown)}</span>
                        <span class="settings-row-people${named ? '' : ' is-empty'}"><span class="settings-row-role">${escapeHtml(role)} · </span>${named ? `<span class="selectable">${escapeHtml(s.email)}</span>` : 'Name appears after their first Google sign-in'}</span>
                    </div>
                    <div class="settings-row-meta"><span class="settings-row-term">${escapeHtml(role)}</span></div>
                    <div class="card-actions">
                        ${rowEditButtonHtml(`Edit ${shown}`, 'edit-staff-btn',
                `${index} data-name="${escapeHtml(s.name)}" data-google-name="${escapeHtml(s.googleName)}" data-uid="${escapeHtml(s.uid)}" data-email="${escapeHtml(s.email)}" data-role="${escapeHtml(s.role || 'Lecturer')}"`)}
                        ${rowMenuHtml([{ label: 'Revoke access', icon: 'fa-solid fa-trash', danger: true, className: 'delete-staff-btn', attrs: `${index} data-name="${escapeHtml(shown)}"` }],
                    `More actions for ${shown}`)}
                    </div>
                </div>
            `;
        }).join('');

        html += `
            <div class="settings-courses-group">
                <div class="settings-group-label">${group.name} <span class="settings-group-count">${group.items.length}</span></div>
                <div class="settings-list">${rows}</div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Attach Staff Listeners
    container.querySelectorAll('.edit-staff-btn').forEach(btn => {
        btn.onclick = () => window.editStaffKey(btn.dataset.rowIndex, btn.dataset.name, btn.dataset.uid, btn.dataset.email, btn.dataset.role, btn.dataset.googleName);
    });
    container.querySelectorAll('.delete-staff-btn').forEach(btn => {
        btn.onclick = () => window.deleteStaffKey(btn.dataset.rowIndex, btn.dataset.name);
    });
}

/**
 * Update database status indicator.
 */
function updateDatabaseStatus() {
    const count = studentEntries().length;
    databaseStatus.textContent = count > 0 ? `${count} registered students` : 'Not loaded';
}

function updatePageTitle() {
    let titlePrefix = '';

    // Only show count for admins if there are pending items
    const titleCount = (isGlobalAdmin && adminCourses.length > 0) ? myNotificationCount : globalNotificationCount;
    if (isAdmin && titleCount > 0) {
        titlePrefix = `(${titleCount}) `;
    }

    if (currentCourse && currentCourse !== 'Default') {
        const titleName = getCleanCourseCode(currentCourse, courseInfoMap[currentCourse]?.eisId);
        document.title = `${titlePrefix}${titleName} Attendance`;
    } else {
        document.title = `${titlePrefix}Stando`;
    }
}

/**
 Update the entire UI.
 */
async function updateUI() {
    await databaseLoadPromise;
    updateLogsList();
    updateDatabaseList();
    updateDatabaseStatus();
    updatePageTitle();


    // This logic ensures the course buttons are correctly hidden when on the database tab.
    const activeTabId = document.querySelector('.tab.active')?.dataset.tab;
    const courseButtonsContainer = document.getElementById('course-buttons-container');
    if (courseButtonsContainer) {
        if (activeTabId === 'database-tab') {
            courseButtonsContainer.style.display = 'none';
        } else {
            courseButtonsContainer.style.display = 'flex';
        }
    }

    const logsForCurrentCourse = getLogsForCurrentUser();

    // Update total scans and last scan info
    totalScans.textContent = logsForCurrentCourse.length;

    if (logsForCurrentCourse.length > 0) {
        const latestLog = logsForCurrentCourse[0]; // Assumes logs are sorted newest first
        const lastTimestamp = new Date(latestLog.timestamp);
        const pad = (n) => n.toString().padStart(2, '0');
        const time = `${pad(lastTimestamp.getHours())}:${pad(lastTimestamp.getMinutes())}`;
        const date = `${pad(lastTimestamp.getDate())}-${pad(lastTimestamp.getMonth() + 1)}-${lastTimestamp.getFullYear()}`;
        lastScan.textContent = `${time} ${date}`;
    } else {
        lastScan.textContent = 'Never';
    }

    // Enable/disable buttons
    exportBtn.disabled = logsForCurrentCourse.length === 0;
    clearBtn.disabled = logsForCurrentCourse.length === 0;

    if (isAdminForCourse(currentCourse)) {
        // Admin-specific UI updates
        const hasStudents = studentEntries().length > 0;
        clearDbBtn.disabled = !hasStudents;
        exportExcelBtn.disabled = !hasStudents;
    }

    updateScanButtons();
    populateCourseButtons();

    if (currentCourse) {
        renderSessionControls(currentCourse);
    }

    const hasLogs = logsForCurrentCourse.length > 0;
    filterInput.disabled = !hasLogs;
    sortSelect.disabled = !hasLogs;
}

/**
 * Start NFC scanning.
 */
async function startScanning() {
    if (!nfcSupported || nfcReader) return;
    const controller = new AbortController();
    const reader = new NDEFReader();
    nfcAbortController = controller;
    nfcReader = reader;
    try {
        reader.addEventListener('reading', handleNfcReading);
        reader.addEventListener('readingerror', handleNfcError);
        await reader.scan({ signal: controller.signal });
        if (controller.signal.aborted || nfcReader !== reader) return;
        isScanning = true;
        document.getElementById('scan-button').classList.add('is-scanning');
        updateScanClock();
        if (scanClockInterval) clearInterval(scanClockInterval);
        scanClockInterval = setInterval(updateScanClock, 1000);
    } catch (error) {
        if (controller.signal.aborted || nfcReader !== reader) return;
        handleScanningError(error);
    }
}

function handleScanningError(error) {
    // Handle permission denied and other errors
    let errorMessage = error?.message || 'Could not start NFC scanning. Please try again.';
    let errorTitle = 'Scanner error';

    if (error.name === 'NotAllowedError' || errorMessage.includes('permission')) {
        errorTitle = 'Permission denied';
        errorMessage = 'You need to grant permission to use NFC. Please try again.';
    } else if (error.name === 'NotSupportedError') {
        errorTitle = 'NFC not supported';
        errorMessage = 'Your device doesn\'t support NFC or it\'s turned off.';
    }

    showNotification('error', errorTitle, errorMessage);
    stopScanning();
}

function updateScanButtons() {
    const scanBtn = document.getElementById('scan-button');
    const scanButtonsContainer = document.querySelector('.scan-buttons');

    if (!scanBtn || !scanButtonsContainer) return;

    // Show button if supported
    scanBtn.style.display = nfcSupported ? 'flex' : 'none';
    scanButtonsContainer.style.display = nfcSupported ? 'flex' : 'none';

    if (isScanning) {
        scanBtn.classList.add('is-scanning');
        // updateScanClock() handles the text/time display.
    } else {
        scanBtn.classList.remove('is-scanning');

        // --- UNIFIED IDLE STATE ---
        // Always show "START SCANNING" regardless of login status
        scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i><b>&nbsp;&nbsp; START SCANNING</b>';
    }
}

/**
* Handle NFC reading.
* SCENARIO A: If logged out, checks if the card belongs to an Admin to log them in.
* SCENARIO B: If logged in, records attendance for the current course.
*/
async function handleNfcReading({ serialNumber }) {
    // A dialog's own scan takes the card, unless the lock screen covers that dialog.
    const locked = isScanLockScreenShown();
    if (!locked && document.querySelector('.dialog-backdrop')) return;
    if (typeof serialNumber !== 'string' || !serialNumber.trim()) {
        playSound(false);
        showNotification('warning', 'Card Not Read', 'Hold your card against the reader and try again.');
        return;
    }

    // ============================================================
    // SCENARIO A: LOGIN CHECK / GUEST MODE
    // Run this ONLY if we are NOT signed in
    // ============================================================
    if (!isSignedIn) {
        if (nfcLoginInProgress) return;
        nfcLoginInProgress = true;
        const notSignedInMsg = document.getElementById('not-signed-in-message');
        if (notSignedInMsg) notSignedInMsg.innerHTML = `<div style="text-align:center;"><i class="fa-solid fa-circle-notch fa-spin"></i> Checking credentials...</div>`;

        try {
            const myDeviceId = getDeviceFingerprint();
            const convertedCardId = convertUidToExternalId(serialNumber);
            // Ask the kiosk-login Edge Function if this UID belongs to a staff member
            const { data, error } = await supabaseClient.functions.invoke('kiosk-login', {
                body: { uid: serialNumber, convertedId: convertedCardId, deviceId: myDeviceId }
            });
            if (error) {
                console.warn('Kiosk login invoke error:', error);
                throw error;
            }

            if (data && data.result === 'success') {
                // === ADMIN LOGIN SUCCESS ===
                // Exchange the one-time token for a real Supabase session
                const { error: otpError } = await supabaseClient.auth.verifyOtp({
                    type: 'email',
                    token_hash: data.token_hash
                });
                if (otpError) throw otpError;

                localStorage.setItem(KIOSK_MODE_KEY, '1');
                // A staff row may have no custom name yet; the avatar draws its own initials.
                currentUser = {
                    ...data.user,
                    name: data.user.name || data.user.email,
                    picture: /ui-avatars\.com/.test(data.user.picture || '') ? '' : data.user.picture
                };
                showNotification('success', 'Session Active', `Welcome, ${currentUser.name}`);
                playSound(true);
                await onSuccessfulAuth(false);
            } else {
                if (data && data.result === 'error' && data.message) {
                    showNotification('warning', 'Kiosk Login', data.message);
                }
                // === STUDENT CARD (GUEST MODE) ===
                // Just show the converted ID
                lastScannedUID = convertedCardId;
                updateAuthUI();
            }

        } catch (err) {
            console.warn('Kiosk login error fallback:', err);
            // Network error implies offline or unauthenticated guest, show converted ID
            lastScannedUID = convertUidToExternalId(serialNumber);
            updateAuthUI();
        } finally {
            nfcLoginInProgress = false;
        }
        return; // Stop here
    }

    // ============================================================
    // SCENARIO B: ATTENDANCE RECORDING
    // Runs if Signed In OR in Lecturer Mode
    // ============================================================

    // The lecturer's own unlock card locks and unlocks instead of recording attendance.
    if ((scanLockSession || locked) && await isScanLockCard(serialNumber)) {
        toggleScanLockWithCard();
        return;
    }

    const convertedUid = convertUidToExternalId(serialNumber);
    const primaryUid = lookupPrimaryUid(serialNumber);
    const finalUid = primaryUid || convertedUid || serialNumber;
    lastScannedUID = convertedUid;

    // Security Check: Only block if we are signed in but NOT an admin
    // (If isLecturerMode is true, we bypass this because auth is offline)
    if (!isAdmin || (currentCourse && !isAdminForCourse(currentCourse))) {
        playSound(false);
        showNotification('error', 'Action Not Allowed', 'Only administrators can record attendance.');
        return;
    }

    // Cooldown
    if (cooldownUIDs.has(finalUid)) return;
    cooldownUIDs.add(finalUid);
    setTimeout(() => { cooldownUIDs.delete(finalUid) }, 2000);

    if (!currentCourse) {
        showNotification('warning', 'No Course Selected', 'Please select a course before scanning');
        return;
    }

    const timestamp = new Date();
    // A card missing from the student list sounds the failure tone to get attention.
    const isUnknown = !primaryUid;
    playSound(!isUnknown);

    let newLog = {
        uid: convertedUid,
        timestamp: timestamp.getTime(),
        id: Date.now() + Math.random().toString(36).substring(2, 11),
        manual: false,
        session: getCurrentActiveSession()
    };

    // In LecturerMode, currentUser might be null, which is fine
    newLog = touchLogForEdit(newLog, currentUser?.email || 'Offline Lecturer');

    if (!courseData[currentCourse]) {
        courseData[currentCourse] = { logs: [], tombstones: new Set() };
    }
    courseData[currentCourse].logs.unshift(newLog);

    saveAndMarkChanges(currentCourse);
    updateUI();
    if (scanLockSession) {
        scanLockScanCount++;
        updateScanLockScreen();
    }

    // The lock screen shows the overlay on any screen size.
    if (window.innerWidth <= 700 || locked) {
        showScanAnnouncement(isUnknown
            ? { unknown: true, name: convertedUid || serialNumber }
            : { unknown: false, name: databaseMap[primaryUid]?.name || '' });
    }
}

// Full-screen result of a scan: white with the name, or orange with the Card ID
// when the card is not in the student list.
function showScanAnnouncement({ unknown, name }) {
    const overlay = document.getElementById('scan-announcement-overlay');
    const nameEl = document.getElementById('scan-announcement-name');
    if (!overlay || !nameEl) return;

    overlay.classList.toggle('is-unknown', unknown);
    // A fresh icon element lets the icon kit render the new glyph.
    overlay.querySelector('.scan-announcement-icon').innerHTML = unknown
        ? '<i class="fa-solid fa-triangle-exclamation"></i>'
        : '<i class="fa-solid fa-circle-check"></i>';
    overlay.querySelector('.scan-announcement-title').textContent = unknown ? 'Unknown card' : 'Welcome';
    overlay.querySelector('.scan-announcement-subtitle').textContent = unknown
        ? 'Attendance recorded · Not in the student list'
        : 'Attendance Recorded';
    nameEl.textContent = name;

    // Don't use openDialogMode/closeDialogMode - the overlay should NOT block scrolling
    overlay.style.display = 'flex';
    void overlay.offsetWidth;
    overlay.classList.add('visible');
    if (window.overlayTimeout) clearTimeout(window.overlayTimeout);
    if (window.overlayHideTimeout) clearTimeout(window.overlayHideTimeout);
    const hideOverlay = () => {
        if (window.overlayTimeout) clearTimeout(window.overlayTimeout);
        overlay.classList.remove('visible');
        window.overlayHideTimeout = setTimeout(() => {
            overlay.style.display = 'none';
        }, 150);
    };
    // An unknown card stays up longer so it is noticed.
    window.overlayTimeout = setTimeout(hideOverlay, unknown ? 4000 : 2500);
    overlay.onclick = hideOverlay;
}

/**
 * Handle NFC error.
 * @param {Object} error - The NFC error.
 */
function handleNfcError(error) {
    playSound(false);
    showNotification('warning', 'Card Not Read', error?.message || 'Hold your card steady and tap again.');
}

/**
 * Stop NFC scanning.
 */
function stopScanning() {
    if (nfcAbortController) {
        nfcAbortController.abort();
        nfcAbortController = null;
    }

    // --- STOP CLOCK ---
    isScanning = false;
    if (scanClockInterval) {
        clearInterval(scanClockInterval);
        scanClockInterval = null;
    }

    // Reset button UI
    const scanBtn = document.getElementById('scan-button');
    if (scanBtn) {
        scanBtn.classList.remove('is-scanning');
        scanBtn.innerHTML = '<i class="fa-solid fa-wifi"></i><b>&nbsp;&nbsp; START SCANNING</b>';
    }

    if (nfcReader) nfcReader = null;

    // Stopping while unlocked ends the lock session; a scanner that fails while
    // locked stays locked and says that scanning is paused.
    if (scanLockSession && !isScanLockScreenShown()) {
        endScanLockSession();
    } else if (isScanLockScreenShown()) {
        updateScanLockScreen();
        startScanLockReader();
    }
    updateScanLockButton();
}

// ============================================================
// SCAN LOCK
// A scanning phone is often left unattended, so scanning shows a lock screen
// that only records attendance. The lecturer unlocks it by tapping their own
// staff card on a trusted device, the same rules as staff card sign-in, which
// the database checks. The last card confirmed on this phone is kept as a
// salted hash so the phone also unlocks offline. The lock is shared by every
// Stando tab of this website and survives a reload, and leaving the page while
// locked is reported on the next unlock.
// ============================================================
const SCAN_LOCK_KEY = 'stando_scan_lock';
const SCAN_LOCK_CARD_PREFIX = 'stando_scan_lock_card_';
const SCAN_LOCK_IDLE_MS = 30000; // Relock after this long untouched while scanning
const SCAN_LOCK_MIN_AWAY_MS = 2000; // Shorter absences are not reported
let scanLockSession = false; // From Start scanning until the lecturer stops
let scanLockScanCount = 0;
let scanLockIdleTimer = null;
let scanLockClockInterval = null;
let scanLockReaderController = null;
let scanLockLastCardToggle = 0;
let scanLockUnavailableShown = false;

function scanLockAccount() {
    return String(currentUser?.email || '').trim().toLowerCase();
}

function readScanLockState() {
    try {
        return JSON.parse(localStorage.getItem(SCAN_LOCK_KEY) || 'null');
    } catch {
        return null;
    }
}

function writeScanLockState(state) {
    try {
        if (state) localStorage.setItem(SCAN_LOCK_KEY, JSON.stringify(state));
        else localStorage.removeItem(SCAN_LOCK_KEY);
    } catch (error) {
        console.warn('Could not save the scan lock:', error);
    }
}

function isScanLockScreenShown() {
    return !!document.getElementById('scan-lock');
}

// Only administrators record attendance, and hashing needs a secure context (as NFC does).
function scanLockAvailable() {
    return isSignedIn && isAdmin && !!scanLockAccount() && !!supabaseClient && !!window.crypto?.subtle;
}

async function hashScanLockValue(value, salt) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${value}`));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Every form a staff card may be stored in, as staff card sign-in matches them.
function staffCardCandidates(serialNumber) {
    const raw = String(serialNumber || '').trim();
    return [...new Set([raw, raw.toLowerCase(), raw.toUpperCase(), raw.replace(/:/g, ''), convertUidToExternalId(raw)])]
        .filter(Boolean);
}

function scanLockCardValue(serialNumber) {
    return String(convertUidToExternalId(serialNumber) || serialNumber).trim().toLowerCase();
}

// The staff card last confirmed on this phone, for unlocking offline.
function getSavedUnlockCard() {
    try {
        return JSON.parse(localStorage.getItem(SCAN_LOCK_CARD_PREFIX + scanLockAccount()) || 'null');
    } catch {
        return null;
    }
}

async function saveUnlockCard(serialNumber) {
    const salt = crypto.randomUUID();
    const hash = await hashScanLockValue(scanLockCardValue(serialNumber), salt);
    try {
        localStorage.setItem(SCAN_LOCK_CARD_PREFIX + scanLockAccount(), JSON.stringify({ salt, hash }));
    } catch (error) {
        console.warn('Could not save the unlock card:', error);
    }
}

async function isSavedUnlockCard(serialNumber) {
    const saved = getSavedUnlockCard();
    return !!saved?.hash && await hashScanLockValue(scanLockCardValue(serialNumber), saved.salt) === saved.hash;
}

// Whether the signed-in lecturer has a staff card and this phone is trusted.
async function canUnlockWithStaffCard() {
    if (navigator.onLine) {
        try {
            const { data, error } = await supabaseClient.rpc('staff_card_unlock_ready', { p_device_id: getDeviceFingerprint() });
            if (error) throw error;
            return data === true;
        } catch (error) {
            console.warn('Staff card check unavailable:', error?.message || error);
        }
    }
    return !!getSavedUnlockCard();
}

// Online, the database decides (so a changed staff card takes effect at once);
// offline, the card last confirmed on this phone still works.
async function isScanLockCard(serialNumber) {
    if (!serialNumber || !scanLockAvailable()) return false;
    const saved = await isSavedUnlockCard(serialNumber);
    // Students' cards skip the server check; a card this phone already confirmed does not.
    if (!saved && lookupPrimaryUid(serialNumber)) return false;
    if (navigator.onLine) {
        try {
            const { data, error } = await supabaseClient.rpc('verify_staff_card', {
                p_card_ids: staffCardCandidates(serialNumber),
                p_device_id: getDeviceFingerprint()
            });
            if (error) throw error;
            if (data === true) await saveUnlockCard(serialNumber);
            else if (saved) localStorage.removeItem(SCAN_LOCK_CARD_PREFIX + scanLockAccount());
            return data === true;
        } catch (error) {
            console.warn('Staff card check unavailable; using the card saved on this phone:', error?.message || error);
        }
    }
    return saved;
}

function formatScanLockDuration(ms) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function formatScanLockTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Start scanning behind the lock screen when the lecturer can unlock it again.
async function startScanningLocked() {
    if (!scanLockAvailable()) return startScanning();

    await startScanning();
    if (!isScanning) return;
    if (!(await canUnlockWithStaffCard())) {
        if (!scanLockUnavailableShown) {
            scanLockUnavailableShown = true;
            showNotification('info', 'Scanning Is Not Locked', isGlobalAdmin
                ? 'To lock Stando while scanning, add your card in Settings → Staff and trust this phone in Settings → Trusted Devices.'
                : 'To lock Stando while scanning, ask an administrator to add your staff card and trust this phone.', 10000);
        }
        return;
    }
    scanLockSession = true;
    scanLockScanCount = 0;
    // Full screen hides the address bar and tabs. It needs a recent tap, so it
    // can fail after a slow NFC permission prompt; the lock works without it.
    requestScanLockFullscreen();
    lockScanner();
    updateScanLockButton();
}

function requestScanLockFullscreen() {
    const root = document.documentElement;
    if (document.fullscreenElement || !root.requestFullscreen) return;
    root.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* Optional; the lock works without it. */ });
}

function exitScanLockFullscreen() {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { });
}

function lockScanner() {
    if (!scanLockAvailable()) return;
    clearTimeout(scanLockIdleTimer);
    const state = readScanLockState();
    if (!state || state.email !== scanLockAccount()) {
        writeScanLockState({ email: scanLockAccount(), since: Date.now(), events: [] });
    }
    showScanLockScreen();
}

function unlockScanner() {
    const state = readScanLockState();
    writeScanLockState(null);
    hideScanLockScreen();
    reportScanLockAbsences(state?.events);
    if (scanLockSession) {
        if (isScanning) armScanLockIdle();
        else endScanLockSession();
    }
    updateScanLockButton();
}

function endScanLockSession() {
    scanLockSession = false;
    clearTimeout(scanLockIdleTimer);
    scanLockIdleTimer = null;
    exitScanLockFullscreen();
    updateScanLockButton();
}

// Signing out removes what the lock protects, so the lock goes too.
function clearScanLock() {
    endScanLockSession();
    writeScanLockState(null);
    hideScanLockScreen();
}

function toggleScanLockWithCard() {
    // One tap can be read twice; ignore the echo.
    if (Date.now() - scanLockLastCardToggle < 1500) return;
    scanLockLastCardToggle = Date.now();
    playSound(true);
    if (isScanLockScreenShown()) unlockScanner();
    else lockScanner();
}

function armScanLockIdle() {
    clearTimeout(scanLockIdleTimer);
    scanLockIdleTimer = setTimeout(() => {
        if (scanLockSession && isScanning && !isScanLockScreenShown()) lockScanner();
    }, SCAN_LOCK_IDLE_MS);
}

function updateScanLockButton() {
    const lockBtn = document.getElementById('scan-lock-btn');
    if (lockBtn) lockBtn.hidden = !(scanLockSession && isScanning);
}

function setScanLockInert(inert) {
    Array.from(document.body.children).forEach(el => {
        if (el.id === 'scan-lock' || el.id === 'scan-announcement-overlay' || el.tagName === 'SCRIPT') return;
        if (inert && !el.inert) {
            el.inert = true;
            el.dataset.scanLockInert = '1';
        } else if (!inert && el.dataset.scanLockInert) {
            el.inert = false;
            delete el.dataset.scanLockInert;
        }
    });
}

function scanLockBeforeUnload(event) {
    event.preventDefault();
    event.returnValue = '';
}

function showScanLockScreen() {
    let screen = document.getElementById('scan-lock');
    if (!screen) {
        // Close open row menus; they float above everything.
        document.querySelectorAll('.row-menu-list:not([hidden])').forEach(menu => { menu.hidden = true; });
        screen = document.createElement('div');
        screen.id = 'scan-lock';
        screen.className = 'scan-lock';
        screen.tabIndex = -1;
        screen.setAttribute('role', 'dialog');
        screen.setAttribute('aria-modal', 'true');
        screen.setAttribute('aria-labelledby', 'scan-lock-title');
        screen.innerHTML = `
            <div class="scan-lock-inner">
                <div class="scan-lock-top">
                    <span class="scan-lock-badge"><i class="fa-solid fa-lock" aria-hidden="true"></i> Locked</span>
                    <span class="scan-lock-course"></span>
                </div>
                <div class="scan-lock-view">
                    <div class="scan-lock-clock" aria-hidden="true"></div>
                    <h2 class="scan-lock-title" id="scan-lock-title"></h2>
                    ${cardTapAnimationHtml()}
                    <p class="scan-lock-status" role="status" aria-live="polite"></p>
                    <p class="scan-lock-alert" hidden></p>
                </div>
                <div class="scan-lock-footer">
                    <p class="scan-lock-hint"><i class="fa-solid fa-id-badge" aria-hidden="true"></i> Lecturer: tap your staff card to unlock.</p>
                    <button type="button" class="scan-lock-link" data-key="signout">Can't unlock? Sign out</button>
                </div>
            </div>`;
        screen.addEventListener('click', handleScanLockClick);
        document.body.appendChild(screen);
        document.documentElement.classList.add('scan-locked');
        setScanLockInert(true);
        window.addEventListener('beforeunload', scanLockBeforeUnload);
        scanLockClockInterval = setInterval(updateScanLockScreen, 1000);
    }
    updateScanLockScreen();
    // Without the attendance scanner (another tab, or after a reload), listen for the unlock card.
    if (!nfcReader) startScanLockReader();
    screen.focus({ preventScroll: true });
}

function hideScanLockScreen() {
    const screen = document.getElementById('scan-lock');
    if (!screen) return;
    stopScanLockReader();
    clearInterval(scanLockClockInterval);
    scanLockClockInterval = null;
    window.removeEventListener('beforeunload', scanLockBeforeUnload);
    setScanLockInert(false);
    document.documentElement.classList.remove('scan-locked');
    screen.remove();
}

// Runs every second; text is only written when it changes, so live regions stay quiet.
function updateScanLockScreen() {
    const screen = document.getElementById('scan-lock');
    if (!screen) return;
    const setText = (selector, text) => {
        const el = screen.querySelector(selector);
        if (el.textContent !== text) el.textContent = text;
    };
    const session = getCurrentActiveSession();
    setText('.scan-lock-course', [currentCourse, session !== 'Default' ? session : ''].filter(Boolean).join(' · '));
    setText('.scan-lock-clock', formatScanLockTime(Date.now()));
    screen.classList.toggle('is-paused', !isScanning);
    setText('.scan-lock-title', isScanning ? 'Tap your card on the back of this phone' : 'Scanning is paused');
    if (!screen.querySelector('.scan-lock-status').dataset.message) {
        setText('.scan-lock-status', isScanning
            ? `${scanLockScanCount} ${scanLockScanCount === 1 ? 'card' : 'cards'} recorded`
            : 'Cards are not being recorded. Unlock to start scanning again.');
    }

    const events = readScanLockState()?.events || [];
    screen.querySelector('.scan-lock-alert').hidden = events.length === 0;
    if (events.length) {
        const last = events[events.length - 1];
        setText('.scan-lock-alert', `${events.length === 1 ? 'Stando was left' : `Stando was left ${events.length} times, last`} at ${formatScanLockTime(last.at)} for ${formatScanLockDuration(last.ms)}. Cards tapped then were not recorded.`);
    }
}

// A short message in place of the scan count, for example for a card tapped while paused.
function flashScanLockStatus(message) {
    const status = document.querySelector('#scan-lock .scan-lock-status');
    if (!status) return;
    status.dataset.message = '1';
    status.textContent = message;
    clearTimeout(status._timer);
    status._timer = setTimeout(() => {
        delete status.dataset.message;
        updateScanLockScreen();
    }, 4000);
}

// Without the staff card (forgotten, or the phone is offline and has never
// confirmed it), signing out is the way out; it gives nobody else access.
function handleScanLockClick(event) {
    if (!event.target.closest('button[data-key="signout"]')) return;
    showConfirmationDialog({
        title: 'Sign out to unlock?',
        message: 'Scanning stops, and you sign in again with Google or your staff card. Attendance saved on this phone stays on it and syncs when you sign in again with the same account.',
        confirmText: 'Sign out',
        isDestructive: true,
        onConfirm: () => {
            clearScanLock();
            handleSignoutClick();
        }
    });
}

function startScanLockReader() {
    if (!nfcSupported || scanLockReaderController) return;
    const controller = new AbortController();
    scanLockReaderController = controller;
    const reader = new NDEFReader();
    reader.onreading = async ({ serialNumber }) => {
        if (controller.signal.aborted) return;
        if (await isScanLockCard(serialNumber)) {
            toggleScanLockWithCard();
        } else {
            playSound(false);
            flashScanLockStatus("Scanning is paused, so this card wasn't recorded.");
        }
    };
    // Without an earlier NFC permission this fails quietly; signing out still works.
    reader.scan({ signal: controller.signal }).catch(() => {
        if (scanLockReaderController === controller) scanLockReaderController = null;
    });
}

function stopScanLockReader() {
    if (scanLockReaderController) scanLockReaderController.abort();
    scanLockReaderController = null;
}

// Record when the locked page is hidden or closed; report it when it is back.
function noteScanLockHidden() {
    const state = readScanLockState();
    if (state && state.email === scanLockAccount() && !state.hiddenAt) {
        writeScanLockState({ ...state, hiddenAt: Date.now() });
    }
}

function noteScanLockReturn() {
    const state = readScanLockState();
    if (!state?.hiddenAt || state.email !== scanLockAccount()) return;
    const away = Date.now() - state.hiddenAt;
    const events = away >= SCAN_LOCK_MIN_AWAY_MS
        ? [...(state.events || []), { at: state.hiddenAt, ms: away }].slice(-20)
        : (state.events || []);
    writeScanLockState({ ...state, hiddenAt: null, events });
    updateScanLockScreen();
}

function reportScanLockAbsences(events) {
    if (!events?.length) return;
    const last = events[events.length - 1];
    const times = events.length === 1 ? 'once' : `${events.length} times`;
    showNotification('warning', 'Stando Was Left While Locked',
        `Stando was left ${times}, last at ${formatScanLockTime(last.at)} for ${formatScanLockDuration(last.ms)}. Cards tapped then were not recorded.`, 10000);
}

// After sign-in (or in another tab), show the lock if this account left it locked.
function restoreScanLock() {
    const state = readScanLockState();
    if (!state) return;
    if (!scanLockAccount() || state.email !== scanLockAccount()) {
        writeScanLockState(null);
        return;
    }
    showScanLockScreen();
    noteScanLockReturn();
}

function syncScanLockFromStorage() {
    if (!isSignedIn) return;
    const state = readScanLockState();
    if (state && state.email === scanLockAccount()) {
        if (isScanLockScreenShown()) updateScanLockScreen();
        else showScanLockScreen();
    } else if (isScanLockScreenShown()) {
        hideScanLockScreen();
        if (scanLockSession && isScanning) armScanLockIdle();
    }
}

function setupScanLock() {
    document.getElementById('scan-lock-btn')?.addEventListener('click', () => {
        requestScanLockFullscreen();
        lockScanner();
    });

    // Any touch or key while unlocked and scanning restarts the relock countdown.
    ['pointerdown', 'keydown', 'wheel', 'touchmove'].forEach(type => {
        document.addEventListener(type, () => {
            if (scanLockSession && isScanning && !isScanLockScreenShown()) armScanLockIdle();
        }, { capture: true, passive: true });
    });

    window.addEventListener('storage', (event) => {
        if (event.key === SCAN_LOCK_KEY || event.key === null) syncScanLockFromStorage();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') noteScanLockHidden();
        else noteScanLockReturn();
    });
    window.addEventListener('pagehide', noteScanLockHidden);
}

/**
 * Play sound effect (success or error).
 * @param {boolean} success - Whether to play success or error sound.
 */
function playSound(success) {
    if (!soundEnabled) return;

    const sound = success ? successSound : errorSound;
    if (!sound) return;

    // Reset to start (0) only if the audio metadata is loaded
    if (sound.readyState >= 1) {
        sound.currentTime = 0;
    }

    const playPromise = sound.play();

    if (playPromise !== undefined) {
        playPromise.catch(error => {
            // This catches the "DOMException: The play() request was interrupted"
            // or "Autoplay is not allowed" errors so they don't stop the app.
            console.warn("Audio playback blocked (User needs to tap screen once):", error);
        });
    }
}

/**
 * Update current year in footer.
 */
function updateYear() {
    const yearElement = document.getElementById('currentYear');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }
}

function removeNotifications(type) {
    const notificationArea = document.getElementById('in-page-notification-area');
    const notificationsToRemove = notificationArea.querySelectorAll(`[data-notification-type="${type}"]`);

    notificationsToRemove.forEach(notification => {
        notification.classList.add('removing');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    });
}

function showNotification(type, title, message, duration = 5000) {
    const notificationArea = document.getElementById('in-page-notification-area');
    if (!notificationArea) return;

    // Deduplicate notifications - skip if same notification shown recently
    const notificationKey = `${type}-${title}-${message}`;
    if (lastNotificationKey === notificationKey &&
        (Date.now() - lastNotificationTime) < 3000) {
        return;
    }
    lastNotificationKey = notificationKey;
    lastNotificationTime = Date.now();

    // Skip redundant notifications
    if (title === 'Courses Warning' && message === 'Using default course list') {
        return;
    }

    // Skip Auth Errors during initialization
    if (isInitializing && title === 'Auth Error') {
        return;
    }

    message = String(message ?? '');

    // Skip User Info errors that often resolve themselves
    if (title === 'User Info Error' || message.includes('user info')) {
        return;
    }

    // During initialization, only show critical notifications immediately
    if (isInitializing || criticalErrorsOnly) {
        const isCritical = type === 'error' &&
            (title.includes('Critical') ||
                message.includes('Permission denied'));

        if (!isCritical) {
            // Store non-critical notifications for later
            pendingNotifications.push({ type, title, message, duration });
            return;
        }
    }

    // Safely remove notifications
    const safeRemove = (element) => {
        try {
            if (element && element.parentNode) {
                element.parentNode.removeChild(element);
            }
        } catch (e) {
        }
    };

    // Clear existing notifications of the same type
    const existingNotifications = notificationArea.querySelectorAll(`.in-page-notification-${type}`);
    existingNotifications.forEach(notification => {
        notification.classList.add('removing');
        setTimeout(() => safeRemove(notification), 300);
    });

    // Limit total notifications to 2
    const allNotifications = notificationArea.querySelectorAll('.in-page-notification');
    if (allNotifications.length >= 2) {
        const oldest = allNotifications[0];
        oldest.classList.add('removing');
        setTimeout(() => safeRemove(oldest), 300);
    }

    // Create the new notification
    const notification = document.createElement('div');
    notification.setAttribute('class', `in-page-notification in-page-notification-${type}`);
    notification.dataset.notificationType = type;

    let icon;
    switch (type) {
        case 'success': icon = 'check-circle'; break;
        case 'error': icon = 'times-circle'; break;
        case 'warning': icon = 'exclamation-circle'; break;
        case 'delete': icon = 'trash'; break;
        default: icon = 'info-circle';
    }

    // Title and message are plain text: they often carry names and server errors.
    // Line breaks ("\n") in the message are kept.
    notification.innerHTML = `
        <i class="fa-solid fa-${icon}" aria-hidden="true"></i>
        <div class="in-page-notification-text"><strong></strong><br><span class="in-page-notification-message"></span></div>
        <button type="button" class="notification-close" title="Close" aria-label="Close notification">&times;</button>
    `;
    notification.querySelector('strong').textContent = title;
    notification.querySelector('.in-page-notification-message').textContent = message ?? '';
    if (type === 'error') notification.setAttribute('role', 'alert');

    notificationArea.appendChild(notification);

    // Add click handler to close button
    const closeBtn = notification.querySelector('.notification-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            notification.classList.add('removing');
            setTimeout(() => safeRemove(notification), 300);
        });
    }

    // Auto-remove non-error notifications
    if (type !== 'error') {
        setTimeout(() => {
            notification.classList.add('removing');
            setTimeout(() => safeRemove(notification), 300);
        }, duration || 5000);
    }
}

// --- PAGINATION HELPER FUNCTIONS ---

/**
 * Renders pagination controls for the logs table.
 */
function renderLogsPagination(currentPage, totalPages) {
    const container = document.getElementById('logs-pagination');
    const pageNumbers = document.getElementById('logs-page-numbers');
    const prevBtn = document.getElementById('logs-prev-page');
    const nextBtn = document.getElementById('logs-next-page');

    if (!container || totalPages <= 1) {
        if (container) container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    pageNumbers.innerHTML = '';

    // Generate page buttons
    const pages = generatePageNumbers(currentPage, totalPages);
    pages.forEach(page => {
        const btn = document.createElement('button');
        btn.setAttribute('class', 'page-btn' + (page === currentPage ? ' active' : '') + (page === '...' ? ' ellipsis' : ''));
        btn.textContent = page;
        if (page !== '...') {
            btn.onclick = () => {
                logsCurrentPage = parseInt(page);
                updateLogsList();
            };
        }
        pageNumbers.appendChild(btn);
    });

    // Update prev/next button states
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    prevBtn.onclick = () => { logsCurrentPage--; updateLogsList(); };
    nextBtn.onclick = () => { logsCurrentPage++; updateLogsList(); };
}

/**
 * Renders pagination controls for the database table.
 */
function renderDbPagination(currentPage, totalPages) {
    const container = document.getElementById('db-pagination');
    const pageNumbers = document.getElementById('db-page-numbers');
    const prevBtn = document.getElementById('db-prev-page');
    const nextBtn = document.getElementById('db-next-page');

    if (!container || totalPages <= 1) {
        if (container) container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    pageNumbers.innerHTML = '';

    // Generate page buttons
    const pages = generatePageNumbers(currentPage, totalPages);
    pages.forEach(page => {
        const btn = document.createElement('button');
        btn.setAttribute('class', 'page-btn' + (page === currentPage ? ' active' : '') + (page === '...' ? ' ellipsis' : ''));
        btn.textContent = page;
        if (page !== '...') {
            btn.onclick = () => {
                dbCurrentPage = parseInt(page);
                updateDatabaseList();
            };
        }
        pageNumbers.appendChild(btn);
    });

    // Update prev/next button states
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    prevBtn.onclick = () => { dbCurrentPage--; updateDatabaseList(); };
    nextBtn.onclick = () => { dbCurrentPage++; updateDatabaseList(); };
}

/**
 * Generates an array of page numbers to display, with ellipsis for long ranges.
 * e.g., [1, 2, 3, '...', 10] or [1, '...', 5, 6, 7, '...', 20]
 */
function generatePageNumbers(current, total) {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => i + 1);
    }

    const pages = [];
    pages.push(1);

    if (current > 3) {
        pages.push('...');
    }

    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);

    for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
    }

    if (current < total - 2) {
        pages.push('...');
    }

    if (!pages.includes(total)) pages.push(total);

    return pages;
}

// Dynamically tags children of a flex container by their visual row so CSS can round outer edges
function updateButtonRows(container) {
    if (!container) return;
    const items = Array.from(container.children).filter(el => el.style.display !== 'none' && el.offsetParent !== null);

    // Wipe existing row classes
    items.forEach(el => el.classList.remove('first-in-row', 'last-in-row', 'only-in-row', 'middle-in-row'));
    if (items.length === 0) return;

    // Group by offsetTop (±5px fuzzy for subpixel zoom)
    const rows = {};
    items.forEach(el => {
        const top = el.offsetTop;
        const existingKey = Object.keys(rows).find(k => Math.abs(parseInt(k) - top) < 5);
        if (existingKey) {
            rows[existingKey].push(el);
        } else {
            rows[top] = [el];
        }
    });

    const rowArrays = Object.values(rows);
    rowArrays.sort((a, b) => a[0].offsetTop - b[0].offsetTop);

    rowArrays.forEach((rowItems, index) => {
        if (rowItems.length === 1) {
            rowItems[0].classList.add(index === 0 ? 'only-in-row' : 'middle-in-row');
        } else {
            rowItems[0].classList.add('first-in-row');
            rowItems[rowItems.length - 1].classList.add('last-in-row');
        }
    });
}

function populateCourseButtons() {
    const courseButtonsContainer = document.getElementById('course-buttons-container');
    if (!courseButtonsContainer) return;

    if (!isSignedIn) {
        courseButtonsContainer.style.display = 'none';
        return;
    } else {
        courseButtonsContainer.style.display = 'flex';
    }

    let coursesToDisplay = availableCourses;

    // For global admins, add the guest course if they're visiting one
    if (isGlobalAdmin && guestCourse && !coursesToDisplay.includes(guestCourse)) {
        coursesToDisplay = [...coursesToDisplay, guestCourse];
    }

    // Filter out archived courses, but keep the guestCourse if it's an archived one being visited
    coursesToDisplay = coursesToDisplay.filter(c => !courseInfoMap[c]?.archived || c === guestCourse);

    // Newest academic year first, Summer → Spring → Fall, then by course number
    coursesToDisplay.sort((a, b) => compareCoursesForDisplay([a, courseInfoMap[a]], [b, courseInfoMap[b]]));

    const buttons = coursesToDisplay.map(course => {
        const code = getCleanCourseCode(course, courseInfoMap[course]?.eisId);
        const repeated = coursesToDisplay.some(other => other !== course && getCleanCourseCode(other) === code);
        const offering = repeated ? String(courseInfoMap[course]?.eisId || courseInfoMap[course]?.startDate || course) : '';
        return { course, code, offering, guest: course === guestCourse };
    });

    // The row stays mounted while the courses are unchanged; only the selection moves,
    // so the selected tab's icon can close smoothly.
    const signature = JSON.stringify(buttons);
    if (courseButtonsContainer.dataset.signature !== signature || !courseButtonsContainer.children.length) {
        courseButtonsContainer.dataset.signature = signature;
        courseButtonsContainer.innerHTML = '';
        buttons.forEach(({ course, code, offering, guest }) => {
            const button = document.createElement('div');
            button.setAttribute('class', 'course-button');
            button.setAttribute('role', 'button');
            button.tabIndex = 0;
            button.dataset.course = course;

            // Mark guest courses visually
            if (guest) button.classList.add('btn-orange');

            button.innerHTML = `<i class="fa-solid fa-table-list fa-fw course-button-icon" aria-hidden="true"></i><span class="course-button-label">${escapeHtml(code)}${offering ? `<small class="course-offering-id">${escapeHtml(offering)}</small>` : ''}</span>`;
            button.title = course.replace(/_/g, ' ');
            button.addEventListener('click', () => selectCourseButton(course));
            courseButtonsContainer.appendChild(button);
        });
    }
    courseButtonsContainer.querySelectorAll('.course-button').forEach(button => {
        const selected = button.dataset.course === currentCourse;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-pressed', String(selected));
    });

    if (!currentCourse && coursesToDisplay.length > 0) {
        selectCourseButton(coursesToDisplay[0]);
    }

    // Apply row-aware rounding after buttons are in the DOM
    requestAnimationFrame(() => updateButtonRows(courseButtonsContainer));

    // Attach a ResizeObserver so rows re-compute on resize
    if (!courseButtonsContainer._rowObserver) {
        courseButtonsContainer._rowObserver = new ResizeObserver(() => updateButtonRows(courseButtonsContainer));
        courseButtonsContainer._rowObserver.observe(courseButtonsContainer);
        // The selected tab changes width as its icon closes; re-tag the rows once it settles.
        courseButtonsContainer.addEventListener('transitionend', (event) => {
            if (event.propertyName !== 'width' || !event.target.classList?.contains('course-button-icon')) return;
            updateButtonRows(courseButtonsContainer);
            const active = courseButtonsContainer.querySelector('.course-button.active');
            if (active && courseButtonsContainer.scrollWidth > courseButtonsContainer.clientWidth) {
                active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }
        });
    }
}

function selectCourseButton(course) {
    // Give instant visual feedback by updating classes immediately
    document.querySelectorAll('#course-buttons-container .course-button').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.remove('selecting');
        btn.setAttribute('aria-pressed', 'false');
        if (btn.dataset.course === course) {
            btn.classList.add('selecting'); // Add selecting feedback
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            // Remove selecting class after a short delay
            setTimeout(() => btn.classList.remove('selecting'), 150);
        }
    });

    renderSessionControls(course);

    // Do nothing more if the course is already selected
    if (currentCourse === course && window.location.hash === `#${course}`) {
        return;
    }
    // Now, proceed with the hash change which will trigger the data load
    window.location.hash = course;
}

/**
 * Initializes the Cat Companion with optimized logic.
 * Features: Accessibility, No-Flicker text swapping, uniqueness check.
 */
function setupCatCompanion() {
    const cat = document.getElementById('cat-companion');
    const bubble = document.getElementById('cat-speech-bubble');
    if (!cat || !bubble || cat.dataset.initialized === "true") return;

    // Accessibility: Make it interactive for keyboard users
    cat.setAttribute('role', 'button');
    cat.setAttribute('tabindex', '0');
    cat.setAttribute('aria-label', 'Cat Companion: Click for a message');

    let bubbleTimeout;
    let animationTimeout;
    let lastIndex = -1;

    // Add your custom messages here
    const messages = [
        // --- 🐱 Generic & Lazy (The Personality) ---
        "I see you have a deadline. I, too, have a deadline... for my next nap. 😴",
        "Have you tried turning it off and on again? Or just walking away? 💻",
        "I am not lazy, I am on energy-saving mode.",
        "Stop clicking me. I am not a mouse. 🐭",
        "My code compiles. Your attendance... remains to be seen.",
        "I’m just here for the digital warmth of your CPU.",
        "System Status: Purring. Attendance Status: Pending.",
        "If I fits, I sits. If you scans, you stands.",
        "Don't mind me, just debugging your life choices.",
        "I accept payment in tuna or verified attendance. 🐟",

        // --- 🏫 Attendance & Scanning (The Core Function) ---
        "Did you scan your ID? Or are we pretending to be present today?",
        "8:40 AM classes are a crime against nature. But you still have to go.",
        "I calculate a 99% probability that you'd rather be sleeping.",
        "Tap the card. Hear the beep. Go to sleep. Repeat. 🔁",
        "Your attendance percentage is looking... interesting.",
        "Attendance is mandatory. My approval is optional.",
        "I am watching the database. Always watching. 👁️",
        "You are here. But are you *mentally* here?",
        "Missing one lecture is a slippery slope to missing the semester.",
        "Scanning in for a friend? I saw nothing... or did I? 🕵️",

        // --- 📝 Absences & Excuses (The "Excuse" Page Logic) ---
        "Calling in sick? I hope you have a doctor's note, or at least a good story.",
        "The 'Car broke down' excuse again? A classic.",
        "I see you're requesting permission. I grant you permission to pet me.",
        "Justifying an absence requires art. And a PDF attachment.",
        "Was it really a 'medical emergency' or just a 'Netflix marathon'?",
        "I don't judge your absences. The algorithm does that for me.",
        "Submitting a request... fingers crossed the professor is in a good mood.",
        "If you miss the Lab, you miss the fun. And the grades.",

        // --- 🎓 University Life (Coffee & Exams) ---
        "Po vjen koha e kafes. ☕",
        "Is it time for Macchiato yet?",
        "That's a lot of reading material. Have you considered absorbing it via osmosis?",
        "Exams are coming. Panic is optional.",
        "Grades, attendance, sleep. Pick two.",
        "I suggest we pause this 'studying' for a quick snack break.",
        "The library is for sleeping, right?",
        "Engineering is hard. Napping is easy.",
        "Calculus? I prefer Cat-culus.",
        "Stressing about the GPA won't help. Scanning your ID might.",

        // --- 🇦🇱 Local Flavour ---
        "What did Bereqet cook today?",
        "Trafiku i Tiranës... say no more.",
        "Gati për mësim?",
    ];

    const triggerCatInteraction = () => {
        // --- Easter Egg Logic (1 in 100 chance) ---
        const chance = 10000;
        const randomNumber = Math.floor(Math.random() * chance);

        if (randomNumber === 0) {
            window.open('https://youtu.be/dQw4w9WgXcQ', '_blank');
            return;
        }

        // 2. Get Unique Message
        let randomIndex;
        do {
            randomIndex = Math.floor(Math.random() * messages.length);
        } while (randomIndex === lastIndex && messages.length > 1);
        lastIndex = randomIndex;

        const text = messages[randomIndex];

        // 3. Smart Duration Calculation
        // Base time (3s) + 50ms per character. 
        // Example: "Hello" = 3.2s. "Long sentence..." = 6-8s. Max cap 12s.
        const readTime = Math.min(Math.max(3000, text.length * 60), 12000);

        // 4. Clear ANY pending hide timers immediately
        clearTimeout(bubbleTimeout);
        clearTimeout(animationTimeout);

        // 5. Update Bubble
        if (bubble.classList.contains('visible')) {
            // Instant swap if already open
            bubble.textContent = text;
            startHideTimer(readTime);
        } else {
            // Pop-in animation if closed
            animationTimeout = setTimeout(() => {
                bubble.textContent = text;
                bubble.classList.add('visible');
            }, 50);
            startHideTimer(readTime);
        }
    };

    const startHideTimer = (duration) => {
        bubbleTimeout = setTimeout(() => {
            bubble.classList.remove('visible');
        }, duration);
    };

    // Click Handler
    cat.addEventListener('click', (event) => {
        event.stopPropagation();
        triggerCatInteraction();
    });

    // Keyboard Handler
    cat.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            triggerCatInteraction();
        }
    });

    // Close on Outside Click
    document.addEventListener('click', (event) => {
        if (bubble.classList.contains('visible') && !cat.contains(event.target)) {
            clearTimeout(bubbleTimeout); // Stop the timer so it doesn't fire later
            bubble.classList.remove('visible');
        }
    });
}

// Direct visits wait for page load; the website loader may arrive after it.
// Keep startup single-use in either case.
let standoStarted = false;
function startStando() {
    if (standoStarted) return;
    standoStarted = true;
    init();
    document.getElementById('stando-startup-theme')?.remove();
    if (!supabaseClient) {
        showMainContent();
        loginBtn.disabled = true;
        showNotification('error', 'Connection Library Unavailable', 'The sign-in library could not load. Check your connection and reload this page.');
        return;
    }
    initGoogleApi();
}

if (document.readyState === 'complete') startStando();
else window.addEventListener('load', startStando, { once: true });

function getRouteCourse() {
    try { return decodeURIComponent(window.location.hash.slice(1)); }
    catch { return window.location.hash.slice(1); }
}
