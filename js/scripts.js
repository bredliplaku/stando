// Config
let isAdmin = false;
let isGlobalAdmin = false;
let adminCourses = [];
// Courses where a teaching assistant records attendance; they are students everywhere else.
let assistantCourses = [];
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
if (currentDbSort.startsWith('uid-')) currentDbSort = 'name-asc'; // The Hardware UID column is gone.
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
let signedOutCard = null; // The last card read on the sign-in page: { name }, empty when unregistered
let courseIDMap = {}; // Object to store course information - name to ID mapping
let courseInfoMap = {};
// Study programmes [{ id, code, name, archived }], sorted by code; null until they
// load (or when they cannot), which hides them.
let programmeList = null;
let dbProgrammeFilter = ''; // Student List: '' for all, 'none', or a programme id
let courseDictionary = {};
let loadingTasks = new Set(['session', 'auth', 'courses', 'database']);
let cooldownUIDs = new Set();
let nfcAbortController = null;
let guestCourse = null; // Track the course global admin is "visiting" but not officially admin of
let globalNotificationCount = 0;
let myNotificationCount = 0;

// Auto syncing
let autoSyncInterval = null;
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
// The letter last picked (A, B…): another category that has it keeps it.
let preferredSessionGroup = null;
let sessionControlsCourse = null; // The course the group buttons were last drawn for
// Each course's last group ("Theory B"), so coming back to a course returns to it.
const COURSE_SESSIONS_KEY = 'stando_course_sessions';
let currentCourseSections = {}; // Parsed structure

// Pagination State
let logsCurrentPage = 1;
let dbCurrentPage = 1;
const ITEMS_PER_PAGE = 25; // Number of items per page

// DOM Elements
let tabs, tabContents, importExcelBtn, excelInput, filterInput, sortSelect,
    dbFilterInput, importBtn, importInput, exportBtn, clearBtn, addLogBtn,
    addEntryBtn, exportExcelBtn, clearDbBtn, logsTbody, databaseTbody,
    emptyLogs, emptyDatabase, filteredCount, dbEntryCount,
    notificationArea, successSound, errorSound,
    syncStatus, syncText, loginBtn, logoutBtn, loginContainer,
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

    const nameVal = isEdit ? (staffData.name || '') : '';
    const emailVal = isEdit ? staffData.email : '';
    const uidVal = isEdit ? staffData.uid : '';
    // An empty name or photo shows the one from their Google account, once they have signed in.
    const googleName = isEdit ? (staffData.googleName || '') : '';
    const namePlaceholder = googleName || 'From their Google account';
    const photoVal = isEdit ? (staffData.photoUrl || '') : '';
    const googlePhoto = isEdit ? (staffData.googlePhoto || '') : '';

    // Default to 'Lecturer' if adding new
    const roleVal = isEdit ? staffRole(staffData.role) : 'Lecturer';

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${title}</h3>
        <div class="dialog-content">

            <div class="form-group">
                <label class="dialog-label-fixed" for="staff-name">Name</label>
                <input type="text" id="staff-name" class="form-control" placeholder="${escapeHtml(namePlaceholder)}" value="${escapeHtml(nameVal)}" autocomplete="off">
            </div>
            <p class="form-hint">Leave empty to use the name from their Google account. Enter a name to add a title or change it.</p>

            <div class="form-group">
                <label class="dialog-label-fixed" for="staff-photo">Photo</label>
                <div class="staff-photo-field">
                    <span id="staff-photo-preview" class="user-avatar staff-photo-preview" aria-hidden="true"></span>
                    <input type="url" id="staff-photo" class="form-control" inputmode="url" maxlength="1000" placeholder="https://… (from their Google account)" value="${escapeHtml(photoVal)}" autocomplete="off">
                </div>
            </div>
            <p class="form-hint" id="staff-photo-hint">Leave empty to use the photo from their Google account, or paste the address of a photo.</p>

            <div class="form-group">
                <label class="dialog-label-fixed" for="staff-email">Email <span class="required">*</span></label>
                <input type="email" id="staff-email" class="form-control" placeholder="nsurname@epoka.edu.al" value="${escapeHtml(emailVal)}">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="staff-role">Role</label>
                <select id="staff-role" class="form-control">
                    <option value="Global" ${roleVal === 'Global' ? 'selected' : ''}>Administrator</option>
                    <option value="Lecturer" ${roleVal === 'Lecturer' ? 'selected' : ''}>Lecturer</option>
                    <option value="Assistant" ${roleVal === 'Assistant' ? 'selected' : ''}>Teaching Assistant</option>
                </select>
            </div>
            <p class="form-hint"><strong>Lecturer:</strong> can log in on trusted devices only and manages their courses. <strong>Teaching Assistant:</strong> a student who scans and adds records in the courses assigned to them in a course's settings; everywhere else they are a student. Their card signs them in only on a device they trusted in their profile.</p>

            ${cardFieldsHtml('staff-card', splitCardValue(uidVal))}

            <div id="staff-nfc-status" style="margin-top:10px;"></div>
        </div>
        <div class="dialog-actions">
            <button type="button" id="cancel-staff-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button type="button" id="save-staff-btn" class="btn-green"><i class="fa-solid fa-check"></i> ${btnText}</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // A staff card is stored once: its UID when Use UID is on, else its Card ID.
    const card = bindCardFields(dialog.querySelector('[data-card-fields]'), {
        statusContainer: dialog.querySelector('#staff-nfc-status'), cardLabel: 'STAFF ID CARD'
    });

    // The preview shows the photo that will be used: the address, else the Google
    // photo, else initials. A photo that does not load says so under the field.
    const nameInput = dialog.querySelector('#staff-name');
    const photoInput = dialog.querySelector('#staff-photo');
    const photoPreview = dialog.querySelector('#staff-photo-preview');
    const photoHint = dialog.querySelector('#staff-photo-hint');
    const photoHintText = photoHint.textContent;
    const renderPhotoPreview = () => {
        const custom = photoInput.value.trim();
        const shownName = nameInput.value.trim() || googleName || dialog.querySelector('#staff-email').value.trim();
        const valid = !custom || /^https:\/\/\S+$/i.test(custom);
        photoInput.setAttribute('aria-invalid', String(!valid));
        photoHint.classList.toggle('is-error', !valid);
        photoHint.textContent = valid ? photoHintText : 'Use an address that starts with https://.';
        photoPreview.innerHTML = avatarContentHtml(shownName, valid && custom ? custom : googlePhoto);
        const img = photoPreview.querySelector('img');
        if (img && custom && valid) {
            img.addEventListener('error', () => {
                photoHint.classList.add('is-error');
                photoHint.textContent = 'This photo could not be loaded. Check the address.';
            }, { once: true });
        }
    };
    renderPhotoPreview();
    photoInput.addEventListener('input', renderPhotoPreview);
    nameInput.addEventListener('input', renderPhotoPreview);

    const close = () => {
        cardScanSession?.controller?.abort();
        document.body.removeChild(dialogBackdrop);
    };
    dialog.querySelector('#cancel-staff-btn').onclick = close;

    dialog.querySelector('#save-staff-btn').onclick = async (e) => {
        const name = document.getElementById('staff-name').value.trim();
        const email = document.getElementById('staff-email').value.trim();
        const role = document.getElementById('staff-role').value;
        const photoUrl = photoInput.value.trim();
        const btn = e.currentTarget;

        // The name and photo are optional: empty means the one from their Google account.
        const emailInput = document.getElementById('staff-email');
        clearInputError(emailInput);
        let isValid = true;
        if (!isValidEmail(email)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        if (!card.validate()) isValid = false;
        if (!isValid) return;
        if (photoUrl && !/^https:\/\/\S+$/i.test(photoUrl)) {
            showNotification('error', 'Invalid Photo', 'The photo address must start with https://.');
            photoInput.focus();
            return;
        }

        const save = async () => {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
            try {
                const payload = {
                    actionType: isEdit ? 'edit' : 'add',
                    name, email, uid: card.uid() || card.cardId(), role
                };
                if (isEdit) payload.rowIndex = staffData.rowIndex;
                if (photoUrl !== photoVal) payload.photoUrl = photoUrl;

                await callWebApp('manageStaff_Admin', payload, 'POST');

                showNotification('success', 'Success', `Staff member ${isEdit ? 'updated' : 'added'}.`);

                dialogBackdrop.remove();
                refreshOpenSettings();
            } catch (err) {
                showNotification('error', 'Error', err.message);
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-check"></i> ${btnText}`;
            }
        };
        confirmUidRemoval([card], save);
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
* The group picker of the Add Manual Log and bulk dialogs: the categories, then the
* letters, as group tracks like the main screen's (segmentButtonHtml). An inherit
* option, when named, takes the first line of the category track.
* @param {string} prefix - ID prefix.
* @param {string} inheritLabel - The inherit option's label, or '' for none.
*/
function renderSessionSelectorHTML(prefix, inheritLabel = '') {
    if (!currentCourse || !courseInfoMap[currentCourse]) return '';

    const categories = Object.keys(parseAvailableSections(courseInfoMap[currentCourse].availableSections || ''));
    if (categories.length === 0) return '';

    const inherit = inheritLabel ? segmentButtonHtml('data-val="INHERIT"', 'fa-clock-rotate-left', inheritLabel) : '';
    const options = categories.map(cat =>
        segmentButtonHtml(`data-val="${escapeHtml(cat)}"`, SESSION_ICONS[cat.toLowerCase()] || 'fa-tag', cat)).join('');

    return `
    <div id="${prefix}-session-wrapper" class="segment-rows">
        <input type="hidden" id="${prefix}-selected-session" value="">
        <div id="${prefix}-cat-row" class="segment-track">${inherit}${options}</div>
        <div id="${prefix}-grp-row" class="segment-track" hidden></div>
    </div>`;
}

/**
 * Makes a picker from renderSessionSelectorHTML work; its hidden input holds the
 * choice ("Theory B", "Lab" or INHERIT). As on the main screen, a category keeps the
 * letter last picked when it has it, and a single letter is not shown.
 * @param {string} prefix - The prefix used in renderSessionSelectorHTML.
 * @param {Object} sectionsMap - The parsed sections object.
 * @param {string} initialSession - The choice to start on; otherwise the first option.
 */
function setupSessionToggleListeners(prefix, sectionsMap, initialSession = '') {
    const input = document.getElementById(`${prefix}-selected-session`);
    const catRow = document.getElementById(`${prefix}-cat-row`);
    const grpRow = document.getElementById(`${prefix}-grp-row`);
    if (!input || !catRow || !grpRow) return;

    let category = null;
    let preferredLetter = null;

    const markTrack = (track, value, animate) => {
        track.querySelectorAll(':scope > .course-button').forEach(btn => btn.classList.toggle('active', btn.dataset.val === value));
        updateSegmentThumb(track, animate);
    };

    const select = (nextCategory, animate = true) => {
        const letters = sectionsMap[nextCategory] || [];
        if (nextCategory !== category) {
            setSegmentOptions(grpRow, letters.map(grp => segmentButtonHtml(`data-val="${escapeHtml(grp)}"`, '', grp)).join(''));
            grpRow.hidden = letters.length <= 1;
        }
        category = nextCategory;
        const letter = letters.includes(preferredLetter) ? preferredLetter : (letters[0] || '');
        markTrack(catRow, category, animate);
        markTrack(grpRow, letter, animate);
        input.value = letter ? `${category} ${letter}` : category;
    };

    const [initialCategory, initialLetter] = String(initialSession || '').split(' ');
    const options = [...catRow.querySelectorAll(':scope > .course-button')].map(btn => btn.dataset.val);
    preferredLetter = initialLetter || null;
    select(options.includes(initialCategory) ? initialCategory : options[0], false);

    catRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (btn && btn.dataset.val !== category) select(btn.dataset.val);
    });
    grpRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (!btn) return;
        preferredLetter = btn.dataset.val;
        select(category);
    });
    // Tracks drawn before the dialog is laid out place their thumbs once shown.
    [catRow, grpRow].forEach(track => watchButtonRows(track, followSegmentThumb));
}

// --- SMART VERTICAL SESSION CONTROLS ---

function renderSessionControls(courseName) {
    const controls = document.getElementById('session-controls');
    const catGroup = document.getElementById('session-category-group');

    // Only those who record attendance in the course choose its group.
    if (!courseInfoMap || !courseInfoMap[courseName] || (isSignedIn && !isAdmin && !canRecordInCourse(courseName))) {
        controls.style.display = 'none';
        document.getElementById('session-label')?.setAttribute('hidden', '');
        return;
    }

    const rawSections = courseInfoMap[courseName].availableSections || '';
    currentCourseSections = parseAvailableSections(rawSections);
    const categories = Object.keys(currentCourseSections);
    const courseChanged = courseName !== sessionControlsCourse;
    sessionControlsCourse = courseName;

    if (categories.length === 0) {
        controls.style.display = 'none';
        document.getElementById('session-label')?.setAttribute('hidden', '');
        activeSessionCategory = null;
        activeSessionGroup = null;
        return;
    }

    // Coming back to a course returns to the group last used in it.
    if (courseChanged) {
        const [savedCategory, savedGroup] = String(readCourseSessions()[courseName] || '').split(' ');
        if (categories.includes(savedCategory)) {
            activeSessionCategory = savedCategory;
            activeSessionGroup = currentCourseSections[savedCategory].includes(savedGroup) ? savedGroup : null;
            if (activeSessionGroup) preferredSessionGroup = activeSessionGroup;
        }
    }

    // 1. Auto-select Category Logic
    // If no category selected, or current one invalid, pick first
    if (!activeSessionCategory || !categories.includes(activeSessionCategory)) {
        activeSessionCategory = categories[0];
        activeSessionGroup = null; // Reset group
    }

    // 2. Render Categories (the thumb stays, so a redraw never cuts its slide short)
    catGroup.querySelectorAll(':scope > .course-button').forEach(btn => btn.remove());
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
    // Under programme headings, the sessions get one too, so they are not read as the
    // last programme's.
    const sessionLabel = document.getElementById('session-label');
    if (sessionLabel) {
        sessionLabel.hidden = controls.style.display === 'none' ||
            !document.getElementById('course-buttons-container')?.classList.contains('is-grouped');
    }

    // Apply row-aware rounding to session button containers, and again whenever they reflow;
    // each track's thumb sits under its chosen option.
    const sessionGroups = document.getElementById('session-group-container');
    requestAnimationFrame(() => {
        updateButtonRows(catGroup);
        updateButtonRows(sessionGroups);
        followSegmentThumb(catGroup);
        followSegmentThumb(sessionGroups);
    });
    const placeTrack = track => { updateButtonRows(track); followSegmentThumb(track); };
    watchButtonRows(catGroup, placeTrack);
    watchButtonRows(sessionGroups, placeTrack);
}

function selectSessionCategory(category) {
    // The letter stays when this category has it too (Theory B → Practice B).
    activeSessionCategory = category;

    // Visual Update
    const catGroup = document.getElementById('session-category-group');
    Array.from(catGroup.children).forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.category ?? btn.innerText.trim()) === category);
    });

    updateSegmentThumb(catGroup, true);
    renderGroupsForCategory(category, true);

    // Re-check parent visibility (Group row might have appeared/disappeared)
    const grpContainer = document.getElementById('session-group-container');
    const categories = Object.keys(currentCourseSections);
    const showCategories = categories.length > 1;
    const showGroups = grpContainer.style.display !== 'none';

    document.getElementById('session-controls').style.display = (showCategories || showGroups) ? 'flex' : 'none';
    rememberCourseSession();
}

// animate: the letter's thumb slides when the letter in use changes (Theory B → Lab A).
function renderGroupsForCategory(category, animate = false) {
    const groups = currentCourseSections[category] || [];
    const grpContainer = document.getElementById('session-group-container');

    // 1. Auto-select Group Logic: the letter last picked, else the one in use, else the first.
    if (groups.length > 0) {
        if (groups.includes(preferredSessionGroup)) activeSessionGroup = preferredSessionGroup;
        else if (!groups.includes(activeSessionGroup)) activeSessionGroup = groups[0];
    } else {
        activeSessionGroup = null;
    }

    // 2. Render Buttons (the thumb stays, to slide to the letter now chosen)
    grpContainer.querySelectorAll(':scope > .course-button').forEach(btn => btn.remove());

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
    requestAnimationFrame(() => {
        updateButtonRows(grpContainer);
        if (animate) updateSegmentThumb(grpContainer);
        else followSegmentThumb(grpContainer);
    });
}

const SESSION_ICONS = { theory: 'fa-book', lab: 'fa-desktop', practice: 'fa-pen-to-square' };

// One option of a group track in a dialog (.segment-track): an icon that closes away
// when chosen, and a label that keeps its bold width.
function segmentButtonHtml(attrs, icon, label) {
    return `<div class="course-button" role="button" tabindex="0" ${attrs}>${icon ? `<i class="fa-solid ${icon} tab-icon" aria-hidden="true"></i>` : ''}<span class="tab-label" data-label="${escapeHtml(label)}">${escapeHtml(label)}</span></div>`;
}

// A group track's raised part (the thumb) slides to the chosen option, matching its
// size; animate false just places it (first drawing, a resize).
function updateSegmentThumb(track, animate = true) {
    if (!track) return;
    let thumb = track.querySelector(':scope > .segment-thumb');
    if (!thumb) {
        thumb = document.createElement('span');
        thumb.className = 'segment-thumb';
        thumb.setAttribute('aria-hidden', 'true');
        track.prepend(thumb);
        animate = false;
    }
    const active = track.querySelector(':scope > :is(.course-button, .tab).active');
    if (!active || track.offsetParent === null) {
        thumb.style.opacity = '0';
        return;
    }
    thumb.classList.toggle('no-slide', !animate || thumb.style.opacity !== '1');
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.height = `${active.offsetHeight}px`;
    thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    thumb.style.opacity = '1';
    if (thumb.classList.contains('no-slide')) {
        void thumb.offsetWidth;
        thumb.classList.remove('no-slide');
    }
}

// Places a track's thumb after a redraw or a resize. One already sliding slides on to
// its option's new place (an icon closing moves the options), never cut short.
function followSegmentThumb(track) {
    const thumb = track?.querySelector(':scope > .segment-thumb');
    updateSegmentThumb(track, !!thumb?.getAnimations().length);
}

// New options for a group track; its thumb stays, to slide to the next one chosen.
function setSegmentOptions(track, html) {
    track.querySelectorAll(':scope > .course-button').forEach(btn => btn.remove());
    track.insertAdjacentHTML('beforeend', html);
}

function selectSessionGroup(group) {
    activeSessionGroup = group;
    preferredSessionGroup = group;
    const grpContainer = document.getElementById('session-group-container');
    Array.from(grpContainer.children).forEach(btn => {
        if (btn.innerText.trim() === group) btn.classList.add('active');
        else btn.classList.remove('active');
    });
    updateSegmentThumb(grpContainer, true);
    rememberCourseSession();
}

function readCourseSessions() {
    try { return JSON.parse(localStorage.getItem(COURSE_SESSIONS_KEY)) || {}; } catch { return {}; }
}

function rememberCourseSession() {
    if (!sessionControlsCourse || !activeSessionCategory) return;
    const sessions = readCourseSessions();
    sessions[sessionControlsCourse] = getCurrentActiveSession();
    try { localStorage.setItem(COURSE_SESSIONS_KEY, JSON.stringify(sessions)); } catch { /* Not remembered. */ }
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
    dialog.setAttribute('role', 'dialog');

    dialog.innerHTML = `
    <div class="settings-modal-header">
        <h3 style="margin:0;"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i> Request History</h3>
        <button type="button" id="close-hist-btn" class="btn-icon icon-only-btn" title="Close" aria-label="Close history"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>
    <div class="dialog-content" style="overflow-y:auto; padding-top:0;">

        <div class="filter-container history-filter-bar list-toolbar">
            <div class="search filter-search">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input type="search" id="hist-search" class="filter-input" placeholder="Search" title="Search by name, course, date or reason" aria-label="Search requests by name, course, date or reason">
            </div>
            <label class="icon-select" title="Status">
                <i class="fa-solid fa-filter" aria-hidden="true"></i>
                <select id="hist-filter-status" class="sort-dropdown" aria-label="Filter by status">
                    <option value="All">All requests</option>
                    <option value="Pending">Pending</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                </select>
            </label>
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
                    getCourseTitle(req.course), programmeCode(studentProgrammeId(req.studentEmail)),
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
                // The status in its colour (styles.css, .request-status).
                const status = req.status === 'Approved' || req.status === 'Rejected' ? req.status : 'Pending';
                const statusBadge = `<span class="request-status is-${status.toLowerCase()}">${status}</span>`;

                // --- Session Badge ---
                let sessionBadge = '';
                if (req.session && req.session !== 'Default') {
                    sessionBadge = `<span class="session-badge">${escapeHtml(req.session)}</span>`;
                }

                return `
        <div class="request-list-item clickable-hist-row">
            <div style="flex-grow:1;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <span><strong>${escapeHtml(req.studentName)}</strong>${programmeById(studentProgrammeId(req.studentEmail)) ? ` ${programmeBadgeHtml(studentProgrammeId(req.studentEmail))}` : ''}</span>
                    ${statusBadge}
                </div>
                <div class="meta-parts request-meta">
                    ${courseCellHtml(req.course, sessionBadge ? ` ${sessionBadge}` : '')}
                    <span>${escapeHtml(req.absenceDate)}</span>
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

    // Five rows built from the list's own cells, so they lay out as its rows do at
    // every width: the name, the date, each group's label and times (empty pills the
    // size of a time) and, for the course's admins, Edit and ⋯.
    const timeRow = count => `<div class="time-row"><span class="cat-label"><span class="skeleton-bar skeleton-label"></span></span>` +
        `<div class="pills-wrapper">${'<span class="time-tag skeleton-pill">00:00</span>'.repeat(count)}</div></div>`;
    const actionsCell = canRecordInCourse(currentCourse)
        ? '<td class="actions-cell"><div class="actions-cell-content card-actions"><span class="skeleton-bar skeleton-edit"></span><span class="skeleton-bar skeleton-menu"></span></div></td>'
        : '';
    const selectCell = isBulkMode ? '<td class="select-column"></td>' : '';
    tbody.innerHTML = [[2, 2], [2, 1], [2], [1, 2], [2, 2]].map(groups => `
        <tr class="skeleton-row" aria-hidden="true">
            ${selectCell}<td class="name-cell name-column"><span class="skeleton-bar skeleton-name"></span></td><td class="date-cell date-column"><span class="skeleton-bar skeleton-date"></span></td><td class="times-cell times-cell-stacked">${groups.map(timeRow).join('')}</td>${actionsCell}</tr>`).join('');

    const countEl = document.getElementById('filtered-count');
    if (countEl) countEl.textContent = 'Loading…';
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
        assistantCourses = result.assistantCourses || [];

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

// A teaching assistant's course: they scan, add records, and add or delete
// times on the records they made. Nothing else of a lecturer's.
function isAssistantForCourse(courseName) {
    return !!courseName && !isAdminForCourse(courseName) && assistantCourses.includes(courseName);
}

function canRecordInCourse(courseName) {
    return !!courseName && (isAdminForCourse(courseName) || assistantCourses.includes(courseName));
}

function canRecordAnywhere() {
    return isAdmin || assistantCourses.length > 0;
}

// Whether a record was made by the signed-in account (an assistant acts only on those).
function isOwnLog(log) {
    return !!currentUser?.email && String(log?.updatedBy || '').toLowerCase() === currentUser.email.toLowerCase();
}

/**
 * Finds and removes all data related to this app from localStorage.
 */
function clearAllAppData() {
    const keysToRemove = [];
    // Find all keys used by this application.
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('attendance_') || key.startsWith('sb-') || key.startsWith('eis_pref_') || key.startsWith(SCAN_LOCK_KEY) || [KIOSK_MODE_KEY, COLOUR_THEME_KEY, COURSE_SESSIONS_KEY, 'theme', 'logs_sort', 'db_sort', 'last_active_course', 'stando_view'].includes(key)) {
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

// The sign-in page's answer to a card, for a few seconds; the next card replaces it.
function showSignedOutCard(card) {
    signedOutCard = card;
    updateAuthUI();
    clearTimeout(showSignedOutCard.timer);
    if (card) {
        showSignedOutCard.timer = setTimeout(() => {
            if (signedOutCard !== card) return;
            signedOutCard = null;
            document.getElementById('not-signed-in-message')?.remove();
        }, 8000);
    }
}

// One pill in both places. Signed out, it sits in the sign-in card and a staff
// card signs in; signed in, it takes attendance.
function scanButtonHtml() {
    const icon = '<span class="scan-btn-icon" aria-hidden="true"><i class="fa-solid fa-wifi fa-rotate-90"></i></span>';
    if (isScanning) return `${icon}<span class="scan-btn-label">Scanning…<small>Tap to stop</small></span>`;
    return `${icon}<span class="scan-btn-label">${isSignedIn ? 'Start Scanning' : 'Scan Card'}</span>`;
}

// Rewrites the button only when its content changes, so its icon is not redrawn needlessly.
function renderScanButton() {
    const scanBtn = document.getElementById('scan-button');
    if (!scanBtn) return;
    scanBtn.classList.toggle('is-scanning', isScanning);
    // Waiting for a card on the sign-in page: show how to hold it.
    const art = document.querySelector('.scan-wait-art');
    if (art) {
        const waiting = !isSignedIn && isScanning;
        if (waiting && !art.firstElementChild) art.innerHTML = cardTapAnimationHtml();
        art.hidden = !waiting;
    }
    const html = scanButtonHtml();
    if (scanBtn._shownHtml !== html) {
        scanBtn._shownHtml = html;
        scanBtn.innerHTML = html;
    }
}

// Signed out, the scan button moves into the sign-in card; signed in, it goes back above
// Scan History, and above the requests lists that open there.
function placeScanButtons() {
    const scanButtons = document.querySelector('.scan-buttons');
    const signinNote = document.querySelector('#login-container .signin-note');
    const anchor = document.getElementById('admin-views-container') || document.getElementById('scanner-tab');
    if (!scanButtons || !signinNote || !anchor) return;
    if (!isSignedIn && scanButtons.nextElementSibling !== signinNote) signinNote.before(scanButtons);
    else if (isSignedIn && scanButtons.nextElementSibling !== anchor) anchor.before(scanButtons);
    renderScanButton();
}

// Pending requests sit in the top bar after the sync status, and only while there are
// some: Permissions (amber) and New cards (blue), each with its count. A chip opens its
// list above the course's records (toggleAdminView).
function updateAdminDashboardBar(absencesCount, registrationsCount, isLoading = false, myAbsencesCount = absencesCount) {
    const bar = document.getElementById('admin-dashboard-bar');

    // 1. Force Clean State if not global admin
    if (!isGlobalAdmin) {
        const regView = document.getElementById('pending-registrations-view');
        if (regView) regView.classList.remove('expanded');
    }

    if (!bar) return;
    if (!isAdmin) {
        bar.hidden = true;
        bar.innerHTML = bar._html = '';
        return;
    }

    // While the counts are fetched, the chips stay as they are.
    if (isLoading) return;

    // Auto-drive filter state based on counts
    if (isGlobalAdmin && adminCourses.length > 0) {
        hideOtherCourseAbsences = myAbsencesCount > 0;
        const filterBtn = document.getElementById('absence-filter-btn');
        if (filterBtn) {
            filterBtn.style.display = absencesCount > myAbsencesCount ? '' : 'none';
            syncAbsenceFilterBtn();
        }
    }

    const chip = (id, viewId, icon, label, title, count, tone) => {
        const open = !!document.getElementById(viewId)?.classList.contains('expanded');
        return `<button type="button" id="${id}" class="request-chip ${tone}${open ? ' active' : ''}" aria-controls="${viewId}" aria-expanded="${open}" title="${title}" aria-label="${title}: ${count}" onclick="toggleAdminView('${viewId}')">` +
            `<i class="fa-solid ${icon}" aria-hidden="true"></i><span class="request-chip-label">${label}</span><span class="request-chip-count">${count}</span></button>`;
    };

    let html = '';
    if (absencesCount > 0) {
        // Requests only in other lecturers' courses show quietly, with their count.
        html += myAbsencesCount > 0
            ? chip('chip-absences', 'pending-absences-view', 'fa-hand-point-up', 'Permissions', 'Permission requests', myAbsencesCount, 'is-permission')
            : chip('chip-absences', 'pending-absences-view', 'fa-hand-point-up', 'Permissions', 'Permission requests in other courses', absencesCount, 'is-quiet');
    }
    if (registrationsCount > 0 && isGlobalAdmin) {
        html += chip('chip-registrations', 'pending-registrations-view', 'fa-id-card', 'New cards', 'New cards to approve', registrationsCount, 'is-card');
    }

    // Redrawn only when something changed, so a refresh does not replay the chips' entrance.
    if (bar._html !== html) {
        bar._html = html;
        bar.innerHTML = html;
    }
    bar.hidden = !html;
}

// Opens or closes a requests list (open: true/false, or toggles), and its chip with it.
function toggleAdminView(viewId, open) {
    const view = document.getElementById(viewId);
    if (!view) return;

    const expand = typeof open === 'boolean' ? open : !view.classList.contains('expanded');
    view.classList.toggle('expanded', expand);
    const chip = document.querySelector(`#admin-dashboard-bar [aria-controls="${viewId}"]`);
    if (chip) {
        chip.classList.toggle('active', expand);
        chip.setAttribute('aria-expanded', String(expand));
    }
    if (expand) setTimeout(() => view.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 300);
}


/**
 * Adds a new log entry one hour after the latest existing entry for a group.
 * @param {Object} group - The log group to add the time to.
 */
function addPlusOneHourLog(group) {
    if (!canRecordInCourse(currentCourse)) return;
    // An assistant adds to their own times only.
    const logs = isAssistantForCourse(currentCourse) ? group.originalLogs.filter(isOwnLog) : group.originalLogs;
    if (!logs.length) return;

    // Find the full log object with the latest timestamp
    const latestLog = logs.reduce((prev, current) =>
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

    if (isOnline && isSignedIn) {
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

            // The Student List has no course: its class hides the course buttons,
            // groups and scan button (see the stylesheet), and scanning stops.
            document.body.classList.toggle('on-student-list', tabId === 'database-tab');
            if (tabId === 'database-tab') {
                if (isScanning) stopScanning();
            } else if (courseButtons) {
                courseButtons.style.display = isSignedIn ? 'flex' : 'none';
                if (currentCourse) renderSessionControls(currentCourse);
            }

            // Update the active state on the tab buttons
            document.querySelectorAll('.tab').forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            updateSegmentThumb(tab.parentElement);
            closeRowMenus();
            updateAppHeader();

            // Transition the content panes
            if (oldTabContent) {
                oldTabContent.classList.remove('active');
            }
            if (newTabContent) {
                newTabContent.classList.add('active');
            }
            // Show or hide the floating date bar for the tab now in view.
            updateStickyDateBar(true);
        });
    });

    // The selected tab's look slides between the tabs on a thumb. It finds its
    // place when the tabs first show or resize, and again once the chosen tab's
    // icon has closed (which changes the tabs' widths).
    const tabStrip = document.querySelector('.tabs');
    watchButtonRows(tabStrip, followSegmentThumb);
    tabStrip?.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'width' && event.target.classList?.contains('tab-icon')) followSegmentThumb(tabStrip);
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

            // A click elsewhere leaves selecting, unless something is chosen
            // (then only × or Escape does, so a stray tap never loses a selection).
            if (!isTable && !isBulkBar && !isToggleBtn && !isDialog && selectedLogIds.size === 0) {
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
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const dbSortSelect = document.getElementById('db-sort-select');

    const registerUidBtn = document.getElementById('register-uid-btn');
    if (registerUidBtn) registerUidBtn.addEventListener('click', showRegisterUIDDialog);

    // The photo and name chip opens Settings, My Courses or the profile.
    const profileChip = document.getElementById('student-profile-chip');
    if (profileChip) profileChip.addEventListener('click', () => {
        if (!isSignedIn) return;
        if (isAdmin) openSettingsDialog();
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
        if (!targetRow || !event.target.closest('.add-time-btn, .delete-log-btn, .delete-all-log-btn, .edit-log-btn')) return;

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

        // Use reliable class-based detection for button clicks. Register student
        // (unknown cards) has its own listener in updateLogsList.
        if (event.target.closest('.add-time-btn')) {
            addPlusOneHourLog(group);
        } else if (event.target.closest('.delete-log-btn')) {
            confirmDeleteLog(group);
        } else if (event.target.closest('.delete-all-log-btn')) {
            confirmDeleteAllLogs(group);
        } else if (event.target.closest('.edit-log-btn')) {
            showEditLogDialog(group);
        }
    });
    setupLogSelectionGestures();

    if (importExcelBtn) importExcelBtn.addEventListener('click', showStudentImportGuide);
    if (excelInput) excelInput.addEventListener('change', handleExcelFile);
    if (filterInput) filterInput.addEventListener('input', debounce(handleFilterChange, 300));
    if (sortSelect) sortSelect.addEventListener('change', handleSortChange);
    if (dbFilterInput) dbFilterInput.addEventListener('input', handleDbFilterChange);
    document.getElementById('db-programme-filter')?.addEventListener('change', (event) => {
        dbProgrammeFilter = event.target.value;
        dbCurrentPage = 1;
        updateDatabaseList();
    });
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
    // A tap outside a dialog closes it as its × does, when the press began outside
    // too (a text selection dragged out of a field is not a tap outside).
    let pressedOn = null;
    document.addEventListener('pointerdown', (e) => { pressedOn = e.target; }, true);
    document.addEventListener('click', (e) => {
        // 1. Backdrop click
        if (e.target.classList && e.target.classList.contains('dialog-backdrop')) {
            // Ignore if clicking on confirmation backdrop itself
            if (e.target.classList.contains('confirmation-backdrop')) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (pressedOn === e.target) dismissDialog(e.target);
            return;
        }

        // 2. Intercept Cancel / Close buttons inside any dialog (except confirmation modal)
        const confirmModal = e.target.closest('.confirmation-dialog, [role="alertdialog"]');
        if (confirmModal) return;
        // Discarding from "Save changes?" closes the dialog its own way, without asking again.
        if (e.target.closest('.dialog-backdrop')?._discarding) return;

        // Cancel and Close are the grey footer buttons (and the header's ×); a red
        // footer button is an action, such as Reject, and Back only steps back.
        const cancelBtn = e.target.closest(
            'button[id*="cancel"], button[id*="close"], button[data-action="cancel"], .dialog-close-x, ' +
            '.dialog-actions button.btn-secondary:not([data-action="back"], [id*="back"]), ' +
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
            // An open programme list closes first; its field handles the key.
            if (e.target?.closest?.('.combo.is-open')) return;
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
                dismissDialog(topBackdrop);
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
                dialogSaveButton(topBackdrop.querySelector('.dialog') || topBackdrop)?.click();
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
                    if (node.matches('select.programme-select, select.search-select')) enhanceSearchSelect(node);
                    node.querySelectorAll('select:is(.programme-select, .search-select):not([data-combo])').forEach(enhanceSearchSelect);
                    // A footer drawn anew (a dialog's next step) gives up its Cancel to the × again.
                    const host = node.closest('.dialog-backdrop');
                    if (host && host !== node) markDialogDismiss(host);
                    const backdrops = node.classList?.contains('dialog-backdrop') ? [node] : node.querySelectorAll?.('.dialog-backdrop');
                    if (backdrops && backdrops.length > 0) {
                        backdrops.forEach(addDialogCloseButton);
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
        if (input.hasAttribute('data-no-dirty')) continue;
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
        if (!backdrop || !document.body.contains(backdrop)) return;
        // Its own Cancel or Close closes it, so what it does on closing still happens.
        const dismiss = backdrop.querySelector(':scope > .dialog > .dialog-actions .is-dismiss');
        if (dismiss && !dismiss.disabled) {
            backdrop._discarding = true;
            dismiss.click();
        }
        backdrop.remove();
        closeDialogMode();
    };

    if (isDialogDirty(dialog)) {
        const save = dialogSaveButton(dialog);
        showUnsavedChangesDialog({ onSave: save && (() => save.click()), onDiscard: performClose });
        return false;
    } else {
        performClose();
        return true;
    }
}
if (typeof window !== 'undefined') window.confirmCloseDialog = confirmCloseDialog;

// "Save changes?" when a dialog with changes is closed: Save presses the dialog's
// own Save (which may still ask for something missing), Discard closes it, and
// Keep editing (or Escape) goes back to it.
function showUnsavedChangesDialog({ onSave, onDiscard }) {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop confirmation-backdrop';
    backdrop.style.zIndex = '10050';
    backdrop.innerHTML = `
        <div class="dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-text">
            <h3 class="dialog-title" id="unsaved-title">Save changes?</h3>
            <div class="dialog-content"><p id="unsaved-text">${onSave ? 'You changed something here. Save it before closing?' : 'You changed something here. Close without keeping it?'}</p></div>
            <div class="dialog-actions">
                <button type="button" class="btn-secondary" data-choice="keep">Keep editing</button>
                <button type="button" class="btn-red" data-choice="discard">Discard</button>
                ${onSave ? '<button type="button" class="btn-green" data-choice="save">Save</button>' : ''}
            </div>
        </div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (event) => {
        const choice = event.target.closest('[data-choice]')?.dataset.choice;
        if (!choice) return;
        backdrop.remove();
        closeDialogMode();
        if (choice === 'save') onSave();
        else if (choice === 'discard') onDiscard();
    });
    backdrop.querySelector('[data-choice="save"], [data-choice="discard"]').focus({ preventScroll: true });
}

// A dialog's main action (Save, Add, Submit…), for Ctrl+S and "Save changes?".
const DIALOG_SAVE = ['#save-edit-c', '#save-staff-btn', '#save-edit-log-btn', '#confirm-db-entry-btn', '#confirm-add-btn',
    '#confirm-add-log-btn', '#save-manual-log-btn', '#submit-register-btn', '#submit-request-btn', '#dialog-confirm-btn',
    '#confirm-trust-btn', '#confirm-approve-btn', '#apply-btn', '#replace-btn', '#merge-logs-btn', '#merge-db-btn',
    '#save-settings-btn', '#save-custom-btn', '#confirm-reg-btn', 'button.btn-green', 'button[type="submit"]'].join(', ');

function dialogSaveButton(dialog) {
    const button = dialog?.querySelector(`.dialog-actions :is(${DIALOG_SAVE})`);
    return button && !button.disabled && button.offsetParent !== null ? button : null;
}

// One way to close a dialog: the × in its title bar, as in Syllabase (Settings
// and the student profile have their own). A tap outside and Escape do the same.
// The footer's grey Cancel or Close steps aside for it (.is-dismiss, hidden) but
// still does the closing, so whatever a dialog does then still happens; a dialog
// with changes asks first (confirmCloseDialog). Back stays: it is a step, not a way out.
// Confirmations and the idle warning keep their explicit buttons only.
const DIALOG_DISMISS = 'button.btn-secondary:is([id*="cancel" i], [id*="close" i], [class*="cancel"], [data-action="cancel"], [data-action="close"])';

function markDialogDismiss(backdrop) {
    if (backdrop.matches('.confirmation-backdrop, .idle-backdrop')) return;
    if (!backdrop.querySelector(':scope > .dialog > :is(.dialog-title, .settings-modal-header, .sp-header) :is(.dialog-close-x, .icon-only-btn)')) return;
    backdrop.querySelectorAll(`:scope > .dialog > .dialog-actions ${DIALOG_DISMISS}`).forEach(button => button.classList.add('is-dismiss'));
}

function dismissDialog(backdrop) {
    const dismiss = backdrop.querySelector(':scope > .dialog > .dialog-actions .is-dismiss, :scope > .dialog > :is(.settings-modal-header, .sp-header) .icon-only-btn');
    if (dismiss && !dismiss.disabled) dismiss.click();
    else confirmCloseDialog(backdrop);
}

function addDialogCloseButton(backdrop) {
    if (backdrop.matches('.confirmation-backdrop, .idle-backdrop')) return;
    const title = backdrop.querySelector(':scope > .dialog > .dialog-title');
    if (title && !title.querySelector('.dialog-close-x')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dialog-close-x';
        button.title = 'Close';
        button.setAttribute('aria-label', 'Close');
        button.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            dismissDialog(backdrop);
        });
        title.appendChild(button);
    }
    markDialogDismiss(backdrop);
}

// A dialog leaves as it came: fading on a computer, sliding down on a phone.
// Code closes one by removing its backdrop, and that still happens at once; just
// before, a still copy takes its place to play the way out. The copy is inert and
// sits after <body>, so the count of open dialogs and lookups by id never meet it.
function playDialogExit(backdrop) {
    const dialog = backdrop.querySelector(':scope > .dialog');
    if (!dialog?.offsetWidth || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ghost = backdrop.cloneNode(true);
    const copy = ghost.querySelector(':scope > .dialog');
    const place = getComputedStyle(backdrop);
    const veil = getComputedStyle(backdrop, '::before');
    ghost.removeAttribute('id');
    ghost.className = 'dialog-ghost';
    ghost.inert = true;
    Object.assign(ghost.style, {
        width: `${backdrop.offsetWidth}px`, height: `${backdrop.offsetHeight}px`, zIndex: place.zIndex,
        alignItems: place.alignItems, justifyContent: place.justifyContent, padding: place.padding
    });
    ghost.style.setProperty('--ghost-veil', veil.backgroundColor);
    ghost.style.setProperty('--ghost-blur', veil.backdropFilter || veil.webkitBackdropFilter || 'none');
    // The dialog keeps its size and where each part was scrolled to.
    Object.assign(copy.style, {
        width: `${dialog.offsetWidth}px`, height: `${dialog.offsetHeight}px`,
        minHeight: '0', maxWidth: 'none', maxHeight: 'none'
    });
    const copies = ghost.querySelectorAll('*');
    const scrolled = [];
    backdrop.querySelectorAll('*').forEach((el, i) => {
        if (el.scrollTop || el.scrollLeft) scrolled.push([copies[i], el.scrollTop, el.scrollLeft]);
    });
    // A copied radio would untick its namesake still on the page.
    ghost.querySelectorAll('input[type="radio"][name]').forEach(input => input.removeAttribute('name'));
    document.documentElement.appendChild(ghost);
    scrolled.forEach(([el, top, left]) => { el.scrollTop = top; el.scrollLeft = left; });
    const done = () => ghost.remove();
    copy.addEventListener('animationend', (event) => { if (event.target === copy) done(); });
    setTimeout(done, 500);
}

// Every way of closing a dialog removes its backdrop with one of these two.
const removeElement = Element.prototype.remove;
Element.prototype.remove = function () {
    if (this.parentNode === document.body && this.classList.contains('dialog-backdrop')) {
        try { playDialogExit(this); } catch { /* It closes without its way out. */ }
    }
    return removeElement.call(this);
};
const removeChildNode = Node.prototype.removeChild;
Node.prototype.removeChild = function (child) {
    if (this === document.body && child?.parentNode === this && child.classList?.contains('dialog-backdrop')) {
        try { playDialogExit(child); } catch { /* It closes without its way out. */ }
    }
    return removeChildNode.call(this, child);
};

// Searchable selects (programmes, courses): a search box over the list. Typing
// narrows it to the best matches (see matchTier); arrows, Enter and the pointer
// choose. Options in an <optgroup> show under its label, and data-code (on an
// option or optgroup) shows in bold. The <select> stays underneath and holds the
// value, so forms read it and hear its 'change' as before.
let comboCount = 0;
function enhanceSearchSelect(select) {
    if (select.dataset.combo) return;
    select.dataset.combo = 'on';
    const id = select.id || `combo-${++comboCount}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'combo';
    select.before(wrapper);
    wrapper.appendChild(select);
    select.classList.add('combo-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `${id}-search`; // "search": the unsaved-changes check follows the select instead
    input.className = 'form-control combo-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.disabled = select.disabled;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', `${id}-options`);
    input.placeholder = select.options[0]?.value === '' ? select.options[0].textContent : '';
    const label = select.id && document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
    if (label) label.htmlFor = input.id;
    wrapper.prepend(input);
    // A magnifier says it can be typed in; the chevron that it opens.
    wrapper.insertAdjacentHTML('afterbegin', '<i class="fa-solid fa-magnifying-glass combo-search-icon" aria-hidden="true"></i>');
    wrapper.insertAdjacentHTML('beforeend', '<i class="fa-solid fa-chevron-down combo-chevron" aria-hidden="true"></i>');
    // Code that focuses the field (after a validation error) reaches the search box.
    select.focus = (options) => input.focus(options);

    const list = document.createElement('ul');
    list.className = 'combo-list';
    list.id = `${id}-options`;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    let matches = [];
    let active = -1;

    const groupOf = option => option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '';
    const groupCodeOf = option => option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.dataset.code || '' : '';
    const choices = () => [...select.options].filter(option => option.value && !option.disabled);
    // A chosen programme shows by its code (BA CE); its full name is in the list and on hover.
    const shortCode = select.classList.contains('programme-select');
    const selectedLabel = () => {
        const option = select.value ? select.selectedOptions[0] : null;
        return (shortCode && option?.dataset.code) || option?.textContent || '';
    };
    const showSelected = () => {
        input.value = selectedLabel();
        input.title = select.value ? select.selectedOptions[0]?.textContent || '' : '';
    };
    showSelected();
    const codeHtml = (text, code) => code && text.startsWith(code)
        ? `<strong>${escapeHtml(code)}</strong>${escapeHtml(text.slice(code.length))}`
        : escapeHtml(text);
    // An option: its code as a chip, its name beside it, a tick when chosen.
    const optionHtml = option => {
        const text = option.textContent;
        const code = option.dataset.code;
        const label = code && text.startsWith(code)
            ? `<span class="combo-code">${escapeHtml(code)}</span><span class="combo-name">${escapeHtml(text.slice(code.length).trim())}</span>`
            : `<span class="combo-name">${escapeHtml(text)}</span>`;
        return `${label}<i class="fa-solid fa-check combo-check" aria-hidden="true"></i>`;
    };
    const groupHtml = option => codeHtml(groupOf(option), groupCodeOf(option));

    // How well an option answers the search, 5 to 0. Only the best tier shows, so
    // "BA CE" lists BA CE (or its courses), not everything with "ba" and "ce" in it:
    // 5 its code, or its group's code, is the search; 4 its label starts with it;
    // 3 every word starts one of its words; 2 the same, counting its group's label;
    // 1 every word appears anywhere.
    const fold = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
    const wordsOf = text => fold(text).split(/[^a-z0-9]+/).filter(Boolean);
    const startsWords = (words, own) => words.every(word => own.some(part => part.startsWith(word)));
    const matchTier = (option, query, words) => {
        if (fold(option.dataset.code) === query || (groupCodeOf(option) && fold(groupCodeOf(option)) === query)) return 5;
        const label = fold(option.textContent);
        if (label.startsWith(query)) return 4;
        const own = wordsOf(option.textContent);
        if (startsWords(words, own)) return 3;
        if (startsWords(words, [...own, ...wordsOf(groupOf(option))])) return 2;
        const all = `${label} ${fold(groupOf(option))}`;
        return words.every(word => all.includes(word)) ? 1 : 0;
    };

    const place = () => {
        const rect = input.getBoundingClientRect();
        const below = window.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const up = below < 180 && above > below;
        list.style.left = `${rect.left}px`;
        list.style.width = `${rect.width}px`;
        list.style.maxHeight = `${Math.max(120, Math.min(280, up ? above : below))}px`;
        list.style.top = up ? '' : `${rect.bottom + 4}px`;
        list.style.bottom = up ? `${window.innerHeight - rect.top + 4}px` : '';
    };
    const optionItems = () => list.querySelectorAll('[role="option"]');
    const setActive = (index, scroll = true) => {
        active = index;
        const items = optionItems();
        items.forEach((item, i) => item.classList.toggle('is-active', i === index));
        const item = items[index];
        if (item) {
            input.setAttribute('aria-activedescendant', item.id);
            if (scroll) item.scrollIntoView({ block: 'nearest' });
        } else input.removeAttribute('aria-activedescendant');
    };
    const render = (text) => {
        const query = fold(text);
        const words = query.split(/[^a-z0-9]+/).filter(Boolean);
        if (!words.length) matches = choices();
        else {
            const tiers = choices().map(option => [option, matchTier(option, query, words)]);
            const best = Math.max(...tiers.map(([, tier]) => tier), 0);
            matches = best ? tiers.filter(([, tier]) => tier === best).map(([option]) => option) : [];
        }
        let group = null;
        list.innerHTML = matches.length
            ? matches.map((option, i) => {
                const heading = groupOf(option) && groupOf(option) !== group ? `<li class="combo-group" role="presentation">${groupHtml(option)}</li>` : '';
                group = groupOf(option);
                return `${heading}<li role="option" id="${id}-option-${i}" data-index="${i}" class="combo-option${option.value === select.value ? ' is-selected' : ''}" aria-selected="${option.value === select.value}">${optionHtml(option)}</li>`;
            }).join('')
            : `<li class="combo-empty">${escapeHtml(select.dataset.empty || 'No programme matches')}</li>`;
        setActive(matches.length ? Math.max(0, matches.findIndex(option => option.value === select.value)) : -1);
    };
    const open = (query = '') => {
        if (list.hidden) {
            (wrapper.closest('.dialog-backdrop') || document.body).appendChild(list);
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            wrapper.classList.add('is-open');
            window.addEventListener('scroll', place, true);
            window.addEventListener('resize', place);
        }
        render(query);
        place();
    };
    const close = () => {
        if (list.hidden) return;
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        wrapper.classList.remove('is-open');
        window.removeEventListener('scroll', place, true);
        window.removeEventListener('resize', place);
    };
    const choose = (option) => {
        const changed = select.value !== (option?.value || '');
        select.value = option?.value || '';
        showSelected();
        close();
        if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    input.addEventListener('focus', () => { input.select(); open(); });
    input.addEventListener('click', () => { if (list.hidden) open(); });
    input.addEventListener('input', () => open(input.value));
    input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (list.hidden) return open();
            if (matches.length) setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        } else if (event.key === 'Enter' && !list.hidden) {
            event.preventDefault();
            event.stopPropagation();
            if (matches[active]) choose(matches[active]);
        } else if (event.key === 'Escape' && !list.hidden) {
            event.preventDefault();
            event.stopPropagation(); // Closes the list, not the dialog.
            showSelected();
            close();
        } else if (event.key === 'Tab') {
            close();
        }
    });
    // Leaving the box keeps the choice; an emptied box clears it.
    input.addEventListener('blur', () => setTimeout(() => {
        if (document.activeElement === input) return;
        if (!input.value.trim()) choose(null);
        else showSelected();
        close();
    }, 120));
    list.addEventListener('pointerdown', (event) => event.preventDefault()); // Keeps focus in the box.
    // The pointer moves the highlight, as the arrow keys do.
    list.addEventListener('pointermove', (event) => {
        const item = event.target.closest('[role="option"]');
        if (item && Number(item.dataset.index) !== active) setActive(Number(item.dataset.index), false);
    });
    list.addEventListener('click', (event) => {
        const item = event.target.closest('[role="option"]');
        if (item) choose(matches[Number(item.dataset.index)]);
    });
    wrapper.querySelector('.combo-chevron').addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (input.disabled) return;
        if (list.hidden) input.focus(); else close();
    });
    // The list lives outside the dialog's scroll area; it leaves with the field.
    wrapper.closest('.dialog-backdrop')?.addEventListener('dialogclose', () => list.remove(), { once: true });
    // Code that sets the select directly (selectedIndex, value) shows here too.
    select.addEventListener('change', showSelected);
}

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

// Settings for administrators and lecturers. Already open, it only switches tab.
function openSettingsDialog(tab = 'sect-courses') {
    if (!isAdmin) return;
    const open = document.querySelector('.dialog-backdrop .settings-dialog');
    if (open) showSettingsTab(open, tab);
    else showSettingsDialog(tab);
}

// The header and tabs stay put; only the chosen section fades in.
function showSettingsTab(dialog, targetId) {
    const btn = dialog.querySelector(`.settings-tab-btn[data-target="${targetId}"]`);
    const target = dialog.querySelector(`#${targetId}`);
    if (!btn || !target) return;
    closeRowMenus();
    dialog.querySelectorAll('.settings-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
    });
    dialog.querySelectorAll('.settings-section').forEach(s => s.style.display = 'none');
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    target.classList.remove('loaded');
    target.style.display = 'flex';
    void target.offsetWidth;
    target.classList.add('loaded');
}

// Leaving a tab with unsaved edits asks first.
function bindSettingsTabs(dialog) {
    dialog.querySelectorAll('.settings-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;

            const activeSection = dialog.querySelector('.settings-section[style*="display: flex"], .settings-section[style*="display:flex"]');
            const isSectionDirty = !!activeSection && isDialogDirty(activeSection);

            const switchTab = () => showSettingsTab(dialog, btn.dataset.target);
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
}

// --- Trusted devices: administrators manage every device; lecturers see every
// device, trust new ones, and rename or remove the ones they registered. ---

const DEVICE_TRUSTED_KEY = 'attendance_device_trusted';

function cachedDeviceTrust() {
    try {
        const value = localStorage.getItem(DEVICE_TRUSTED_KEY);
        return value === '1' ? true : value === '0' ? false : null;
    } catch {
        return null;
    }
}

function rememberDeviceTrust(trusted) {
    try { localStorage.setItem(DEVICE_TRUSTED_KEY, trusted ? '1' : '0'); } catch { /* Asked again next time. */ }
}

// Whether this browser is a trusted device: the database's answer, else the last
// one (so a phone that lost its connection still scans), else null.
async function checkDeviceTrusted() {
    if (navigator.onLine && supabaseClient) {
        try {
            const { data, error } = await supabaseClient.rpc('device_is_trusted', { p_device_id: getDeviceFingerprint() });
            if (error) throw error;
            rememberDeviceTrust(data === true);
            return data === true;
        } catch (error) {
            console.warn('Trusted device check unavailable:', error?.message || error);
        }
    }
    return cachedDeviceTrust();
}

function openTrustedDevicesSettings() {
    showNotification('warning', 'Device Not Trusted', 'Stando scans only on trusted devices. Register this device, then start scanning.', 8000);
    openSettingsDialog('sect-devices');
    setTimeout(() => document.getElementById('register-this-device-btn')?.focus({ preventScroll: true }), 150);
}

// This device with Register, a hint, and the trusted devices (renderTrustedDevices):
// in Settings for staff, and in a student's profile.
function trustedDevicesHtml(hint) {
    return `
                <div class="settings-device-note">
                    <div class="settings-device-id">
                        <strong>This device</strong>
                        <small class="selectable">${escapeHtml(getDeviceFingerprint())}</small>
                    </div>
                    <button type="button" id="register-this-device-btn" class="btn-blue btn-sm">
                        <i class="fa-solid fa-fingerprint" aria-hidden="true"></i> Register This Device
                    </button>
                </div>
                <p class="settings-device-hint">${hint}</p>
                <div class="settings-group-label">Trusted devices</div>
                <div id="devices-tbody" class="settings-list"></div>`;
}

function trustedDevicesSectionHtml() {
    return `
        <div id="sect-devices" class="settings-section" style="display:none; flex-direction:column; height:100%;">
            <div class="settings-scroll">
                ${trustedDevicesHtml((isGlobalAdmin
        ? 'Attendance is scanned only on trusted devices. You see everyone’s; a device you register is trusted for everyone, as a class tablet is.'
        : 'Attendance is scanned only on trusted devices: the ones you register, and the class devices an administrator registered. Only you see and change yours.') +
        ' On the row of this device, <strong>Fingerprint or PIN</strong> lets the scan lock open with the lock of the device itself.')}
            </div>
        </div>`;
}

function renderTrustedDevices(devices) {
    const deviceBody = document.getElementById('devices-tbody');
    if (!deviceBody) return;
    closeRowMenus();
    const myId = getDeviceFingerprint();
    const me = String(currentUser?.email || '').toLowerCase();
    // Each person registers a device for themselves; an administrator sees everyone's
    // rows, a device registered by several people once for each.
    const isRegistered = devices.some(d => d.id === myId && String(d.owner || '').toLowerCase() === me);

    const regBtn = document.getElementById('register-this-device-btn');
    if (regBtn) {
        regBtn.disabled = isRegistered;
        // A class device an administrator registered is trusted already; registering
        // it too gives it a name and settings of one's own.
        regBtn.title = !isRegistered && cachedDeviceTrust() === true
            ? 'An administrator trusted this device for everyone. Register it to keep your own settings on it.' : '';
        regBtn.innerHTML = isRegistered
            ? '<i class="fa-solid fa-check-circle" aria-hidden="true"></i> Trusted'
            : '<i class="fa-solid fa-fingerprint" aria-hidden="true"></i> Register This Device';
        regBtn.classList.toggle('btn-green', isRegistered);
        regBtn.classList.toggle('btn-blue', !isRegistered);
    }

    // On this device's own row, whoever scans (lecturers, teaching assistants) turns
    // unlocking the scan lock with the device's fingerprint, face or PIN on or off
    // (the key stays on the device, for their account).
    const lockSwitch = canRecordAnywhere() && deviceUnlockAvailable ? `
                    <label class="device-lock-switch" title="Unlock the scan lock with this device's fingerprint, face or PIN">
                        <i class="fa-solid fa-fingerprint" aria-hidden="true"></i><span>Fingerprint or PIN</span>
                        <input type="checkbox" role="switch" class="switch-input" aria-label="Unlock the scan lock with fingerprint or PIN" data-no-dirty${deviceUnlockId() ? ' checked' : ''}>
                    </label>` : '';
    deviceBody.innerHTML = devices.length ? devices.map(d => {
        const mine = String(d.owner || '').toLowerCase() === me;
        const attrs = `data-row-index="${escapeHtml(String(d.rowIndex))}" data-name="${escapeHtml(d.name)}"`;
        return `
            <div class="settings-row${d.id === myId ? ' is-selected' : ''}">
                <div class="settings-row-main">
                    <span class="settings-row-title">${escapeHtml(d.name)}${d.id === myId ? ' <span class="settings-row-state">This device</span>' : ''}</span>
                    <span class="settings-row-people">${mine ? 'Registered by you' : escapeHtml(d.owner)}</span>
                </div>
                <div class="settings-row-meta">
                    <span class="settings-row-sub">${escapeHtml(d.date)}</span>${d.id === myId && mine ? lockSwitch : ''}
                </div>
                ${isGlobalAdmin || mine ? `<div class="card-actions">
                    ${rowEditButtonHtml(`Rename ${d.name}`, 'rename-device-btn', attrs)}
                    ${rowMenuHtml([{ label: 'Remove device', icon: 'fa-solid fa-trash', danger: true, className: 'delete-device-btn', attrs }], `More actions for ${d.name}`)}
                </div>` : ''}
            </div>`;
    }).join('') : '<div class="settings-empty">No trusted devices.</div>';

    deviceBody.querySelectorAll('.rename-device-btn').forEach(btn => {
        btn.onclick = () => renameTrustedDevice(btn.dataset.rowIndex, btn.dataset.name);
    });
    deviceBody.querySelector('.device-lock-switch input')?.addEventListener('change', async (event) => {
        const input = event.target;
        if (!input.checked) {
            turnOffDeviceUnlock();
            return;
        }
        input.disabled = true;
        try {
            await turnOnDeviceUnlock();
            showNotification('success', 'Turned On', "The scan lock now opens with this device's fingerprint, face or PIN.");
        } catch (error) {
            input.checked = false;
            if (error?.name !== 'NotAllowedError') showNotification('error', 'Not Turned On', error?.message || 'This device could not set it up.');
        } finally {
            input.disabled = false;
        }
    });
    deviceBody.querySelectorAll('.delete-device-btn').forEach(btn => {
        btn.onclick = () => window.deleteTrustedDevice(btn.dataset.rowIndex, btn.dataset.name);
    });
}

async function reloadTrustedDevices() {
    try {
        const [devices] = await Promise.all([callWebApp('getTrustedDevices'), checkDeviceTrusted()]);
        renderTrustedDevices(devices);
    } catch (error) {
        showNotification('error', 'Error', 'Failed to load trusted devices: ' + error.message);
    }
}

// A small dialog above Settings that asks for a device's name.
function showDeviceNameDialog({ title, icon, intro, name = '', confirmText, onSave }) {
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    dialogBackdrop.style.zIndex = "10010";

    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid ${icon}" aria-hidden="true"></i> ${escapeHtml(title)}</h3>
        <div class="dialog-content">
            <p>${escapeHtml(intro)}</p>
            <div class="form-group">
                <label class="dialog-label-fixed" for="device-name-input"><i class="fa-solid fa-quote-right" aria-hidden="true"></i> Name</label>
                <input type="text" id="device-name-input" class="form-control" placeholder="Device Name" maxlength="80" value="${escapeHtml(name)}" autocomplete="off">
            </div>
        </div>
        <div class="dialog-actions">
            <button type="button" class="btn-secondary device-name-cancel"><i class="fa-solid fa-xmark" aria-hidden="true"></i> Cancel</button>
            <button type="button" class="btn-green device-name-save"><i class="fa-solid fa-check" aria-hidden="true"></i> ${escapeHtml(confirmText)}</button>
        </div>`;
    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const input = dialog.querySelector('#device-name-input');
    setTimeout(() => {
        input.focus();
        input.select();
    }, 100);
    const close = () => dialogBackdrop.remove();
    dialog.querySelector('.device-name-cancel').onclick = close;

    const save = async () => {
        const value = input.value.trim();
        if (!value) {
            input.setAttribute('aria-invalid', 'true');
            showNotification('warning', 'Name Required', 'Please enter a device name.');
            input.focus();
            return;
        }
        const btn = dialog.querySelector('.device-name-save');
        if (btn.disabled) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Saving...';
        try {
            await onSave(value);
            close();
        } catch (err) {
            showNotification('error', 'Error', err.message);
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check" aria-hidden="true"></i> ${escapeHtml(confirmText)}`;
        }
    };
    dialog.querySelector('.device-name-save').onclick = save;
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') save();
    });
}

// A starting name for this device: the phone's model where the browser tells it,
// otherwise the kind of device. It is selected, so typing replaces it.
async function suggestedDeviceName() {
    try {
        const { model } = await navigator.userAgentData?.getHighEntropyValues?.(['model']) || {};
        if (model) return model;
    } catch { /* Fall back to the kind of device. */ }
    const ua = navigator.userAgent;
    return /iPhone/.test(ua) ? 'iPhone'
        : /iPad/.test(ua) ? 'iPad'
            : /Android/.test(ua) ? 'Android phone'
                : /Windows/.test(ua) ? 'Windows PC'
                    : /Macintosh/.test(ua) ? 'Mac'
                        : /Linux|CrOS/.test(ua) ? 'Computer' : '';
}

function bindTrustedDevicesSection(dialog) {
    dialog.querySelector('#register-this-device-btn').onclick = async () => showDeviceNameDialog({
        title: 'Trust This Device',
        icon: 'fa-laptop-medical',
        intro: 'Give this device a friendly name (e.g., "A-131 Tablet").',
        name: await suggestedDeviceName(),
        confirmText: 'Trust',
        onSave: async (deviceName) => {
            await callWebApp('registerDevice_Admin', { deviceName, deviceId: getDeviceFingerprint() }, 'POST');
            rememberDeviceTrust(true);
            showNotification('success', 'Registered', isAdmin
                ? 'Device is now trusted. You can start scanning.'
                : 'Device is now trusted. Your staff card signs you in on it.');
            await reloadTrustedDevices();
        }
    });
}

function renameTrustedDevice(rowIndex, name) {
    showDeviceNameDialog({
        title: 'Rename Device',
        icon: 'fa-pen',
        intro: 'The name helps you recognise this device in the list.',
        name,
        confirmText: 'Save',
        onSave: async (deviceName) => {
            await callWebApp('renameDevice', { rowIndex, deviceName }, 'POST');
            showNotification('success', 'Saved', 'Device renamed.');
            await reloadTrustedDevices();
        }
    });
}

// Settings, the same for administrators and lecturers: Courses, Programmes, Staff
// and Trusted Devices. Lecturers list their own courses (archived ones too, to
// bring one back) and change only their programmes, sections and archiving; the
// Programmes and Staff tabs are theirs to read. An editor opened from Settings
// opens above it and, on saving, only refreshes its lists (refreshOpenSettings).
function showSettingsDialog(initialTab = 'sect-courses') {
    openDialogMode();
    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog settings-dialog');
    dialog.style.maxWidth = '1000px';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'settings-title');

    // --- Variables for Bomb ---
    let avatarClickCount = 0;
    let lastAvatarClickTime = 0;

    const tab = (target, icon, label) => `<button type="button" class="settings-tab-btn" data-target="${target}" role="tab" aria-selected="false"><i class="fa-solid ${icon} tab-icon" aria-hidden="true"></i><span class="tab-label" data-label="${label}">${label}</span></button>`;
    const search = (id, label) => `
                <div class="input-with-icon search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input type="search" id="${id}" class="settings-search-input" placeholder="${label}" aria-label="${label}">
                </div>`;
    const add = (id, icon, label) => isGlobalAdmin ? `
                <button type="button" id="${id}" class="btn-green toolbar-add" title="${label}" aria-label="${label}">
                    <i class="fa-solid ${icon}" aria-hidden="true"></i><span class="btn-text">${label}</span>
                </button>` : '';
    const section = (id, toolbar, listId) => `
        <div id="${id}" class="settings-section" style="display:none; flex-direction:column; height:100%;">
            <div class="settings-controls-bar list-toolbar">${toolbar}</div>
            <div class="settings-scroll" id="${listId}"></div>
        </div>`;

    dialog.innerHTML = `
    <div class="settings-modal-header">
        <div class="settings-modal-identity">
            <div class="settings-avatar" id="settings-profile-pic">
                ${userAvatarHtml(currentUserDisplayName(), currentUserPhoto(), 'user-avatar user-avatar-lg')}
            </div>
            <div class="settings-modal-heading">
                <h3 id="settings-title">Settings</h3>
                <div class="settings-modal-sub">${isGlobalAdmin ? 'Administrator' : 'Lecturer'}</div>
            </div>
        </div>
        <button type="button" id="close-settings-btn" class="btn-icon icon-only-btn" title="Close" aria-label="Close settings"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
    </div>

    <div class="settings-tabs-container" role="tablist">
        ${tab('sect-courses', 'fa-book-open', isGlobalAdmin ? 'Courses' : 'My Courses')}
        ${programmeList ? tab('sect-programmes', 'fa-graduation-cap', 'Programmes') : ''}
        ${tab('sect-staff', 'fa-user-tie', 'Staff')}
        ${tab('sect-devices', 'fa-laptop-code', 'Trusted Devices')}
    </div>

    <div class="dialog-content" style="padding:0; position:relative; display:flex; flex-direction:column; overflow:hidden;">
        <div id="settings-loader" class="settings-loader-overlay">
            <div class="loading-spinner"></div>
        </div>
        ${section('sect-courses', search('course-search-input', 'Search courses') + settingsSortSelectHtml('settings-course-sort') +
            add('add-new-course-btn', 'fa-plus', 'New Course'), 'settings-courses-container')}
        ${programmeList ? section('sect-programmes', search('programme-search-input', 'Search programmes') +
            add('add-programme-btn', 'fa-plus', 'New Programme'), 'settings-programmes-container') : ''}
        ${section('sect-staff', search('staff-search-input', 'Search staff') + add('add-staff-btn', 'fa-user-plus', 'Add Staff'), 'settings-staff-container')}
        ${trustedDevicesSectionHtml()}
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    StandoWebsite.addDownloadControl(dialog.querySelector('#sect-courses'), { forGlobalAdmin: isGlobalAdmin });

    // --- BOMB LOGIC (Restored) ---
    const profilePicContainer = dialog.querySelector('#settings-profile-pic');
    profilePicContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        const now = Date.now();
        if (now - lastAvatarClickTime > 1000) avatarClickCount = 0;
        lastAvatarClickTime = now;
        avatarClickCount++;
        if (avatarClickCount === 5) {
            profilePicContainer.innerHTML = `<div style="width:100%; height:100%; border-radius:50%; background:var(--danger-color); display:flex; align-items:center; justify-content:center; color:white; font-size:2em;"><i class="fa-solid fa-bomb"></i></div>`;
            profilePicContainer.onclick = confirmClearAllAppData;
            avatarClickCount = 0;
        }
    });

    bindSettingsTabs(dialog);
    showSettingsTab(dialog, dialog.querySelector(`#${initialTab}`) ? initialTab : 'sect-courses');

    // Administrators see every course; a lecturer the ones they teach.
    const courseSearch = dialog.querySelector('#course-search-input');
    const settingsCourses = () => isGlobalAdmin
        ? courseInfoMap
        : Object.fromEntries(adminCourses.filter(course => courseInfoMap[course]).map(course => [course, courseInfoMap[course]]));
    const renderCourses = () => renderCoursesInSettings(settingsCourses(), courseSearch.value);
    courseSearch.addEventListener('input', renderCourses);
    bindSettingsSortSelect(dialog.querySelector('#settings-course-sort'), renderCourses);

    const programmeSearch = dialog.querySelector('#programme-search-input');
    if (programmeSearch) {
        programmeSearch.addEventListener('input', () => renderProgrammesInSettings(programmeSearch.value));
        renderProgrammesInSettings();
    }

    let staffList = [];
    const staffSearch = dialog.querySelector('#staff-search-input');
    staffSearch.addEventListener('input', () => renderStaffInSettings(staffList, staffSearch.value));

    // Lecturers read the staff list without its cards (getStaffDirectory).
    const load = async () => {
        try {
            const [, people, programmes] = await Promise.all([
                fetchCourseInfo(),
                isGlobalAdmin
                    ? callWebApp('getGlobalSettingsData', {}, 'POST')
                    : Promise.all([callWebApp('getStaffDirectory'), callWebApp('getTrustedDevices')]).then(([staff, devices]) => ({ staff, devices })),
                callWebApp('getProgrammes')
            ]);
            if (programmes) {
                setProgrammeList(programmes);
                renderProgrammesInSettings(programmeSearch?.value || '');
            }
            staffList = people.staff || [];
            // Course rows show lecturers by name where the staff list knows them.
            settingsStaffNames = new Map(staffList
                .filter(s => s && s.email && (s.name || s.googleName))
                .map(s => [String(s.email).trim().toLowerCase(), staffDisplayName(s)]));
            renderCourses();
            renderStaffInSettings(staffList, staffSearch.value);
            renderTrustedDevices(people.devices || []);
        } catch (e) {
            console.error(e);
            showNotification('error', 'Error', 'Failed to load settings: ' + e.message);
        } finally {
            const loader = dialog.querySelector('#settings-loader');
            if (loader) loader.style.display = 'none';
        }
    };
    load();
    dialog._reload = load;

    bindTrustedDevicesSection(dialog);
    if (isGlobalAdmin) {
        dialog.querySelector('#add-programme-btn')?.addEventListener('click', () => showProgrammeEditorDialog(null));
        dialog.querySelector('#add-staff-btn').onclick = () => showStaffEditorDialog(null);
        dialog.querySelector('#add-new-course-btn').onclick = () => showCourseEditorDialog(null);
    }

    dialog.querySelector('#close-settings-btn').onclick = () => {
        dialogBackdrop.remove();
        closeDialogMode();
    };
}

/**
* Bridges the HTML onclick event to the Editor Dialog.
*/
window.editStaffKey = (rowIndex, name, uid, email, role, googleName = '', photoUrl = '', googlePhoto = '') => {
    showStaffEditorDialog({
        rowIndex: rowIndex,
        name: name,
        uid: uid,
        email: email,
        role: role,
        googleName: googleName,
        photoUrl: photoUrl,
        googlePhoto: googlePhoto
    });
};

window.deleteTrustedDevice = (rowIndex, name) => {
    showConfirmationDialog({
        title: '<i class="fa-solid fa-laptop-slash" style="color:var(--danger-color);"></i> Untrust Device?',
        message: `Are you sure you want to remove <strong>${escapeHtml(name)}</strong>? Stando will not scan on it, or accept staff card sign-in there, until it is registered again.`,
        confirmText: '<i class="fa-solid fa-trash"></i> Untrust', // Added Icon
        cancelText: '<i class="fa-solid fa-xmark"></i> Cancel',   // Added Icon
        isDestructive: true,
        onConfirm: () => {
            callWebApp('deleteDevice_Admin', { rowIndex }, 'POST')
                .then(async () => {
                    showNotification('delete', 'Removed', `${name} is no longer trusted.`);
                    await reloadTrustedDevices();
                    checkDeviceTrusted(); // Updates the saved answer if this was this device.
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
                .then(() => refreshOpenSettings())
                .catch(err => showNotification('error', 'Error', err.message));
        }
    });
};


// A colleague's name by e-mail: from the staff list Settings loaded, else the
// loaded student list (which includes staff), else the e-mail.
function staffNameByEmail(email) {
    const key = String(email || '').trim().toLowerCase();
    return settingsStaffNames.get(key) || personNameByEmail(key);
}

// A course's people in one list. Administrators tick lecturers and teaching
// assistants alike (each row names its role), searching or narrowing the list to
// one role or to those chosen.
function peoplePickerHtml(id) {
    return `
        <div class="staff-picker" id="${id}" role="group" aria-label="Lecturers and teaching assistants">
            <div class="staff-picker-tools">
                <div class="input-with-icon">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                    <input type="search" id="${id}-search" class="form-control" placeholder="Search staff" autocomplete="off" aria-label="Search staff">
                </div>
                <div class="settings-facet staff-picker-filters" role="group" aria-label="Show"></div>
            </div>
            <div class="staff-picker-list">
                <div class="staff-picker-note"><div class="loading-spinner"></div></div>
            </div>
        </div>`;
}

// Ticking someone adds them as their role makes them: a teaching assistant to the
// course's assistants, anyone else to its lecturers. Unticking removes them from both.
function bindPeoplePicker(root, staff, lecturers, assistants) {
    const list = root.querySelector('.staff-picker-list');
    const search = root.querySelector('input[type="search"]');
    const filters = root.querySelector('.staff-picker-filters');
    const emailOf = s => String(s.email || '').trim().toLowerCase();
    const isChosen = s => lecturers.has(emailOf(s)) || assistants.has(emailOf(s));
    const FILTERS = [
        { id: 'all', label: 'All', test: () => true },
        { id: 'lecturers', label: 'Lecturers', test: s => staffRole(s.role) !== 'Assistant' },
        { id: 'assistants', label: 'Assistants', test: s => staffRole(s.role) === 'Assistant' },
        { id: 'chosen', label: 'Chosen', test: isChosen }
    ];
    let filter = 'all';
    const render = () => {
        filters.innerHTML = FILTERS.map(f => `<button type="button" data-filter="${f.id}" aria-pressed="${f.id === filter}">${f.label}<span>${staff.filter(f.test).length}</span></button>`).join('');
        const query = search.value.trim().toLowerCase();
        const test = FILTERS.find(f => f.id === filter).test;
        const shown = staff.filter(s => test(s) && (!query || staffDisplayName(s).toLowerCase().includes(query) ||
            emailOf(s).includes(query)));
        list.innerHTML = shown.length ? '' : '<div class="staff-picker-note">No staff found</div>';
        shown.forEach(person => {
            const email = emailOf(person);
            const chosen = isChosen(person);
            const name = staffDisplayName(person);
            const row = document.createElement('div');
            row.className = `student-item${chosen ? ' selected' : ''}`;
            row.setAttribute('role', 'checkbox');
            row.setAttribute('aria-checked', String(chosen));
            row.tabIndex = 0;
            row.dataset.email = email;
            row.innerHTML = `
                ${userAvatarHtml(name, person.photo, 'user-avatar settings-row-avatar')}
                <div class="student-info">
                    <div class="student-name">${escapeHtml(name)}</div>
                    <div class="student-uid"><span class="role-chip">${escapeHtml(staffRoleLabel(person.role))}</span>${escapeHtml(person.email)}</div>
                </div>
                ${chosen ? '<i class="fa-solid fa-check student-item-check" aria-hidden="true"></i>' : ''}`;
            row.onclick = () => {
                if (chosen) {
                    lecturers.delete(email);
                    assistants.delete(email);
                } else {
                    (staffRole(person.role) === 'Assistant' ? assistants : lecturers).add(email);
                }
                render();
                list.querySelector(`[data-email="${CSS.escape(email)}"]`)?.focus();
            };
            list.appendChild(row);
        });
    };
    filters.addEventListener('click', (event) => {
        const button = event.target.closest('[data-filter]');
        if (!button) return;
        filter = button.dataset.filter;
        render();
        filters.querySelector(`[data-filter="${filter}"]`)?.focus();
    });
    search.addEventListener('input', render);
    render();
}

function emailSet(list) {
    return new Set(String(list || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean));
}

// A course's settings, from Settings (or New Course). Administrators change
// everything. A course's lecturers change its programmes, sections and
// archiving, and see the rest: its lecturers, teaching assistants and appearance.
function showCourseEditorDialog(courseName, info = null) {
    const isNew = !courseName;
    const title = isNew ? 'New Course' : 'Edit Course';
    const data = info || {};
    const val = (v) => v !== undefined && v !== null ? v : '';

    // The course code as people write it, without the internal archive/EIS ID suffix.
    const cleanCourseName = isNew ? '' : getCleanCourseCode(courseName, data.eisId);

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

    // Fields only administrators change.
    const off = isGlobalAdmin ? '' : 'disabled';

    let currentSections = [];
    if (data.availableSections) {
        currentSections = data.availableSections.split(',').map(s => s.trim()).filter(Boolean);
    }
    const lecturers = emailSet(data.adminEmails);
    const assistants = emailSet(data.assistantEmails);
    const initial = JSON.stringify([currentSections, [...lecturers], [...assistants]]);

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    dialogBackdrop.style.zIndex = "10002";
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog course-editor');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    // Lecturers read who teaches and assists, by name and role; administrators choose them.
    const person = (email, role) => `<div class="admin-pill-item" title="${escapeHtml(email)}"><b>${escapeHtml(staffNameByEmail(email))}</b><small>${role}</small></div>`;
    const peopleHtml = isGlobalAdmin ? peoplePickerHtml('edit-c-people') : `
        <div class="admin-pills-list people-pills">${lecturers.size + assistants.size
            ? [...lecturers].map(email => person(email, 'Lecturer')).join('') + [...assistants].map(email => person(email, 'Teaching assistant')).join('')
            : '<span class="people-pills-empty">None yet</span>'}</div>`;

    let groupButtonsHtml = '';
    for (let i = 0; i < 4; i++) {
        const char = String.fromCharCode(65 + i);
        groupButtonsHtml += `<div class="course-button" data-val="${char}" role="button" tabindex="0" style="min-width:35px; padding:6px 0; font-size:0.9em;"><b>${char}</b></div>`;
    }

    dialog.innerHTML = `
    <h3 class="dialog-title"><i class="fa-solid fa-book-open"></i> ${title}</h3>
    <div class="dialog-content">
        ${isGlobalAdmin ? '' : '<p class="form-hint editor-note"><i class="fa-solid fa-lock" aria-hidden="true"></i> You can change this course’s programmes, sections and archiving. The rest is set by an administrator.</p>'}

        <div class="editor-columns">
            <div class="editor-column">
                <section class="editor-section is-details">
                    <h4 class="editor-section-title"><i class="fa-solid fa-book-open" aria-hidden="true"></i>Course</h4>
                    <div class="editor-section-body">
                        <div class="editor-pair">
                            <div class="form-group">
                                <label class="dialog-label-fixed" for="edit-c-name">Course Code <span class="required">*</span></label>
                                <input id="edit-c-name" class="form-control" value="${escapeHtml(cleanCourseName)}" ${off} placeholder="e.g. CE 101">
                            </div>
                            <div class="form-group">
                                <label class="dialog-label-fixed" for="edit-c-eis">EIS ID</label>
                                <input id="edit-c-eis" class="form-control" value="${escapeHtml(val(data.eisId))}" placeholder="e.g. 12345" ${off}>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="dialog-label-fixed" for="edit-c-title">Course Name <span class="required">*</span></label>
                            <input id="edit-c-title" class="form-control" value="${escapeHtml(val(data.title))}" ${off} maxlength="150">
                        </div>
                        ${programmesFieldHtml('edit-c-programmes', data.programmeIds || [])}
                        ${!isNew ? switchRowHtml('edit-c-archived', data.archived, 'Archived', 'Hidden from lists. Its records stay.') : ''}
                    </div>
                </section>

                <section class="editor-section is-dates">
                    <h4 class="editor-section-title"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i>Dates</h4>
                    <div class="editor-section-body">
                        <div class="editor-pair">
                            <div class="form-group">
                                <label class="dialog-label-fixed" for="edit-c-start">Start Date</label>
                                <input type="date" id="edit-c-start" class="form-control" value="${formatDate(data.startDate)}" ${off}>
                            </div>
                            <div class="form-group">
                                <label class="dialog-label-fixed" for="edit-c-end">End Date</label>
                                <input type="date" id="edit-c-end" class="form-control" value="${formatDate(data.endDate)}" ${off}>
                            </div>
                            <div class="form-group">
                                <label class="dialog-label-fixed" for="edit-c-holiday-start">Holiday Start</label>
                                <input type="date" id="edit-c-holiday-start" class="form-control" value="${formatDate(data.holidayStartDate)}" ${off}>
                            </div>
                            <div class="form-group">
                                <label class="dialog-label-fixed" for="edit-c-holidays">Holiday Weeks</label>
                                <input type="number" id="edit-c-holidays" class="form-control" value="${escapeHtml(val(data.holidayWeeks))}" ${off}>
                            </div>
                        </div>
                    </div>
                </section>
            </div>

            <div class="editor-column">
                <section class="editor-section is-sections">
                    <h4 class="editor-section-title"><i class="fa-solid fa-layer-group" aria-hidden="true"></i>Sections</h4>
                    <div class="editor-section-body">
                        <div style="display:flex; flex-direction:column; gap:10px; min-width:0;">
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
                                    <button type="button" id="btn-add-section" class="btn-green btn-sm" style="padding:8px 15px; flex-shrink:0; margin-left:10px; font-size:0.85em;">
                                        <i class="fa-solid fa-plus"></i> Add
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="editor-section is-people">
                    <h4 class="editor-section-title"><i class="fa-solid fa-user-group" aria-hidden="true"></i>People</h4>
                    <div class="editor-section-body">
                        ${peopleHtml}
                        ${isGlobalAdmin ? '<p class="form-hint">Teaching assistants scan and add records here, and change only the ones they made.</p>' : ''}
                    </div>
                </section>
            </div>
        </div>

        <section class="editor-section is-appearance">
            <h4 class="editor-section-title"><i class="fa-solid fa-palette" aria-hidden="true"></i>Appearance</h4>
            <div class="editor-section-body">
                ${appearanceFieldsHtml(data, { code: cleanCourseName, title: data.title, editable: isGlobalAdmin })}
            </div>
        </section>
    </div>
    <div class="dialog-actions">
        ${(!isNew && isGlobalAdmin) ? '<button type="button" id="delete-course-btn" class="btn-red tint-danger" style="margin-right:auto;"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>' : ''}
        <button type="button" id="cancel-edit-c" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button type="button" id="save-edit-c" class="btn-green"><i class="fa-solid fa-floppy-disk"></i> Save</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);
    bindProgrammesField(dialog.querySelector('[data-programmes-field]'));
    // A lecturer sees the course's colours in the preview, without changing them.
    const appearance = bindAppearanceFields(dialog);
    // Sections and people are not fields, so leaving asks about them too.
    dialog._checkDirty = () => JSON.stringify([currentSections, [...lecturers], [...assistants]]) !== initial;

    // --- Section Builder Logic ---
    const sectionListContainer = dialog.querySelector('#section-builder-list');
    const catContainer = dialog.querySelector('#new-sec-cat');
    const grpContainer = dialog.querySelector('#new-sec-grp');
    const addSectionBtn = dialog.querySelector('#btn-add-section');

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
            pill.innerHTML = `<b>${escapeHtml(sec)}</b> <i class="fa-solid fa-times remove-pill" style="margin-left:8px; cursor:pointer; color:var(--danger-color);" data-index="${index}"></i>`;
            sectionListContainer.appendChild(pill);
        });
        sectionListContainer.querySelectorAll('.remove-pill').forEach(btn => {
            btn.onclick = (e) => {
                currentSections.splice(parseInt(e.currentTarget.dataset.index), 1);
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

    // --- Lecturers and teaching assistants: ticked in the staff list, lecturers
    // (by title) before teaching assistants (A–Z) ---
    if (isGlobalAdmin) {
        callWebApp('getGlobalSettingsData', {}, 'POST')
            .then(({ staff = [] }) => {
                const assistant = s => staffRole(s.role) === 'Assistant';
                const sorted = [...staff].sort((a, b) => assistant(a) - assistant(b) || (assistant(a)
                    ? staffDisplayName(a).localeCompare(staffDisplayName(b), undefined, { sensitivity: 'base' })
                    : compareLecturers(staffDisplayName(a), staffDisplayName(b))));
                bindPeoplePicker(dialog.querySelector('#edit-c-people'), sorted, lecturers, assistants);
            })
            .catch(() => {
                dialog.querySelectorAll('.staff-picker-list').forEach(list => {
                    list.innerHTML = '<div class="staff-picker-note error-message">Failed to load the staff list.</div>';
                });
            });
    }

    const close = () => dialogBackdrop.remove();
    dialog.querySelector('#cancel-edit-c').onclick = close;

    // --- Save Logic ---
    dialog.querySelector('#save-edit-c').onclick = async (e) => {
        const btn = e.currentTarget;
        const nameInput = dialog.querySelector('#edit-c-name');
        const rawName = nameInput.value.trim();
        const archivedSwitch = dialog.querySelector('#edit-c-archived');
        const isArchived = archivedSwitch ? archivedSwitch.checked : (data.archived || false);
        const eisInput = dialog.querySelector('#edit-c-eis');
        const eisVal = eisInput.value.trim();
        const titleInput = dialog.querySelector('#edit-c-title');
        const courseTitle = titleInput.value.replace(/\s+/g, ' ').trim();
        clearInputError(nameInput);
        clearInputError(eisInput);
        clearInputError(titleInput);
        let systemName;
        try {
            systemName = StandoData.resolveCourseName({ code: rawName, eisId: eisVal,
                originalName: courseName, originalData: data, archived: isArchived, courses: courseInfoMap });
        } catch (error) {
            showInputError(error.message.startsWith('EIS ID') ? eisInput : nameInput, error.message);
            return;
        }
        // Like the code, the name is required; only administrators can set it.
        if (isGlobalAdmin && !courseTitle) {
            showInputError(titleInput, 'Enter the course name, such as Civil Engineering Drawing.');
            titleInput.focus();
            return;
        }
        if (currentSections.length === 0) {
            showNotification('error', 'Missing Data', 'Please add at least one section.');
            return;
        }
        if (isGlobalAdmin && appearance && !appearance.validate()) return;

        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

        const payload = {
            originalName: courseName,
            courseName: systemName, // SEND UNDERSCORES
            courseTitle,
            defaultHours: data.defaultHours || '2',
            startDate: dialog.querySelector('#edit-c-start').value,
            endDate: dialog.querySelector('#edit-c-end').value,
            holidayStartDate: dialog.querySelector('#edit-c-holiday-start').value,
            holidayWeeks: dialog.querySelector('#edit-c-holidays').value,
            eisId: eisVal,
            availableSections: currentSections.join(', '),
            adminEmails: isGlobalAdmin ? [...lecturers].join(', ') : (data.adminEmails || '')
        };
        if (!isNew) payload.archived = isArchived;
        const programmesField = dialog.querySelector('[data-programmes-field]');
        if (programmesField) payload.programmeIds = readProgrammesField(programmesField);
        if (isGlobalAdmin) payload.assistantEmails = [...assistants].join(', ');
        if (isGlobalAdmin && appearance) Object.assign(payload, appearance.read());

        try {
            const res = await callWebApp('saveCourseSettings_Admin', payload, 'POST');
            if (res.result === 'success') {
                // Refresh the picker too, so restored and new courses are usable immediately.
                await refreshCoursePicker('Course saved.');
                showNotification('success', 'Saved', 'Course updated.');
                close();
                refreshOpenSettings();
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
                    refreshOpenSettings();
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
        // A lecturer's courses, archived ones too: archiving can rename a course.
        if (isAdmin && !isGlobalAdmin) adminCourses = Object.keys(courses);
        availableCourses = Object.keys(courses).filter(name => !info[name]?.archived);
        courseDictionary = Object.fromEntries(availableCourses.map(name => [name, courses[name]]));
        courseIDMap = Object.fromEntries(Object.entries(info).map(([name, metadata]) => [name, metadata.eisId]));
        // A deleted or renamed course cannot stay selected, nor one a lecturer
        // archived; routing picks the next one.
        if (currentCourse && (!info[currentCourse] || (!isGlobalAdmin && info[currentCourse].archived))) {
            if (!courseData[currentCourse]?.pending) delete courseData[currentCourse];
            if (guestCourse === currentCourse) guestCourse = null;
            currentCourse = '';
            window.location.hash = '';
            updateUI();
        }
        // New colours or a new icon show at once.
        if (currentCourse) applyCourseAppearance(currentCourse);
        populateCourseButtons();
    } catch (refreshError) {
        showNotification('warning', 'Refresh Needed', `${savedMessage} Reload the page to refresh the course list.`);
    }
}

// --- Settings → Programmes ---
// Students point at a programme by id: renaming one renames it for all of them,
// archiving takes it out of the choices but keeps it on its students, and
// deleting one moves its students to another programme first.

function programmeStudentCounts() {
    const counts = new Map();
    studentEntries().forEach(([, student]) => {
        const id = Number(student.programmeId);
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
    });
    return counts;
}

function renderProgrammesInSettings(filterText = '') {
    const container = document.getElementById('settings-programmes-container');
    if (!container) return;
    closeRowMenus();
    const query = filterText.trim().toLowerCase();
    const counts = programmeStudentCounts();
    // Active courses per programme, once courses can name one.
    const courseCounts = new Map();
    Object.values(courseInfoMap).forEach(info => {
        if (!info?.archived) courseProgrammes(info).forEach(programme => courseCounts.set(programme.id, (courseCounts.get(programme.id) || 0) + 1));
    });
    const shown = (programmeList || []).filter(p => !query || p.code.toLowerCase().includes(query) || p.name.toLowerCase().includes(query));
    const row = p => {
        const count = counts.get(p.id) || 0;
        const courses = courseCounts.get(p.id) || 0;
        return `
            <div class="settings-row${p.archived ? ' is-archived' : ''}">
                <div class="settings-row-main">
                    <span class="settings-row-title"><strong>${escapeHtml(p.code)}</strong>${p.archived ? ' <span class="settings-row-state">Archived</span>' : ''}</span>
                    ${p.name ? `<span class="settings-row-people" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>` : ''}
                </div>
                <div class="settings-row-meta"><span class="settings-row-sub">${listCountText(count, 'student')}</span><span class="settings-row-sub">${listCountText(courses, 'course')}</span></div>
                ${isGlobalAdmin ? `<div class="card-actions">
                    ${rowEditButtonHtml(`Edit ${p.code}`, 'edit-programme-btn', `data-programme-id="${p.id}"`)}
                </div>` : ''}
            </div>`;
    };
    const group = (label, list) => `
        <div class="settings-courses-group">
            <div class="settings-group-label">${label} <span class="settings-group-count">${list.length}</span></div>
            ${list.length ? `<div class="settings-list">${list.map(row).join('')}</div>` : '<div class="settings-empty">No active programmes.</div>'}
        </div>`;
    const archived = shown.filter(p => p.archived);
    container.innerHTML = shown.length
        ? group('Programmes', shown.filter(p => !p.archived)) + (archived.length ? group('Archived programmes', archived) : '')
        : `<div class="settings-empty">No programmes${query ? ` matching "${escapeHtml(filterText.trim())}"` : ''}.</div>`;
    container.querySelectorAll('.edit-programme-btn').forEach(btn => {
        btn.onclick = () => showProgrammeEditorDialog(programmeById(btn.dataset.programmeId));
    });
}

function showProgrammeEditorDialog(programme) {
    const isNew = !programme;
    const count = isNew ? 0 : (programmeStudentCounts().get(programme.id) || 0);
    const students = `${count} ${count === 1 ? 'student' : 'students'}`;
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    backdrop.style.zIndex = '10010';
    backdrop.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="programme-editor-title">
            <h3 class="dialog-title" id="programme-editor-title"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i> ${isNew ? 'New Programme' : 'Edit Programme'}</h3>
            <div class="dialog-content">
                <div class="form-group">
                    <label class="dialog-label-fixed" for="programme-code">Code <span class="required">*</span></label>
                    <input type="text" id="programme-code" class="form-control" maxlength="30" placeholder="e.g. BA CE" value="${escapeHtml(programme?.code || '')}" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="dialog-label-fixed" for="programme-name">Full Name</label>
                    <input type="text" id="programme-name" class="form-control" maxlength="150" placeholder="e.g. Civil Engineering" value="${escapeHtml(programme?.name || '')}" autocomplete="off">
                </div>
                <p class="form-hint">${isNew ? 'Students choose it when they register their card.' : `A change shows at once for its ${students}.`}</p>
                ${isNew ? '' : switchRowHtml('programme-archived', programme.archived, 'Archived',
                    'No longer offered. Its students keep it.')}
            </div>
            <div class="dialog-actions">
                ${isNew ? '' : '<button type="button" id="delete-programme-btn" class="btn-red tint-danger" style="margin-right:auto;"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>'}
                <button type="button" id="cancel-programme-btn" class="btn-secondary"><i class="fa-solid fa-xmark" aria-hidden="true"></i> Cancel</button>
                <button type="button" id="save-programme-btn" class="btn-green"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save</button>
            </div>
        </div>`;
    document.body.appendChild(backdrop);
    const dialog = backdrop.querySelector('.dialog');
    const codeInput = dialog.querySelector('#programme-code');
    const close = () => backdrop.remove();
    dialog.querySelector('#cancel-programme-btn').onclick = close;
    if (!isTouchDevice()) codeInput.focus();

    const refresh = async (message) => {
        try {
            await reloadProgrammes();
        } catch (error) {
            showNotification('warning', 'Refresh Needed', 'Saved. Reload the page to see the change.');
            return;
        }
        renderProgrammesInSettings(document.getElementById('programme-search-input')?.value || '');
        showNotification('success', 'Saved', message);
    };

    dialog.querySelector('#save-programme-btn').onclick = async (event) => {
        const button = event.currentTarget;
        const code = codeInput.value.replace(/\s+/g, ' ').trim();
        clearInputError(codeInput);
        const taken = (programmeList || []).find(p => p.id !== programme?.id && p.code.toLowerCase() === code.toLowerCase());
        if (!code || taken) {
            showInputError(codeInput, code ? `There is already a programme called ${taken.code}.` : 'Enter the programme code.');
            codeInput.focus();
            return;
        }
        button.disabled = true;
        button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving...';
        try {
            await callWebApp('saveProgramme_Admin', {
                id: programme?.id, code,
                name: dialog.querySelector('#programme-name').value.replace(/\s+/g, ' ').trim(),
                archived: isNew ? undefined : dialog.querySelector('#programme-archived').checked
            });
            close();
            await refresh(`${code} ${isNew ? 'added' : 'saved'}.`);
        } catch (error) {
            showNotification('error', 'Save Failed', error.message);
            button.disabled = false;
            button.innerHTML = '<i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save';
        }
    };

    if (isNew) return;
    // Students never lose their programme: those in it move to another one first.
    dialog.querySelector('#delete-programme-btn').onclick = () => {
        const others = (programmeList || []).filter(p => p.id !== programme.id && !p.archived);
        if (count && !others.length) {
            showNotification('warning', 'Add Another Programme', `${programme.code} has ${students}. Add a programme for them to move to first.`);
            return;
        }
        showConfirmationDialog({
            title: `<i class="fa-solid fa-trash" style="color:var(--danger-color);"></i> Delete ${escapeHtml(programme.code)}?`,
            message: count
                ? `Its <strong>${students}</strong> move to the programme you choose. Their cards and attendance stay as they are.<br><br>
                   <label class="confirm-field-label" for="programme-move-to">Move them to</label>
                   <select id="programme-move-to" class="form-control programme-select"><option value="">Choose a programme</option>${others.map(p =>
                    `<option value="${p.id}">${escapeHtml(programmeOptionLabel(p))}</option>`).join('')}</select>`
                : `No students are in ${escapeHtml(programme.code)}. To keep it for the record but stop offering it, archive it instead.`,
            confirmText: '<i class="fa-solid fa-trash"></i> Delete',
            cancelText: '<i class="fa-solid fa-xmark"></i> Cancel',
            isDestructive: true,
            onConfirm: async () => {
                const moveTo = count ? Number(document.getElementById('programme-move-to').value) || null : null;
                if (count && !moveTo) throw new Error(`Choose the programme its ${students} move to.`);
                await callWebApp('deleteProgramme_Admin', { id: programme.id, moveTo });
                close();
                if (count) {
                    invalidateDatabaseCache();
                    await fetchDatabaseFromSheet().catch(error => console.warn('Could not reload the student list:', error));
                    window.buildUIDToPrimaryUidMap();
                }
                await refresh(count ? `${programme.code} deleted. Its students are in ${programmeCode(moveTo)} now.` : `${programme.code} deleted.`);
            }
        });
    };
}

// After an editor opened from Settings saves, Settings stays as it was (tab, search,
// scroll) and only reads its lists again. false when no Settings is open.
function refreshOpenSettings() {
    const settings = document.querySelector('.dialog-backdrop .settings-dialog');
    if (!settings?._reload) return false;
    Promise.resolve(settings._reload()).catch(error => console.warn('Settings did not refresh:', error));
    return true;
}

// A student's profile: who they are, whether their Student ID card is registered
// (its Card ID hidden, like a password), the devices where their card signs them
// in, and their absence requests.
async function showStudentProfileDialog() {
    const cardCount = ownStudentCardCount();
    const email = String(currentUser.email || '').toLowerCase();
    const programme = programmeById(Object.values(databaseMap)
        .find(entry => !entry?.isStaff && String(entry?.email || '').toLowerCase() === email)?.programmeId);

    openDialogMode();
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog student-profile';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'sp-name');
    dialog.innerHTML = `
        <div class="sp-header">
            <a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer" class="profile-avatar-link" title="Manage Google Account" aria-label="Manage Google Account">
                ${userAvatarHtml(currentUserDisplayName(), currentUserPhoto(), 'user-avatar sp-avatar')}
            </a>
            <div class="sp-identity">
                <h3 id="sp-name">${escapeHtml(currentUserDisplayName())}</h3>
                <span class="sp-email">${escapeHtml(currentUser.email)}</span>
                ${programme ? `<span class="sp-email sp-programme"><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i> ${escapeHtml(programmeOptionLabel(programme))}</span>` : ''}
            </div>
            <button type="button" class="btn-icon icon-only-btn" data-action="close" title="Close" aria-label="Close profile"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
        </div>
        <div class="dialog-content sp-content">
            <section class="sp-section" aria-labelledby="sp-card-title">
                <h4 class="sp-section-title" id="sp-card-title">Student ID card</h4>
                ${cardCount ? `
                <div class="sp-card">
                    <span class="sp-card-icon" aria-hidden="true"><i class="fa-solid fa-id-card"></i></span>
                    <span class="sp-card-text">
                        <strong>${cardCount === 1 ? 'Card registered' : `${cardCount} cards registered`}</strong>
                        <span class="sp-masked" aria-label="Card ID hidden">••••••••</span>
                    </span>
                    <button type="button" class="btn-blue btn-sm" data-action="register" title="Got a new card? Update it">Update</button>
                </div>` : `
                <div class="sp-card is-empty">
                    <span class="sp-card-icon" aria-hidden="true"><i class="fa-solid fa-id-card"></i></span>
                    <span class="sp-card-text">
                        <strong>No card registered</strong>
                        <span>Register your Student ID so scans count for you.</span>
                    </span>
                    <button type="button" class="btn-blue btn-sm" data-action="register">Register</button>
                </div>`}
            </section>
            <section class="sp-section sp-devices" aria-labelledby="sp-devices-title">
                <h4 class="sp-section-title" id="sp-devices-title">Card sign-in</h4>
                ${trustedDevicesHtml('Your card signs you in only on a device you trusted, so a card someone else picks up opens nothing. Trust your own phone here; only you see your devices.')}
            </section>
            <section class="sp-section" aria-labelledby="sp-requests-title">
                <div class="sp-section-head">
                    <h4 class="sp-section-title" id="sp-requests-title">Absence requests</h4>
                    <span class="sp-counts"></span>
                </div>
                <div class="sp-requests" aria-live="polite">
                    <div class="sp-empty"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Loading requests...</div>
                </div>
            </section>
        </div>
        <div class="dialog-actions">
            <button type="button" class="btn-orange" data-action="request"><i class="fa-solid fa-hand-point-up" aria-hidden="true"></i> Request for Permission</button>
        </div>`;
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    bindTrustedDevicesSection(dialog);
    reloadTrustedDevices();

    const close = () => {
        backdrop.remove();
        closeDialogMode();
    };
    backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) return close();
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'close') close();
        else if (action === 'register') { close(); showRegisterUIDDialog(); }
        else if (action === 'request') { close(); showRequestPermissionDialog(); }
    });
    dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close();
    });

    const list = dialog.querySelector('.sp-requests');
    try {
        const requests = await callWebApp('getStudentAbsenceRequests', {}, 'POST');
        if (!requests?.length) {
            list.innerHTML = '<div class="sp-empty">No absence requests yet.</div>';
            return;
        }
        const count = status => requests.filter(req => String(req.status || 'Pending').toLowerCase() === status).length;
        dialog.querySelector('.sp-counts').innerHTML = ['pending', 'approved', 'rejected']
            .filter(status => count(status))
            .map(status => `<span class="sp-pill status-${status}">${count(status)} ${status}</span>`).join('');
        list.innerHTML = requests.map(req => {
            const status = String(req.status || 'Pending');
            const [y, m, d] = String(req.absenceDate || '').split('-').map(Number);
            const date = y ? new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : req.absenceDate;
            const note = req.adminNotes
                ? `<p class="sp-request-note"><i class="fa-solid fa-reply" aria-hidden="true"></i><span>${escapeHtml(req.adminNotes)}</span></p>`
                : req.reason ? `<p class="sp-request-note is-reason">${escapeHtml(req.reason)}</p>` : '';
            return `
                <article class="sp-request status-${escapeHtml(status.toLowerCase())}">
                    <div class="sp-request-top">
                        ${courseCellHtml(req.course)}
                        <span class="sp-pill status-${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span>
                    </div>
                    <div class="sp-request-meta">
                        <span><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${escapeHtml(date || '')}</span>
                        <span class="sp-request-hours">${formatHoursAsPills(req.hours)}</span>
                    </div>
                    ${note}
                </article>`;
        }).join('');
    } catch (err) {
        list.innerHTML = '<div class="sp-empty is-error"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> Failed to load requests.</div>';
    }
}

// Function to show the main content when ready
function showMainContent() {
    const loadingIndicator = document.getElementById('app-loading');
    const mainContainer = document.getElementById('main-container');

    isInitializing = false;
    criticalErrorsOnly = false;

    // Lay the page out for the signed-in or signed-out view before it shows, so the
    // crossfade never passes through the default markup (top bar, header banner,
    // Scan History) on its way to the sign-in card.
    updateAuthUI();
    updateUI();

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
    }, 400);

    processPendingNotifications();
}

// Leaves the address on a course without adding a history entry, so Back never
// returns to a link that only redirects again.
function replaceRouteCourse(course) {
    history.replaceState(null, '', window.location.pathname + window.location.search + (course ? '#' + encodeURIComponent(course) : ''));
}

// event is the hashchange (Back, Forward, an edited address); without one, this
// is the address the page opened with.
function handleRouting(event) {
    if (isInitializing) {
        return;
    }

    const hash = getRouteCourse();
    const fallbackCourse = () => currentCourse || (availableCourses.length > 0 ? availableCourses[0] : '');

    // Locked, the course stays the one the lock protects; Back does not change it.
    if (isScanLockScreenShown()) {
        if (hash !== currentCourse) replaceRouteCourse(currentCourse);
        return;
    }

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
    // Case 4: The course doesn't exist at all (not in the full map).
    // Either way the address goes back to the course on screen. Only a link the
    // page opened with is reported; going Back to an old address is quiet.
    const denied = !!courseInfoMap[hash];
    console.warn(denied ? 'Access denied to course:' : 'Course not found:', hash);
    const course = fallbackCourse();
    replaceRouteCourse(course);
    if (course && course !== currentCourse) handleCourseChange(course);
    if (!event) {
        showNotification(denied ? 'error' : 'warning', denied ? 'Access Denied' : 'Course Not Found',
            denied ? 'You do not have access to this course.' : 'That link is for a course that no longer exists.');
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
    const rows = StandoData.studentExportRows(databaseMap, programmeCode);
    if (rows.length === 1) return showNotification('warning', 'Export Failed', 'There are no students to export.');
    writeStudentWorkbook(rows, 'students.xlsx');
    showNotification('success', 'Export Complete', `${rows.length - 1} students exported. This file can be imported again.`);
}

function writeStudentWorkbook(rows, filename) {
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 30 }, { wch: 24 }, { wch: 38 }, { wch: 14 }, { wch: 28 }];
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
                    <thead><tr><th>Name</th><th>Card ID</th><th>Email</th>${programmeList ? '<th>Programme</th>' : ''}</tr></thead>
                    <tbody><tr><td>Example Student</td><td>001234</td><td>student@example.edu</td>${programmeList ? '<td>BA CE</td>' : ''}</tr></tbody>
                </table>
            </div>
            <p>Keep Card IDs as text to preserve leading zeros.${programmeList ? ' Programme is optional: use a code from Settings → Programmes, or choose one programme for the whole file in the next step.' : ''} Use the template if you need a starting file.</p>
            <button type="button" id="student-template-btn" class="btn-blue btn-sm"><i class="fa-solid fa-download"></i> Download Template</button>
        </div>
        <div class="dialog-actions">
            <button type="button" id="cancel-student-guide" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button type="button" id="choose-student-file" class="btn-green"><i class="fa-solid fa-folder-open"></i> Choose File</button>
        </div></div>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('#student-template-btn').onclick = () => writeStudentWorkbook([StandoData.studentColumns.slice(0, programmeList ? 4 : 3)], 'student_import_template.xlsx');
    backdrop.querySelector('#cancel-student-guide').onclick = () => backdrop.remove();
    backdrop.querySelector('#choose-student-file').onclick = () => {
        backdrop.remove();
        excelInput.click();
    };
}

// ============================================================
// COURSE APPEARANCE
// Each course has an icon, on its course button, and five colours, the same five
// as Syllabase's. Administrators set them in the course's settings (courses.icon
// and courses.theme). While a course is on screen the page takes its colours, for
// everyone. A colour left as Stando's sets nothing, so the stylesheet's own shades
// show; a chosen one sets --<family>-main and .theme-<family>, and the stylesheet
// mixes the family's other shades from it, light and dark (styles.css, "Theme
// colours"). Red, for deleting, is the same in every course. This browser keeps
// the last course's colours to paint them before the courses load (index.html, embed.js).
// ============================================================
const THEME_FAMILIES = [
    { id: 'primary', label: 'Primary', hint: 'Header, course buttons and dates', fallback: '#3949ab' },
    { id: 'secondary', label: 'Secondary', hint: 'Requests and warnings', fallback: '#fb8c00' },
    { id: 'tertiary', label: 'Tertiary', hint: 'Information', fallback: '#2196f3' },
    { id: 'accent', label: 'Accent', hint: 'Scan times', fallback: '#1e88e5' },
    { id: 'success', label: 'Success', hint: 'Adding and approving', fallback: '#43a047' }
];
const COLOUR_THEME_KEY = 'stando_colours';
const DEFAULT_COURSE_ICON = 'fa-solid fa-table-list';
const FA_SEARCH_URL = 'https://fontawesome.com/search?ic=free-collection';

// "#abc", "abc" or "#AABBCC" → "#aabbcc"; anything else → ''.
function normalizeHexColour(value) {
    const hex = String(value || '').trim().replace(/^#?/, '#').toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(hex)) return '#' + [...hex.slice(1)].map(c => c + c).join('');
    return /^#[0-9a-f]{6}$/.test(hex) ? hex : '';
}

// Only the colours that differ from Stando's own.
function cleanColourTheme(theme) {
    const clean = {};
    THEME_FAMILIES.forEach(({ id, fallback }) => {
        const hex = normalizeHexColour(theme?.[id]);
        if (hex && hex !== fallback) clean[id] = hex;
    });
    return clean;
}

// Paints the page, or one preview (a .theme-scope), in these colours.
function applyColourTheme(theme, target = document.documentElement) {
    const clean = cleanColourTheme(theme);
    THEME_FAMILIES.forEach(({ id }) => {
        if (clean[id]) target.style.setProperty(`--${id}-main`, clean[id]);
        else target.style.removeProperty(`--${id}-main`);
        target.classList.toggle(`theme-${id}`, !!clean[id]);
    });
    return clean;
}

// Paints the page and remembers the colours for the next start.
function useColourTheme(theme) {
    const clean = applyColourTheme(theme);
    try {
        if (Object.keys(clean).length) localStorage.setItem(COLOUR_THEME_KEY, JSON.stringify(clean));
        else localStorage.removeItem(COLOUR_THEME_KEY);
    } catch { /* Painted at the next course change instead. */ }
}

function applyCourseAppearance(course) {
    useColourTheme(courseInfoMap[course]?.theme);
}

// Font Awesome icons, as in Syllabase: a field takes an icon's class
// ("fa-solid fa-cube") or the tag Font Awesome copies
// (<i class="fa-solid fa-cube"></i>) and keeps the class. '' when it is neither.
function faIconClass(value) {
    const text = String(value || '').trim();
    const match = text.match(/class\s*=\s*["']([^"']*)["']/i);
    const cls = (match ? match[1] : text.replace(/<\/?i\b[^>]*>/gi, '')).trim().replace(/\s+/g, ' ').toLowerCase();
    return /^[a-z0-9 -]{1,100}$/.test(cls) ? cls : '';
}

// A preview's markup. Font Awesome's script replaces each <i> with an <svg>, so
// previews are redrawn with a new <i>; changing the class of the old one does nothing.
function faIconHtml(cls, extraClass = '') {
    return `<i class="${escapeHtml(faIconClass(cls) || DEFAULT_COURSE_ICON)}${extraClass ? ` ${extraClass}` : ''}" aria-hidden="true"></i>`;
}

// The course in its colours, drawn as Syllabase's preview: the header with the
// course's icon, a day heading with its scan times, and a pill per colour.
function themePreviewHtml({ code = 'CE 121', title = 'Civil Engineering Drawing', icon = '' } = {}) {
    const now = new Date();
    const date = [now.getDate(), now.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('-') + `-${now.getFullYear()}`;
    return `
        <div class="theme-preview theme-scope" aria-hidden="true">
            <div class="tp-header">
                <span class="tp-icon" data-icon-preview>${faIconHtml(icon)}</span>
                <div class="tp-head-text">
                    <div class="tp-title">${escapeHtml(title || code || 'Course')}</div>
                    <div class="tp-sub">${escapeHtml(code || 'CE 121')}, Attendance</div>
                </div>
                <span class="tp-chip"><i class="fa-solid fa-wifi" aria-hidden="true"></i> Scanning</span>
            </div>
            <div class="tp-body">
                <div class="tp-module"><i class="fa-solid fa-calendar-day" aria-hidden="true"></i>${date} — Theory A</div>
                <div class="tp-row">
                    <span class="tp-time">09:00</span><span class="tp-time">09:10</span><span class="tp-time">09:15</span>
                    <span class="tp-badge"><i class="fa-solid fa-hand-point-up" aria-hidden="true"></i> Requests <b>3</b></span>
                </div>
                <div class="tp-row">
                    ${THEME_FAMILIES.map(family => `<span class="tp-pill is-${family.id}">${family.label}</span>`).join('')}
                </div>
            </div>
        </div>`;
}

// A course's icon and colours in its settings, with a live preview. Lecturers
// see them; administrators change them (bindAppearanceFields).
function appearanceFieldsHtml(data, { code, title, editable }) {
    const off = editable ? '' : ' disabled';
    const theme = cleanColourTheme(data?.theme);
    const icon = faIconClass(data?.icon);
    const value = family => theme[family.id] || family.fallback;
    return `
        <div class="appearance-fields">
            <div class="form-group">
                <label class="dialog-label-fixed" for="edit-c-icon">Course Icon <span class="theme-label-note">Font Awesome class or &lt;i&gt; tag, e.g. fa-solid fa-cube</span></label>
                <div class="icon-input-wrap">
                    <input type="text" id="edit-c-icon" class="form-control" value="${escapeHtml(icon)}" placeholder="${DEFAULT_COURSE_ICON}" spellcheck="false" autocomplete="off"${off}>
                    <span class="fa-preview" data-icon-preview>${faIconHtml(icon)}</span>
                    <a class="icon-find-link" href="${FA_SEARCH_URL}" target="_blank" rel="noopener noreferrer" title="Find an icon on Font Awesome" aria-label="Find an icon on Font Awesome"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i></a>
                </div>
            </div>
            <div class="form-group">
                <label class="dialog-label-fixed">Theme Colours <span class="theme-label-note">pick a swatch or type a hex value</span></label>
                <div class="theme-colours">
                    ${THEME_FAMILIES.map(family => `
                    <div class="theme-colour" title="${family.label}: ${family.hint.toLowerCase()}">
                        <input type="color" id="theme-${family.id}" value="${value(family)}" aria-label="${family.label} colour (${family.hint.toLowerCase()})"${off}>
                        <input type="text" class="form-control theme-hex" id="theme-${family.id}-code" value="${value(family)}" maxlength="7" spellcheck="false" autocomplete="off" aria-label="${family.label} colour code"${off}>
                        <span class="theme-colour-name">${family.label}</span>
                        <span class="theme-colour-hint">${family.hint}</span>
                    </div>`).join('')}
                </div>
                ${themePreviewHtml({ code, title, icon })}
                <p class="form-hint theme-note">Live preview of the course with these colours. Everyone sees them while this course is open.${editable ? ' <button type="button" class="link-btn" id="theme-reset-btn">Reset to default colours</button>' : ''}</p>
            </div>
        </div>`;
}

// Typing an icon or picking a colour (or typing its code) repaints the preview.
// validate() checks the icon; read() gives { icon, theme } to save: the icon's
// class ('' for the usual one) and the colours that differ from Stando's.
function bindAppearanceFields(root) {
    const section = root.querySelector('.appearance-fields');
    if (!section) return null;
    const preview = section.querySelector('.theme-preview');
    const iconInput = section.querySelector('#edit-c-icon');
    const fields = THEME_FAMILIES.map(family => ({
        family,
        swatch: section.querySelector(`#theme-${family.id}`),
        code: section.querySelector(`#theme-${family.id}-code`)
    }));
    const readTheme = () => Object.fromEntries(fields.map(({ family, swatch }) => [family.id, swatch.value]));
    const repaint = () => applyColourTheme(readTheme(), preview);
    const set = (field, hex) => {
        field.swatch.value = hex;
        field.code.value = hex;
        field.code.classList.remove('is-invalid');
    };
    fields.forEach(field => {
        field.swatch.addEventListener('input', () => { set(field, field.swatch.value); repaint(); });
        field.code.addEventListener('input', () => {
            const hex = normalizeHexColour(field.code.value);
            field.code.classList.toggle('is-invalid', !hex);
            if (!hex) return;
            field.swatch.value = hex;
            repaint();
        });
        field.code.addEventListener('blur', () => set(field, field.swatch.value));
    });
    // A pasted tag becomes its class as it arrives; the previews follow.
    iconInput.addEventListener('input', () => {
        if (/[<>]|class\s*=/i.test(iconInput.value)) iconInput.value = faIconClass(iconInput.value);
        clearInputError(iconInput);
        const html = faIconHtml(iconInput.value);
        section.querySelectorAll('[data-icon-preview]').forEach(el => { el.innerHTML = html; });
    });
    section.querySelector('#theme-reset-btn')?.addEventListener('click', () => {
        fields.forEach(field => set(field, field.family.fallback));
        repaint();
    });
    repaint();
    return {
        validate() {
            if (!iconInput.value.trim() || faIconClass(iconInput.value)) return true;
            showInputError(iconInput, 'Use a Font Awesome class, such as fa-solid fa-cube.');
            iconInput.focus();
            return false;
        },
        read: () => ({ icon: faIconClass(iconInput.value), theme: cleanColourTheme(readTheme()) })
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
    if (!isOnline || !isSignedIn || isSyncing) return;

    // With nothing waiting, the regular check stays quiet.
    const hadChanges = refreshPendingChanges();
    try {
        isSyncing = true;
        if (hadChanges) updateSyncStatus('Saving…', 'syncing');

        await syncLogsWithSheet();

        lastSyncTime = Date.now();
        syncAttempts = 0;
        isSyncing = false;
        if (hadChanges) showSyncState();
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

// "Thu 15 Oct" for a request's YYYY-MM-DD date, with the year when it is not this one.
function formatRequestDate(dateStr) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
    if (!match) return String(dateStr || '');
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const options = { weekday: 'short', day: 'numeric', month: 'short' };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
    return date.toLocaleDateString('en-GB', options).replace(',', '');
}

// A request's day as a pill: a calendar and "Thu 15 Oct".
function requestDatePillHtml(dateStr) {
    return dateStr
        ? `<span class="req-pill is-date" title="${escapeHtml(dateStr)}"><i class="fa-regular fa-calendar" aria-hidden="true"></i>${escapeHtml(formatRequestDate(dateStr))}</span>`
        : '';
}

// Request details: the day and then each hour ("12:40–13:30") as pills, in a row that wraps.
function requestWhenHtml(dateStr, hoursString) {
    const hours = String(hoursString || '').split(',').map(hour => hour.trim()).filter(Boolean);
    const hourPills = hours.map(hour => `<span class="req-pill">${escapeHtml(hour.replace(/\s*-\s*/, '–'))}</span>`).join('');
    return `<span class="req-when">${requestDatePillHtml(dateStr)}${hourPills}</span>`;
}

// The pending list: the day, then "Medical for 3 h"; the hours show in the dialog.
function requestSummaryHtml(dateStr, hoursString, reason) {
    const count = String(hoursString || '').split(',').filter(hour => hour.trim()).length;
    const amount = count ? `${count} h` : '';
    const text = reason ? (amount ? `${reason} for ${amount}` : reason) : amount;
    return `<span class="req-when">${requestDatePillHtml(dateStr)}${text ? `<span class="req-reason">${escapeHtml(text)}</span>` : ''}</span>`;
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
    dialog.setAttribute('class', 'dialog eis-export-dialog');
    dialog.setAttribute('role', 'dialog');

    const formattedCourseName = getCourseLabel(currentCourse);

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

                <div class="form-group" id="export-group-field">
                    <label class="dialog-label-fixed"><i class="fa-solid fa-users"></i> Group</label>
                    <div class="segment-rows">
                        <div id="export-cat-group" class="segment-track"></div>
                        <div id="export-subgroup-group" class="segment-track"></div>
                    </div>
                </div>

                <div class="form-group">
                    <label class="dialog-label-fixed" for="export-topic"><i class="fa-solid fa-quote-left"></i> Topic</label>
                    <input type="text" id="export-topic" class="form-control" autocomplete="off">
                </div>

                <details class="more-settings eis-more-options">
                    <summary>More options<span class="eis-more-peek" id="export-options-peek"></span></summary>
                    <div class="eis-more-body">
                        <div class="form-group">
                            <label class="dialog-label-fixed">Category</label>
                            <div id="export-section-group" class="segment-track">
                                ${segmentButtonHtml('data-value="theory"', SESSION_ICONS.theory, 'Theory')}
                                ${segmentButtonHtml('data-value="lab"', SESSION_ICONS.lab, 'Lab')}
                                ${segmentButtonHtml('data-value="practice"', SESSION_ICONS.practice, 'Practice')}
                            </div>
                        </div>
                        ${switchRowHtml('manual-hours-check', false, 'Set the hours', 'Otherwise EIS fills in the hours of the section.')}
                        <div class="form-group" id="export-hours-field" hidden>
                            <label class="dialog-label-fixed" for="hours-custom-input">Hours</label>
                            <input type="number" id="hours-custom-input" class="form-control" value="2" min="1" max="25">
                        </div>
                        ${switchRowHtml('mark-exempted-option', false, 'Mark exempted students absent', 'Students marked R EX in EIS, even if they scanned.')}
                        ${switchRowHtml('mark-missing-option', false, 'Mark students not in Stando absent', 'Students in EIS who are not in the Student List.')}
                        ${switchRowHtml('new-tab-option', false, 'Open EIS in a new tab', 'Stando stays open in this tab.')}
                        <button type="button" id="save-export-btn" class="btn-secondary btn-sm eis-export-file-btn"><i class="fa-solid fa-file-export"></i> Export to file</button>
                    </div>
                </details>
            </div>
        </div>
        <div class="dialog-actions">
            <button id="cancel-export-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
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

    const closeDialog = () => { document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    const courseMetadata = getCourseMetadata(currentCourse);
    const sectionsMap = parseAvailableSections(courseMetadata?.availableSections || '');
    const categories = Object.keys(sectionsMap);

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

    // --- Group, Category and Topic ---
    // Group is the course's sections, Category what EIS calls the class. A row with a
    // single choice is not shown; that choice is still the one sent.
    let selectedCategory = null;
    let selectedSubgroup = null;
    let selectedSection = 'theory';

    const groupField = document.getElementById('export-group-field');
    const catContainer = document.getElementById('export-cat-group');
    const subContainer = document.getElementById('export-subgroup-group');
    const sectionContainer = document.getElementById('export-section-group');
    const topicInput = document.getElementById('export-topic');
    const optionsPeek = document.getElementById('export-options-peek');

    catContainer.innerHTML = categories.map(cat =>
        segmentButtonHtml(`data-category="${escapeHtml(cat)}"`, SESSION_ICONS[cat.toLowerCase()] || 'fa-tag', cat)).join('');
    catContainer.hidden = categories.length <= 1;

    const markActive = (track, isActive, animate) => {
        track.querySelectorAll(':scope > .course-button').forEach(btn => btn.classList.toggle('active', isActive(btn)));
        updateSegmentThumb(track, animate);
    };

    // The topic follows the category and week (Lecture 2, Practice 2, Laboratory 2)
    // until it is edited; emptying it lets it follow again.
    const topicNames = { theory: 'Lecture', practice: 'Practice', lab: 'Laboratory' };
    let autoTopic = '';
    const fillTopic = () => {
        if (topicInput.value.trim() && topicInput.value !== autoTopic) return;
        autoTopic = `${topicNames[selectedSection] || 'Lecture'} ${weekSelect.value}`;
        topicInput.value = autoTopic;
    };

    // Closed, More options still names the Category it sends.
    const selectSection = (section, animate = true) => {
        selectedSection = section;
        markActive(sectionContainer, btn => btn.dataset.value === section, animate);
        const chosen = [...sectionContainer.children].find(btn => btn.dataset.value === section);
        optionsPeek.textContent = chosen?.querySelector('.tab-label')?.textContent || '';
        fillTopic();
    };

    // Picking a category also sets the Category; picking a letter leaves it.
    const selectGroup = (category, subgroup, animate = true) => {
        const groups = sectionsMap[category] || [];
        const categoryChanged = category !== selectedCategory;
        selectedCategory = category;
        selectedSubgroup = groups.includes(subgroup) ? subgroup : (groups[0] || null);
        markActive(catContainer, btn => btn.dataset.category === category, animate);
        if (categoryChanged) {
            setSegmentOptions(subContainer, groups.map(grp => segmentButtonHtml(`data-group="${escapeHtml(grp)}"`, '', grp)).join(''));
            subContainer.hidden = groups.length <= 1;
            groupField.hidden = catContainer.hidden && subContainer.hidden;
        }
        markActive(subContainer, btn => btn.dataset.group === selectedSubgroup, animate);
        if (categoryChanged) selectSection(category.toLowerCase(), animate);
    };

    // The group to start on: the first one, in the course's order, that has scans on
    // the chosen date (only Practice that day → Practice). With none, the course's first.
    const defaultGroup = (onlyCategory = null) => {
        const sessions = new Set();
        (courseData[currentCourse]?.logs || []).forEach(log => {
            if (log.session && localDateString(new Date(log.timestamp)) === dateInput.value) sessions.add(log.session);
        });
        for (const category of onlyCategory ? [onlyCategory] : categories) {
            const groups = sectionsMap[category] || [];
            const scanned = groups.length
                ? groups.find(grp => sessions.has(`${category} ${grp}`))
                : [...sessions].some(session => session.split(' ')[0] === category);
            if (scanned) return { category, subgroup: groups.length ? scanned : null };
        }
        const category = onlyCategory || categories[0] || 'Theory';
        return { category, subgroup: sectionsMap[category]?.[0] || null };
    };

    const startGroup = defaultGroup();
    selectGroup(startGroup.category, startGroup.subgroup, false);

    catContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (!btn || btn.dataset.category === selectedCategory) return;
        selectGroup(btn.dataset.category, defaultGroup(btn.dataset.category).subgroup);
    });
    subContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (btn) selectGroup(selectedCategory, btn.dataset.group);
    });
    sectionContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (btn) selectSection(btn.dataset.value);
    });
    // A track that was hidden (the closed More options, the loader) places its thumb once shown.
    [catContainer, subContainer, sectionContainer].forEach(track => watchButtonRows(track, followSegmentThumb));

    // Picking another date moves the week with it, and the group to that day's.
    dateInput.addEventListener('change', () => {
        if (courseMetadata && dateInput.value) setWeek(calculateWeekForDate(courseMetadata, new Date(dateInput.value)));
        const { category, subgroup } = defaultGroup();
        selectGroup(category, subgroup);
        fillTopic();
    });
    weekSelect.addEventListener('change', fillTopic);

    // --- More options ---
    const hoursInput = document.getElementById('hours-custom-input');
    const manualCheck = document.getElementById('manual-hours-check');
    const hoursField = document.getElementById('export-hours-field');

    hoursInput.value = parseInt(courseMetadata?.defaultHours || 2);
    manualCheck.addEventListener('change', () => {
        hoursField.hidden = !manualCheck.checked;
        if (manualCheck.checked) hoursInput.focus({ preventScroll: true });
    });

    // Prefs
    ['mark-exempted-option', 'new-tab-option', 'mark-missing-option'].forEach(id => {
        const cb = document.getElementById(id);
        const saved = localStorage.getItem(`eis_pref_${id}`);
        if (saved !== null) cb.checked = JSON.parse(saved);
        else if (id !== 'mark-exempted-option') cb.checked = true;
        cb.addEventListener('change', () => localStorage.setItem(`eis_pref_${id}`, cb.checked));
    });

    const moreOptions = dialog.querySelector('.eis-more-options');
    try { moreOptions.open = localStorage.getItem('eis_pref_more-options') === '1'; } catch { /* Closed. */ }
    moreOptions.addEventListener('toggle', () => {
        try { localStorage.setItem('eis_pref_more-options', moreOptions.open ? '1' : '0'); } catch { /* Not remembered. */ }
    });

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

        // Only what the EIS importer needs, by name: the hours each student scanned in
        // this group that day, and everyone this course has seen, so a row EIS lists
        // but Stando never saw stands out. No card IDs, and not the whole Student List.
        const studentName = key => (key && !databaseMap[key]?.isStaff) ? String(databaseMap[key]?.name || '').trim() : '';
        const attendance = {};
        Object.entries(uidCounts).forEach(([key, count]) => {
            const name = studentName(key);
            if (name) attendance[name] = (attendance[name] || 0) + count;
        });
        const known = new Set(Object.keys(attendance));
        logsForCourse.forEach(log => {
            const name = studentName(lookupPrimaryUid(log.uid));
            if (name) known.add(name);
        });

        return {
            version: 2,
            parameters: {
                eisId: String(eisId),
                week: weekSelect.value,
                hours: hoursInput.value,
                category: selectedSection,
                date: dateInput.value,
                topic: topicInput.value,
                course: currentCourse,
                section: sectionParam
            },
            options: {
                markMissingAsAbsent: document.getElementById('mark-missing-option').checked,
                markExemptedAsAbsent: document.getElementById('mark-exempted-option').checked,
                manualHours: document.getElementById('manual-hours-check').checked // <-- KEY FLAG
            },
            attendance,
            known: [...known]
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
    const hasStoredSession = Object.keys(localStorage).some(isStoredSessionKey);
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
    notificationArea = document.getElementById('in-page-notification-area');
    successSound = document.getElementById('success-sound');
    errorSound = document.getElementById('error-sound');
    // Sounds may start only after a tap or click; the first one prepares them.
    const prepareSoundsOnce = () => {
        prepareScanSounds();
        if (soundContext?.state === 'running') document.removeEventListener('pointerdown', prepareSoundsOnce, true);
    };
    document.addEventListener('pointerdown', prepareSoundsOnce, true);
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

    // Scanning is on in any browser that offers Web NFC on an HTTPS page, rather
    // than a list of browser names: Chrome on Android does, and other Android
    // browsers (Edge, Samsung Internet, Opera and more) can. A phone without an
    // NFC chip, or with NFC switched off, says so when scanning starts.
    nfcSupported = 'NDEFReader' in window && window.isSecureContext;
    console.log(nfcSupported ? 'Web NFC available' : 'Web NFC not available in this browser');

    // Only where it helps: an Android browser without Web NFC. iPhones never
    // scan, and their students register through a friend's phone instead.
    if (!nfcSupported && /Android/i.test(navigator.userAgent)) {
        pendingNotifications.push({
            type: 'warning',
            title: 'NFC Unsupported',
            message: "This browser can't scan cards. To scan, open Stando in Google Chrome."
        });
    }

    updateScanButtons();

    // Set up event listeners
    setupEventListeners();
    setupScanLock();
    setupIdleSignOut();

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
    setupAuthStateTracking();

    // Scanning never starts on its own; the user starts it manually.

    // This prevents the phone from sleeping and killing the sync process
    if ('wakeLock' in navigator) {
        // Asked for now, again whenever Stando is back on screen (the browser drops
        // it when the page is hidden), and when scanning starts (keepScreenAwake).
        keepScreenAwake();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') keepScreenAwake();
        });

        // AMOLED Burn-in Prevention: Subtle pixel shifting every 2 minutes
        // Shifts content by ±2 pixels - imperceptible to users but prevents static burn-in
        // Note: Applied to main-container to avoid breaking position:fixed elements (notifications, cat).
        // It moves by offsets, not a transform: a transform would keep the whole tall page
        // as one GPU layer, which phones draw late (white or garbled patches while scrolling).
        const mainContainer = document.getElementById('main-container');
        if (mainContainer) {
            setInterval(() => {
                // Only apply shift when no dialogs are open
                if (dialogOpenCount === 0) {
                    mainContainer.style.position = 'relative';
                    mainContainer.style.left = `${Math.floor(Math.random() * 5) - 2}px`; // -2 to +2 pixels
                    mainContainer.style.top = `${Math.floor(Math.random() * 5) - 2}px`;
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

        // Coming back from Google is a new sign-in, not a session reopened after
        // a break; noted before the session swallows the code in the address.
        const oauthReturn = /[?#&](code|access_token)=/.test(window.location.href);

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
            onSuccessfulAuth(!(oauthReturn || originalHash !== null));
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

        // Coming back after the inactivity limit signs out at once, unless
        // attendance on this device still waits to sync.
        if (isRestore && isIdleSessionStale()) {
            signOutForInactivity();
            return;
        }
        noteActivity(true);

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
            assistantCourses = bootData.adminStatus.assistantCourses || [];
            console.log('Admin status:', { isAdmin, isGlobalAdmin, adminCourses, assistantCourses });
        }

        // A staff member's custom name (for example with a title) and photo replace
        // the Google ones in the top bar. After a staff card sign-in the session has
        // no Google details, so the Google name and photo stored with the staff
        // profile fill in. Loaded alongside the rest; never blocks.
        sbGetStaffProfiles().then(profiles => {
            const own = profiles.get(String(currentUser?.email || '').trim().toLowerCase());
            if (!own || !currentUser) return;
            currentUser.staffName = own.name || (currentUser.name === currentUser.email ? own.googleName : '');
            currentUser.staffPhoto = own.photo;
            renderUserChip();
        });
        // Scanning needs a trusted device; knowing now lets it start offline later.
        if (isAdmin) checkDeviceTrusted();

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
        }

        setProgrammeList(bootData.programmes);

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
        applyCourseAppearance(currentCourse);
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
    const scope = canRecordInCourse(courseName) ? 'admin' : 'student';
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

// An EPOKA ID card held against the back of a phone, lowered from above at a
// slight tilt, as a hand does. Without motion it shows the card in place. The
// frame is cropped to the drawing, so the size set in CSS is all illustration.
function cardTapAnimationHtml({ label = 'STUDENT ID CARD' } = {}) {
    // Field labels on the card end where their white boxes begin, as printed.
    const fields = [12, 11, 8, 12, 13].map((width, row) => {
        const y = 17 + row * 5.2;
        return `<rect class="tap-card-label" x="${47 - width}" y="${y + 1}" width="${width}" height="1.6" rx="0.8"/>
                    <rect class="tap-card-field" x="49" y="${y}" width="36" height="3.6" rx="0.6"/>`;
    }).join('');
    return `
        <svg class="card-tap" viewBox="30 0 140 150" aria-hidden="true" focusable="false">
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
            <g transform="translate(55 52)">
                <g class="tap-card">
                    <rect class="tap-card-body" width="90" height="57" rx="4.5"/>
                    <path class="tap-card-skyline" d="M3 54v-5h3v-3h4v5h3v-7h5v7h4v-3h6v3h5v-5h3v5h7v-4h4v4h6v-2h5v2h8v-3h4v3h6v-5h3v5h4"/>
                    <path class="tap-card-mark" d="M6 5h6v4.2c0 1.9-1.4 3.1-3 3.7-1.6-.6-3-1.8-3-3.7z"/>
                    <text class="tap-card-text" x="14" y="11" font-size="5" textLength="38" lengthAdjust="spacingAndGlyphs"><tspan font-weight="800">EPOKA</tspan> UNIVERSITY</text>
                    <text class="tap-card-text" x="85" y="10.4" font-size="2.9" font-weight="700" text-anchor="end" textLength="${(label.length * 1.55).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${escapeHtml(label)}</text>
                    <rect class="tap-card-photo" x="6" y="17" width="18" height="24" rx="0.8"/>
                    ${fields}
                    <text class="tap-card-text tap-card-site" x="85" y="47" font-size="2.6" text-anchor="end" textLength="13" lengthAdjust="spacingAndGlyphs">epoka.edu.al</text>
                </g>
            </g>
            <g class="tap-check">
                <circle cx="146" cy="22" r="13"/>
                <path d="M140 22.5l4.2 4.2 7.8-8.4"/>
            </g>
        </svg>`;
}

// How many cards the signed-in student has registered, from the student list.
function ownStudentCardCount() {
    const email = String(currentUser?.email || '').toLowerCase();
    if (!email) return 0;
    const own = Object.values(databaseMap).find(entry => !entry?.isStaff && String(entry?.email || '').toLowerCase() === email);
    return new Set([...(own?.uids || []), ...(own?.hardware_uids || []).map(convertUidToExternalId)]
        .map(id => String(id || '').trim()).filter(Boolean)).size;
}

// "Update Card ID" once a card is registered: students get new cards.
function updateRegisterCardButton() {
    const button = document.getElementById('register-uid-btn');
    if (!button || isAdmin) return;
    const label = ownStudentCardCount() ? 'Update Card ID' : 'Register Card ID';
    const text = button.querySelector('.btn-text');
    if (text && text.textContent !== label) text.textContent = label;
    button.title = label;
    button.setAttribute('aria-label', label);
}

// Students register their card by scanning it. "Scan for a friend" goes through
// the same steps for a classmate's card (an iPhone cannot scan): their name, email
// and programme are typed in, and the request names them as the student and this
// account as who scanned it. Phones that cannot scan are told to ask such a friend.
function showRegisterUIDDialog() {
    if (!isSignedIn || isAdmin || !currentUser) return;
    // A student with a card registered may have a new one; helping a friend works either way.
    const updating = ownStudentCardCount() > 0;

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog reg-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'reg-dialog-title');
    dialog.innerHTML = `
        <h3 class="dialog-title" id="reg-dialog-title"><i class="fa-solid fa-id-card"></i> <span class="reg-dialog-name"></span></h3>
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
    let card = null;
    let forFriend = false;
    let friend = { name: '', email: '' };
    let manualReason = '';
    let currentStep = '';
    // A student updating their card starts from the programme they have; a friend's is chosen.
    const ownEntry = Object.values(databaseMap).find(entry => !entry?.isStaff && String(entry?.email || '').toLowerCase() === String(currentUser.email || '').toLowerCase());
    const ownProgrammeId = programmeById(ownEntry?.programmeId) ? ownEntry.programmeId : null;
    let programmeId = ownProgrammeId;

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
            <button type="button" class="reg-link" data-action="help">Ask a friend to scan it instead</button>
        </div>`;
    // The small switch in the corner: a friend's card, and back to one's own.
    const modeHtml = () => nfcSupported ? `
        <div class="reg-mode-row"><button type="button" class="reg-mode" data-action="mode">${forFriend
            ? '<i class="fa-solid fa-id-card" aria-hidden="true"></i> My own card'
            : '<i class="fa-solid fa-user-group" aria-hidden="true"></i> Scan for a friend'}</button></div>` : '';
    const accountHtml = () => `<p class="reg-account">Sending as <strong>${escapeHtml(currentUser.name)}</strong><br>${escapeHtml(currentUser.email)}</p>`;
    // What the administrator will read: the friend as the student, scanned by this account.
    const friendNoteHtml = () => `<p class="reg-account">Sending for <strong class="reg-friend-who">${escapeHtml(friend.name || 'your friend')}</strong><br>Scanned by ${escapeHtml(currentUserDisplayName())}</p>`;
    const programmeHtml = () => programmeFieldHtml('reg-programme', programmeId, { placeholder: forFriend ? 'Choose their programme' : 'Choose your programme' });

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

    // The card goes as read; a friend's with the name and email typed for them.
    const submit = (submitBtn) => {
        const programmeSelect = content.querySelector('#reg-programme');
        if (!readProgrammeField(programmeSelect).ok) {
            programmeSelect.focus();
            return;
        }
        let name = currentUser.name;
        let email = currentUser.email;
        if (forFriend) {
            const nameInput = content.querySelector('#reg-friend-name');
            const emailInput = content.querySelector('#reg-friend-email');
            clearInputError(nameInput);
            clearInputError(emailInput);
            name = nameInput.value.replace(/\s+/g, ' ').trim();
            email = emailInput.value.trim().toLowerCase();
            let valid = true;
            if (!name) {
                showInputError(nameInput, "Type your friend's name and surname.");
                valid = false;
            }
            if (!isValidEmail(email)) {
                showInputError(emailInput, "Type your friend's email.");
                valid = false;
            } else if (email === String(currentUser.email || '').toLowerCase()) {
                showInputError(emailInput, 'That is your own email. For your own card, choose My own card.');
                valid = false;
            }
            if (!valid) {
                content.querySelector('[aria-invalid="true"]')?.focus();
                return;
            }
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending...';
        const restore = () => {
            submitBtn.disabled = false;
            submitBtn.textContent = forFriend ? 'Send' : 'Submit';
        };

        callWebApp('submitRegistration', {
            name, email,
            uid: card.cardId,
            hardwareUid: card.hardwareUid,
            programmeId,
            source: forFriend ? 'friend' : 'scan'
        }, 'POST')
            .then(data => {
                if (data && data.result === 'success') {
                    showNotification('success', 'Submission Sent!', forFriend
                        ? `${name}'s card has been sent for approval.`
                        : 'Your card application has been sent for approval.');
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
        // Android with NFC: scan the card, one's own or a friend's.
        scan() {
            content.innerHTML = `
                ${modeHtml()}
                ${forFriend
                    ? notice("Scan your friend's Student ID card.", 'Then type their name and email. Nothing is sent as yours.')
                    : notice(updating ? 'Scan your new Student ID card.' : 'Scan your Student ID card.', 'Your Student ID No. printed on it is not the number Stando uses; the card is read from its chip.')}
                ${cardTapAnimationHtml()}
                <p class="reg-instruction">Hold the card flat against the <strong>back of your phone</strong> and keep it still until it beeps.</p>
                <p class="reg-hint">No beep? Slide the card slowly around the back, towards the camera.</p>
                ${statusHtml}`;
            actions.innerHTML = `<button type="button" id="cancel-register-btn" class="btn-secondary" data-action="cancel">Cancel</button>`;
            readCard(read => { card = read; show('review'); });
        },
        // The card read, hidden like a password; a friend's name and email under it.
        review() {
            content.innerHTML = `
                ${modeHtml()}
                <div class="reg-result"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span class="reg-result-label">${forFriend ? "Friend's card scanned" : 'Card scanned'}</span><span class="reg-result-id is-masked" aria-label="Card ID hidden">••••••••</span></div>
                ${forFriend ? `
                <div class="form-group">
                    <label class="dialog-label-fixed" for="reg-friend-name">Their name <span class="required">*</span></label>
                    <input type="text" id="reg-friend-name" class="form-control" placeholder="Name Surname" maxlength="120" autocomplete="off" value="${escapeHtml(friend.name)}">
                </div>
                <div class="form-group">
                    <label class="dialog-label-fixed" for="reg-friend-email">Their email <span class="required">*</span></label>
                    <input type="email" id="reg-friend-email" class="form-control" placeholder="nsurname@epoka.edu.al" autocomplete="off" value="${escapeHtml(friend.email)}">
                </div>`
                    : `<p class="reg-instruction">${!programmeHtml() ? 'Submit it' : programmeId ? 'Check your programme, then submit' : 'Choose your programme, then submit'} to send it for approval.</p>`}
                ${programmeHtml()}
                ${forFriend ? friendNoteHtml() : accountHtml()}
                <div class="reg-center"><button type="button" class="btn-blue" data-action="rescan">Scan again</button></div>`;
            actions.innerHTML = `
                <button type="button" id="cancel-register-btn" class="btn-secondary" data-action="cancel">Cancel</button>
                <button type="button" id="submit-register-btn" class="btn-green" data-action="submit">${forFriend ? 'Send' : 'Submit'}</button>`;
            if (forFriend && !isTouchDevice()) content.querySelector('#reg-friend-name').focus({ preventScroll: true });
        },
        // No NFC here (iPhone, computer, another browser), or the card would not read.
        help() {
            const reason = manualReason || (isIos
                ? "iPhones can't scan cards in Stando."
                : isAndroid
                    ? 'This browser cannot scan cards. Open Stando in Google Chrome to scan it yourself.'
                    : "This device can't scan cards.");
            content.innerHTML = `
                ${notice('Ask a friend with an Android phone.', reason)}
                ${cardTapAnimationHtml()}
                <ol class="reg-list">
                    <li>Your friend opens Stando in Chrome, taps <strong>Register Card ID</strong>, then <strong>Scan for a friend</strong>.</li>
                    <li>Hold your card flat against the back of their phone until it beeps.</li>
                    <li>They type your name and email, choose your programme and tap <strong>Send</strong>.</li>
                </ol>
                <p class="reg-hint">An administrator approves your card, as when you scan it yourself.</p>`;
            actions.innerHTML = nfcSupported
                ? '<button type="button" id="reg-back-btn" class="btn-secondary" data-action="back">Back</button>'
                : '';
        }
    };

    function show(step) {
        stopReader();
        currentStep = step;
        dialog.querySelector('.reg-dialog-name').textContent = forFriend
            ? "Register a friend's card"
            : (updating ? 'Update your card' : 'Register your card');
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
            case 'back': show('scan'); break;
            case 'retry': show(currentStep); break;
            case 'rescan': show('scan'); break;
            case 'mode':
                // Someone else's card starts empty: no card, name, email or programme of one's own.
                forFriend = !forFriend;
                card = null;
                friend = { name: '', email: '' };
                programmeId = forFriend ? null : ownProgrammeId;
                show('scan');
                break;
            case 'help':
                manualReason = "This phone couldn't scan the card.";
                show('help');
                break;
            case 'submit': submit(button); break;
        }
    });

    // The friend's name and email, and the programme chosen, stay when scanning again.
    dialog.addEventListener('input', (event) => {
        if (event.target.id === 'reg-friend-name') {
            friend.name = event.target.value;
            const who = content.querySelector('.reg-friend-who');
            if (who) who.textContent = friend.name.trim() || 'your friend';
        } else if (event.target.id === 'reg-friend-email') {
            friend.email = event.target.value;
        }
        if (event.target.matches?.('input')) clearInputError(event.target);
    });
    dialog.addEventListener('change', (event) => {
        if (event.target.id !== 'reg-programme') return;
        programmeId = Number(event.target.value) || null;
        clearInputError(event.target);
    });

    // One reader at a time: this dialog's scan replaces the attendance scan.
    if (nfcSupported && (isScanning || nfcReader)) stopScanning();
    show(nfcSupported ? 'scan' : 'help');
}

// An unknown card from the attendance list, laid out as Register your card is:
// the card, then whose it is. An administrator adds the student at once; a
// lecturer or teaching assistant sends a request for an administrator to approve.
function showRegisterUIDDialogWithPrefill(prefillUid) {
    const scanned = String(prefillUid || '').trim();
    const hardwareUid = /:/.test(scanned) ? normalizeUid(scanned) : '';
    const cardId = convertUidToExternalId(scanned) || scanned;

    openDialogMode();

    const dialogBackdrop = document.createElement('div');
    dialogBackdrop.setAttribute('class', 'dialog-backdrop');
    const dialog = document.createElement('div');
    dialog.setAttribute('class', 'dialog reg-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'register-student-title');

    const actionText = isGlobalAdmin ? 'Add Student' : 'Send Request';
    dialog.innerHTML = `
        <h3 class="dialog-title" id="register-student-title"><i class="fa-solid fa-address-card"></i> Register Student</h3>
        <div class="dialog-content reg-content">
            <div class="reg-result is-unknown"><i class="fa-solid fa-id-card" aria-hidden="true"></i><span class="reg-result-label">Unknown card</span><span class="reg-result-id selectable">${escapeHtml(cardId)}</span></div>
            <p class="reg-instruction">${isGlobalAdmin
                ? 'Whose card is it? They are added to the Student List.'
                : 'Whose card is it? An administrator approves the request.'}</p>
            <div class="form-group">
                <label class="dialog-label-fixed" for="register-name">Name <span class="required">*</span></label>
                <input type="text" id="register-name" class="form-control" placeholder="Name Surname" maxlength="120" autocomplete="off">
            </div>
            <div class="form-group">
                <label class="dialog-label-fixed" for="register-email">Email <span class="required">*</span></label>
                <input type="email" id="register-email" class="form-control" placeholder="nsurname@epoka.edu.al" autocomplete="off">
            </div>
            ${programmeFieldHtml('register-programme', '', { required: isGlobalAdmin, placeholder: 'Choose their programme' })}
            ${isGlobalAdmin ? '' : `<p class="reg-account">Sending as <strong>${escapeHtml(currentUserDisplayName())}</strong><br>${escapeHtml(currentUser?.email || '')}</p>`}
        </div>
        <div class="dialog-actions">
            <button type="button" id="cancel-register-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button type="button" id="submit-register-btn" class="btn-green"><i class="fa-solid fa-check"></i> ${actionText}</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);
    if (!isTouchDevice()) dialog.querySelector('#register-name').focus({ preventScroll: true });

    const closeDialog = () => {
        dialogBackdrop.remove();
        closeDialogMode();
    };
    dialog.querySelector('#cancel-register-btn').addEventListener('click', closeDialog);

    const submitBtn = dialog.querySelector('#submit-register-btn');
    submitBtn.addEventListener('click', async () => {
        const nameInput = dialog.querySelector('#register-name');
        const emailInput = dialog.querySelector('#register-email');
        clearInputError(nameInput);
        clearInputError(emailInput);
        const name = nameInput.value.replace(/\s+/g, ' ').trim();
        const email = emailInput.value.trim();

        let isValid = true;
        if (name === '') {
            showInputError(nameInput, 'Name is required.');
            isValid = false;
        }
        if (!isValidEmail(email)) {
            showInputError(emailInput, 'A valid email is required.');
            isValid = false;
        }
        // Administrators add the student at once; a request can leave the programme to them.
        const programme = readProgrammeField(dialog.querySelector('#register-programme'), isGlobalAdmin);
        if (!programme.ok) isValid = false;
        if (!isValid) return;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

        try {
            const submissionData = {
                name, email,
                uid: cardId,
                hardwareUid,
                programmeId: programme.id,
                source: 'staff',
                sentBy: {
                    name: currentUser?.name || 'Admin',
                    email: currentUser?.email || ''
                }
            };

            if (isGlobalAdmin) {
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
            programmeId: studentData.programmeId ?? null,
            rowIndex: parseInt(dbKey)
        };

        if (existingUids.some(eu => uidsEquivalent(eu, newUid) || (newHwUid && uidsEquivalent(eu, newHwUid)))) return { type: 'uid', duplicate: duplicateData };
        if (existingHwUids.some(eu => uidsEquivalent(eu, newUid) || (newHwUid && uidsEquivalent(eu, newHwUid)))) return { type: 'uid', duplicate: duplicateData };
        if (newEmail && existingEmail && existingEmail === newEmail) return { type: 'email', duplicate: duplicateData };
        if (existingName === newName) return { type: 'name', duplicate: duplicateData };
    }
    return null;
}

// The duplicate dialogs' Programme rows: the existing student's, and the new entry's
// as a choice with Replace when it differs.
function existingProgrammeRowHtml(id) {
    if (!programmeList) return '';
    return `
            <div class="form-group is-inline is-readout">
                <label class="dialog-label-fixed"><i class="fa-solid fa-graduation-cap"></i> Programme</label>
                <input class="form-control" value="${escapeHtml(programmeCode(id) || '—')}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>`;
}

function newProgrammeRowHtml(id) {
    if (!programmeList) return '';
    return `
        <div class="form-group is-inline">
            <label class="dialog-label-fixed" for="dup-programme"><i class="fa-solid fa-graduation-cap"></i> Programme</label>
            <select id="dup-programme" class="form-control programme-select">${programmeOptionsHtml(id)}</select>
            <div class="field-action dup-programme-action" style="display:flex; align-items:center; gap:6px; white-space:nowrap; min-width:90px; justify-content:flex-end; margin:0;"></div>
        </div>`;
}

// Shows "(Matches)" or a Replace box for the chosen programme, ticked when the
// administrator picks another one or the existing student has none. Returns a
// reader for { id, replace }.
function bindProgrammeRow(dialog, existingId, onChange) {
    const select = dialog.querySelector('#dup-programme');
    if (!select) return () => ({ id: null, replace: false });
    const action = dialog.querySelector('.dup-programme-action');
    const existing = Number(existingId) || null;
    const render = (chosenByHand) => {
        const chosen = Number(select.value) || null;
        if (!chosen || chosen === existing) {
            action.innerHTML = chosen ? '<span style="opacity: 0.6; font-size: 0.85em; white-space: nowrap; text-align: right;">(Matches)</span>' : '';
        } else {
            action.innerHTML = `<input type="checkbox" id="replace-programme-check" style="cursor:pointer; margin:0;" ${chosenByHand || !existing ? 'checked' : ''}><label for="replace-programme-check" style="margin:0; cursor:pointer; font-weight:600; font-size:0.9em;">Replace</label>`;
            action.querySelector('input').addEventListener('change', onChange);
        }
        onChange();
    };
    select.addEventListener('change', () => render(true));
    render(false);
    return () => ({ id: Number(select.value) || null, replace: !!action.querySelector('#replace-programme-check')?.checked });
}

// An existing student's Card IDs and UIDs for the comparison rows; only UIDs that were saved.
function studentCardLists(student) {
    const list = (array, text) => (array?.length ? array : String(text || '').split(',')).map(value => String(value).trim()).filter(Boolean);
    const uids = list(student.hardware_uids, student.hardwareUid).map(normalizeUid).filter(Boolean);
    const ids = list(student.uids, student.uid);
    return { ids: ids.length ? ids : uids.map(uidToCardId), uids };
}

// A new entry's card: its UID only when one was given, and its Card ID worked out
// from that UID whenever there is one.
function newEntryCard(data) {
    const card = splitCardValue(data.uid);
    const uid = normalizeUid(data.hardwareUid || data.hardware_uid) || card.uid;
    return { cardId: uidToCardId(uid) || card.cardId, uid };
}

// The comparison rows for a card: its Card ID(s), and its UID(s) when there are any.
function cardReadoutRowsHtml(ids, uids) {
    const row = (icon, label, value) => `
            <div class="form-group is-inline is-readout">
                <label class="dialog-label-fixed"><i class="fa-solid ${icon}"></i> ${label}</label>
                <input class="form-control" value="${escapeHtml(value)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>`;
    return row('fa-id-card', ids.length > 1 ? 'Card IDs' : 'Card ID', ids.join(', ') || '—') +
        (uids.length ? row('fa-wifi', uids.length > 1 ? 'UIDs' : 'UID', uids.join(', ')) : '');
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
    const existingCards = studentCardLists(existing);
    const newCard = newEntryCard(newData);
    const isUidMatch = existingCards.ids.some(id => uidsEquivalent(id, newCard.cardId)) ||
        (!!newCard.uid && existingCards.uids.some(uid => uidsEquivalent(uid, newCard.uid)));

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
            
            <div class="form-group is-inline is-readout">
                <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
                <input class="form-control" value="${escapeHtml(existing.name)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>${existingProgrammeRowHtml(existing.programmeId)}${cardReadoutRowsHtml(existingCards.ids, existingCards.uids)}
            <div class="form-group is-inline is-readout">
                <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
                <input class="form-control" value="${escapeHtml(existing.email || 'N/A')}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">

        <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">New Entry</div>
        
        <div class="form-group is-inline">
            <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
            <input class="form-control" value="${escapeHtml(newData.name)}" disabled style="flex: 1;">
            ${nameActionHTML}
        </div>
        
        <div class="form-group is-inline">
            <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
            <input class="form-control" value="${escapeHtml(newData.email)}" disabled style="flex: 1;">
            ${emailActionHTML}
        </div>
        ${newProgrammeRowHtml(newData.programmeId || existing.programmeId)}
        
        <div class="form-group is-inline">
            <label class="dialog-label-fixed"><i class="fa-solid fa-id-card"></i> Card ID</label>
            <input class="form-control" value="${escapeHtml(newCard.cardId || '—')}" disabled style="flex: 1;">
            ${uidActionHTML}
        </div>${newCard.uid ? `
        <div class="form-group is-inline">
            <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID</label>
            <input class="form-control" value="${escapeHtml(newCard.uid)}" disabled style="flex: 1;">
            <span style="min-width: 120px;"></span>
        </div>` : ''}
    </div>
    <div class="dialog-actions">
        <button id="cancel-duplicate-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
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
    let readProgramme = () => ({ id: null, replace: false });

    const updateButtonStates = () => {
        const isAnyActionSelected = Array.from(actionControls).some(control =>
            (control.type === 'checkbox' && control.checked) ||
            (control.tagName === 'SELECT' && control.value !== 'none')
        ) || readProgramme().replace;
        addAnywayBtn.disabled = isAnyActionSelected;
        applyBtn.disabled = !isAnyActionSelected;
    };

    actionControls.forEach(control => control.addEventListener('change', updateButtonStates));
    readProgramme = bindProgrammeRow(dialog, existing.programmeId, updateButtonStates);
    updateButtonStates();
    document.getElementById('cancel-duplicate-btn').addEventListener('click', closeDialog);

    const studentId = newCard.cardId;
    const hwUid = newCard.uid;

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
            name: newData.name, email: newData.email, uid: studentId, hardwareUid: hwUid,
            programmeId: readProgramme().id || newData.programmeId
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
        const programme = readProgramme();
        if (programme.replace) update.programmeId = programme.id;
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
            programmeId: studentData.programmeId ?? null,
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

    dialog.innerHTML = `
    <h3 class="dialog-title">Approve Application</h3>
    <div class="dialog-content">
        <p style="margin-bottom:15px;">${registration.source === 'friend' ? `Scanned by ${escapeHtml(personNameByEmail(registration.sentBy))} for ${escapeHtml(registration.name || 'the student')}. ` : ''}Please review and confirm the details below.</p>
        
        <div class="form-group">
            <label class="dialog-label-fixed" for="approve-name"><i class="fa-solid fa-quote-left"></i> Name</label>
            <input type="text" id="approve-name" class="form-control" value="${escapeHtml(registration.name)}">
        </div>
        
        <div class="form-group">
            <label class="dialog-label-fixed" for="approve-email"><i class="fa-solid fa-at"></i> Email</label>
            <input type="email" id="approve-email" class="form-control" value="${escapeHtml(registration.email)}">
        </div>

        ${programmeFieldHtml('approve-programme', registration.programmeId)}

        ${cardFieldsHtml('approve-card', newEntryCard(registration))}
        <div id="approve-nfc-status" style="margin-top:10px;"></div>
    </div>
    <div class="dialog-actions">
        <button id="cancel-approve-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="confirm-approve-btn" class="btn-green"><i class="fa-solid fa-check"></i> Approve</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => { cardScanSession?.controller?.abort(); document.body.removeChild(dialogBackdrop); closeDialogMode(); };
    document.getElementById('cancel-approve-btn').addEventListener('click', closeDialog);
    const card = bindCardFields(dialog.querySelector('[data-card-fields]'), { statusContainer: dialog.querySelector('#approve-nfc-status') });

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
        const programme = readProgrammeField(dialog.querySelector('#approve-programme'));
        if (!programme.ok) isValid = false;
        if (!card.validate()) isValid = false;
        if (!isValid) return;

        const approve = () => {
            const idleLabel = confirmBtn.innerHTML;
            confirmBtn.disabled = true; confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Approving...';
            const finalData = {
                action: 'approveRegistration',
                approvalMode: 'final_approve',
                name: finalName,
                uid: card.cardId(),
                hardwareUid: card.uid(),
                email: finalEmail,
                programmeId: programme.id,
                rowNumber: registration.rowNumber
            };
            callWebApp('approveRegistration', finalData, 'POST').then(result => {
                if (result && result.result === 'success') {
                    showNotification('success', 'Approved!', `${finalData.name} has been added to the database.`);
                    notifyIfEmailFailed(result, finalData.email);
                    refreshDatabaseAfterApproval(); refreshAdminViews(); closeDialog();
                } else { throw new Error(result ? result.message : 'Approval failed.'); }
            }).catch(err => { showNotification('error', 'Approval Failed', err.message); confirmBtn.disabled = false; confirmBtn.innerHTML = idleLabel; });
        };
        // Nothing is saved yet, so turning off Use UID only leaves the UID out.
        approve();
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

    const existingCards = studentCardLists(existing);
    const newCard = newEntryCard(newData);

    // --- Core comparison logic ---
    const norm = (str) => (str || '').toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const isNameMatch = norm(newData.name) === norm(existing.name);
    const isEmailMatch = norm(newData.email) === norm(existing.email);
    // A scanned card the student has by Card ID alone can still add its UID (Merge).
    const isUidMatch = newCard.uid
        ? existingCards.uids.some(uid => uidsEquivalent(uid, newCard.uid))
        : existingCards.ids.some(id => uidsEquivalent(id, newCard.cardId));

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
        <p style="margin-bottom: 15px;">An entry with similar data already exists.${newData.source === 'friend' ? ` Scanned by ${escapeHtml(personNameByEmail(newData.sentBy))} for ${escapeHtml(newData.name || 'the student')}.` : ''}</p>
        
        <div style="background: rgba(0,0,0,0.03); padding: 10px; border-radius: 8px; margin-bottom: 15px;">
            <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">Existing Data</div>
            
            <div class="form-group is-inline is-readout">
                <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
                <input class="form-control" value="${escapeHtml(existing.name)}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>${existingProgrammeRowHtml(existing.programmeId)}${cardReadoutRowsHtml(existingCards.ids, existingCards.uids)}
            <div class="form-group is-inline is-readout">
                <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
                <input class="form-control" value="${escapeHtml(existing.email || 'N/A')}" disabled style="background: transparent; border: none; padding: 5px; height: auto;">
            </div>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">

        <div style="font-weight: 700; margin-bottom: 10px; color: var(--text-color); font-size: 0.9em; text-transform: uppercase;">New Application</div>
        
        <div class="form-group is-inline">
            <label class="dialog-label-fixed"><i class="fa-solid fa-quote-left"></i> Name</label>
            <input class="form-control" value="${escapeHtml(newData.name)}" disabled style="flex: 1;">
            ${nameActionHTML}
        </div>
        
        <div class="form-group is-inline">
            <label class="dialog-label-fixed"><i class="fa-solid fa-at"></i> Email</label>
            <input class="form-control" value="${escapeHtml(newData.email)}" disabled style="flex: 1;">
            ${emailActionHTML}
        </div>
        ${newProgrammeRowHtml(newData.programmeId || existing.programmeId)}
        
        <div class="form-group is-inline">
            <label class="dialog-label-fixed"><i class="fa-solid fa-id-card"></i> Card ID</label>
            <input class="form-control" value="${escapeHtml(newCard.cardId || '—')}" disabled style="flex: 1;">
            ${uidActionHTML}
        </div>${newCard.uid ? `
        <div class="form-group is-inline">
            <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID</label>
            <input class="form-control" value="${escapeHtml(newCard.uid)}" disabled style="flex: 1;">
            <span style="min-width: 120px;"></span>
        </div>` : ''}

    </div>
    <div class="dialog-actions">
        <button id="cancel-duplicate-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
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
    let readProgramme = () => ({ id: null, replace: false });

    // Function to manage button states
    const updateButtonStates = () => {
        const nameCheck = dialog.querySelector('#replace-name-check');
        const emailCheck = dialog.querySelector('#replace-email-check');
        const uidSelect = dialog.querySelector('#uid-action-select');

        const isAnyActionSelected = (nameCheck && nameCheck.checked) ||
            (emailCheck && emailCheck.checked) ||
            (uidSelect && uidSelect.value !== 'none') ||
            readProgramme().replace;

        addAnywayBtn.disabled = isAnyActionSelected;
        replaceBtn.disabled = !isAnyActionSelected;
    };

    // Attach listeners and initialize states
    actionControls.forEach(control => control.addEventListener('change', updateButtonStates));
    readProgramme = bindProgrammeRow(dialog, existing.programmeId, updateButtonStates);
    updateButtonStates(); // Set initial state
    document.getElementById('cancel-duplicate-btn').addEventListener('click', closeDialog);

    // "Add as Separate" button listener
    addAnywayBtn.addEventListener('click', (e) => {
        const button = e.currentTarget;
        const idleLabel = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
        const studentId = newCard.cardId;
        const hwUid = newCard.uid;
        const payload = { ...newData, approvalMode: 'add_new_separate', uid: studentId, hardwareUid: hwUid, hardware_uid: hwUid,
            programmeId: readProgramme().id || newData.programmeId };
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
        const programme = readProgramme();
        if (programme.replace) updates.programme = true;

        const studentId = newCard.cardId;
        const hwUid = newCard.uid;
        const payload = { ...newData, action: 'approveRegistration', approvalMode: 'custom_replace', duplicateRowIndex: existing.rowIndex, updates: updates, uid: studentId, hardwareUid: hwUid, hardware_uid: hwUid, programmeId: programme.id };
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

// The name on the student list for an email, or the email when it is not there.
function personNameByEmail(email) {
    const key = String(email || '').trim().toLowerCase();
    const entry = key && Object.values(databaseMap).find(item => String(item?.email || '').trim().toLowerCase() === key);
    return entry?.name || email || '';
}

// "3 pending" under a requests list's title.
function setPendingCount(id, count) {
    const el = document.getElementById(id);
    if (el) el.textContent = `${count} pending`;
}

function renderRegistrationsTable(registrations) {
    const tbody = document.getElementById('registrations-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    setPendingCount('registrations-count', registrations?.length || 0);

    if (!registrations || registrations.length === 0) return;

    registrations.forEach(reg => {
        const row = document.createElement('tr');

        // A friend's scan names the friend; otherwise who sent it shows only when it
        // was not the student (a lecturer registering a card).
        const sentByOther = reg.sentBy && reg.sentBy.trim().toLowerCase() !== String(reg.email || '').trim().toLowerCase();
        const sentNote = reg.source === 'friend'
            ? `<small class="cell-note" title="${escapeHtml(reg.name)}, scanned by a friend (${escapeHtml(reg.sentBy)})"><i class="fa-solid fa-user-group" aria-hidden="true"></i> Scanned by ${escapeHtml(personNameByEmail(reg.sentBy))} for ${escapeHtml(reg.name)}</small>`
            : sentByOther ? `<small class="cell-note">by ${escapeHtml(reg.sentBy)}</small>` : '';
        const sentAt = reg.timestamp ? new Date(reg.timestamp) : null;
        const formattedTimestamp = sentAt && !isNaN(sentAt)
            ? `${sentAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${formatScanLockTime(sentAt)}`
            : '—';

        // The Card ID, with the UID it was read from under it when the request has one.
        const card = newEntryCard(reg);
        const uidCellDisplay = `<span class="card-id-badge">${escapeHtml(card.cardId || 'N/A')}</span>${card.uid ? `<small class="cell-sub" title="UID">UID ${escapeHtml(card.uid)}</small>` : ''}`;

        row.innerHTML = `
            <td class="person-cell">
                <div class="person-name">${escapeHtml(reg.name) || 'N/A'}</div>
                <small class="person-email">${escapeHtml(reg.email) || 'N/A'}</small>
            </td>
            <td class="programme-cell">${programmeBadgeHtml(reg.programmeId)}</td>
            <td class="id-cell">${uidCellDisplay}</td>
            <td class="date-col">${escapeHtml(formattedTimestamp)}${sentNote}</td>
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
    setPendingCount('absences-count', displayRequests.length);

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

        // The programme sits beside the name, and When is the day with the reason
        // and how many hours (the hours themselves are in the dialog), so the row
        // fits the panel without scrolling sideways.
        const programmeId = studentProgrammeId(req.email);
        row.innerHTML = `
            <td class="person-cell">
                <div class="person-name">${escapeHtml(req.name)}${programmeById(programmeId) ? ` ${programmeBadgeHtml(programmeId)}` : ''}</div>
                <small class="person-email">${escapeHtml(req.email)}</small>
            </td>
            <td class="course-col">${courseCellHtml(req.course, sessionBadge ? ` ${sessionBadge}` : '')}</td>
            <td class="when-cell">${requestSummaryHtml(req.absenceDate, req.hours, req.reasonType)}</td>
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

    let attachmentHtml = '<span class="req-detail-empty">No attachment</span>';
    if (data.attachmentUrl) {
        // openAttachment() handles both legacy Drive URLs and Storage paths
        attachmentHtml = `<a href="#" data-att="${escapeHtml(data.attachmentUrl)}" onclick="openAttachment(this.dataset.att); return false;" class="btn-attachment"><i class="fa-solid fa-paperclip" aria-hidden="true"></i> View document</a>`;
    }

    // The × in the title bar closes, as in every dialog; the footer holds only the
    // decisions, so a request from History (read only) has none.
    const actionsHtml = isReadOnly ? '' : `
        <div class="dialog-actions">
            <button type="button" id="reject-req-btn" class="btn-red"><i class="fa-solid fa-ban" aria-hidden="true"></i> Reject</button>
            <button type="button" id="approve-req-btn" class="btn-green"><i class="fa-solid fa-check" aria-hidden="true"></i> Approve</button>
        </div>`;

    const sessionHtml = (data.session && data.session !== 'Default')
        ? `<span class="session-badge">${escapeHtml(data.session)}</span>` : '';
    const programme = programmeById(studentProgrammeId(data.studentEmail));

    // Values read as text under their labels, not as greyed-out fields.
    const detailRow = (label, valueHtml) => `
            <div class="req-detail">
                <span class="req-detail-label">${label}</span>
                <div class="req-detail-value">${valueHtml}</div>
            </div>`;

    dialog.innerHTML = `
        <h3 class="dialog-title">Request details</h3>
        <div class="dialog-content request-details">
            ${detailRow('Student', `<strong>${escapeHtml(data.studentName)}</strong>${programme ? ` ${programmeBadgeHtml(programme.id)}` : ''}<small class="req-detail-sub">${escapeHtml(data.studentEmail)}</small>`)}
            ${detailRow('Course', data.course ? courseCellHtml(data.course, sessionHtml ? ` ${sessionHtml}` : '') : '<span class="req-detail-empty">None</span>')}
            ${detailRow('Date and hours', requestWhenHtml(data.absenceDate, data.hours))}
            ${detailRow('Reason', escapeHtml(data.reasonType) || '<span class="req-detail-empty">None given</span>')}
            ${detailRow('Description', data.description
        ? `<p class="req-detail-note">${escapeHtml(data.description)}</p>`
        : '<span class="req-detail-empty">No description</span>')}
            ${detailRow('Proof', attachmentHtml)}
        </div>${actionsHtml}
    `;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const closeDialog = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

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

    // 2. The courses offered: the active ones in the student's programme. A student
    // without one on their record (or whose programme has none active) gets the courses
    // they have scans in, and failing that every active course, so none is left without.
    const allActiveCourses = Object.keys(courseInfoMap)
        .sort((a, b) => compareCoursesForDisplay([a, courseInfoMap[a]], [b, courseInfoMap[b]]))
        .filter(courseName => !courseInfoMap[courseName]?.archived);

    const programme = programmeById(studentProgrammeId(currentUser.email));
    const programmeCourses = programme
        ? allActiveCourses.filter(courseName => courseProgrammes(courseInfoMap[courseName]).some(p => p.id === programme.id))
        : [];

    const scannedCourses = allActiveCourses.filter(courseName => {
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

    const enrolledCourses = programmeCourses.length ? programmeCourses
        : scannedCourses.length ? scannedCourses : allActiveCourses;

    // "CE 121 Civil Engineering Drawing", searchable. The student's own programme needs
    // no headings (a course shared with another programme would add one); the wider
    // lists show their programmes when there are two or more.
    const isEnrolledEmpty = enrolledCourses.length === 0;
    const courseOption = courseName => `<option value="${escapeHtml(courseName)}" data-code="${escapeHtml(getCleanCourseCode(courseName))}">${escapeHtml(getCourseLabel(courseName))}</option>`;
    const courseGroups = programmeCourses.length ? null : groupCoursesByProgramme(enrolledCourses);
    const courseOptions = isEnrolledEmpty
        ? '<option value="">No courses open for requests</option>'
        : '<option value="">Search or choose a course</option>' + (courseGroups
            ? courseGroups.map(group => `<optgroup label="${escapeHtml(group.programme ? programmeOptionLabel(group.programme) : 'Other courses')}"${group.programme ? ` data-code="${escapeHtml(group.programme.code)}"` : ''}>${group.courses.map(courseOption).join('')}</optgroup>`).join('')
            : enrolledCourses.map(courseOption).join(''));

    const emptyCourseExplanation = isEnrolledEmpty
        ? '<p class="form-hint" id="no-enrolled-courses-msg">There are no active courses right now.</p>'
        : '';

    const hoursList = ['8:40–9:30', '9:40–10:30', '10:40–11:30', '11:40–12:30', '12:40–13:30', '13:40–14:30', '14:40–15:30', '15:40–16:30', '16:00–16:50', '17:00–17:50', '18:00–18:50', '19:00–19:50'];
    const hourButtons = hoursList.map(h => `<button type="button" class="toggle-button" data-value="${h}">${h}</button>`).join('');

    dialog.classList.add('request-dialog');
    dialog.innerHTML = `
<h3 class="dialog-title"><i class="fa-solid fa-hand-point-up"></i> Request for Permission</h3>
<div class="dialog-content">

    <div class="dialog-callout is-note"><i class="fa-solid fa-circle-info" aria-hidden="true"></i><span>Per university regulations, absences are unexcused by default. Missing a few classes is normal; this form is a professional courtesy.</span></div>

    <div class="form-group required">
        <label class="dialog-label-fixed" for="request-course">Course</label>
        <select id="request-course" class="form-control search-select" data-empty="No course matches" ${isEnrolledEmpty ? 'disabled' : ''}>
            ${courseOptions}
        </select>
        ${emptyCourseExplanation}
    </div>

    <div class="form-group required" id="request-session-field" hidden>
        <label class="dialog-label-fixed">Group</label>
        <div class="segment-rows">
            <div id="req-cat-row" class="segment-track"></div>
            <div id="req-grp-row" class="segment-track"></div>
        </div>
    </div>

    <div class="form-group required">
        <label class="dialog-label-fixed" for="request-date">Date</label>
        <input type="date" id="request-date" class="form-control" value="" min="${minDateStr}" max="${maxDateStr}" required>
        <p class="form-hint">The day you were, or will be, absent: up to 2 working days ago or 7 ahead.</p>
    </div>

    <div class="form-group required">
        <label class="dialog-label-fixed">Hours</label>
        <div id="request-hours-group" class="request-hours">
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

    <div id="reason-help-text" class="dialog-callout" aria-live="polite" hidden></div>

    <div class="form-group" id="request-file-group" hidden>
        <label class="dialog-label-fixed" id="request-file-label">Document</label>
        <div class="file-field">
            <input type="file" id="request-file-upload" accept=".pdf,image/*" tabindex="-1" aria-hidden="true">
            <button type="button" class="file-field-btn" id="request-file-btn"><i class="fa-solid fa-paperclip" aria-hidden="true"></i><span>Choose file</span></button>
            <span class="file-field-name" id="request-file-name">No file chosen</span>
        </div>
        <p class="form-hint">A PDF or an image, up to 5 MB.</p>
    </div>

    <div class="form-group" id="request-expl-group" hidden>
        <label class="dialog-label-fixed" id="request-expl-label" for="request-explanation">Details</label>
        <textarea id="request-explanation" class="form-control" rows="3"></textarea>
    </div>

    <div class="form-section-title">Verification</div>
    <div class="captcha">
        <div id="captcha-question" class="captcha-question" aria-live="polite"></div>
        <div id="captcha-choices" class="captcha-choices" role="group" aria-label="Answers"></div>
    </div>

</div>
<div class="dialog-actions">
    <button id="cancel-request-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
    <button id="submit-request-btn" class="btn-green" disabled><i class="fa-solid fa-paper-plane"></i> Submit</button>
</div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- Variables ---
    const courseSelect = document.getElementById('request-course');
    const sessionField = document.getElementById('request-session-field');
    const catRow = document.getElementById('req-cat-row');
    const grpRow = document.getElementById('req-grp-row');
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
        // A wrong answer asks again after a pause; the dialog may have closed by then.
        if (!dialog.isConnected) return;
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
            `<button type="button" class="toggle-button captcha-choice" data-value="${val}">${val}</button>`
        ).join('');
    }

    // Initialize captcha
    generateCaptcha();

    // The right answer turns green and stays; a wrong one turns red, and a new sum follows.
    document.getElementById('captcha-choices').addEventListener('click', (e) => {
        const btn = e.target.closest('.captcha-choice');
        if (!btn || btn.disabled || captchaSolved) return;
        const choices = btn.parentElement.querySelectorAll('.captcha-choice');

        if (Number(btn.dataset.value) === captchaAnswer) {
            btn.classList.add('is-correct');
            captchaSolved = true;
            choices.forEach(b => { if (b !== btn) b.disabled = true; });
        } else {
            btn.classList.add('is-wrong');
            choices.forEach(b => { b.disabled = true; });
            setTimeout(generateCaptcha, 1500);
        }
    });

    // --- Group ---
    // As on the main screen: a row with a single choice is not shown, and that choice
    // is still sent. Switching category keeps the letter last picked when it has it.
    let requestSections = {};
    let requestCategory = null;
    let requestLetter = null;
    let preferredLetter = null;
    let selectedSession = null;

    const markTrack = (track, isActive, animate) => {
        track.querySelectorAll(':scope > .course-button').forEach(btn => btn.classList.toggle('active', isActive(btn)));
        updateSegmentThumb(track, animate);
    };

    const selectRequestGroup = (category, letter, animate = true) => {
        const groups = requestSections[category] || [];
        const categoryChanged = category !== requestCategory;
        requestCategory = category;
        requestLetter = [preferredLetter, letter].find(l => groups.includes(l)) || groups[0] || null;
        markTrack(catRow, btn => btn.dataset.category === category, animate);
        if (categoryChanged) {
            setSegmentOptions(grpRow, groups.map(grp => segmentButtonHtml(`data-group="${escapeHtml(grp)}"`, '', grp)).join(''));
            grpRow.hidden = groups.length <= 1;
            sessionField.hidden = catRow.hidden && grpRow.hidden;
        }
        markTrack(grpRow, btn => btn.dataset.group === requestLetter, animate);
        selectedSession = requestLetter ? `${category} ${requestLetter}` : category;
    };

    courseSelect.addEventListener('change', () => {
        requestSections = parseAvailableSections(courseInfoMap[courseSelect.value]?.availableSections || '');
        const categories = Object.keys(requestSections);
        requestCategory = null;
        catRow.innerHTML = categories.map(cat =>
            segmentButtonHtml(`data-category="${escapeHtml(cat)}"`, SESSION_ICONS[cat.toLowerCase()] || 'fa-tag', cat)).join('');
        catRow.hidden = categories.length <= 1;
        if (!categories.length) {
            grpRow.innerHTML = '';
            sessionField.hidden = true;
            selectedSession = null;
            return;
        }
        selectRequestGroup(categories[0], requestLetter, false);
    });

    catRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (btn && btn.dataset.category !== requestCategory) selectRequestGroup(btn.dataset.category, requestLetter);
    });
    grpRow.addEventListener('click', (e) => {
        const btn = e.target.closest('.course-button');
        if (!btn) return;
        preferredLetter = btn.dataset.group;
        selectRequestGroup(requestCategory, btn.dataset.group);
    });
    // A track drawn while hidden places its thumb once shown.
    [catRow, grpRow].forEach(track => watchButtonRows(track, followSegmentThumb));

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

        // 1. Start from nothing shown
        helpText.hidden = true;
        fileGroup.hidden = true;
        explGroup.hidden = true;
        fileGroup.classList.remove('required');
        explGroup.classList.remove('required');
        submitBtn.disabled = false;
        explInput.value = '';
        explInput.removeAttribute('minlength');
        explInput.placeholder = '';
        fileLabel.textContent = 'Document';
        explLabel.textContent = 'Details';

        // A note under the reasons: information, or a warning (amber).
        const showHelp = (icon, html, tone = 'is-info') => {
            helpText.className = `dialog-callout ${tone}`;
            helpText.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i><span>${html}</span>`;
            helpText.hidden = false;
        };
        const askFile = (label, required) => {
            fileGroup.hidden = false;
            fileGroup.classList.toggle('required', required);
            fileLabel.textContent = label;
        };
        const askExplanation = (required, minLength = 0) => {
            explGroup.hidden = false;
            explGroup.classList.toggle('required', required);
            explLabel.textContent = 'Explanation';
            if (minLength) explInput.setAttribute('minlength', String(minLength));
        };

        // 2. What this reason needs
        switch (selectedReason) {
            case 'Medical': // Calling Sick: a report, and an explanation if wanted
                askFile('Medical report', true);
                askExplanation(false);
                showHelp('fa-circle-info', 'Please attach your medical report (Raporti Mjekësor) or any other documentation.');
                break;

            case 'Conference':
                askFile('Invitation', true);
                showHelp('fa-circle-info', 'Please attach your invitation letter.');
                break;

            case 'Official': // Official Appointment: a document, and an explanation if wanted
                askFile('Document', true);
                askExplanation(false);
                showHelp('fa-circle-info', 'Please attach your official summons (court, embassy, police).');
                break;

            case 'Bus':
                askExplanation(true, 20);
                askFile('Attachment', false);
                showHelp('fa-circle-info', "<strong>Note:</strong> Only applies to the university's bus line.");
                break;

            case 'Club':
                submitBtn.disabled = true; // The Dean of Students Office asks instead
                showHelp('fa-envelope', 'The Dean of Students Office must email the lecturer to request permission on your behalf.', 'is-warning');
                break;

            case 'Confidential': // Personal Matter: an explanation is required
                askExplanation(true, 50);
                explInput.placeholder = 'Please explain the situation in detail...';
                showHelp('fa-lock', "If you cannot write it here, please visit the lecturer's office to discuss it in person.", 'is-warning');
                break;
        }
    });

    // The file button opens the picker; the chosen file's name shows beside it.
    const fileInput = document.getElementById('request-file-upload');
    const fileName = document.getElementById('request-file-name');
    document.getElementById('request-file-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        fileName.textContent = file ? file.name : 'No file chosen';
        fileName.classList.toggle('has-file', !!file);
    });

    // --- SUBMIT LOGIC ---
    submitBtn.addEventListener('click', () => {
        const hours = Array.from(hoursGroup.querySelectorAll('.active')).map(b => b.dataset.value);
        const date = document.getElementById('request-date').value;
        const course = courseSelect.value;
        const file = document.getElementById('request-file-upload').files[0];
        const explanation = explInput.value.trim();

        const session = selectedSession || 'Default';

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
    <button id="cancel-approve-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
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
    <button id="cancel-reject-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
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
        <button id="cancel-reject-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
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
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data;
}

async function sbSessionEmail() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    // A token that could not be refreshed (offline, say) is not a sign-out: the
    // session stays for when the connection is back. A revoked one signs out by itself.
    if (error) throw error;
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
            title: String(row.title || '').trim(),
            startDate: row.start_date || '',
            endDate: row.end_date || '',
            holidayWeeks: row.holiday_weeks != null ? row.holiday_weeks.toString() : '',
            holidayStartDate: row.holiday_start_date || '',
            defaultHours: row.default_hours != null ? row.default_hours.toString() : '',
            eisId: row.eis_id || '',
            adminEmails: row.admin_emails || '',
            availableSections: row.available_sections || '',
            archived: row.archived || false,
            programmeIds: Array.isArray(row.programme_ids) ? row.programme_ids.map(Number) : [],
            assistantEmails: row.assistant_emails || '',
            icon: row.icon || '',
            theme: row.theme && typeof row.theme === 'object' ? row.theme : {}
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
                hardware_uids: Array.isArray(row.hardware_uids) ? row.hardware_uids : (row.hardware_uids ? [row.hardware_uids] : []),
                programmeId: row.programme_id ?? null
            };
        }
    });
    return database;
}

async function sbGetAdminStatus() {
    return sbUnwrap(await supabaseClient.rpc('check_admin_status'));
}

// Staff photos and Google names come from each person's sign-in record
// (public.staff_profiles); a photo address set in Settings → Staff replaces the
// Google photo. Global administrators get every staff member, anyone else only
// themselves. Missing data never blocks the page.
async function sbGetStaffProfiles() {
    try {
        const { data, error } = await supabaseClient.rpc('staff_profiles');
        if (error) throw error;
        return new Map((data || []).filter(row => row && row.email).map(row => {
            const googlePhoto = normalizeGooglePhotoUrl(row.photo_url || '');
            const customPhoto = row.custom_photo || '';
            return [String(row.email).trim().toLowerCase(), {
                name: row.name || '',
                googleName: row.google_name || '',
                googlePhoto,
                customPhoto,
                photo: customPhoto || googlePhoto
            }];
        }));
    } catch (error) {
        console.warn('Staff profiles unavailable:', error?.message || error);
        return new Map();
    }
}

// The name shown for a staff member: their custom name, else their Google name, else the e-mail.
function staffDisplayName(staff) {
    return String(staff?.name || '').trim() || staff?.googleName || staff?.email || '';
}

// A staff role as stored: Global, Lecturer or Assistant. Anything unknown is an
// assistant, who manages nothing.
function staffRole(role) {
    return role === 'Global' || role === 'Lecturer' ? role : 'Assistant';
}

function staffRoleLabel(role) {
    return { Global: 'Administrator', Lecturer: 'Lecturer', Assistant: 'Teaching Assistant' }[staffRole(role)];
}

function sbMapDevices(rows) {
    return (rows || []).map(row => ({
        rowIndex: row.id, name: row.name, id: row.device_id,
        owner: row.owner, date: row.registered_at || ''
    }));
}

async function sbGetCourseInfo() {
    return sbMapCourseInfo(sbUnwrap(await supabaseClient.from('courses').select(
        'name,title,start_date,end_date,holiday_weeks,holiday_start_date,default_hours,eis_id,admin_emails,assistant_emails,available_sections,archived,programme_ids,icon,theme')));
}

// Programmes A–Z by code; null when the database has none yet, which hides them.
async function sbGetProgrammes() {
    const { data, error } = await supabaseClient.from('programmes').select('id,code,name,archived').order('code');
    if (error) {
        console.warn('Programmes unavailable:', error.message);
        return null;
    }
    return (data || []).map(row => ({ id: row.id, code: String(row.code || '').trim(), name: String(row.name || '').trim(), archived: !!row.archived }))
        .sort(compareProgrammes);
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
        .select('id,name,email,uids,hardware_uids,programme_id').order('id'));

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

    // Student path: courses where they have attendance logs, and a teaching
    // assistant's courses besides.
    (status.assistantCourses || []).forEach(name => { result[name] = true; });
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
            const [courses, database, courseInfo, programmes] = await Promise.all([
                sbGetAvailableCourses(adminStatus),
                sbGetDatabase(),
                sbGetCourseInfo(),
                sbGetProgrammes()
            ]);
            return { result: 'success', adminStatus, courses, database, courseInfo, programmes };
        }

        case 'getProgrammes':
            return sbGetProgrammes();

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
                .select('id,name,uid,email,submitted_at,sent_by,programme_id,hardware_uid,source')
                .order('submitted_at', { ascending: true }));
            return (rows || []).map(row => ({
                rowNumber: row.id,
                name: row.name || '',
                uid: row.uid || '',
                hardwareUid: row.hardware_uid || '',
                email: row.email || '',
                timestamp: row.submitted_at || '',
                sentBy: row.sent_by || '',
                source: row.source || '',
                programmeId: row.programme_id ?? null
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
                        email: row.email, role: staffRole(row.role),
                        googleName: profile.googleName || '', photo: profile.photo || '',
                        photoUrl: profile.customPhoto || '', googlePhoto: profile.googlePhoto || ''
                    };
                }),
                devices: sbMapDevices(deviceRows)
            };
        }

        // Lecturers' Settings → Staff: names, photos and roles, no cards.
        case 'getStaffDirectory': {
            return (sbUnwrap(await supabaseClient.rpc('staff_directory')) || []).map(row => {
                const googlePhoto = normalizeGooglePhotoUrl(row.photo_url || '');
                return {
                    name: row.name || '', email: row.email, role: staffRole(row.role),
                    googleName: row.google_name || '', photo: row.custom_photo || googlePhoto
                };
            });
        }

        case 'getTrustedDevices':
            return sbMapDevices(sbUnwrap(await supabaseClient.from('trusted_devices')
                .select('id,name,device_id,owner,registered_at').order('id', { ascending: true })));

        // ------------------------- writes -------------------------

        case 'submitRegistration': {
            const email = await sbSessionEmail();
            const sentBy = payload.sentBy
                ? (payload.sentBy.name || payload.sentBy.email || email)
                : email;
            // The Card ID comes from the UID the card was read from, when there is one.
            const hardwareUid = normalizeUid(payload.hardwareUid);
            sbUnwrap(await supabaseClient.from('registrations').insert({
                name: payload.name || '',
                uid: uidToCardId(hardwareUid) || payload.uid || '',
                hardware_uid: hardwareUid || null,
                email: payload.email || '',
                programme_id: payload.programmeId || null,
                submitted_at: new Date().toISOString(),
                sent_by: sentBy,
                source: payload.source || null
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
            if (payload.programmeId) studentInsert.programme_id = payload.programmeId;
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
            if (payload.programmeId !== undefined) patch.programme_id = payload.programmeId || null;
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
            const role = staffRole(payload.role);

            // An empty name or photo means "use the one from their Google account".
            // The photo is only sent when set or changed.
            const row = { name: payload.name || null, uid: payload.uid, email: payload.email, role };
            if ('photoUrl' in payload) row.photo_url = payload.photoUrl || null;
            if (payload.actionType === 'add') {
                sbUnwrap(await supabaseClient.from('staff').insert(row));
            } else if (payload.actionType === 'delete') {
                sbUnwrap(await supabaseClient.from('staff').delete()
                    .eq('id', parseInt(payload.rowIndex)));
            } else if (payload.actionType === 'edit') {
                sbUnwrap(await supabaseClient.from('staff').update(row)
                    .eq('id', parseInt(payload.rowIndex)));
            }
            return { result: 'success' };
        }

        // Students point at a programme by id, so a corrected code shows everywhere.
        case 'saveProgramme_Admin': {
            const row = { code: String(payload.code || '').trim(), name: String(payload.name || '').trim() || null };
            if (payload.archived !== undefined) row.archived = !!payload.archived;
            const { data, error } = await (payload.id
                ? supabaseClient.from('programmes').update(row).eq('id', payload.id).select('id')
                : supabaseClient.from('programmes').insert(row).select('id'));
            if (error?.code === '23505') throw new Error(`There is already a programme called ${row.code}.`);
            sbUnwrap({ data, error });
            if (!data?.length) throw new Error('That programme no longer exists. Reopen Settings and try again.');
            return { result: 'success', id: data[0].id };
        }

        // Its students (and pending registrations) move to payload.moveTo first.
        case 'deleteProgramme_Admin':
            return sbUnwrap(await supabaseClient.rpc('delete_programme', {
                p_id: payload.id, p_move_to: payload.moveTo || null
            }));

        case 'registerDevice_Admin': {
            // Several people may register the same device, once each.
            const owner = await sbSessionEmail();
            const own = sbUnwrap(await supabaseClient.from('trusted_devices')
                .select('id').eq('device_id', payload.deviceId).ilike('owner', owner));
            if (own?.length) throw new Error('You already registered this device.');
            sbUnwrap(await supabaseClient.from('trusted_devices').insert({
                name: payload.deviceName,
                device_id: payload.deviceId,
                owner,
                registered_at: localDateString()
            }));
            return { result: 'success' };
        }

        // Row security lets lecturers change only their own devices; a change that
        // touched no row was not allowed.
        case 'deleteDevice_Admin': {
            const id = parseInt(payload.rowIndex);
            if (isNaN(id) || id < 1) throw new Error('Invalid row index provided');
            const removed = sbUnwrap(await supabaseClient.from('trusted_devices').delete().eq('id', id).select('id'));
            if (!removed?.length) throw new Error('You can only remove devices you registered.');
            return { result: 'success' };
        }

        case 'renameDevice': {
            const id = parseInt(payload.rowIndex);
            const name = String(payload.deviceName || '').trim();
            if (isNaN(id) || id < 1) throw new Error('Invalid row index provided');
            if (!name) throw new Error('Please enter a device name.');
            const renamed = sbUnwrap(await supabaseClient.from('trusted_devices').update({ name }).eq('id', id).select('id'));
            if (!renamed?.length) throw new Error('You can only rename devices you registered.');
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

        // A teaching assistant's records (supabase/migrations/assistants_and_course_appearance.sql).
        case 'syncCourseLogs_Assistant': {
            return sbUnwrap(await supabaseClient.rpc('sync_assistant_logs', {
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
            // The card's UID is kept only when one was given; it is never guessed from the Card ID.
            // When there is one, the Card ID comes from it.
            const card = splitCardValue(payload.uid);
            const hardwareUid = normalizeUid(payload.hardwareUid) || card.uid;
            const studentId = uidToCardId(hardwareUid) || card.cardId;

            if (payload.approvalMode === 'custom_replace') {
                const existing = sbUnwrap(await supabaseClient.from('students')
                    .select('id,uids,hardware_uids').eq('id', parseInt(payload.duplicateRowIndex)));
                if (!existing || existing.length === 0) throw new Error('Could not find existing student to update.');

                const student = existing[0];
                const updates = payload.updates || {};
                const patch = {};
                if (updates.name) patch.name = payload.name;
                if (updates.email) patch.email = payload.email;
                if (updates.programme) patch.programme_id = payload.programmeId || null;
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
                const student = {
                    name: payload.name,
                    email: payload.email,
                    uids: studentId ? [studentId] : [],
                    hardware_uids: hardwareUid ? [hardwareUid] : []
                };
                if (payload.programmeId) student.programme_id = payload.programmeId;
                sbUnwrap(await supabaseClient.from('students').insert(student));
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
// onRead(serialNumber), when given, fills the fields itself instead of inputElement.
function startNfcForInputDialog(inputElement, statusContainer, scanButton, cardLabel = 'STUDENT ID CARD', onRead = null) {
    if (!nfcSupported) {
        if (/Android|webOS|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            statusContainer.innerHTML = `<p style="text-align:center; font-size: 0.9em; opacity: 0.8;">NFC scanning requires Chrome on Android.</p>`;
        }
        return null;
    }

    statusContainer.style.minHeight = '48px';
    statusContainer.innerHTML = `<div class="nfc-input-wait">${cardTapAnimationHtml({ label: cardLabel })}<div class="nfc-input-status is-waiting" role="status"><i class="fa-solid fa-wifi" aria-hidden="true"></i><span>Ready to scan</span></div></div>`;
    // It sits below the fields; bring it into view so the hint is seen.
    requestAnimationFrame(() => statusContainer.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));

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
            if (onRead) onRead(serialNumber);
            else {
                inputElement.value = serialNumber;
                inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                inputElement.dataset.hardwareUid = serialNumber;
            }
            playSound(true);
            statusContainer.innerHTML = `<div class="nfc-input-status is-success" role="status"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Card scanned</span></div>`;

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
            statusContainer.innerHTML = `<div class="nfc-input-status is-error" role="status"><i class="fa-solid fa-circle-xmark" aria-hidden="true"></i><span>Scan failed. Is NFC on?</span></div>`;
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
                assistantCourses = bootData.adminStatus?.assistantCourses || [];
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

                // 3. Refresh Logs for the (potentially new) Current Course. An
                // assistant's course keeps the records waiting to upload, and sends them.
                if (currentCourse) {
                    await loadAndMergeCourseData(currentCourse, { strict: true });
                    if (canRecordAnywhere()) await syncLogsWithSheet();
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
    localStorage.removeItem(COLOUR_THEME_KEY);
    localStorage.removeItem('last_active_course');
    // The next sign-in starts its own inactivity clock; an old one would end it at once.
    localStorage.removeItem(LAST_ACTIVITY_KEY);

    // Stop One Tap from silently signing the user straight back in
    if (typeof google !== 'undefined' && google.accounts?.id) {
        google.accounts.id.disableAutoSelect();
    }

    // Online, the session also ends on the server. Offline that fails (supabase-js
    // first refreshes an expired token) and keeps the session, so it is removed
    // from this device either way; a server that does not answer gets 3 seconds.
    const serverSignOut = navigator.onLine
        ? Promise.race([supabaseClient.auth.signOut({ scope: 'local' }), new Promise(resolve => setTimeout(resolve, 3000))])
        : Promise.resolve();
    serverSignOut.catch(() => {}).finally(() => {
        Object.keys(localStorage).filter(isStoredSessionKey).forEach(key => localStorage.removeItem(key));
        // The scan lock goes with the session, but stays on screen until the page reloads.
        window.removeEventListener('beforeunload', scanLockBeforeUnload);
        endScanLockSession();
        writeScanLockState(null);
        window.location.reload();
    });
}

// supabase-js keeps the session as sb-<project>-auth-token, with its helpers beside it.
function isStoredSessionKey(key) {
    return /^sb-.+-auth-token/.test(key || '');
}

// ============================================================
// SIGN-OUT AFTER INACTIVITY
// After 30 minutes without a touch, click or key in any Stando tab, a one-minute
// countdown offers to stay signed in, then signs out. Coming back later than
// that signs out at once. Never while scanning or locked for scanning, while
// syncing, or while attendance on this device waits to sync.
// ============================================================
const IDLE_SIGNOUT_MS = 30 * 60 * 1000;
const IDLE_WARNING_MS = 60 * 1000;
const LAST_ACTIVITY_KEY = 'stando_last_activity';
let lastActivityWrite = 0;
let idleCountdown = null;

function readLastActivity() {
    try {
        return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || 0;
    } catch {
        return 0;
    }
}

// Shared by every tab through localStorage; written at most every 15 seconds.
function noteActivity(force = false) {
    const now = Date.now();
    if (!force && now - lastActivityWrite < 15000) return;
    lastActivityWrite = now;
    try { localStorage.setItem(LAST_ACTIVITY_KEY, String(now)); } catch { /* This tab still counts it. */ }
}

// Attendance saved on this device for the signed-in account and not yet synced.
function hasPendingAttendance() {
    if (refreshPendingChanges()) return true;
    const prefix = `${LOGS_STORAGE_KEY}_account_${encodeURIComponent(String(currentUser?.email || '').trim().toLowerCase())}_`;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(prefix)) continue;
            const cached = JSON.parse(localStorage.getItem(key) || 'null');
            if (cached?.pending === true || cached?.tombstones?.length) return true;
        }
    } catch {
        return true; // Unreadable storage: keep the session rather than risk it.
    }
    return false;
}

function idleSignOutBlocked() {
    return isScanning || scanLockSession || isSyncing || hasPendingAttendance();
}

function idleTime() {
    const last = readLastActivity();
    return last ? Date.now() - last : 0;
}

function isIdleSessionStale() {
    return idleTime() >= IDLE_SIGNOUT_MS && !idleSignOutBlocked();
}

function signOutForInactivity() {
    hideIdleCountdown();
    handleSignoutClick();
}

function checkIdleSignOut() {
    if (!isSignedIn) return;
    // While blocked the clock is held at zero, so the countdown starts afresh afterwards.
    if (idleSignOutBlocked()) {
        noteActivity(true);
        hideIdleCountdown();
        return;
    }
    const idle = idleTime();
    if (idle >= IDLE_SIGNOUT_MS) signOutForInactivity();
    else if (idle >= IDLE_SIGNOUT_MS - IDLE_WARNING_MS) showIdleCountdown();
    else hideIdleCountdown();
}

// Above everything, the lock screen included, so it is seen before it acts.
function showIdleCountdown() {
    if (!idleCountdown) {
        const backdrop = document.createElement('div');
        backdrop.className = 'dialog-backdrop idle-backdrop';
        backdrop.innerHTML = `
            <div class="dialog idle-dialog" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-text">
                <h3 class="dialog-title" id="idle-title"><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i> Still there?</h3>
                <div class="dialog-content">
                    <p id="idle-text">You haven't used Stando for a while. To keep your account safe, you'll be signed out in <strong class="idle-seconds"></strong>.</p>
                </div>
                <div class="dialog-actions">
                    <button type="button" class="btn-red" data-idle="signout"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Sign out</button>
                    <button type="button" class="btn-green" data-idle="stay"><i class="fa-solid fa-check" aria-hidden="true"></i> Stay signed in</button>
                </div>
            </div>`;
        backdrop.addEventListener('click', (event) => {
            const action = event.target.closest('[data-idle]')?.dataset.idle;
            if (action === 'signout') signOutForInactivity();
            else if (action === 'stay') {
                noteActivity(true);
                hideIdleCountdown();
            }
        });
        document.body.appendChild(backdrop);
        openDialogMode();
        idleCountdown = { backdrop, timer: setInterval(updateIdleCountdown, 1000) };
        backdrop.querySelector('[data-idle="stay"]').focus({ preventScroll: true });
    }
    updateIdleCountdown();
}

function updateIdleCountdown() {
    if (!idleCountdown) return;
    const seconds = Math.max(0, Math.ceil((IDLE_SIGNOUT_MS - idleTime()) / 1000));
    idleCountdown.backdrop.querySelector('.idle-seconds').textContent = `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
    if (seconds === 0) checkIdleSignOut();
}

function hideIdleCountdown() {
    if (!idleCountdown) return;
    clearInterval(idleCountdown.timer);
    idleCountdown.backdrop.remove();
    idleCountdown = null;
    closeDialogMode();
}

function setupIdleSignOut() {
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(type => {
        document.addEventListener(type, (event) => {
            if (!isSignedIn) return;
            // A click on the countdown's own buttons decides for itself; keys (Escape,
            // Enter) always count as being there, as Escape closes the countdown.
            if (idleCountdown && event.type === 'pointerdown' && event.target?.closest?.('[data-idle]')) return;
            noteActivity(!!idleCountdown);
            if (idleCountdown) hideIdleCountdown();
        }, { capture: true, passive: true });
    });
    // Activity in another tab closes this tab's countdown.
    window.addEventListener('storage', (event) => {
        if (event.key === LAST_ACTIVITY_KEY && idleCountdown) checkIdleSignOut();
    });
    // Timers sleep with the phone; check as soon as the page is back.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkIdleSignOut();
    });
    setInterval(checkIdleSignOut, 15000);
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
    if (avatar) avatar.innerHTML = avatarContentHtml(displayName, currentUserPhoto());
    if (name) name.textContent = displayName;
    if (chip) {
        const opens = isAdmin ? 'Settings' : 'Profile';
        chip.title = opens;
        chip.setAttribute('aria-label', `${opens}: ${displayName}`);
    }
}

// The staff record's custom name when set, otherwise the Google account name.
function currentUserDisplayName() {
    return currentUser?.staffName || currentUser?.name || '';
}

// A photo set in Settings → Staff, else the Google photo.
function currentUserPhoto() {
    return currentUser?.staffPhoto || currentUser?.picture || '';
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
    updateRecordingMode();

    // The groups and their label go together (signing out in another tab included).
    const sessionControls = document.getElementById('session-controls');
    if (!isAdmin && !canRecordInCourse(currentCourse) && sessionControls) {
        sessionControls.style.setProperty('display', 'none', 'important');
        document.getElementById('session-label')?.setAttribute('hidden', '');
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
    placeScanButtons();
    updateScanButtons();
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

        // A card read here signs in on a device trusted for its owner (kiosk-login);
        // elsewhere a student's card greets them by name, as a check that it works,
        // and says how to sign in with it. Its Card ID stays hidden.
        if (signedOutCard) {
            let notSignedInMsg = notSignedInMsgElement;
            if (!notSignedInMsg) {
                notSignedInMsg = document.createElement('div');
                notSignedInMsg.id = 'not-signed-in-message';
                notSignedInMsg.setAttribute('class', 'not-signed-in-message');
                notSignedInMsg.setAttribute('role', 'status');
                (loginContainer || document.getElementById('main-container'))?.appendChild(notSignedInMsg);
            }
            notSignedInMsg.classList.toggle('is-known', !!signedOutCard.name);
            notSignedInMsg.innerHTML = signedOutCard.checking
                ? '<p><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i> Checking card…</p>'
                : signedOutCard.name
                    ? `<p class="card-greeting"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Hello, <strong></strong></span></p>
                       <p>To sign in with your card on this phone, sign in once and trust it in your profile.</p>`
                    : `<p><i class="fa-solid fa-id-card" aria-hidden="true"></i> This card isn't registered yet.</p>
                       <p>Sign in, then choose <strong>Register Card ID</strong>.</p>`;
            if (signedOutCard.name) notSignedInMsg.querySelector('strong').textContent = signedOutCard.name;
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
    updateRecordingMode();
    applyCourseAppearance(courseName);
    renderSessionControls(courseName);
    updatePageTitle();
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
        const writable = canRecordInCourse(courseName);
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
            try { localStorage.removeItem(LAST_ACTIVITY_KEY); } catch { /* Cleared at the next sign-out. */ }
            useColourTheme({});
            isSignedIn = false;
            isAdmin = false;
            isGlobalAdmin = false;
            adminCourses = [];
            assistantCourses = [];
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

    // Signing out in another tab removes the stored session, which supabase-js
    // does not report here when offline. This tab reloads signed out, its lock
    // on screen until then.
    window.addEventListener('storage', (event) => {
        if (!isSignedIn || event.newValue !== null || !/^sb-.+-auth-token$/.test(event.key || '')) return;
        isSignedIn = false;
        window.removeEventListener('beforeunload', scanLockBeforeUnload);
        window.location.reload();
    });
}

/**
 * Update online/offline status indicator. Changes waiting to upload go up as
 * soon as the connection is back.
 */
function updateOnlineStatus() {
    isOnline = navigator.onLine;
    if (isSyncing) return;
    if (isOnline && pendingChanges) {
        updateSyncStatus('Saving…', 'syncing');
        if (isSignedIn) syncSoon(500);
    } else if (isOnline) {
        updateSyncStatus('Online', 'online');
    } else {
        updateSyncStatus(pendingChanges ? 'Saved offline' : 'Offline', pendingChanges ? 'waiting' : 'offline');
    }
}

/**
 * Sync data with Google Sheets.
 * Fetches and updates both database and logs.
 */
async function syncData() {
    if (!isOnline || !isSignedIn || isSyncing) return;
    const courseName = currentCourse;
    isSyncing = true;
    updateSyncStatus('Syncing…', 'syncing');
    try {
        invalidateDatabaseCache();
        await fetchDatabaseFromSheet();
        window.buildUIDToPrimaryUidMap();
        await fetchCourseInfo();
        if (courseName) await loadAndMergeCourseData(courseName, { strict: true });
        if (canRecordAnywhere()) await syncLogsWithSheet();
        if (isAdmin) await refreshAdminViews();
        lastSyncTime = Date.now();
        isSyncing = false;
        showSyncState();
    } catch (error) {
        console.error('Sync error:', error);
        updateSyncStatus('Sync failed', 'error');
        showNotification('warning', 'Sync Failed', 'Your pending changes are kept on this device. Reconnect and try again.');
    } finally {
        isSyncing = false;
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
        const writable = canRecordInCourse(courseName);
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
* Centralized function to save course data and upload it shortly after.
*/
function saveAndMarkChanges(courseName) {
    const data = courseData[courseName];
    if (!data) return;
    data.pending = true;
    data.revision = (data.revision || 0) + 1;
    refreshPendingChanges();
    saveCourseToLocalStorage(courseName);
    if (!isOnline) updateSyncStatus('Saved offline', 'waiting');
    else if (isSignedIn && !isSyncing) {
        updateSyncStatus('Saving…', 'syncing');
        syncSoon();
    }
}

// Changes upload by themselves a moment after they are made, so a run of scans
// goes up together. Failed uploads are retried by the regular auto-sync.
let syncSoonTimer = null;
function syncSoon(delay = 2000) {
    clearTimeout(syncSoonTimer);
    syncSoonTimer = setTimeout(() => {
        if (isOnline && isSignedIn && canRecordAnywhere()) syncLogsWithSheet().catch(error => console.warn('Upload failed; auto-sync retries it:', error));
    }, delay);
}

// The status chip once uploads finish: "Saved" for a moment, then "Online".
let syncedStatusTimer = null;
function showSyncState() {
    refreshPendingChanges();
    clearTimeout(syncedStatusTimer);
    if (!isOnline) {
        updateSyncStatus(pendingChanges ? 'Saved offline' : 'Offline', pendingChanges ? 'waiting' : 'offline');
    } else if (pendingChanges) {
        updateSyncStatus('Saving…', 'syncing');
    } else {
        updateSyncStatus('Saved', 'success');
        syncedStatusTimer = setTimeout(() => {
            if (!pendingChanges && isOnline && !isSyncing) updateSyncStatus('Online', 'online');
        }, 3000);
    }
}


/**
* Uploads every course with changes not yet saved online.
*/
async function syncLogsWithSheet() {
    if (!isOnline || !isSignedIn || !canRecordAnywhere()) return;
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
        if (!canRecordInCourse(courseName)) continue;
        if (!courseData[courseName]) courseData[courseName] = await loadCourseFromLocalStorage(courseName);
        if (courseData[courseName].pending) await syncViaBackendAPI(courseName);
    }
    refreshPendingChanges();
}

async function syncViaBackendAPI(courseName = currentCourse) {
    if (!courseName || !isOnline || !isSignedIn || !canRecordInCourse(courseName)) return;
    if (courseSyncRequests.has(courseName)) return courseSyncRequests.get(courseName);
    const data = courseData[courseName];
    if (!data) return;
    const revision = data.revision || 0;
    // An assistant uploads only their own records; the server keeps the rest as they are.
    const assistant = isAssistantForCourse(courseName);
    const logs = data.logs.filter(log => !assistant || isOwnLog(log)).map(log => ({ ...log }));
    const tombstones = Array.from(data.tombstones || []);
    const account = currentUser?.email;
    const request = (async () => {
        const result = await callWebApp(assistant ? 'syncCourseLogs_Assistant' : 'syncCourseLogs_Admin', { courseName, logs, tombstones });
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
    } catch (error) {
        updateSyncStatus('Sync failed', 'error');
        throw error;
    } finally {
        if (courseSyncRequests.get(courseName) === request) courseSyncRequests.delete(courseName);
    }
    // Edits made while this upload ran follow it; otherwise say they are saved.
    if (courseData[courseName]?.pending) syncSoon(500);
    else if (!courseSyncRequests.size && !isSyncing) showSyncState();
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

// --- Card ID, with the card's UID as an option ---
// A card is known by its Card ID, the number a scan shows. Its UID (the chip's
// own serial number) is optional: "Use UID" under More settings shows a UID
// field above the Card ID, and the Card ID then follows the UID and cannot be
// edited. Cards saved with a UID open with it on.
const MORE_SETTINGS_KEY = 'stando_more_settings_open';
let cardScanSession = null; // { controller, button } of the card being scanned

// "b5:01:fa:ce" from "B501FACE", "b5 01 fa ce" or "b5-01-fa-ce"; '' if it is not a UID.
function normalizeUid(value) {
    const hex = String(value || '').trim().toLowerCase().replace(/[\s:.-]/g, '');
    return /^[0-9a-f]{8}$/.test(hex) ? hex.match(/../g).join(':') : '';
}

// The Card ID a UID stands for, or '' while the UID is incomplete.
function uidToCardId(uid) {
    const normalized = normalizeUid(uid);
    return normalized ? convertUidToExternalId(normalized) : '';
}

// A card as stored, whichever form it was saved in: { cardId, uid }. Digits alone
// are a Card ID, even eight of them; a stored UID has letters or colons.
function splitCardValue(value) {
    const text = String(value || '').trim();
    const uid = /^\d+$/.test(text) ? '' : normalizeUid(text);
    return uid ? { cardId: uidToCardId(uid), uid } : { cardId: text, uid: '' };
}

function cardFieldsHtml(id, { cardId = '', uid = '', required = true, scan = nfcSupported } = {}) {
    const useUid = !!uid;
    let open = false;
    try { open = localStorage.getItem(MORE_SETTINGS_KEY) === '1'; } catch { /* Closed. */ }
    return `
        <div class="card-fields" data-card-fields data-had-uid="${useUid}">
            <div class="form-group card-uid-group"${useUid ? '' : ' hidden'}>
                <label class="dialog-label-fixed" for="${id}-uid"><i class="fa-solid fa-wifi"></i> UID${required ? ' <span class="required">*</span>' : ''}</label>
                <div class="field-with-action"><input type="text" id="${id}-uid" class="form-control card-uid-input" value="${escapeHtml(uid)}" placeholder="e.g. b5:01:fa:ce" autocomplete="off" spellcheck="false" autocapitalize="off"></div>
            </div>
            <div class="form-group card-id-group">
                <label class="dialog-label-fixed" for="${id}-id"><i class="fa-solid fa-id-card"></i> Card ID${required && !useUid ? ' <span class="required">*</span>' : ''}</label>
                <div class="field-with-action"><input type="text" id="${id}-id" class="form-control card-id-input" inputmode="numeric" value="${escapeHtml(cardId)}" placeholder="e.g. 16384437" autocomplete="off"${useUid ? ' disabled' : ''}>${scan ? '<button type="button" class="btn-blue btn-icon btn-sm card-scan-btn" title="Scan the card" aria-label="Scan the card"><i class="fa-solid fa-wifi" aria-hidden="true"></i></button>' : ''}</div>
            </div>
            <details class="more-settings"${open ? ' open' : ''}>
                <summary>More settings</summary>
                ${switchRowHtml(`${id}-use-uid`, useUid, 'Use UID', 'Enter the UID and the Card ID fills in.')}
            </details>
        </div>`;
}

// Wires one set of card fields. A scan fills the UID when it is used, and the
// Card ID either way. Returns what saving needs.
function bindCardFields(box, { statusContainer, cardLabel, required = true } = {}) {
    const uidGroup = box.querySelector('.card-uid-group');
    const uidInput = box.querySelector('.card-uid-input');
    const idInput = box.querySelector('.card-id-input');
    const idLabel = box.querySelector('.card-id-group label');
    const toggle = box.querySelector('.switch-input');
    const scanBtn = box.querySelector('.card-scan-btn');
    const hadUid = box.dataset.hadUid === 'true';
    const scanIcon = '<i class="fa-solid fa-wifi" aria-hidden="true"></i>';

    const followUid = () => {
        if (toggle.checked && uidInput.value.trim()) idInput.value = uidToCardId(uidInput.value);
    };
    const render = () => {
        const useUid = toggle.checked;
        uidGroup.hidden = !useUid;
        idInput.disabled = useUid;
        idLabel.querySelector('.required')?.remove();
        if (required && !useUid) idLabel.insertAdjacentHTML('beforeend', ' <span class="required">*</span>');
        // The scan button sits beside the field a scan fills in.
        if (scanBtn) (useUid ? uidInput : idInput).after(scanBtn);
        clearInputError(uidInput);
        clearInputError(idInput);
        followUid();
    };
    uidInput.addEventListener('input', followUid);
    toggle.addEventListener('change', () => {
        render();
        if (toggle.checked) uidInput.focus({ preventScroll: true });
    });
    box.querySelector('.more-settings').addEventListener('toggle', (event) => {
        try { localStorage.setItem(MORE_SETTINGS_KEY, event.target.open ? '1' : '0'); } catch { /* Not remembered. */ }
    });

    const stopScan = () => {
        cardScanSession?.controller?.abort();
        if (cardScanSession?.button && !cardScanSession.button.disabled) cardScanSession.button.innerHTML = scanIcon;
        cardScanSession = null;
    };
    scanBtn?.addEventListener('click', () => {
        if (cardScanSession?.button === scanBtn) {
            stopScan();
            if (statusContainer) { statusContainer.innerHTML = ''; statusContainer.style.minHeight = '0'; }
            return;
        }
        stopScan();
        scanBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        const controller = startNfcForInputDialog(uidInput, statusContainer, scanBtn, cardLabel, (serialNumber) => {
            uidInput.value = normalizeUid(serialNumber) || serialNumber;
            idInput.value = uidToCardId(serialNumber) || serialNumber;
            [uidInput, idInput].forEach(input => { clearInputError(input); input.dispatchEvent(new Event('input', { bubbles: true })); });
            cardScanSession = null;
        });
        cardScanSession = { controller, button: scanBtn };
    });
    render();

    return {
        hadUid,
        get useUid() { return toggle.checked; },
        get removesUid() { return hadUid && !toggle.checked; },
        cardId: () => idInput.value.trim(),
        uid: () => (toggle.checked ? normalizeUid(uidInput.value) : ''),
        isEmpty: () => !idInput.value.trim() && !(toggle.checked && uidInput.value.trim()),
        // Shows what is wrong beside the field; true when the card can be saved.
        validate() {
            clearInputError(uidInput);
            clearInputError(idInput);
            if (toggle.checked) {
                if (normalizeUid(uidInput.value)) return true;
                showInputError(uidInput, uidInput.value.trim()
                    ? 'A UID is four pairs of letters and digits, such as b5:01:fa:ce.'
                    : 'Enter or scan the UID, or turn off Use UID.');
                return false;
            }
            const cardId = idInput.value.trim();
            if (!cardId) {
                if (required) showInputError(idInput, 'Enter or scan the Card ID.');
                return !required;
            }
            if (!/^\d+$/.test(cardId)) {
                showInputError(idInput, normalizeUid(cardId) ? 'That is a UID. Turn on Use UID under More settings, or enter the Card ID.' : 'A Card ID has digits only.');
                return false;
            }
            return true;
        }
    };
}

// Turning off Use UID deletes the stored UID: ask first. The Card ID stays.
function confirmUidRemoval(cards, onConfirm) {
    if (!cards.some(card => card.removesUid)) return onConfirm();
    showConfirmationDialog({
        title: 'Remove the UID?',
        message: 'Use UID is off, so the card’s UID will be deleted when you save. Its Card ID stays as it is.',
        confirmText: '<i class="fa-solid fa-trash"></i> Remove UID and Save',
        cancelText: 'Keep Editing',
        isDestructive: true,
        onConfirm
    });
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

    dialog.innerHTML = `
        <h3 class="dialog-title"><i class="fa-solid fa-user-plus"></i> Add New Student</h3>
        <div class="dialog-content">
            <p style="margin-bottom: 15px; opacity: 0.7;">Enter the student's details.</p>

            <div class="form-group">
                <label class="dialog-label-fixed" for="add-name">Name <span class="required">*</span></label>
                <input type="text" id="add-name" class="form-control" placeholder="Full Name">
            </div>

            <div class="form-group">
                <label class="dialog-label-fixed" for="add-email">Email <span class="required">*</span></label>
                <input type="email" id="add-email" class="form-control" placeholder="nsurname00@epoka.edu.al">
            </div>

            ${programmeFieldHtml('add-programme', dbProgrammeFilter === 'none' ? '' : dbProgrammeFilter)}

            ${cardFieldsHtml('add-card')}

            <div id="nfc-status-container" style="margin-top:10px;"></div>
        </div>
        <div class="dialog-actions">
            <button id="cancel-add-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button id="confirm-add-btn" class="btn-green"><i class="fa-solid fa-plus"></i> Add Student</button>
        </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const close = () => {
        if (document.body.contains(dialogBackdrop)) {
            document.body.removeChild(dialogBackdrop);
        }
        closeDialogMode();
    };

    const card = bindCardFields(dialog.querySelector('[data-card-fields]'), { statusContainer: dialog.querySelector('#nfc-status-container') });

    document.getElementById('cancel-add-btn').addEventListener('click', close);

    // --- Event Listener ---
    document.getElementById('confirm-add-btn').addEventListener('click', async () => {
        const nameInput = document.getElementById('add-name');
        const emailInput = document.getElementById('add-email');

        // --- Validation ---
        clearInputError(nameInput);
        clearInputError(emailInput);
        const name = nameInput.value.trim();
        const email = emailInput.value.trim();

        let isValid = true;
        if (name === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(email)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        const programme = readProgrammeField(dialog.querySelector('#add-programme'));
        if (!programme.ok) isValid = false;
        if (!card.validate()) isValid = false;
        if (!isValid) return;

        const submissionData = {
            name: name,
            email: email,
            uid: card.cardId(),
            hardwareUid: card.uid(),
            programmeId: programme.id,
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

        ${programmeFieldHtml('edit-programme', entry.programmeId)}

        <hr style="margin: 15px 0; border:0; border-top:1px solid #eee;">

        <div id="uid-list-container"></div>

        <div style="display: flex; justify-content: flex-end; margin-top: 15px;">
             <button type="button" id="add-new-uid-row-btn" class="btn-blue btn-sm"><i class="fa-solid fa-plus"></i> Add Card</button>
        </div>
        <div id="nfc-status-container" style="margin-top:10px;"></div>
    </div>
    <div class="dialog-actions">
        <button id="cancel-request-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="submit-request-btn" class="btn-green"><i class="fa-solid fa-check"></i> Submit</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    const uidListContainer = dialog.querySelector('#uid-list-container');
    const nfcStatusContainer = dialog.querySelector('#nfc-status-container');
    const cards = new Map(); // card box → its fields
    let cardCount = 0;
    // One card is just "Card"; several are "Card 1", "Card 2"… as they are added and
    // removed. The only card cannot be removed, so it has no Remove.
    const numberCards = () => {
        const rows = uidListContainer.querySelectorAll('.uid-edit-row');
        rows.forEach((row, index) => {
            row.querySelector('.uid-edit-row-title').lastChild.textContent = rows.length > 1 ? ` Card ${index + 1}` : ' Card';
            row.querySelector('.remove-uid-btn').hidden = rows.length === 1;
        });
    };

    const createUidRow = (cardId = '', uid = '') => {
        const uidGroup = document.createElement('div');
        uidGroup.setAttribute('class', 'uid-edit-row');
        uidGroup.innerHTML = `
            <div class="uid-edit-row-head">
                <span class="uid-edit-row-title"><i class="fa-solid fa-id-card"></i> Card</span>
                <button type="button" class="btn-red btn-sm remove-uid-btn" title="Remove this card"><i class="fa-solid fa-trash-can"></i> Remove</button>
            </div>
            ${cardFieldsHtml(`edit-card-${++cardCount}`, { cardId, uid })}`;
        uidListContainer.appendChild(uidGroup);
        numberCards();
        cards.set(uidGroup, bindCardFields(uidGroup.querySelector('[data-card-fields]'), { statusContainer: nfcStatusContainer }));

        uidGroup.querySelector('.remove-uid-btn').addEventListener('click', () => {
            if (cards.size > 1) {
                cards.delete(uidGroup);
                uidGroup.remove();
                numberCards();
            } else {
                showNotification('warning', 'Cannot Remove', 'A student needs at least one card.');
            }
        });
    };

    // Each Card ID with the UID it was worked out from, then any UID without one.
    const uids = (entry.hardware_uids || []).map(normalizeUid).filter(Boolean);
    const pairs = (entry.uids || []).map(cardId => {
        const index = uids.findIndex(uid => uidToCardId(uid) === String(cardId).trim());
        return { cardId, uid: index >= 0 ? uids.splice(index, 1)[0] : '' };
    });
    uids.forEach(uid => pairs.push({ cardId: uidToCardId(uid), uid }));
    if (pairs.length === 0) pairs.push({ cardId: '', uid: '' });
    pairs.forEach(({ cardId, uid }) => createUidRow(cardId, uid));

    dialog.querySelector('#add-new-uid-row-btn').addEventListener('click', () => createUidRow());

    const closeDialog = () => {
        cardScanSession?.controller?.abort();
        if (document.body.contains(dialogBackdrop)) document.body.removeChild(dialogBackdrop);
        closeDialogMode();
    };

    document.getElementById('cancel-request-btn').addEventListener('click', closeDialog);

    document.getElementById('submit-request-btn').addEventListener('click', async () => {
        const nameInput = document.getElementById('edit-name');
        const emailInput = document.getElementById('edit-email');

        clearInputError(nameInput);
        clearInputError(emailInput);
        const newName = nameInput.value.trim();
        const newEmail = emailInput.value.trim();
        let isValid = true;
        if (newName === '') { showInputError(nameInput, 'Name is required.'); isValid = false; }
        if (!isValidEmail(newEmail)) { showInputError(emailInput, 'A valid email is required.'); isValid = false; }
        const programmeSelect = dialog.querySelector('#edit-programme');
        const programme = readProgrammeField(programmeSelect);
        if (!programme.ok) isValid = false;

        const finalUids = [];
        const finalHardwareUids = [];
        cards.forEach(card => {
            if (!card.validate()) { isValid = false; return; }
            finalUids.push(card.cardId());
            if (card.uid()) finalHardwareUids.push(card.uid());
        });

        if (!isValid) return;
        const saveStudent = () => {
            // 1. Update local map
            const programmeId = programmeSelect ? programme.id : (entry.programmeId ?? null);
            databaseMap[dbKey] = { name: newName, email: newEmail, uids: finalUids, hardware_uids: finalHardwareUids, programmeId };

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
                if (programmeSelect) updateData.programmeId = programmeId;

                callWebApp('updateStudentInDatabase_Admin', updateData, 'POST')
                    .then(() => {
                        invalidateDatabaseCache();
                    })
                    .catch((err) => {
                        console.error("Background sync failed:", err);
                        showNotification('error', 'Sync Failed', 'Changes saved locally but failed to sync.');
                    });
            }
        };
        confirmUidRemoval([...cards.values()], saveStudent);
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
            // Colours changed meanwhile, by an administrator elsewhere, show now.
            if (currentCourse) applyCourseAppearance(currentCourse);
        }
    } catch (e) {
        console.error('Error fetching course info:', e);
    }
}


/**
* Displays a custom confirmation dialog with dynamic button colors.
* @param {object} options - The options for the dialog.
* @param {boolean} [options.isDestructive=false] - If true, the confirm button will be red.
*/
function showConfirmationDialog({ title, message, confirmText = 'Confirm', cancelText = 'Cancel', onConfirm, onCancel, isDestructive = false }) {
    openDialogMode();

    const confirmBtnClass = isDestructive ? 'btn-red' : 'btn-blue';
    const cancelBtnClass = 'btn-secondary';

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
            // error.quiet: the dialog already shows what to fix.
            if (!error?.quiet) showNotification('error', 'Action Failed', error.message || 'Please try again.');
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
    if (!canRecordInCourse(currentCourse)) return;
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
    const sessionHtml = renderSessionSelectorHTML('manual');

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

        // Readable subtitle with Card ID and UID (Global Admin only)
        const idParts = (data.uids && data.uids.length > 0) ? `Card ID: ${data.uids.join(', ')}` : '';
        const hwParts = (data.hardware_uids && data.hardware_uids.length > 0) ? `UID: ${data.hardware_uids.join(', ')}` : '';
        const subtitle = isGlobalAdmin
            ? [idParts, hwParts].filter(Boolean)
            : [data.email].filter(Boolean);

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
            <input type="text" id="manual-name-search" class="form-control" placeholder="${isGlobalAdmin ? 'Type a name, Card ID or UID' : 'Type a student name'}" autocomplete="off">
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

        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-users"></i> Group</label>
            ${sessionHtml || '<input type="text" id="manual-session-fallback" class="form-control" value="Default" disabled>'}
        </div>

    </div>
    <div class="dialog-actions">
        <button id="cancel-manual-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
        <button id="save-manual-log-btn" class="btn-green" disabled><i class="fa-solid fa-plus"></i> Add Entry</button>
    </div>`;

    dialogBackdrop.appendChild(dialog);
    document.body.appendChild(dialogBackdrop);

    // --- Activate Toggles: starting on the main screen's group ---
    if (sessionHtml) {
        const rawSections = courseInfoMap[currentCourse].availableSections || '';
        setupSessionToggleListeners('manual', parseAvailableSections(rawSections), getCurrentActiveSession());
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
                    ${student.subtitle.length ? `<div class="student-uid meta-parts" style="font-size:0.82em; opacity:0.75;">${student.subtitle.map(part => `<span>${escapeHtml(part)}</span>`).join('')}</div>` : ''}
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
// Deletes every time of one student on one date, after asking. From the row's ⋯ menu
// and from Edit Log Entry (which passes onDeleted to close itself).
function confirmDeleteAllLogs(group, onDeleted = null) {
    const count = group.originalLogs.length;
    showConfirmationDialog({
        title: 'Delete All Times?',
        message: `Delete <strong>all ${count} ${count === 1 ? 'time' : 'times'}</strong> of ${escapeHtml(group.name || 'this student')} on ${escapeHtml(group.date || 'this date')}? This cannot be undone.`,
        confirmText: 'Delete All',
        isDestructive: true,
        onConfirm: () => {
            const idsToRemove = group.originalLogs.map(log => log.id);
            const removeLocally = () => {
                courseData[currentCourse].logs = courseData[currentCourse].logs.filter(log => !idsToRemove.includes(log.id));
            };
            const done = () => {
                updateUI();
                showNotification('delete', 'Deleted', `${count === 1 ? 'The time was' : `All ${count} times were`} deleted.`);
            };

            if (isGlobalAdmin) {
                idsToRemove.forEach(id => addToTombstones(id));
                removeLocally();
                saveAndMarkChanges(currentCourse);
                done();
                if (isOnline && isSignedIn) syncLogsWithSheet();
            } else {
                Promise.all(idsToRemove.map(id => deleteLogViaBackend(id)))
                    .then(() => { removeLocally(); done(); })
                    .catch(err => {
                        showNotification('error', 'Error', 'Failed to delete some logs.');
                        console.error(err);
                    });
            }
            if (onDeleted) onDeleted();
        }
    });
}

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

    // The student's Card IDs, and their UIDs only when saved; an unknown card shows what was scanned.
    const cardLists = studentData ? studentCardLists(studentData) : { ids: [], uids: [] };
    const scanned = splitCardValue(group.uid);
    const idDisplay = cardLists.ids.join(', ') || scanned.cardId;
    const uidDisplay = cardLists.uids.join(', ') || (studentData ? '' : scanned.uid);

    // One line per time: (while selecting) a box, the time, its group (when the course
    // has groups) and delete. Labels are set by numberTimes.
    const hasGroups = Object.keys(parseAvailableSections(courseInfoMap[currentCourse]?.availableSections)).length > 0;
    const timestampRowHtml = ({ time, session, manual, logId = '' }) => `
        <div class="timestamp-edit-group${logId ? '' : ' new-item-flash'}"${logId ? ` data-log-id="${escapeHtml(String(logId))}"` : ' data-is-new="true"'}>
            <span class="timestamp-label">Time</span>
            <div class="timestamp-fields">
                <input type="checkbox" class="timestamp-select" data-no-dirty>
                <input type="time" class="form-control timestamp-time${manual ? ' manual-timestamp-input' : ''}" value="${time}">
                <select class="form-control timestamp-session" aria-label="Group"${hasGroups ? '' : ' hidden'}>${generateSessionOptions(session)}</select>
                <button type="button" class="delete-time-btn" title="Delete this time">
                    <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                </button>
            </div>
        </div>`;

    let timestampFields = '';
    group.originalLogs.forEach(log => {
        const timeObj = new Date(log.timestamp);
        timestampFields += timestampRowHtml({
            time: `${String(timeObj.getHours()).padStart(2, '0')}:${String(timeObj.getMinutes()).padStart(2, '0')}`,
            session: log.session || 'Default',
            manual: log.manual === true || log.manual === 'true',
            logId: log.id
        });
    });

    dialog.innerHTML = `
    <h3 class="dialog-title"><i class="fa-solid fa-pen-to-square"></i> Edit Log Entry</h3>
    <div class="dialog-content">
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-quote-right"></i> Name</label>
            <input type="text" id="edit-name" class="form-control" value="${escapeHtml(studentData?.name || group.name)}" disabled>
        </div>
        ${isGlobalAdmin ? `
        ${uidDisplay ? `<div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-wifi"></i> UID</label>
            <input type="text" id="edit-card-uid" class="form-control" value="${escapeHtml(uidDisplay)}" disabled>
        </div>` : ''}
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-solid fa-id-card"></i> Card ID</label>
            <input type="text" id="edit-student-id" class="form-control" value="${escapeHtml(idDisplay)}" disabled>
        </div>
        ` : ''}
        <div class="form-group">
            <label class="dialog-label-fixed"><i class="fa-regular fa-calendar-days"></i> Date</label>
            <input type="date" id="edit-date" class="form-control" value="${formattedDate}">
        </div>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <label class="inline-field-label" style="margin:0;">Times</label>
            <div class="dialog-button-group">
                <button type="button" id="select-times-btn" class="btn-secondary btn-sm" aria-pressed="false"><i class="fa-regular fa-square-check" aria-hidden="true"></i> Select</button>
                <button type="button" id="add-new-time-btn" class="btn-green btn-sm"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add Time</button>
                <button type="button" id="delete-all-logs-btn" class="btn-red btn-sm"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete All</button>
            </div>
        </div>

        <div id="time-select-bar" class="time-select-bar" hidden>
            <label class="time-select-all"><input type="checkbox" id="time-select-all" data-no-dirty> <span id="time-select-count">0 selected</span></label>
            ${hasGroups ? `<select id="time-select-group" class="form-control" aria-label="Group for the selected times" data-no-dirty>${generateSessionOptions(getCurrentActiveSession())}</select>
            <button type="button" id="time-set-group-btn" class="btn-blue btn-sm" disabled>Set Group</button>` : ''}
            <button type="button" id="time-delete-selected-btn" class="btn-red btn-sm" disabled><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>
        </div>

        <div id="timestamp-container">${timestampFields}</div>
    </div>
    <div class="dialog-actions">
        <button id="cancel-edit-log-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
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

        timestampContainer.insertAdjacentHTML('beforeend', timestampRowHtml({
            time: newTimeValue, session: getCurrentActiveSession(), manual: true
        }));
        const newTimestampGroup = timestampContainer.lastElementChild;
        numberTimes();
        if (!isTouchDevice()) newTimestampGroup.querySelector('.timestamp-time').focus({ preventScroll: true });
        newTimestampGroup.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });

    const closeDialog = () => { if (document.body.contains(dialogBackdrop)) document.body.removeChild(dialogBackdrop); closeDialogMode(); };

    // Deleting a time (saved on Save): a saved one is hidden and remembered, a new one goes.
    const logsToDelete = new Set();
    const removeTimeRow = (row) => {
        if (row.dataset.logId) {
            logsToDelete.add(row.dataset.logId);
            row.classList.add('deleted');
            row.style.display = 'none';
        } else {
            row.remove();
        }
    };
    timestampContainer.addEventListener('click', (event) => {
        const button = event.target.closest('.delete-time-btn');
        if (!button) return;
        removeTimeRow(button.closest('.timestamp-edit-group'));
        numberTimes();
    });

    // Selecting times: a box on each, then set their group or delete them together.
    const selectButton = dialog.querySelector('#select-times-btn');
    const selectBar = dialog.querySelector('#time-select-bar');
    const selectAll = dialog.querySelector('#time-select-all');
    const visibleRows = () => [...timestampContainer.querySelectorAll('.timestamp-edit-group:not(.deleted)')];
    const chosenRows = () => visibleRows().filter(row => row.querySelector('.timestamp-select').checked);
    const updateTimeSelection = () => {
        const rows = visibleRows();
        const chosen = chosenRows();
        dialog.querySelector('#time-select-count').textContent = `${chosen.length} selected`;
        selectAll.checked = rows.length > 0 && chosen.length === rows.length;
        selectAll.indeterminate = chosen.length > 0 && chosen.length < rows.length;
        dialog.querySelectorAll('#time-set-group-btn, #time-delete-selected-btn').forEach(button => { button.disabled = chosen.length === 0; });
        rows.forEach(row => row.classList.toggle('is-selected', row.querySelector('.timestamp-select').checked));
    };
    const setSelectingTimes = (on) => {
        timestampContainer.classList.toggle('is-selecting', on);
        selectBar.hidden = !on;
        selectButton.setAttribute('aria-pressed', String(on));
        selectButton.innerHTML = on
            ? '<i class="fa-solid fa-check" aria-hidden="true"></i> Done'
            : '<i class="fa-regular fa-square-check" aria-hidden="true"></i> Select';
        if (!on) timestampContainer.querySelectorAll('.timestamp-select').forEach(box => { box.checked = false; });
        updateTimeSelection();
    };
    // "Time" alone, or "Time 1", "Time 2"… as times are added and deleted.
    function numberTimes() {
        const rows = visibleRows();
        rows.forEach((row, index) => {
            const label = rows.length > 1 ? `Time ${index + 1}` : 'Time';
            row.querySelector('.timestamp-label').textContent = label;
            row.querySelector('.timestamp-time').setAttribute('aria-label', label);
            row.querySelector('.timestamp-select').setAttribute('aria-label', `Select ${label.toLowerCase()}`);
            row.querySelector('.delete-time-btn').setAttribute('aria-label', `Delete ${label.toLowerCase()}`);
        });
        if (!rows.length && timestampContainer.classList.contains('is-selecting')) setSelectingTimes(false);
        updateTimeSelection();
    }
    selectButton.addEventListener('click', () => setSelectingTimes(!timestampContainer.classList.contains('is-selecting')));
    selectAll.addEventListener('change', () => {
        visibleRows().forEach(row => { row.querySelector('.timestamp-select').checked = selectAll.checked; });
        updateTimeSelection();
    });
    timestampContainer.addEventListener('change', (event) => {
        if (event.target.classList.contains('timestamp-select')) updateTimeSelection();
    });
    // While selecting, a tap on a time's label ticks it.
    timestampContainer.addEventListener('click', (event) => {
        const label = event.target.closest('.timestamp-label');
        if (!label || !timestampContainer.classList.contains('is-selecting')) return;
        const box = label.closest('.timestamp-edit-group').querySelector('.timestamp-select');
        box.checked = !box.checked;
        updateTimeSelection();
    });
    dialog.querySelector('#time-set-group-btn')?.addEventListener('click', () => {
        const value = dialog.querySelector('#time-select-group').value;
        chosenRows().forEach(row => {
            row.querySelector('.timestamp-session').value = value;
            row.classList.remove('new-item-flash');
            void row.offsetWidth;
            row.classList.add('new-item-flash');
        });
    });
    dialog.querySelector('#time-delete-selected-btn').addEventListener('click', () => {
        chosenRows().forEach(removeTimeRow);
        numberTimes();
    });
    numberTimes();

    // --- Delete All Logic ---
    document.getElementById('delete-all-logs-btn').addEventListener('click', () => confirmDeleteAllLogs(group, closeDialog));

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
    if (!canRecordInCourse(currentCourse)) return;
    // An assistant deletes their own latest time, never someone else's.
    const ownOnly = isAssistantForCourse(currentCourse);
    if (ownOnly) {
        group = { ...group, originalLogs: group.originalLogs.filter(isOwnLog) };
        if (!group.originalLogs.length) return;
    }

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
            title: ownOnly ? 'Delete your time?' : 'Delete all logs for this date?',
            message: ownOnly
                ? `This removes the time you recorded for ${escapeHtml(group.name)} on this date.`
                : `This will remove all logs for ${escapeHtml(group.name)} on this date. This is the last timestamp.`,
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

// Every row of the list, on every page (not only the rows shown).
function toggleSelectAll(isChecked) {
    lastLogGroups.forEach(group => group.originalLogs.forEach(log => {
        if (isChecked) selectedLogIds.add(log.id);
        else selectedLogIds.delete(log.id);
    }));
    updateBulkUI();
}

// Every row of the attendance list on every page, as last drawn (for Select all and Copy).
let lastLogGroups = [];

function selectedLogGroups() {
    return lastLogGroups.filter(group => group.originalLogs.some(log => selectedLogIds.has(log.id)));
}

// The bar (count, Select all, actions) and every shown row's box follow the selection.
function updateBulkUI() {
    const rows = selectedLogGroups().length;
    const all = lastLogGroups.length > 0 && rows === lastLogGroups.length;
    const countBadge = document.getElementById('bulk-count');
    if (countBadge) countBadge.textContent = rows;
    const bar = document.getElementById('bulk-actions-bar');
    if (bar) {
        bar.classList.toggle('has-selection', rows > 0);
        bar.querySelectorAll('[data-bulk]').forEach(button => { button.disabled = rows === 0; });
        const allButton = bar.querySelector('#bulk-select-all');
        if (allButton) {
            allButton.textContent = all ? 'Clear' : 'Select all';
            allButton.dataset.all = all ? '1' : '';
        }
        // Session only when the course has sessions.
        const session = bar.querySelector('[data-bulk="session"]');
        if (session) session.hidden = !Object.keys(parseAvailableSections(courseInfoMap[currentCourse]?.availableSections || '')).length;
    }
    document.querySelectorAll('#logs-tbody .bulk-checkbox').forEach(box => {
        const checked = box.value.split(',').some(id => selectedLogIds.has(id));
        box.checked = checked;
        box.closest('tr')?.classList.toggle('is-selected', checked);
    });
    document.querySelectorAll('#logs-tbody .day-separator-checkbox').forEach(dayBox => {
        const boxes = [...document.querySelectorAll(`#logs-tbody tr[data-date="${dayBox.closest('tr').dataset.date}"] .bulk-checkbox`)];
        const ticked = boxes.filter(box => box.checked).length;
        dayBox.checked = boxes.length > 0 && ticked === boxes.length;
        dayBox.indeterminate = ticked > 0 && ticked < boxes.length;
    });
    const header = document.querySelector('.logs-table .select-column-header input');
    if (header) {
        header.checked = all;
        header.indeterminate = rows > 0 && !all;
    }
}

// Copy: the selected records go to another course this person runs (any course for
// a global administrator), on a day chosen here or on their own days. The copies keep
// their times, and their group when that course has it; a record the course already
// has (same card, same moment) is not copied twice.
function copySelectedToCourse() {
    const targets = Object.keys(courseInfoMap)
        .filter(course => course !== currentCourse && isAdminForCourse(course) && !courseInfoMap[course]?.archived)
        .sort((a, b) => compareCoursesForDisplay([a, courseInfoMap[a]], [b, courseInfoMap[b]]));
    if (!targets.length) {
        showNotification('info', 'No Other Course', 'You have no other active course to copy to.');
        return;
    }
    const logs = (courseData[currentCourse]?.logs || []).filter(log => selectedLogIds.has(log.id));
    const days = [...new Set(logs.map(log => localDateString(new Date(log.timestamp))))].sort();
    const rowCount = selectedLogGroups().length;
    const rowsText = `${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`;
    const option = course => `<option value="${escapeHtml(course)}" data-code="${escapeHtml(getCleanCourseCode(course))}">${escapeHtml(getCourseLabel(course))}</option>`;
    const groups = groupCoursesByProgramme(targets);
    const options = groups
        ? groups.map(group => `<optgroup label="${escapeHtml(group.programme ? programmeOptionLabel(group.programme) : 'Other courses')}"${group.programme ? ` data-code="${escapeHtml(group.programme.code)}"` : ''}>${group.courses.map(option).join('')}</optgroup>`).join('')
        : targets.map(option).join('');

    showConfirmationDialog({
        title: `Copy ${rowsText} to another course`,
        message: `The copies keep their times, and their group when that course has it.
            <div class="form-group" style="margin-top:15px; text-align:left;">
                <label class="dialog-label-fixed" for="bulk-copy-course"><i class="fa-solid fa-book-open"></i> Course</label>
                <select id="bulk-copy-course" class="form-control search-select" data-empty="No course matches"><option value="">Search or choose a course</option>${options}</select>
            </div>
            <div class="form-group" style="text-align:left;">
                <label class="dialog-label-fixed" for="bulk-copy-date"><i class="fa-solid fa-calendar-day"></i> Day</label>
                <input type="date" id="bulk-copy-date" class="form-control" value="${days[days.length - 1] || ''}"${days.length > 1 ? ' disabled' : ''}>
                ${days.length > 1 ? `<label class="check-line"><input type="checkbox" id="bulk-copy-keep-days" checked> Keep each record's own day</label>` : ''}
            </div>`,
        confirmText: 'Copy',
        onConfirm: async () => {
            const select = document.getElementById('bulk-copy-course');
            const dayInput = document.getElementById('bulk-copy-date');
            const keepDays = !!document.getElementById('bulk-copy-keep-days')?.checked;
            const quiet = message => Object.assign(new Error(message), { quiet: true });
            clearInputError(select);
            clearInputError(dayInput);
            const target = select.value;
            if (!target) {
                showInputError(select, 'Choose a course.');
                throw quiet('Choose a course.');
            }
            if (!keepDays && !/^\d{4}-\d{2}-\d{2}$/.test(dayInput.value)) {
                showInputError(dayInput, 'Choose a day.');
                throw quiet('Choose a day.');
            }

            // The course's records first, so nothing is copied twice.
            await loadAndMergeCourseData(target);
            if (!courseData[target]) courseData[target] = { logs: [], tombstones: new Set() };
            const groupsThere = parseAvailableSections(courseInfoMap[target]?.availableSections || '');
            const hasGroup = session => {
                const [category, group = ''] = String(session || '').split(' ');
                return !!groupsThere[category] && (!group || groupsThere[category].includes(group));
            };
            const [year, month, day] = dayInput.value.split('-').map(Number);
            const already = new Set(courseData[target].logs.map(log => `${log.uid}|${log.timestamp}`));
            let copied = 0;
            let skipped = 0;
            logs.forEach(log => {
                const time = new Date(log.timestamp);
                if (!keepDays) time.setFullYear(year, month - 1, day);
                const key = `${log.uid}|${time.getTime()}`;
                if (already.has(key)) {
                    skipped++;
                    return;
                }
                already.add(key);
                courseData[target].logs.unshift(touchLogForEdit({
                    uid: log.uid,
                    timestamp: time.getTime(),
                    id: Date.now() + Math.random().toString(36).substring(2, 11),
                    manual: log.manual === true || log.manual === 'true',
                    session: hasGroup(log.session) ? log.session : 'Default'
                }, currentUser?.email));
                copied++;
            });
            if (copied) saveAndMarkChanges(target);
            const label = getCourseLabel(target);
            showNotification(copied ? 'success' : 'info', copied ? 'Copied' : 'Nothing Copied',
                copied ? `${copied} ${copied === 1 ? 'time' : 'times'} copied to ${label}${skipped ? ` (${skipped} already there)` : ''}.`
                    : `${label} already has these times.`);
            toggleBulkMode();
        }
    });

    // Several days: the day field opens when "keep their own day" is turned off.
    const keep = document.getElementById('bulk-copy-keep-days');
    keep?.addEventListener('change', () => {
        document.getElementById('bulk-copy-date').disabled = keep.checked;
    });
}

// Selecting by touch and keyboard: while selecting, a tap anywhere on a row (not on
// its buttons) ticks it; holding a row for half a second starts selecting with that
// row; Escape stops. The bar's buttons run the actions.
function setupLogSelectionGestures() {
    const tbody = document.getElementById('logs-tbody');
    const bar = document.getElementById('bulk-actions-bar');
    if (!tbody) return;

    let press = null;
    let pressed = false; // A hold just selected a row: the click that follows does nothing.
    const cancelPress = () => {
        if (press) clearTimeout(press.timer);
        press = null;
    };
    tbody.addEventListener('pointerdown', (event) => {
        if (isBulkMode || event.button > 0 || !isAdminForCourse(currentCourse)) return;
        const row = event.target.closest('tr[data-key]');
        if (!row || event.target.closest('input, button, a, .row-menu, .time-tag')) return;
        cancelPress();
        press = {
            x: event.clientX,
            y: event.clientY,
            timer: setTimeout(() => {
                press = null;
                pressed = true;
                setTimeout(() => { pressed = false; }, 700);
                navigator.vibrate?.(12);
                const group = lastLogGroups.find(item => item.key === row.dataset.key);
                toggleBulkMode();
                group?.originalLogs.forEach(log => selectedLogIds.add(log.id));
                updateBulkUI();
            }, 500)
        };
    });
    tbody.addEventListener('pointermove', (event) => {
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) cancelPress();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => tbody.addEventListener(type, cancelPress));
    // The click that may follow a hold comes with its pointerup; later taps count.
    document.addEventListener('pointerup', () => { if (pressed) setTimeout(() => { pressed = false; }, 0); }, true);
    window.addEventListener('scroll', cancelPress, { passive: true, capture: true });
    tbody.addEventListener('contextmenu', (event) => { if (press || pressed) event.preventDefault(); });

    tbody.addEventListener('click', (event) => {
        if (pressed) {
            pressed = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!isBulkMode) return;
        const row = event.target.closest('tr[data-key]');
        if (!row || event.target.closest('input, button, a, .row-menu')) return;
        event.stopPropagation(); // A tapped time only selects its row here.
        row.querySelector('.bulk-checkbox')?.click();
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isBulkMode && !document.querySelector('.dialog-backdrop')) toggleBulkMode();
    });

    bar?.querySelectorAll('[data-bulk]').forEach(button => button.addEventListener('click', () => performBulkAction(button.dataset.bulk)));
    bar?.querySelector('#bulk-select-all')?.addEventListener('click', (event) => toggleSelectAll(!event.currentTarget.dataset.all));
}


// --- Bulk Operations ---

async function performBulkAction(action) {
    if (selectedLogIds.size === 0) return;
    if (action === 'copy') return copySelectedToCourse();

    let confirmMsg = "", confirmTitle = "";
    let extraHtml = "";
    const rowCount = selectedLogGroups().length;
    const rowsText = `${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`;

    // Adding and removing an hour can keep each row's own group instead of choosing one.
    const inheritLabel = { add1h: 'Same as previous', sub1h: 'Latest' }[action] || '';
    const sessionHtml = renderSessionSelectorHTML('bulk', inheritLabel);

    if (action === 'delete') {
        confirmTitle = `Delete ${rowsText}?`;
        confirmMsg = "Every time in the selected rows is deleted. This cannot be undone.";
    } else if (action === 'session') {
        confirmTitle = `Change the group of ${rowsText}`;
        confirmMsg = 'Every time in the selected rows moves to this group.';
        extraHtml = `<div style="margin-top:15px; text-align:left;">${renderSessionSelectorHTML('bulk')}</div>`;
    } else if (action === 'date') {
        const first = selectedLogGroups()[0]?.originalLogs.find(log => selectedLogIds.has(log.id));
        confirmTitle = `Move ${rowsText} to another day`;
        confirmMsg = 'The times stay the same; only the day changes.';
        extraHtml = `<div class="form-group" style="margin-top:15px; text-align:left;"><label class="dialog-label-fixed" for="bulk-move-date"><i class="fa-solid fa-calendar-day"></i> Day</label><input type="date" id="bulk-move-date" class="form-control" value="${first ? localDateString(new Date(first.timestamp)) : ''}" required></div>`;
    } else if (action === 'add1h') {
        confirmTitle = `Add +1 Hour?`;
        confirmMsg = `Create a new log 1 hour later for every selected student.`;
        if (sessionHtml) extraHtml = `<div style="margin-top:15px; text-align:left;"><label class="inline-field-label">Group</label>${sessionHtml}</div>`;
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
        confirmText: { delete: 'Delete', session: 'Change Group', date: 'Move' }[action] || "Confirm",
        isDestructive: action === 'delete' || action === 'sub1h',
        onConfirm: async () => {
            let targetSession = 'INHERIT';
            const sessionInput = document.getElementById('bulk-selected-session');
            if (sessionInput) targetSession = sessionInput.value;
            const moveTo = document.getElementById('bulk-move-date')?.value || '';

            const allLogs = courseData[currentCourse].logs;
            const allSelectedIds = Array.from(selectedLogIds);
            let logsModified = false;

            // --- SESSION / DAY: edit every selected time ---
            if (action === 'session' || action === 'date') {
                const [year, month, day] = moveTo.split('-').map(Number);
                if (action === 'date' && !year) return;
                let changed = 0;
                allLogs.forEach(log => {
                    if (!selectedLogIds.has(log.id)) return;
                    if (action === 'session') {
                        if ((log.session || '') === targetSession) return;
                        log.session = targetSession;
                    } else {
                        const time = new Date(log.timestamp);
                        time.setFullYear(year, month - 1, day);
                        if (time.getTime() === log.timestamp) return;
                        log.timestamp = time.getTime();
                    }
                    touchLogForEdit(log, currentUser?.email);
                    changed++;
                });
                logsModified = changed > 0;
                showNotification(changed ? 'success' : 'info', changed ? 'Updated' : 'No Change',
                    changed ? `${changed} ${changed === 1 ? 'time' : 'times'} updated.` : 'The selected times already match.');
            }

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
    if (extraHtml && action !== 'date') {
        setTimeout(() => {
            const rawSections = courseInfoMap[currentCourse].availableSections || '';
            setupSessionToggleListeners('bulk', parseAvailableSections(rawSections), inheritLabel ? 'INHERIT' : '');
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
    document.body.classList.toggle('is-selecting', isBulkMode);
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
        title: `Delete logs for ${escapeHtml(getCourseLabel(currentCourse))}?`,
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
            ${programmeList ? `
            <div class="form-group">
                <label class="dialog-label-fixed" for="import-map-programme"><i class="fa-solid fa-graduation-cap"></i> Programme</label>
                <select id="import-map-programme" class="form-control"></select>
            </div>` : ''}
            <div class="form-section-title">Import Preview</div>
            <p id="import-preview-count" role="status"></p>
            <div class="table-container"><table class="database-table">
                <thead><tr><th>Row</th><th>Name</th><th>Card ID</th><th>Email</th>${programmeList ? '<th>Programme</th>' : ''}</tr></thead>
                <tbody id="import-mapping-preview"></tbody>
            </table></div>
            <p id="import-mapping-error" class="error-message" role="alert" hidden></p>
        </div>
        <div class="dialog-actions">
            <button type="button" id="cancel-import-mapping" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
            <button type="button" id="continue-import-mapping" class="btn-green"><i class="fa-solid fa-arrow-right"></i> Continue</button>
        </div></div>`;
    document.body.appendChild(backdrop);
    const sheetSelect = backdrop.querySelector('#import-sheet-select');
    const rowInput = backdrop.querySelector('#import-start-row');
    const headerCheck = backdrop.querySelector('#import-has-headers');
    const selects = { name: backdrop.querySelector('#import-map-name'), cardId: backdrop.querySelector('#import-map-card'), email: backdrop.querySelector('#import-map-email') };
    // Programme: a column of the file, or one programme ("p:<id>") for every student.
    const programmeSelect = backdrop.querySelector('#import-map-programme');
    const previewBody = backdrop.querySelector('#import-mapping-preview');
    const previewCount = backdrop.querySelector('#import-preview-count');
    const errorText = backdrop.querySelector('#import-mapping-error');
    const nextButton = backdrop.querySelector('#continue-import-mapping');
    let rows = [];
    const nonempty = row => row.some(value => String(value ?? '').trim());
    const fixedProgramme = () => programmeSelect?.value.startsWith('p:') ? Number(programmeSelect.value.slice(2)) : null;
    const options = () => {
        const mapping = Object.fromEntries(Object.entries(selects).map(([field, select]) => [field, Number(select.value)]));
        if (programmeSelect) mapping.programme = fixedProgramme() ? -1 : Number(programmeSelect.value);
        return { startRow: Number(rowInput.value) - 1, hasHeaders: headerCheck.checked, mapping,
            programmes: programmeList || undefined, programmeId: fixedProgramme() || undefined };
    };
    const previewProgramme = student => fixedProgramme() ? programmeCode(fixedProgramme()) : student.programme;
    const showError = error => { errorText.textContent = error.message; errorText.hidden = false; };

    const renderPreview = () => {
        const settings = options();
        const firstDataRow = settings.startRow + (settings.hasHeaders ? 1 : 0);
        const validRow = Number.isInteger(settings.startRow) && settings.startRow >= 0 && settings.startRow < rows.length;
        const sourceRows = validRow ? rows.map((row, index) => ({ row, index })).filter(item => item.index >= firstDataRow && nonempty(item.row)) : [];
        // Show partially mapped values too, so each selection is immediately visible.
        let preview = sourceRows.slice(0, 5).map(({ row, index }) => ({ rowNumber: index + 1,
            name: String(row[settings.mapping.name] ?? ''), uids: [String(row[settings.mapping.cardId] ?? '')],
            email: String(row[settings.mapping.email] ?? ''), programme: String(row[settings.mapping.programme] ?? '') }));
        errorText.hidden = true;
        nextButton.disabled = false;
        try {
            preview = StandoData.previewStudentRows(rows, settings);
        } catch (error) {
            nextButton.disabled = true;
            showError(error);
        }
        previewBody.innerHTML = preview.map(student => `<tr><td>${student.rowNumber}</td><td>${escapeHtml(student.name) || '—'}</td><td>${escapeHtml(student.uids.join('; ')) || '—'}</td><td>${escapeHtml(student.email) || '—'}</td>${programmeSelect ? `<td>${escapeHtml(previewProgramme(student)) || '—'}</td>` : ''}</tr>`).join('');
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
            const label = `${XLSX.utils.encode_col(index)}${heading ? ' — ' + heading : ''}${example ? ` (e.g. ${example})` : ''}`;
            return `<option value="${index}">${escapeHtml(label.slice(0, 120))}</option>`;
        }).join('');
        Object.entries(selects).forEach(([field, select]) => {
            const value = suggest ? suggestions[field] : Number(select.value);
            select.innerHTML = `<option value="-1">${field === 'name' ? 'Choose a column' : 'Not imported'}</option>` + columnsHtml;
            select.value = String(value >= 0 && value < width ? value : -1);
        });
        if (programmeSelect) {
            const fixed = fixedProgramme();
            const value = suggest ? detected.programme : Number(programmeSelect.value);
            programmeSelect.innerHTML = '<option value="-1">Not imported</option>' +
                `<optgroup label="From a column">${columnsHtml}</optgroup>` +
                `<optgroup label="The same for every student">${programmeList.filter(p => !p.archived).map(p =>
                    `<option value="p:${p.id}">${escapeHtml(programmeOptionLabel(p))}</option>`).join('')}</optgroup>`;
            // One programme for everyone stays chosen when the header row changes.
            programmeSelect.value = fixed ? `p:${fixed}` : String(value >= 0 && value < width ? value : -1);
        }
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
    if (programmeSelect) programmeSelect.onchange = renderPreview;
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
            <p><strong>${excelList.length} students</strong>${excelList.length > 5 ? ', the first 5 shown here' : ''}</p>
            <div class="table-container"><table class="database-table"><thead><tr><th>Name</th><th>Card ID</th><th>Email</th>${programmeList ? '<th>Programme</th>' : ''}</tr></thead><tbody>
                ${excelList.slice(0, 5).map(student => `<tr><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.uids.join('; '))}</td><td>${escapeHtml(student.email)}</td>${programmeList ? `<td>${escapeHtml(programmeCode(student.programmeId)) || '—'}</td>` : ''}</tr>`).join('')}
            </tbody></table></div>
            <p>Merge adds new students and updates matching IDs or emails. Replace All replaces the entire list.${programmeList && excelList.some(student => !student.programmeId) ? ' Students the file gives no programme keep the one they have.' : ''}</p>
            <p id="student-import-status" role="status" hidden></p>
        </div>
        <div class="dialog-actions">
            ${onBack ? '<button type="button" id="back-db-import-btn" class="btn-secondary"><i class="fa-solid fa-arrow-left"></i> Back</button>' : ''}
            <button type="button" id="cancel-db-import-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>
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
        '<p><strong>' + importedLogs.length + ' logs</strong> for ' + escapeHtml(getCourseLabel(courseName)) + '</p>' +
        '<p>Merge adds new logs and keeps existing entries. Replace All replaces this course\'s logs.</p></div>' +
        '<div class="dialog-actions"><button type="button" id="cancel-import-btn" class="btn-secondary"><i class="fa-solid fa-xmark"></i> Cancel</button>' +
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
        filteredCount.textContent = listCountText(0, 'record');
        emptyLogs.innerHTML = `<i class="fa-solid fa-hand-pointer" style="font-size: 3em; color: #ccc; margin-bottom: 10px;"></i>
                       <p style="font-size: 1.1em; margin-bottom: 5px;">Please select a course.</p>
                       <p style="font-size: 0.9em; color: #999;">Choose a course above to view its attendance history.</p>`;
        emptyLogs.style.display = 'block';
        tableContainer.classList.remove('reloading');
        hideStickyDateBar();
        return;
    }

    // If the data object for the current course hasn't been created yet,
    // it means Phase 3 is still running. Show a spinner.
    if (!courseData[currentCourse]) {
        // During a course switch the previous table stays, dimmed, until the
        // skeleton timer or the new data takes over.
        if (logsSwap) return;
        logsTbody.innerHTML = '';
        filteredCount.textContent = 'Loading…';
        emptyLogs.innerHTML = `<div class="loading-spinner" style="margin: 20px auto;"></div><p style="text-align: center;">Loading logs...</p>`;
        emptyLogs.style.display = 'block';
        tableContainer.classList.remove('reloading');
        hideStickyDateBar();
        return; // Stop here and wait for the next updateUI() call
    }

    const currentCourseLogs = getLogsForCurrentUser();

    // For students, the logs are already filtered by the backend
    // No need to filter again - this was causing empty tables!
    let logsToDisplay = currentCourseLogs;

    // --- DETECT LECTURER MODE ---
    const isLecturerMode = !isSignedIn && currentCourse && courseData[currentCourse];
    // Days get their own heading for staff, and for an assistant in their course.
    const showAdminFeatures = isAdmin || isLecturerMode || canRecordInCourse(currentCourse);

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
    filteredCount.textContent = listCountText(finalLogCount, 'record', filter ? currentCourseLogs.length : null);

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

    lastLogGroups = result;

    // --- PAGINATION LOGIC ---
    // Sorted by date, pages break only between days, so a day is never cut in two.
    const pages = paginateRows(result, currentSort.startsWith('date') ? group => group.date : null);
    const totalPages = pages.length;
    if (logsCurrentPage > totalPages) logsCurrentPage = Math.max(1, totalPages);

    const paginatedResult = pages[logsCurrentPage - 1] || [];

    // Render pagination controls
    renderLogsPagination(logsCurrentPage, totalPages);

    logsTbody.innerHTML = '';

    if (result.length === 0) {
        let emptyMessageHTML = `<i class="fa-solid fa-ghost" style="font-size: 3em; color: #ccc; margin-bottom: 10px;"></i>
                               <p style="font-size: 1.1em; margin-bottom: 5px;">No attendance records found.</p>`;
        if (canRecordInCourse(currentCourse)) {
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
                // Add to EIS is the course administrators', not an assistant's.
                if (isAdminForCourse(currentCourse)) {
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
                }
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

            selectCell.innerHTML = `<input type="checkbox" class="bulk-checkbox" value="${logIdsInGroup}" aria-label="Select ${escapeHtml(group.name)}, ${group.date}">`;
            const checkbox = selectCell.querySelector('input');

            if (selectedLogIds.has(primaryId)) checkbox.checked = true;
            row.classList.toggle('is-selected', checkbox.checked);

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
                    timeTag.title = 'Justified absence';

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

        if (canRecordInCourse(currentCourse)) {
            const actionsCell = document.createElement('td');
            actionsCell.setAttribute('class', 'actions-cell admin-only');
            const actionsWrapper = document.createElement('div');
            actionsWrapper.setAttribute('class', 'actions-cell-content card-actions');

            // Edit stays visible; everything else is in the ⋯ menu, with the
            // destructive action last. Classes keep the tbody's click handler working.
            // An assistant gets the menu only, with +1 and −1 on the rows they recorded.
            const assistant = isAssistantForCourse(currentCourse);
            const menuItems = [];
            if (group.name === 'Unknown') {
                menuItems.push({ label: 'Register student', icon: 'fa-solid fa-user-plus', className: 'register-unknown-btn' });
            }
            if (!assistant || group.originalLogs.some(isOwnLog)) {
                menuItems.push(
                    { label: 'Add 1 hour', icon: 'fa-solid fa-plus', className: 'add-time-btn' },
                    { label: assistant ? 'Delete my latest time' : 'Delete latest time', icon: 'fa-solid fa-minus', className: 'delete-log-btn', danger: true }
                );
            }
            // With one time, "Delete latest time" already deletes them all.
            if (!assistant && group.originalLogs.length > 1) {
                menuItems.push({ label: 'Delete all times', icon: 'fa-solid fa-trash', className: 'delete-all-log-btn', danger: true });
            }
            actionsWrapper.innerHTML = (assistant ? '' : rowEditButtonHtml(`Edit entry for ${group.name}`, 'edit-log-btn')) +
                (menuItems.length ? rowMenuHtml(menuItems, `More actions for ${group.name}`) : '');

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

    reuseDrawnIcons(logsTbody);
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


// The day whose heading has scrolled past the top floats there: the same date and
// Add to EIS as in the list. What shows lives on the bar itself, so a redrawn list
// or another course agrees with it: the bar swaps its date, or leaves.
function setupStickyDateBar() {
    let bar = document.getElementById('floating-sticky-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'floating-sticky-bar';
        bar.innerHTML = `
            <div class="floating-bar-inner day-separator-content">
                <div id="floating-date-badge" class="day-separator-date"></div>
                <div class="day-separator-actions">
                    <button type="button" id="floating-eis-btn" class="btn-sm eis-day-btn" title="Add to EIS for this day"><i class="fa-solid fa-list-check"></i> Add to EIS</button>
                </div>
            </div>`;
        bar.querySelector('#floating-eis-btn').onclick = () => { if (bar._activeDate) showDirectEisExportDialog(bar._activeDate); };
        bar._activeDate = null;
        document.body.appendChild(bar);
        // Once in, the bar drops its finished animation.
        bar.addEventListener('animationend', (event) => {
            if (event.target === bar && event.animationName === 'badge-fly-in') bar.style.animation = 'none';
        });
        window.addEventListener('resize', () => { if (bar._activeDate) alignStickyDateBar(bar); }, { passive: true });
        // One check per frame while scrolling (any scrolling container, hence capture).
        let queued = false;
        window.addEventListener('scroll', () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; updateStickyDateBar(); });
        }, { passive: true, capture: true });
    }
    updateStickyDateBar(true);
}

// fresh: the list was just redrawn, so the bar also re-aligns.
function updateStickyDateBar(fresh = false) {
    const bar = document.getElementById('floating-sticky-bar');
    if (!bar) return;
    // Like the headings, an assistant's bar has the date only.
    bar.querySelector('.day-separator-actions').hidden = !isAdminForCourse(currentCourse);
    // Only the attendance list has day headings; other tabs never show the bar.
    const scannerActive = document.getElementById('scanner-tab')?.classList.contains('active');
    let activeDate = null;
    if (scannerActive) {
        for (const row of document.querySelectorAll('#scanner-tab tr.day-separator[data-date]')) {
            if (row.getBoundingClientRect().bottom > 1) break;
            activeDate = row.dataset.date;
        }
    }
    const badge = bar.querySelector('#floating-date-badge');
    const setDate = date => { badge.innerHTML = `<i class="fa-solid fa-calendar-day"></i> ${escapeHtml(date)}`; };
    const play = (name, ms, easing) => {
        bar.style.animation = 'none';
        void bar.offsetHeight;
        bar.style.animation = `${name} ${ms}ms ${easing} forwards`;
    };

    if (activeDate === bar._activeDate) {
        if (activeDate && fresh) alignStickyDateBar(bar);
        return;
    }
    clearTimeout(bar._timer);
    const shown = bar._activeDate;
    bar._activeDate = activeDate;
    if (!activeDate) {
        play('badge-fly-out', 200, 'ease-in');
        bar._timer = setTimeout(() => { if (!bar._activeDate) bar.style.display = 'none'; }, 200);
    } else if (!shown || bar.style.display === 'none') {
        setDate(activeDate);
        badge.style.opacity = '1';
        bar.style.display = 'block';
        alignStickyDateBar(bar);
        play('badge-fly-in', 220, 'ease-out');
    } else {
        // Another day: the date fades out, changes and fades back in.
        if (fresh) alignStickyDateBar(bar);
        badge.style.transition = 'opacity 80ms ease';
        badge.style.opacity = '0';
        bar._timer = setTimeout(() => {
            setDate(bar._activeDate || activeDate);
            badge.style.opacity = '1';
        }, 80);
    }
}

// Hidden at once, for example while a course loads or has no records.
function hideStickyDateBar() {
    const bar = document.getElementById('floating-sticky-bar');
    if (!bar) return;
    clearTimeout(bar._timer);
    bar._activeDate = null;
    bar.style.animation = 'none';
    bar.style.display = 'none';
}

// Puts the floating pills exactly above a day's heading pills in the list.
function alignStickyDateBar(bar) {
    const heading = document.querySelector('#scanner-tab tr.day-separator .day-separator-content');
    const inner = bar.querySelector('.floating-bar-inner');
    if (!heading || !inner) return;
    const rect = heading.getBoundingClientRect();
    inner.style.width = `${rect.width}px`;
    inner.style.marginLeft = `${rect.left}px`;
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
 * Update the database list in the UI.
 */
// Staff cards are merged into databaseMap so scans show their names, but they
// are managed in Settings → Staff and have no row in the students table.
function studentEntries() {
    return Object.entries(databaseMap).filter(([, data]) => data && !data.isStaff);
}

// An on/off setting in a dialog, such as Archived: its name and what it does, with
// a switch at the end. The whole row toggles it.
function switchRowHtml(id, checked, title, hint) {
    return `
        <label class="switch-row" for="${id}">
            <span class="switch-row-text">
                <span class="switch-row-title">${escapeHtml(title)}</span>
                <span class="switch-row-hint">${escapeHtml(hint)}</span>
            </span>
            <input type="checkbox" role="switch" class="switch-input" id="${id}"${checked ? ' checked' : ''}>
        </label>`;
}

// --- Programmes ---

// Programmes A–Z by code (the start of every label), wherever they are listed.
function compareProgrammes(a, b) {
    return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' })
        || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
}

function setProgrammeList(list) {
    programmeList = Array.isArray(list) ? [...list].sort(compareProgrammes) : null;
    document.body.classList.toggle('has-programmes', !!programmeList);
    if (dbProgrammeFilter && dbProgrammeFilter !== 'none' && !programmeById(dbProgrammeFilter)) dbProgrammeFilter = '';
}

function programmeById(id) {
    return id == null || id === '' ? null : (programmeList || []).find(p => p.id === Number(id)) || null;
}

function programmeCode(id) {
    return programmeById(id)?.code || '';
}

function programmeOptionLabel(programme) {
    return programme.name ? `${programme.code} ${programme.name}` : programme.code;
}

// Active programmes; an archived one stays listed while it is the current choice.
function programmeOptionsHtml(selectedId, placeholder = 'Choose a programme') {
    const selected = Number(selectedId) || null;
    return `<option value="">${escapeHtml(placeholder)}</option>` + (programmeList || [])
        .filter(p => !p.archived || p.id === selected)
        .map(p => `<option value="${p.id}" data-code="${escapeHtml(p.code)}"${p.id === selected ? ' selected' : ''}>${escapeHtml(programmeOptionLabel(p))}${p.archived ? ' (archived)' : ''}</option>`)
        .join('');
}

// A Programme field for a dialog; nothing until the database has programmes.
function programmeFieldHtml(id, selectedId, { required = true, placeholder } = {}) {
    if (!(programmeList || []).some(p => !p.archived || p.id === Number(selectedId))) return '';
    return `
        <div class="form-group">
            <label class="dialog-label-fixed" for="${id}"><i class="fa-solid fa-graduation-cap"></i> Programme${required ? ' <span class="required">*</span>' : ''}</label>
            <select id="${id}" class="form-control programme-select">${programmeOptionsHtml(selectedId, placeholder)}</select>
        </div>`;
}

// A course's Programmes field: the chosen ones as chips, A–Z, each with a remove
// button, and a searchable list below to add another. The ids live in a hidden
// input, so the dialog notices changes as with any field.
function programmesFieldHtml(id, ids) {
    if (!(programmeList || []).length) return '';
    const options = programmeList.filter(p => !p.archived || ids.includes(p.id))
        .map(p => `<option value="${p.id}" data-code="${escapeHtml(p.code)}">${escapeHtml(programmeOptionLabel(p))}${p.archived ? ' (archived)' : ''}</option>`).join('');
    return `
        <div class="form-group programmes-field" data-programmes-field>
            <label class="dialog-label-fixed" for="${id}-add"><i class="fa-solid fa-graduation-cap"></i> Programmes</label>
            <input type="hidden" id="${id}" value="${escapeHtml(ids.join(','))}">
            <div class="programme-chips"></div>
            <select id="${id}-add" class="form-control search-select" data-empty="No programme matches"><option value="">Add a programme</option>${options}</select>
        </div>`;
}

function readProgrammesField(box) {
    return box.querySelector('input[type="hidden"]').value.split(',').map(Number).filter(id => programmeById(id));
}

// Chips and adding; called once the dialog is on the page.
function bindProgrammesField(box) {
    if (!box || box.dataset.bound) return;
    box.dataset.bound = 'on';
    const hidden = box.querySelector('input[type="hidden"]');
    const select = box.querySelector('select');
    const chips = box.querySelector('.programme-chips');
    const render = () => {
        const chosen = readProgrammesField(box).map(programmeById).sort(compareProgrammes);
        chips.innerHTML = chosen.length
            // A chosen programme by its code alone; its full name shows on hover and in the list.
            ? chosen.map(p => `<span class="programme-chip"${p.name ? ` title="${escapeHtml(programmeOptionLabel(p))}"` : ''}><strong>${escapeHtml(p.code)}</strong><button type="button" class="programme-chip-remove" data-id="${p.id}" title="Remove ${escapeHtml(p.code)}" aria-label="Remove ${escapeHtml(p.code)}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></span>`).join('')
            : '<span class="programme-chips-empty">No programme yet</span>';
        [...select.options].forEach(option => { if (option.value) option.disabled = chosen.some(p => String(p.id) === option.value); });
    };
    const set = ids => {
        hidden.value = [...new Set(ids)].join(',');
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
        render();
    };
    select.addEventListener('change', () => {
        const id = Number(select.value);
        if (!id) return;
        set([...readProgrammesField(box), id]);
        select.value = '';
        const search = box.querySelector('.combo-input');
        if (search) search.value = '';
    });
    chips.addEventListener('click', event => {
        const button = event.target.closest('.programme-chip-remove');
        if (button) set(readProgrammesField(box).filter(id => id !== Number(button.dataset.id)));
    });
    render();
}

// { ok, id } for a Programme field; a missing field (no programmes yet) is ok with no id.
function readProgrammeField(select, required = true) {
    if (!select) return { ok: true, id: null };
    clearInputError(select);
    const id = Number(select.value) || null;
    if (!id && required) {
        showInputError(select, 'Choose a programme.');
        return { ok: false, id: null };
    }
    return { ok: true, id };
}

function programmeBadgeHtml(id) {
    const programme = programmeById(id);
    return programme
        ? `<span class="programme-badge" title="${escapeHtml(programmeOptionLabel(programme))}">${escapeHtml(programme.code)}</span>`
        : '<span class="cell-empty">—</span>';
}

// A course's programmes (those that still exist), A–Z.
function courseProgrammes(info) {
    return [...new Set(info?.programmeIds || [])].map(programmeById).filter(Boolean).sort(compareProgrammes);
}

// Items under their courses' programmes, A–Z by code, with those that have none
// last; each keeps the order it was given in, and an item in two programmes shows
// under both. null when they span fewer than two programmes: someone who teaches
// or studies in one programme sees no headings.
function groupByCourseProgramme(items, infoOf) {
    const groups = new Map();
    const add = (programme, item) => {
        const key = programme ? programme.id : 0;
        if (!groups.has(key)) groups.set(key, { programme, courses: [] });
        groups.get(key).courses.push(item);
    };
    items.forEach(item => {
        const programmes = courseProgrammes(infoOf(item));
        if (programmes.length) programmes.forEach(programme => add(programme, item));
        else add(null, item);
    });
    if ([...groups.keys()].filter(Boolean).length < 2) return null;
    return [...groups.values()].sort((a, b) => !a.programme ? 1 : !b.programme ? -1
        : compareProgrammes(a.programme, b.programme));
}

function groupCoursesByProgramme(courses) {
    return groupByCourseProgramme(courses, course => courseInfoMap[course]);
}

// A programme heading for course lists: its code, then its name.
function programmeHeadingHtml(programme) {
    return programme
        ? `<span class="programme-heading-code">${escapeHtml(programme.code)}</span>${programme.name ? `<span class="programme-heading-name">${escapeHtml(programme.name)}</span>` : ''}`
        : '<span class="programme-heading-name">Other courses</span>';
}

// Student List filter: every programme with students, plus "No programme" when some lack one.
function renderProgrammeFilter() {
    const select = document.getElementById('db-programme-filter');
    if (!select) return;
    const counts = new Map();
    studentEntries().forEach(([, student]) => {
        const key = programmeById(student.programmeId) ? String(student.programmeId) : 'none';
        counts.set(key, (counts.get(key) || 0) + 1);
    });
    const options = (programmeList || []).filter(p => counts.has(String(p.id)) || String(p.id) === dbProgrammeFilter)
        .map(p => [String(p.id), p.code, counts.get(String(p.id)) || 0]);
    if (counts.has('none') || dbProgrammeFilter === 'none') options.push(['none', 'No programme', counts.get('none') || 0]);
    const html = `<option value="">All programmes</option>` + options.map(([value, label, count]) =>
        `<option value="${value}">${escapeHtml(label)} (${count})</option>`).join('');
    if (select.dataset.options !== html) {
        select.dataset.options = html;
        select.innerHTML = html;
    }
    select.value = dbProgrammeFilter;
}

async function reloadProgrammes() {
    setProgrammeList(await callWebApp('getProgrammes'));
    updateDatabaseList();
}

function updateDatabaseList() {
    const students = studentEntries();
    renderProgrammeFilter();
    const entries = students.filter(([dbKey, data]) => {
        if (dbProgrammeFilter === 'none' ? programmeById(data.programmeId) : dbProgrammeFilter && String(data.programmeId) !== dbProgrammeFilter) return false;
        if (!dbFilter) return true;
        const searchFilter = dbFilter.toLowerCase();
        const hasIdMatch = (data.uids || []).some(id => String(id).toLowerCase().includes(searchFilter));
        const hasUidMatch = (data.hardware_uids || []).some(uid => String(uid).toLowerCase().includes(searchFilter));
        return (data.name.toLowerCase().includes(searchFilter) ||
            (data.email && data.email.toLowerCase().includes(searchFilter)) ||
            programmeCode(data.programmeId).toLowerCase().includes(searchFilter) ||
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
        } else if (field === 'programme') {
            // Students without a programme come last; within a programme, by name.
            valA = programmeCode(a[1].programmeId) || '￿';
            valB = programmeCode(b[1].programmeId) || '￿';
            if (valA === valB) return String(a[1].name).localeCompare(String(b[1].name));
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

    const totalCount = students.length;
    dbEntryCount.textContent = listCountText(entries.length, 'student', dbFilter || dbProgrammeFilter ? totalCount : null);
    document.getElementById('db-programme-filter')?.closest('.icon-select')?.classList.toggle('is-active', !!dbProgrammeFilter);

    // Render pagination controls
    renderDbPagination(dbCurrentPage, totalPages);

    // An empty list and a search without matches need different messages.
    if (!emptyDatabase.dataset.emptyHtml) emptyDatabase.dataset.emptyHtml = emptyDatabase.innerHTML;
    if (totalCount === 0) {
        emptyDatabase.innerHTML = emptyDatabase.dataset.emptyHtml;
    } else if (entries.length === 0) {
        const programme = dbProgrammeFilter === 'none' ? 'without a programme' : dbProgrammeFilter ? `in ${programmeCode(dbProgrammeFilter)}` : '';
        emptyDatabase.innerHTML = `<i class="fa-solid fa-magnifying-glass" style="font-size: 3em; color: #ccc; margin-bottom: 10px;" aria-hidden="true"></i>
            <p style="font-size: 1.1em; margin-bottom: 5px;">${dbFilter ? `No students ${escapeHtml(programme)}${programme ? ' ' : ''}match "${escapeHtml(dbFilterInput.value.trim())}".` : `No students ${escapeHtml(programme)}.`}</p>
            <p style="font-size: 0.9em; color: #999;">Search by name, card ID, UID, email or programme.</p>`;
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
            ? idList.map(id => `<span class="card-id-badge">${escapeHtml(id)}</span>`).join('')
            : `<span class="cell-empty">—</span>`;

        // Hardware UIDs are not listed (searching still finds them); Edit shows them.
        // On phones each row is two lines: name and programme, then email and Card ID.
        row.innerHTML = `
            <td class="name-cell"><span class="cell-text">${escapeHtml(data.name)}</span></td>
            <td class="id-cell">${idBadges}</td>
            <td class="email-cell"><span class="cell-text">${escapeHtml(data.email || '')}</span></td>
            <td class="programme-cell">${programmeBadgeHtml(data.programmeId)}</td>
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
    reuseDrawnIcons(databaseTbody);
}

// The icon kit turns each <i class="fa-…"> into an <svg>; redrawing a list of
// hundreds of icons kept a phone busy long enough to delay the next scan's name.
// Icons it has already drawn are copied instead, so a redrawn list leaves it
// nothing to do. Icons with extras (fa-fw, fa-spin, a title) are left to the kit.
const drawnIcons = new Map(); // "fas pen" → an <svg> to copy
const ICON_PREFIXES = { 'fa-solid': 'fas', 'fa-regular': 'far', 'fa-brands': 'fab' };
function reuseDrawnIcons(root) {
    if (!root) return;
    document.querySelectorAll('svg.svg-inline--fa[data-prefix][data-icon]').forEach(svg => {
        const key = `${svg.dataset.prefix} ${svg.dataset.icon}`;
        if (drawnIcons.has(key) || svg.querySelector('title') || svg.hasAttribute('style')) return;
        const template = svg.cloneNode(true);
        template.removeAttribute('class');
        template.removeAttribute('aria-labelledby');
        drawnIcons.set(key, template);
    });
    root.querySelectorAll('i[class*="fa-"]').forEach(icon => {
        if (icon.hasAttribute('title') || [...icon.attributes].some(a => a.name.startsWith('data-fa'))) return;
        const classes = [...icon.classList];
        const prefix = classes.map(name => ICON_PREFIXES[name]).find(Boolean);
        const names = classes.filter(name => name.startsWith('fa-') && !ICON_PREFIXES[name]);
        if (!prefix || names.length !== 1) return;
        const template = drawnIcons.get(`${prefix} ${names[0].slice(3)}`);
        if (!template) return;
        const svg = template.cloneNode(true);
        svg.setAttribute('class', ['svg-inline--fa', names[0], ...classes.filter(name => !name.startsWith('fa-'))].join(' '));
        for (const { name, value } of icon.attributes) if (name !== 'class') svg.setAttribute(name, value);
        svg.setAttribute('aria-hidden', icon.getAttribute('aria-hidden') || 'true');
        icon.replaceWith(svg);
    });
}

/**
* Extracts a clean human-readable course code from a system name, stripping archive/EIS ID suffixes.
*/
function getCleanCourseCode(courseName, eisId) {
    return StandoData.cleanCourseCode(courseName, eisId || courseInfoMap[courseName]?.eisId);
}

// The course's full name, such as "Civil Engineering Drawing"; empty until one is set.
function getCourseTitle(courseName) {
    return courseInfoMap[courseName]?.title || '';
}

// "CE 121 Civil Engineering Drawing", or the code alone.
function getCourseLabel(courseName, separator = ' ') {
    const code = getCleanCourseCode(courseName);
    const title = getCourseTitle(courseName);
    return title ? `${code}${separator}${title}` : code;
}

// A course in a table or list: its code in bold and its name beside it. afterCode
// (HTML, such as a section badge) follows the code.
function courseCellHtml(courseName, afterCode = '') {
    const title = getCourseTitle(courseName);
    return `<span class="course-cell"><strong>${escapeHtml(getCleanCourseCode(courseName))}</strong>${afterCode}${title ? ` <span class="course-cell-name">${escapeHtml(title)}</span>` : ''}</span>`;
}

// The programme of the student with this e-mail, as far as the loaded Student List knows.
function studentProgrammeId(email) {
    const wanted = String(email || '').trim().toLowerCase();
    if (!wanted) return null;
    return Object.values(databaseMap).find(entry => !entry?.isStaff && String(entry?.email || '').trim().toLowerCase() === wanted)?.programmeId ?? null;
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

// The sort, as the lists' toolbars show it: an icon, with the choice beside it on wide screens.
function settingsSortSelectHtml(id) {
    return `<label class="icon-select" title="Sort courses"><i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true"></i><select id="${id}" class="settings-sort-select sort-dropdown" aria-label="Sort courses" data-no-dirty>${SETTINGS_COURSE_SORTS.map(([value, label]) =>
        `<option value="${value}"${value === settingsCourseSort ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
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
    { id: 'programme', label: 'Programme' },
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
    if (facet === 'programme') {
        return courseProgrammes(info).map(programme => ({ key: String(programme.id), label: programme.code, full: programmeOptionLabel(programme) }));
    }
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
        (settingsCourseFacets[container.id] = { programme: null, semester: null, year: null, lecturer: null, expanded: false });

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
                String(data.title || '').toLowerCase().includes(lowerFilter) ||
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
                    id === 'programme' ? (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }) :
                        (a, b) => compareLecturers(a.full || a.label, b.full || b.label));
        let more = '';
        if (id === 'lecturer' && !facets.expanded && values.length > LECTURER_PILLS + 1) {
            const hidden = values.length - LECTURER_PILLS;
            values = values.filter((value, index) => index < LECTURER_PILLS || value.key === facets[id]);
            more = `<button type="button" class="more" data-facet-more>+${hidden} more</button>`;
        }
        return `<div class="settings-facet" role="group" aria-label="${label}"><span class="settings-facet-label">${label}</span>${values.map(value =>
            `<button type="button" data-facet="${id}" data-value="${escapeHtml(value.key)}" aria-pressed="${value.key === facets[id]}"${value.full && value.full !== value.label ? ` title="${escapeHtml(value.full)}"` : ''}>${escapeHtml(value.label)}<span>${value.count}</span></button>`).join('')}${more}</div>`;
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
        const programmeCount = new Set(searched.flatMap(([, d]) => courseProgrammes(d).map(programme => programme.id))).size;
        // Rows outside a programme group (archived, or one programme chosen) name their programme.
        const courseRow = ([courseName, data], showProgramme = false) => {
            const cleanCode = getCleanCourseCode(courseName, data.eisId);
            const term = courseTerm(data);
            const lecturers = courseLecturers(data);
            const people = lecturers.length ? lecturers.join(', ') : 'No lecturers assigned';
            const start = term ? term.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
            return `
                <div class="settings-row${data.archived ? ' is-archived' : ''}">
                    <div class="settings-row-main">
                        <span class="settings-row-title">${showProgramme ? courseProgrammes(data).map(programme => `${programmeBadgeHtml(programme.id)} `).join('') : ''}<strong>${escapeHtml(cleanCode)}</strong>${data.title ? ` <span class="settings-row-name">${escapeHtml(data.title)}</span>` : ''}${data.eisId ? ` <span class="settings-row-eis selectable">#${escapeHtml(String(data.eisId))}</span>` : ''}${data.archived ? ' <span class="settings-row-state">Archived</span>' : ''}</span>
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
            ? `<div class="settings-list">${courses.map(entry => courseRow(entry, kind === 'archived' && programmeCount > 1)).join('')}</div>`
            : `<div class="settings-empty">No ${kind} courses.</div>`;
        // Active courses under their programmes, unless one programme is chosen above.
        const activeHtml = () => {
            const groups = !facets.programme && groupByCourseProgramme(activeList, entry => entry[1]);
            if (!groups) return listHtml(activeList, 'active');
            return groups
                .map(group => `<div class="settings-programme-group"><div class="settings-programme-label">${programmeHeadingHtml(group.programme)}<span class="settings-group-count">${group.courses.length}</span></div>${listHtml(group.courses, 'active')}</div>`)
                .join('');
        };

        html += `
            <div class="settings-courses-group">
                <div class="settings-group-label">Active courses <span class="settings-group-count">${activeList.length}</span></div>
                ${activeList.length ? activeHtml() : listHtml(activeList, 'active')}
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
            staffRoleLabel(s.role).toLowerCase().includes(lowerFilter);
    });

    if (filtered.length === 0) {
        container.innerHTML = `<div class="settings-empty">No staff members found.</div>`;
        return;
    }

    // Group staff by position
    const roleGroups = [
        { name: 'Administrators', byTitle: true, items: filtered.filter(s => staffRole(s.role) === 'Global') },
        { name: 'Lecturers', byTitle: true, items: filtered.filter(s => staffRole(s.role) === 'Lecturer') },
        { name: 'Teaching assistants', byTitle: false, items: filtered.filter(s => staffRole(s.role) === 'Assistant') }
    ];

    let html = '';

    roleGroups.forEach(group => {
        if (group.items.length === 0) return;

        group.items.sort((a, b) => group.byTitle
            ? compareLecturers(staffDisplayName(a), staffDisplayName(b))
            : staffDisplayName(a).localeCompare(staffDisplayName(b), undefined, { sensitivity: 'base' }));

        // The custom name when set, otherwise the Google name; likewise the photo.
        // Lecturers see the list; only administrators change it.
        const rows = group.items.map(s => {
            const role = staffRoleLabel(s.role);
            const shown = staffDisplayName(s);
            const named = !!(s.name || s.googleName);
            const index = `data-row-index="${escapeHtml(String(s.rowIndex))}"`;
            return `
                <div class="settings-row is-person">
                    ${userAvatarHtml(shown, s.photo, 'user-avatar settings-row-avatar')}
                    <div class="settings-row-main">
                        <span class="settings-row-title">${escapeHtml(shown)}</span>
                        <span class="settings-row-people${named ? '' : ' is-empty'}"><span class="settings-row-role role-chip">${escapeHtml(role)}</span>${named ? `<span class="selectable">${escapeHtml(s.email)}</span>` : 'Name appears after their first Google sign-in'}</span>
                    </div>
                    <div class="settings-row-meta"><span class="settings-row-term">${escapeHtml(role)}</span></div>
                    ${isGlobalAdmin ? `<div class="card-actions">
                        ${rowEditButtonHtml(`Edit ${shown}`, 'edit-staff-btn',
                `${index} data-name="${escapeHtml(s.name)}" data-google-name="${escapeHtml(s.googleName)}" data-photo-url="${escapeHtml(s.photoUrl)}" data-google-photo="${escapeHtml(s.googlePhoto)}" data-uid="${escapeHtml(s.uid)}" data-email="${escapeHtml(s.email)}" data-role="${escapeHtml(staffRole(s.role))}"`)}
                        ${rowMenuHtml([{ label: 'Revoke access', icon: 'fa-solid fa-trash', danger: true, className: 'delete-staff-btn', attrs: `${index} data-name="${escapeHtml(shown)}"` }],
                    `More actions for ${shown}`)}
                    </div>` : ''}
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
        btn.onclick = () => window.editStaffKey(btn.dataset.rowIndex, btn.dataset.name, btn.dataset.uid, btn.dataset.email, btn.dataset.role, btn.dataset.googleName, btn.dataset.photoUrl, btn.dataset.googlePhoto);
    });
    container.querySelectorAll('.delete-staff-btn').forEach(btn => {
        btn.onclick = () => window.deleteStaffKey(btn.dataset.rowIndex, btn.dataset.name);
    });
}

function updatePageTitle() {
    let titlePrefix = '';

    // Only show count for admins if there are pending items
    const titleCount = (isGlobalAdmin && adminCourses.length > 0) ? myNotificationCount : globalNotificationCount;
    if (isAdmin && titleCount > 0) {
        titlePrefix = `(${titleCount}) `;
    }

    if (currentCourse && currentCourse !== 'Default') {
        document.title = `${titlePrefix}${getCourseLabel(currentCourse, ' ')} Attendance`;
    } else {
        document.title = `${titlePrefix}Stando`;
    }
    updateAppHeader();
}

// The header banner names the course on screen, as Syllabase does: its code above
// its name. The Student List keeps "Stando", with the size of the list above it.
function updateAppHeader() {
    const header = document.querySelector('.app-header');
    if (!header) return;
    const onCourses = document.querySelector('.tab.active')?.dataset.tab !== 'database-tab';
    const course = onCourses && currentCourse && currentCourse !== 'Default' && courseInfoMap[currentCourse] ? currentCourse : '';
    const code = course ? getCleanCourseCode(course) : '';
    const title = course ? getCourseTitle(course) : '';
    const heading = title || code || 'Stando';
    const eyebrow = title ? code : onCourses ? '' : studentListSummary();
    // The startup skeleton draws the next visit's banner in the same shape.
    if (isSignedIn && !isInitializing && onCourses) {
        try { localStorage.setItem('stando_header', title ? 'titled' : 'plain'); } catch { /* The plain banner. */ }
    }
    if (header.dataset.heading === heading && header.dataset.eyebrow === eyebrow) return;
    const changed = 'heading' in header.dataset;
    header.dataset.heading = heading;
    header.dataset.eyebrow = eyebrow;
    const eyebrowElement = header.querySelector('.app-header-code');
    eyebrowElement.textContent = eyebrow;
    eyebrowElement.hidden = !eyebrow;
    header.querySelector('.app-header-name').textContent = heading;
    if (changed) {
        const text = header.querySelector('.app-header-title');
        text.classList.remove('is-changing');
        void text.offsetWidth;
        text.classList.add('is-changing');
    }
}

// Above "Stando" on the Student List (whose panel already counts the students):
// the programmes they study, and how many still need one.
function studentListSummary() {
    if (!programmeList) return 'Students and their cards';
    const students = studentEntries();
    const programmes = new Set(students.map(([, s]) => programmeById(s.programmeId)?.id).filter(Boolean));
    const without = students.filter(([, s]) => !programmeById(s.programmeId)).length;
    const summary = listCountText(programmes.size, 'programme');
    return without ? `${summary}, ${listCountText(without, 'student')} without one` : summary;
}

/**
 Update the entire UI.
 */
// body.can-record: the course on screen is one the account records in, so an
// assistant gets its groups, Add and row menus too. body.is-assistant shows them
// the sync status.
function updateRecordingMode() {
    document.body.classList.toggle('can-record', isSignedIn && canRecordInCourse(currentCourse));
    document.body.classList.toggle('is-assistant', isSignedIn && !isAdmin && assistantCourses.length > 0);
}

async function updateUI() {
    await databaseLoadPromise;
    updateRecordingMode();
    updateLogsList();
    updateDatabaseList();
    updatePageTitle();
    updateRegisterCardButton();

    const logsForCurrentCourse = getLogsForCurrentUser();

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
// Keeps the screen on, so the phone does not sleep while cards are tapped.
let screenWakeLock = null;
async function keepScreenAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (screenWakeLock && !screenWakeLock.released) return;
    try {
        screenWakeLock = await navigator.wakeLock.request('screen');
    } catch (err) {
        console.warn(`Wake Lock failed: ${err.name}, ${err.message}`);
    }
}

async function startScanning() {
    if (!nfcSupported || nfcReader) return;
    keepScreenAwake();
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
        renderScanButton();
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

    // Lecturers take attendance, teaching assistants in their courses, and staff
    // sign in by card; students never scan here.
    const shown = nfcSupported && (!isSignedIn || isAdmin || canRecordInCourse(currentCourse));
    scanBtn.style.display = shown ? 'flex' : 'none';
    scanButtonsContainer.style.display = shown ? 'flex' : 'none';
    // An assistant who opens another course stops scanning there.
    if (!shown && isSignedIn && isScanning) stopScanning();
    renderScanButton();
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
        showSignedOutCard({ checking: true });

        try {
            const myDeviceId = getDeviceFingerprint();
            const convertedCardId = convertUidToExternalId(serialNumber);
            // Ask the kiosk-login Edge Function whose card this is, and whether this device is trusted for them
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
                const { data: otpData, error: otpError } = await supabaseClient.auth.verifyOtp({
                    type: 'email',
                    token_hash: data.token_hash
                });
                if (otpError) throw otpError;

                localStorage.setItem(KIOSK_MODE_KEY, '1');
                signedOutCard = null;
                // The account keeps the Google name and photo from its last Google
                // sign-in; the staff name comes first, and without any the avatar
                // draws initials.
                const meta = otpData?.user?.user_metadata || {};
                currentUser = {
                    ...data.user,
                    name: data.user.name || meta.full_name || meta.name || data.user.email,
                    picture: normalizeGooglePhotoUrl(meta.avatar_url || meta.picture || '')
                };
                showNotification('success', 'Session Active', `Welcome, ${currentUser.name}`);
                playSound(true);
                await onSuccessfulAuth(false);
            } else if (data && data.result === 'error') {
                // A staff card that cannot sign in here, for example on an untrusted device.
                if (data.message) showNotification('warning', 'Staff Sign-In', data.message);
                showSignedOutCard(null);
            } else {
                // A student's card on a device they have not trusted: greeted by name.
                const name = data?.student?.name || '';
                playSound(!!name);
                showSignedOutCard({ name });
            }

        } catch (err) {
            console.warn('Kiosk login error fallback:', err);
            showSignedOutCard(null);
            showNotification('warning', 'Card Not Checked', 'Stando could not check this card. Check the connection and try again.');
        } finally {
            nfcLoginInProgress = false;
        }
        return; // Stop here
    }

    // ============================================================
    // SCENARIO B: ATTENDANCE RECORDING
    // Runs if Signed In OR in Lecturer Mode
    // ============================================================

    const convertedUid = convertUidToExternalId(serialNumber);
    const primaryUid = lookupPrimaryUid(serialNumber);
    const finalUid = primaryUid || convertedUid || serialNumber;

    // A course lecturer's staff card locks and unlocks instead of recording attendance.
    // A student's card skips that check (unless this phone saved staff cards, which it
    // checks locally), so it is recorded the moment it is read.
    if (scanLockSession || locked) {
        const entry = databaseMap[primaryUid];
        if (!entry || entry.isStaff || getSavedUnlockCards().length) {
            const owner = await scanLockCardOwner(serialNumber);
            if (owner) {
                toggleScanLockWithCard(owner);
                return;
            }
        }
    }

    // Course administrators record attendance, and teaching assistants in their courses.
    if (currentCourse ? !canRecordInCourse(currentCourse) : !canRecordAnywhere()) {
        playSound(false);
        showNotification('error', 'Action Not Allowed', 'You can record attendance only in your own courses.');
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

    // The name shows at once; saving and redrawing the list wait for that frame.
    // An unknown card carries its Card ID in place of a name, shown hidden (showScannedName).
    const scan = isUnknown
        ? { unknown: true, name: convertedUid || serialNumber, at: timestamp.getTime() }
        : { unknown: false, name: databaseMap[primaryUid]?.name || convertedUid, at: timestamp.getTime() };
    const lockedNow = isScanLockScreenShown();
    // Locked, the name appears under the clock; unlocked on a phone, as a full-screen result.
    if (lockedNow) showScanLockResult(scan);
    else if (window.innerWidth <= 700) showScanAnnouncement(scan);

    const course = currentCourse;
    let newLog = {
        uid: convertedUid,
        timestamp: timestamp.getTime(),
        id: Date.now() + Math.random().toString(36).substring(2, 11),
        manual: false,
        session: getCurrentActiveSession()
    };

    // In LecturerMode, currentUser might be null, which is fine
    newLog = touchLogForEdit(newLog, currentUser?.email || 'Offline Lecturer');

    if (!courseData[course]) {
        courseData[course] = { logs: [], tombstones: new Set() };
    }
    courseData[course].logs.unshift(newLog);
    if (scanLockSession || lockedNow) noteScanLockScan(scan);

    afterNextPaint(() => {
        saveAndMarkChanges(course);
        scheduleScanRender();
    });
}

// Runs fn just after the next frame is drawn (at once while the page is hidden).
function afterNextPaint(fn) {
    if (document.hidden) setTimeout(fn, 0);
    else requestAnimationFrame(() => setTimeout(fn, 0));
}

// During scanning the attendance list is redrawn once the cards pause, not for every
// card: behind the lock screen after a second, otherwise after a moment.
let scanRenderTimer = null;
let logsListStale = false;
function scheduleScanRender() {
    clearTimeout(scanRenderTimer);
    if (isScanLockScreenShown()) {
        logsListStale = true;
        return;
    }
    scanRenderTimer = setTimeout(() => {
        scanRenderTimer = null;
        logsListStale = false;
        updateLogsList();
        const hasLogs = getLogsForCurrentUser().length > 0;
        exportBtn.disabled = !hasLogs;
        clearBtn.disabled = !hasLogs;
        filterInput.disabled = !hasLogs;
        sortSelect.disabled = !hasLogs;
    }, 600);
}

// A scan's name. An unknown card's Card ID stays hidden, like a password, on the
// lock screen and in the full-screen result, which anyone near the phone sees;
// the attendance list shows it once unlocked.
function showScannedName(el, { unknown, name }) {
    el.classList.toggle('is-masked', !!unknown);
    el.textContent = unknown ? '••••••••' : name;
    if (unknown) el.setAttribute('aria-label', 'Card ID hidden');
    else el.removeAttribute('aria-label');
}

// Full-screen result of a scan: white with the name, or orange (the Card ID
// hidden) when the card is not in the student list.
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
        ? 'Attendance recorded, but not in the student list'
        : 'Attendance Recorded';
    showScannedName(nameEl, { unknown, name });

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

    isScanning = false;

    // Reset button UI
    renderScanButton();

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
// that only records attendance. Any lecturer of the course on screen unlocks it
// by tapping their staff card on a trusted device, which the database checks.
// Cards confirmed on this phone are kept as salted hashes so the phone also
// unlocks offline. The lock is shared by every Stando tab of this website and
// survives a reload, and leaving the page while locked is reported on the next
// unlock.
// ============================================================
const SCAN_LOCK_KEY = 'stando_scan_lock';
const SCAN_LOCK_CARD_PREFIX = 'stando_scan_lock_card_';
const SCAN_LOCK_IDLE_MS = 30000; // Relock after this long untouched while scanning
const SCAN_LOCK_MIN_AWAY_MS = 2000; // Shorter absences are not reported
let scanLockSession = false; // From Start scanning until the lecturer stops
let scanLockScans = []; // Cards recorded this session, newest first: { name, unknown, at }
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

// For whoever records attendance (teaching assistants too); hashing needs a secure context (as NFC does).
function scanLockAvailable() {
    return isSignedIn && canRecordAnywhere() && !!scanLockAccount() && !!supabaseClient && !!window.crypto?.subtle;
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

// The course the lock protects: the one on screen when it locked.
function scanLockCourse() {
    return readScanLockState()?.course || currentCourse || '';
}

// Staff cards confirmed on this phone, for unlocking offline: { salt, hash, owner, course }.
// The lecturer's own card (course '*') opens any course; a colleague's only theirs.
function getSavedUnlockCards() {
    try {
        const saved = JSON.parse(localStorage.getItem(SCAN_LOCK_CARD_PREFIX + scanLockAccount()) || 'null');
        if (Array.isArray(saved)) return saved.filter(card => card?.salt && card?.hash);
        // Saved before colleagues could unlock: one card, the lecturer's own.
        return saved?.hash ? [{ salt: saved.salt, hash: saved.hash, owner: scanLockAccount(), course: '*' }] : [];
    } catch {
        return [];
    }
}

function writeSavedUnlockCards(cards) {
    try {
        if (cards.length) localStorage.setItem(SCAN_LOCK_CARD_PREFIX + scanLockAccount(), JSON.stringify(cards.slice(-20)));
        else localStorage.removeItem(SCAN_LOCK_CARD_PREFIX + scanLockAccount());
    } catch (error) {
        console.warn('Could not save the unlock card:', error);
    }
}

async function isSameSavedCard(card, serialNumber) {
    return await hashScanLockValue(scanLockCardValue(serialNumber), card.salt) === card.hash;
}

// The saved card that opens this course, if this is one.
async function findSavedUnlockCard(serialNumber, course) {
    for (const card of getSavedUnlockCards()) {
        if ((card.course === '*' || card.course === course) && await isSameSavedCard(card, serialNumber)) return card;
    }
    return null;
}

// Replaces what this phone knew about the card for this course; owner '' forgets it.
async function rememberUnlockCard(serialNumber, course, owner) {
    const own = owner === scanLockAccount();
    const kept = [];
    for (const card of getSavedUnlockCards()) {
        const sameScope = card.course === '*' || card.course === course;
        if (!(sameScope && await isSameSavedCard(card, serialNumber))) kept.push(card);
    }
    if (owner) {
        const salt = crypto.randomUUID();
        kept.push({ salt, hash: await hashScanLockValue(scanLockCardValue(serialNumber), salt), owner, course: own ? '*' : course });
    }
    writeSavedUnlockCards(kept);
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
    return getSavedUnlockCards().some(card => card.course === '*');
}

// --- Unlocking with the device's own lock: its fingerprint, face or PIN (Windows
// Hello on a computer) instead of a staff card. A lecturer turns it on for their
// account on this device (Settings → Trusted Devices), and the browser keeps a key
// that opens only after the device checks who is holding it. The lock guards this
// screen, so the device's answer is enough and nothing is sent: it works offline.
// Anyone who can unlock the device can unlock Stando this way, so it is for a
// lecturer's own phone, not a shared one.
const SCAN_LOCK_DEVICE_PREFIX = 'stando_scan_lock_device_';
let scanLockVerifying = false; // The device's own prompt is up
let deviceUnlockAvailable = false; // This device has a fingerprint, face or PIN for websites (setupScanLock)

function deviceUnlockId() {
    try {
        return localStorage.getItem(SCAN_LOCK_DEVICE_PREFIX + scanLockAccount()) || '';
    } catch {
        return '';
    }
}

async function deviceUnlockSupported() {
    try {
        return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
        return false;
    }
}

const toBase64Url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function turnOnDeviceUnlock() {
    const credential = await navigator.credentials.create({
        publicKey: {
            rp: { name: 'Stando' },
            user: { id: crypto.getRandomValues(new Uint8Array(16)), name: scanLockAccount(), displayName: currentUserDisplayName() },
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
            authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
            attestation: 'none',
            timeout: 60000
        }
    });
    localStorage.setItem(SCAN_LOCK_DEVICE_PREFIX + scanLockAccount(), toBase64Url(credential.rawId));
}

function turnOffDeviceUnlock() {
    try { localStorage.removeItem(SCAN_LOCK_DEVICE_PREFIX + scanLockAccount()); } catch { /* Stays on. */ }
}

// Whether the device checked who is holding it (the user-verified flag of its answer).
async function verifyWithDevice() {
    const id = deviceUnlockId();
    if (!id) return false;
    scanLockVerifying = true;
    try {
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                allowCredentials: [{ type: 'public-key', id: fromBase64Url(id), transports: ['internal'] }],
                userVerification: 'required',
                timeout: 60000
            }
        });
        return (new Uint8Array(assertion.response.authenticatorData)[32] & 0x04) !== 0;
    } catch (error) {
        // Cancelled, or the key is no longer on the device.
        console.warn('Device unlock not completed:', error?.name || error);
        return false;
    } finally {
        scanLockVerifying = false;
    }
}

// The e-mail of the lecturer whose staff card opens the lock for this course, or ''.
async function verifyScanUnlockCard(serialNumber, course) {
    const { data, error } = await supabaseClient.rpc('verify_scan_unlock_card', {
        p_card_ids: staffCardCandidates(serialNumber).slice(0, 8), p_device_id: getDeviceFingerprint(), p_course: course
    });
    if (error) throw error;
    return String(data || '').toLowerCase();
}

// The lecturer whose card this is, if it opens the lock, or ''. Online, the
// database decides (so a changed staff card takes effect at once); offline,
// cards already confirmed on this phone still work.
async function scanLockCardOwner(serialNumber) {
    if (!serialNumber || !scanLockAvailable()) return '';
    const course = scanLockCourse();
    const saved = await findSavedUnlockCard(serialNumber, course);
    // Students' cards skip the server check. Staff cards are in the list too (so
    // their scans show a name), and a card this phone already confirmed is checked.
    const entry = databaseMap[lookupPrimaryUid(serialNumber)];
    if (!saved && entry && !entry.isStaff) return '';
    if (navigator.onLine) {
        try {
            const owner = await Promise.race([
                verifyScanUnlockCard(serialNumber, course),
                new Promise((resolve, reject) => setTimeout(() => reject(new Error('No answer within 1.5 s')), 1500))
            ]);
            if (owner || saved) await rememberUnlockCard(serialNumber, course, owner);
            return owner;
        } catch (error) {
            console.warn('Staff card check unavailable; using the cards saved on this phone:', error?.message || error);
        }
    }
    return saved?.owner || '';
}

// A colleague's name as Stando knows it, else their e-mail.
function lecturerDisplayName(email) {
    const key = String(email || '').toLowerCase();
    return settingsStaffNames.get(key) ||
        Object.values(databaseMap).find(entry => entry?.isStaff && String(entry.email || '').toLowerCase() === key)?.name ||
        email;
}

function formatScanLockDuration(ms) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function formatScanLockTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Lecturers scan only on a trusted device; otherwise Settings opens where they
// can trust it. Scanning then starts behind the lock screen when the lecturer
// can unlock it again.
async function startScanningLocked() {
    // Asked together, so scanning starts while the tap still counts for the NFC prompt.
    const lockable = scanLockAvailable();
    const [trusted, lockReady] = await Promise.all([
        isSignedIn && isAdmin ? checkDeviceTrusted() : true,
        lockable ? canUnlockWithStaffCard().then(ready => ready || !!deviceUnlockId()) : false
    ]);
    if (trusted === false) {
        openTrustedDevicesSettings();
        return;
    }

    await startScanning();
    if (!isScanning || !lockable) return;
    if (!lockReady) {
        if (!scanLockUnavailableShown) {
            scanLockUnavailableShown = true;
            const devices = isAdmin ? 'Settings → Trusted Devices' : 'your profile';
            showNotification('info', 'Scanning Is Not Locked', isGlobalAdmin
                ? `To lock Stando while scanning, add your card in Settings → Staff, or turn on Fingerprint or PIN for this device in ${devices}.`
                : `To lock Stando while scanning, ask an administrator to add your staff card, or turn on Fingerprint or PIN for this device in ${devices}.`, 10000);
        }
        return;
    }
    scanLockSession = true;
    scanLockScans = [];
    fillScreenForScanning();
    lockScanner();
    updateScanLockButton();
}

// While scanning behind the lock, Stando fills the screen: the browser's address
// bar and tabs go, and so do the phone's status and navigation bars. Cards are
// still read. The phone's Back, or a swipe from an edge, shows them again; the
// next tap on the lock screen fills it again (a browser allows that only on a
// tap). It ends with the scanning. A website cannot lock the phone itself:
// Android's app pinning does that (README).
function fillScreenForScanning() {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* Tried again on the next tap. */ });
}

function leaveFullScreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { /* Already left. */ });
}

function lockScanner() {
    if (!scanLockAvailable()) return;
    clearTimeout(scanLockIdleTimer);
    const state = readScanLockState();
    if (!state || state.email !== scanLockAccount()) {
        writeScanLockState({ email: scanLockAccount(), course: currentCourse || '', since: Date.now(), events: [] });
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
    if (scanLockSession) leaveFullScreen();
    scanLockSession = false;
    clearTimeout(scanLockIdleTimer);
    scanLockIdleTimer = null;
    updateScanLockButton();
}

// Signing out removes what the lock protects, so the lock goes too.
function clearScanLock() {
    endScanLockSession();
    writeScanLockState(null);
    hideScanLockScreen();
}

function toggleScanLockWithCard(owner) {
    // One tap can be read twice; ignore the echo.
    if (Date.now() - scanLockLastCardToggle < 1500) return;
    scanLockLastCardToggle = Date.now();
    // Silent, so students do not mistake it for a recorded card; a short buzz instead.
    navigator.vibrate?.(40);
    if (!isScanLockScreenShown()) {
        lockScanner();
        return;
    }
    unlockScanner();
    if (owner && owner !== scanLockAccount()) {
        showNotification('info', 'Unlocked', `Unlocked by ${lecturerDisplayName(owner)}.`);
    }
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

// Notifications stay above the lock screen and can still be swiped or tapped away.
function setScanLockInert(inert) {
    Array.from(document.body.children).forEach(el => {
        if (['scan-lock', 'scan-announcement-overlay', 'in-page-notification-area'].includes(el.id) || el.tagName === 'SCRIPT') return;
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
                    <span class="scan-lock-course"><span class="scan-lock-course-name"><strong class="scan-lock-course-code"></strong> <span class="scan-lock-course-title"></span></span><span class="scan-lock-course-group" hidden></span></span>
                </div>
                <div class="scan-lock-view">
                    <div class="scan-lock-clock" aria-hidden="true"></div>
                    <div class="scan-lock-stage">
                        ${cardTapAnimationHtml()}
                        <div class="scan-lock-result" aria-live="polite" aria-atomic="true"></div>
                    </div>
                    <h2 class="scan-lock-title" id="scan-lock-title"></h2>
                    <button type="button" class="scan-lock-status" data-key="list" aria-live="polite">
                        <span class="scan-lock-status-text"></span><i class="fa-solid fa-chevron-down scan-lock-status-more" aria-hidden="true"></i>
                    </button>
                    <p class="scan-lock-alert" hidden></p>
                </div>
                <div class="scan-lock-footer">
                    <p class="scan-lock-hint"><i class="fa-solid fa-id-badge" aria-hidden="true"></i><span>Tap your Staff ID to unlock</span></p>
                    <button type="button" class="scan-lock-device" data-key="device" hidden><i class="fa-solid fa-fingerprint" aria-hidden="true"></i> Fingerprint or PIN</button>
                    <button type="button" class="scan-lock-link" data-key="signout"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i> Sign out</button>
                </div>
            </div>
            <div class="scan-lock-sheet" hidden>
                <div class="scan-lock-sheet-backdrop" data-key="close-list"></div>
                <section class="scan-lock-list" aria-labelledby="scan-lock-list-title">
                    <div class="scan-lock-list-head">
                        <h3 id="scan-lock-list-title">Scanned cards</h3>
                        <button type="button" class="scan-lock-list-close" data-key="close-list">Hide</button>
                    </div>
                    <ol class="scan-lock-list-items"></ol>
                </section>
            </div>`;
        screen.addEventListener('click', handleScanLockClick);
        screen.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeScanLockList();
        });
        bindScanLockSwipe(screen);
        bindScanLockDimming(screen);
        document.body.appendChild(screen);
        document.documentElement.classList.add('scan-locked');
        setScanLockInert(true);
        window.addEventListener('beforeunload', scanLockBeforeUnload);
        scanLockClockInterval = setInterval(updateScanLockScreen, 1000);
    }
    updateScanLockScreen();
    wakeScanLock();
    // Without the attendance scanner (another tab, or after a reload), listen for the unlock card.
    if (!nfcReader) startScanLockReader();
    screen.focus({ preventScroll: true });
}

// --- Dimming: a minute without a scan or a touch dims the lock screen (less
// light, and less wear on an AMOLED screen, which the clock's small drift every
// two minutes also spares). A card or a touch wakes it; the first touch on a
// dimmed screen only wakes it, so it never presses what lies under the finger.
const SCAN_LOCK_DIM_MS = 60000;
let scanLockDimTimer = null;

function wakeScanLock() {
    const screen = document.getElementById('scan-lock');
    if (!screen) return;
    screen.classList.remove('is-dimmed');
    clearTimeout(scanLockDimTimer);
    scanLockDimTimer = setTimeout(() => screen.classList.add('is-dimmed'), SCAN_LOCK_DIM_MS);
}

function bindScanLockDimming(screen) {
    let wakingTap = false;
    screen.addEventListener('pointerdown', () => {
        wakingTap = screen.classList.contains('is-dimmed');
        wakeScanLock();
    }, true);
    screen.addEventListener('click', (event) => {
        if (!wakingTap) return;
        wakingTap = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (scanLockSession) fillScreenForScanning();
    }, true);
    screen.addEventListener('keydown', wakeScanLock, true);
}

function hideScanLockScreen() {
    const screen = document.getElementById('scan-lock');
    if (!screen) return;
    clearTimeout(scanLockDimTimer);
    stopScanLockReader();
    clearInterval(scanLockClockInterval);
    scanLockClockInterval = null;
    clearTimeout(scanLockListTimer);
    window.removeEventListener('beforeunload', scanLockBeforeUnload);
    setScanLockInert(false);
    document.documentElement.classList.remove('scan-locked');
    screen.remove();
    if (logsListStale) scheduleScanRender();
}

// Runs every second; text is only written when it changes, so live regions stay quiet.
function updateScanLockScreen() {
    const screen = document.getElementById('scan-lock');
    if (!screen) return;
    const setText = (selector, text) => {
        const el = screen.querySelector(selector);
        if (el.textContent !== text) el.textContent = text;
    };
    // The course as people write it ("CE 121") with its name, and the group, if any, beside it.
    const session = getCurrentActiveSession();
    const group = screen.querySelector('.scan-lock-course-group');
    const lockedCourse = scanLockCourse();
    setText('.scan-lock-course-code', lockedCourse ? getCleanCourseCode(lockedCourse) : '');
    setText('.scan-lock-course-title', lockedCourse ? getCourseTitle(lockedCourse) : '');
    setText('.scan-lock-course-group', session !== 'Default' ? session : '');
    group.hidden = session === 'Default';
    setText('.scan-lock-clock', formatScanLockTime(Date.now()));
    screen.querySelector('.scan-lock-device').hidden = !deviceUnlockId();
    screen.classList.toggle('is-paused', !isScanning);
    setText('.scan-lock-title', isScanning ? 'Tap your Student ID' : 'Scanning is paused');

    const status = screen.querySelector('.scan-lock-status');
    const count = scanLockScans.length;
    status.disabled = count === 0;
    status.classList.toggle('has-scans', count > 0);
    status.setAttribute('aria-label', count ? `${count} ${count === 1 ? 'card' : 'cards'} recorded. Show scanned cards` : '');
    if (!status.dataset.message) {
        setText('.scan-lock-status-text', isScanning
            ? `${count} ${count === 1 ? 'card' : 'cards'} recorded`
            : 'Cards are not being recorded. Unlock to start scanning again.');
    }

    const events = readScanLockState()?.events || [];
    screen.querySelector('.scan-lock-alert').hidden = events.length === 0;
    if (events.length) {
        const last = events[events.length - 1];
        setText('.scan-lock-alert', scanLockAwayText(events));
    }
}

// A short message in place of the scan count, for example for a card tapped while paused.
function flashScanLockStatus(message) {
    const status = document.querySelector('#scan-lock .scan-lock-status');
    if (!status) return;
    wakeScanLock();
    status.dataset.message = '1';
    status.querySelector('.scan-lock-status-text').textContent = message;
    clearTimeout(status._timer);
    status._timer = setTimeout(() => {
        delete status.dataset.message;
        updateScanLockScreen();
    }, 4000);
}

// --- The latest scan, large, in place of the tap illustration ---
// Each name slides in as the previous one leaves. Both moves take a fifth of a
// second, so a queue of students tapping one after another never waits on them.
const SCAN_LOCK_RESULT_MS = 5000;

function showScanLockResult(scan) {
    const box = document.querySelector('#scan-lock .scan-lock-result');
    if (!box) return;
    const stage = box.closest('.scan-lock-stage');
    box.querySelectorAll('.scan-lock-result-item:not(.is-leaving)').forEach(leaveScanLockResult);
    const item = document.createElement('span');
    item.className = `scan-lock-result-item${scan.unknown ? ' is-unknown' : ''}`;
    item.innerHTML = `<span class="scan-lock-result-name"></span>
        <span class="scan-lock-result-note"><i class="fa-solid ${scan.unknown ? 'fa-triangle-exclamation' : 'fa-circle-check'}" aria-hidden="true"></i>${scan.unknown ? 'Not in the student list' : 'Recorded'}</span>`;
    showScannedName(item.querySelector('.scan-lock-result-name'), scan);
    box.appendChild(item);
    stage?.classList.add('has-result');
    clearTimeout(box._timer);
    box._timer = setTimeout(() => {
        box.querySelectorAll('.scan-lock-result-item:not(.is-leaving)').forEach(leaveScanLockResult);
        stage?.classList.remove('has-result');
    }, SCAN_LOCK_RESULT_MS);
}

function leaveScanLockResult(item) {
    item.classList.add('is-leaving');
    item.setAttribute('aria-hidden', 'true');
    item.addEventListener('animationend', () => item.remove(), { once: true });
    setTimeout(() => item.remove(), 400); // Without animations there is no animationend.
}

// --- Scanned cards: swipe down for a floating list, newest first ---
let scanLockListTimer = null;
const SCAN_LOCK_LIST_IDLE_MS = 20000; // An open list folds away after this long untouched

function noteScanLockScan(scan) {
    wakeScanLock();
    scanLockScans.unshift(scan);
    updateScanLockScreen();
    const items = document.querySelector('#scan-lock .scan-lock-sheet:not([hidden]) .scan-lock-list-items');
    if (items) {
        items.querySelector('.scan-lock-list-empty')?.remove();
        items.prepend(scanLockListItem(scan, 0));
    }
}

function scanLockListItem(scan, index) {
    const li = document.createElement('li');
    li.className = `scan-lock-list-item${scan.unknown ? ' is-unknown' : ''}`;
    li.style.setProperty('--i', Math.min(index, 8));
    li.innerHTML = `
        <span class="scan-lock-list-icon"><i class="fa-solid ${scan.unknown ? 'fa-triangle-exclamation' : 'fa-check'}" aria-hidden="true"></i></span>
        <span class="scan-lock-list-name"></span>
        <time class="scan-lock-list-time"></time>`;
    showScannedName(li.querySelector('.scan-lock-list-name'), scan);
    li.querySelector('.scan-lock-list-time').textContent = formatScanLockTime(scan.at);
    li.querySelector('.scan-lock-list-time').dateTime = new Date(scan.at).toISOString();
    return li;
}

function isScanLockListOpen() {
    return !!document.querySelector('#scan-lock .scan-lock-sheet:not([hidden]):not(.is-closing)');
}

function openScanLockList() {
    const screen = document.getElementById('scan-lock');
    const sheet = screen?.querySelector('.scan-lock-sheet');
    if (!sheet || isScanLockListOpen()) return;
    const items = sheet.querySelector('.scan-lock-list-items');
    items.replaceChildren(...scanLockScans.map(scanLockListItem));
    if (!scanLockScans.length) items.innerHTML = '<li class="scan-lock-list-empty">No cards recorded yet.</li>';
    items.scrollTop = 0;
    sheet.querySelector('.scan-lock-list').style.transform = '';
    sheet.classList.remove('is-closing');
    sheet.hidden = false;
    armScanLockListIdle();
}

function closeScanLockList() {
    const screen = document.getElementById('scan-lock');
    const sheet = screen?.querySelector('.scan-lock-sheet');
    if (!sheet || sheet.hidden || sheet.classList.contains('is-closing')) return;
    clearTimeout(scanLockListTimer);
    sheet.classList.add('is-closing');
    // A dragged list slides on from where the finger left it.
    const list = sheet.querySelector('.scan-lock-list');
    const finish = () => {
        if (!sheet.classList.contains('is-closing')) return;
        sheet.hidden = true;
        sheet.classList.remove('is-closing');
        list.style.transform = '';
    };
    list.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 450); // Without animations there is no animationend.
}

function armScanLockListIdle() {
    clearTimeout(scanLockListTimer);
    scanLockListTimer = setTimeout(closeScanLockList, SCAN_LOCK_LIST_IDLE_MS);
}

// Swiping down opens the list. Open, the list follows a downward drag from its
// top and folds away past a short distance; anything less springs back.
function bindScanLockSwipe(screen) {
    let start = null;
    screen.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) { start = null; return; }
        const touch = event.touches[0];
        const items = event.target.closest('.scan-lock-list-items');
        start = {
            x: touch.clientX,
            y: touch.clientY,
            inSheet: !!event.target.closest('.scan-lock-sheet'),
            atTop: !items || items.scrollTop <= 0,
            dragging: false
        };
        if (isScanLockListOpen()) armScanLockListIdle();
    }, { passive: true });

    screen.addEventListener('touchmove', (event) => {
        if (!start || !isScanLockListOpen() || !start.inSheet || !start.atTop) return;
        const touch = event.touches[0];
        const dy = touch.clientY - start.y;
        if (!start.dragging && (dy < 8 || Math.abs(touch.clientX - start.x) > dy)) return;
        start.dragging = true;
        event.preventDefault(); // The list follows the finger instead of scrolling.
        const list = screen.querySelector('.scan-lock-list');
        list.classList.add('is-dragging');
        list.style.transform = `translateY(${Math.max(0, dy)}px)`;
    }, { passive: false });

    const end = (event) => {
        if (!start) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        const downward = dy > 60 && Math.abs(dx) < dy;
        const list = screen.querySelector('.scan-lock-list');
        list.classList.remove('is-dragging');
        if (!isScanLockListOpen()) {
            if (downward && !start.inSheet) openScanLockList();
        } else if (start.dragging) {
            if (dy > 90) closeScanLockList();
            else list.style.transform = '';
        }
        start = null;
    };
    screen.addEventListener('touchend', end);
    screen.addEventListener('touchcancel', () => {
        screen.querySelector('.scan-lock-list')?.classList.remove('is-dragging');
        const list = screen.querySelector('.scan-lock-list');
        if (list) list.style.transform = '';
        start = null;
    });
}

// Sign out is the way out without a staff card (forgotten, or the phone is
// offline and has never confirmed it); it gives nobody else access. Where the
// lecturer turned it on, the device's own fingerprint or PIN unlocks it too.
function handleScanLockClick(event) {
    const key = event.target.closest('[data-key]')?.dataset.key;
    // A tap fills the screen again, unless it asks the device or signs out.
    if (scanLockSession && key !== 'device' && key !== 'signout') fillScreenForScanning();
    if (key === 'list') {
        openScanLockList();
    } else if (key === 'close-list') {
        closeScanLockList();
    } else if (key === 'signout') {
        // The lock stays until the session is gone, which offline takes a moment.
        handleSignoutClick();
    } else if (key === 'device') {
        verifyWithDevice().then(verified => {
            if (verified && isScanLockScreenShown()) unlockScanner();
        });
    }
}

function startScanLockReader() {
    if (!nfcSupported || scanLockReaderController) return;
    const controller = new AbortController();
    scanLockReaderController = controller;
    const reader = new NDEFReader();
    reader.onreading = async ({ serialNumber }) => {
        if (controller.signal.aborted) return;
        const owner = await scanLockCardOwner(serialNumber);
        if (owner) {
            toggleScanLockWithCard(owner);
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
// The device's own fingerprint or PIN prompt hides it too, but cards are not lost then.
function noteScanLockHidden() {
    if (scanLockVerifying) return;
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
    showNotification('warning', 'Stando Was Off Screen', scanLockAwayText(events), 10000);
}

// Stando cannot read cards while it is off screen: the screen went off, or another
// app, tab or the phone's own NFC screen came up. Those taps were not recorded.
function scanLockAwayText(events) {
    const last = events[events.length - 1];
    const when = `${formatScanLockTime(last.at)} for ${formatScanLockDuration(last.ms)}`;
    return events.length === 1
        ? `Stando was off screen at ${when}, so cards tapped then weren't recorded.`
        : `Stando was off screen ${events.length} times, last at ${when}. Cards tapped then weren't recorded.`;
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
    document.getElementById('scan-lock-btn')?.addEventListener('click', lockScanner);
    deviceUnlockSupported().then(available => { deviceUnlockAvailable = available; });

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
        if (document.visibilityState === 'hidden') {
            noteScanLockHidden();
        } else {
            noteScanLockReturn();
            wakeScanLock();
        }
    });
    window.addEventListener('pagehide', noteScanLockHidden);
}

/**
 * Play sound effect (success or error).
 * @param {boolean} success - Whether to play success or error sound.
 */
// Scan sounds through Web Audio: decoded once, they start the instant a card is read
// (an <audio> element can lag a few hundred milliseconds on phones). The <audio>
// elements stay the fallback. Prepared on the first tap or click on the page.
let soundContext = null;
const soundBuffers = {};
function prepareScanSounds() {
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return;
    if (!soundContext) {
        try {
            soundContext = new AudioContextType({ latencyHint: 'interactive' });
        } catch {
            return;
        }
        [['success', successSound], ['error', errorSound]].forEach(([key, element]) => {
            const src = element?.querySelector('source')?.src || element?.currentSrc || element?.src;
            if (!src) return;
            fetch(src)
                .then(response => response.arrayBuffer())
                .then(data => soundContext.decodeAudioData(data))
                .then(buffer => { soundBuffers[key] = buffer; })
                .catch(() => { /* The <audio> element plays instead. */ });
        });
    }
    if (soundContext.state === 'suspended') soundContext.resume().catch(() => { });
}

function playSound(success) {
    if (!soundEnabled) return;

    const buffer = soundBuffers[success ? 'success' : 'error'];
    if (soundContext?.state === 'running' && buffer) {
        const source = soundContext.createBufferSource();
        source.buffer = buffer;
        source.connect(soundContext.destination);
        source.start();
        return;
    }

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
    notificationArea.querySelectorAll(`[data-notification-type="${type}"]`).forEach(element => leaveNotification(element));
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

    // A new notification replaces one of the same kind.
    notificationArea.querySelectorAll(`.in-page-notification-${type}`).forEach(element => leaveNotification(element));

    // At most three at a time; the oldest (lowest) makes room.
    const shown = notificationArea.querySelectorAll('.in-page-notification:not(.removing)');
    if (shown.length >= 3) leaveNotification(shown[shown.length - 1]);

    // Create the new notification
    const notification = document.createElement('div');
    notification.setAttribute('class', `in-page-notification in-page-notification-${type}`);
    notification.dataset.notificationType = type;

    const icon = { success: 'check', error: 'xmark', warning: 'exclamation', delete: 'trash-can' }[type] || 'info';

    // Title and message are plain text: they often carry names and server errors.
    // Line breaks ("\n") in the message are kept.
    // No close button: a tap or a swipe dismisses it.
    notification.innerHTML = `
        <span class="toast-icon" aria-hidden="true"><i class="fa-solid fa-${icon}"></i></span>
        <div class="in-page-notification-text"><strong></strong><span class="in-page-notification-message"></span></div>
    `;
    notification.querySelector('strong').textContent = title;
    notification.querySelector('.in-page-notification-message').textContent = message ?? '';
    notification.title = 'Tap to dismiss';
    if (type === 'error') notification.setAttribute('role', 'alert');

    // Newest at the top, like a phone's notifications.
    notificationArea.prepend(notification);

    // Each leaves on its own (errors stay longer), but not while the pointer
    // rests on it or a finger holds it.
    const startTimer = (ms) => {
        clearTimeout(notification._autoTimer);
        notification._autoTimer = setTimeout(() => leaveNotification(notification), ms);
    };
    startTimer(type === 'error' ? Math.max(duration || 0, 10000) : duration || 5000);
    notification.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') clearTimeout(notification._autoTimer);
    });
    notification.addEventListener('pointerleave', (event) => {
        if (event.pointerType === 'mouse' && !notification.classList.contains('is-dragging')) startTimer(2500);
    });

    makeNotificationSwipeable(notification, () => startTimer(type === 'error' ? 6000 : 3000));
}

// A notification leaves the way it is going, fading as it moves; then the space
// it held closes, so the ones below glide up instead of jumping.
function leaveNotification(element, { x = 0, y = -12, rotate = 0 } = {}) {
    if (!element || element.classList.contains('removing')) return;
    element.classList.add('removing');
    element.classList.remove('is-dragging', 'is-settling');
    clearTimeout(element._autoTimer);
    element.style.animation = 'none';
    element.style.transition = 'transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.22s ease-out';
    element.style.transform = `translate(${x}px, ${y}px) rotate(${rotate}deg)`;
    element.style.opacity = '0';
    setTimeout(() => {
        element.style.height = `${element.offsetHeight}px`;
        void element.offsetHeight;
        element.style.transition = 'height 0.2s ease, padding 0.2s ease, margin 0.2s ease, border-width 0.2s ease';
        element.style.height = '0px';
        element.style.paddingTop = '0px';
        element.style.paddingBottom = '0px';
        element.style.borderWidth = '0px';
        element.style.marginBottom = '-8px'; // Takes back the gap above the next one
    }, 200);
    setTimeout(() => element.remove(), 450);
}

// Swipe a notification away sideways (either way) or up, with a finger or by
// dragging with the mouse; a tap without moving dismisses it too. Let go of a
// swipe before it is far enough and it springs back.
function makeNotificationSwipeable(element, onSettle) {
    let drag = null;
    element.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || element.classList.contains('removing')) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, t: performance.now(), dx: 0, dy: 0, axis: null };
        element.setPointerCapture(event.pointerId);
        element.style.animation = 'none';
        element.classList.remove('is-settling');
        element.classList.add('is-dragging');
        clearTimeout(element._autoTimer);
    });

    element.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        drag.dx = event.clientX - drag.x;
        drag.dy = event.clientY - drag.y;
        if (!drag.axis && Math.hypot(drag.dx, drag.dy) > 6) {
            drag.axis = Math.abs(drag.dx) >= Math.abs(drag.dy) ? 'x' : 'y';
        }
        if (drag.axis === 'x') {
            element.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 30}deg)`;
            element.style.opacity = String(Math.max(0.15, 1 - Math.abs(drag.dx) / element.offsetWidth));
        } else if (drag.axis === 'y') {
            // Up follows the pointer; down resists, as there is nowhere to go.
            element.style.transform = `translateY(${drag.dy < 0 ? drag.dy : drag.dy / 5}px)`;
            element.style.opacity = String(Math.max(0.15, 1 + Math.min(0, drag.dy) / (element.offsetHeight * 1.5)));
        }
    });

    const end = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const { dx, dy, axis } = drag;
        const ms = Math.max(1, performance.now() - drag.t);
        drag = null;
        element.classList.remove('is-dragging');
        if (element.classList.contains('removing')) return;
        // Far enough, or flicked fast enough, and it goes; a tap sends it up.
        if (!axis && event.type === 'pointerup') {
            leaveNotification(element);
        } else if (axis === 'x' && (Math.abs(dx) > element.offsetWidth * 0.35 || Math.abs(dx) / ms > 0.6)) {
            const side = Math.sign(dx);
            leaveNotification(element, { x: side * (element.offsetWidth + 60), y: 0, rotate: side * 12 });
        } else if (axis === 'y' && (dy < -element.offsetHeight * 0.5 || dy / ms < -0.6)) {
            leaveNotification(element, { x: 0, y: -(element.offsetHeight + 40) });
        } else {
            element.classList.add('is-settling');
            element.style.transform = '';
            element.style.opacity = '';
            setTimeout(() => element.classList.remove('is-settling'), 600);
            onSettle();
        }
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
}

// The count under a list's title: "12 records", or "5 of 78 records" while a
// search or filter hides some (total given).
function listCountText(count, noun, total = null) {
    const plural = n => `${noun}${n === 1 ? '' : 's'}`;
    return total != null && total !== count
        ? `${count} of ${total} ${plural(total)}`
        : `${count} ${plural(count)}`;
}

// --- PAGINATION HELPER FUNCTIONS ---

// Pages under a list: ‹ 1 2 3 … › on wide screens, ‹ Page 2 of 6 › on phones.
// Changing page brings the top of the list back into view.
function renderPagination(prefix, currentPage, totalPages, goTo) {
    const container = document.getElementById(`${prefix}-pagination`);
    const pageNumbers = document.getElementById(`${prefix}-page-numbers`);
    const prevBtn = document.getElementById(`${prefix}-prev-page`);
    const nextBtn = document.getElementById(`${prefix}-next-page`);
    if (!container) return;
    if (totalPages <= 1) {
        container.style.display = 'none';
        return;
    }

    const show = page => {
        goTo(page);
        container.closest('.module')?.querySelector('.list-toolbar')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    container.style.display = 'flex';
    pageNumbers.innerHTML = generatePageNumbers(currentPage, totalPages).map(page => page === '...'
        ? '<span class="page-btn ellipsis" aria-hidden="true">…</span>'
        : `<button type="button" class="page-btn${page === currentPage ? ' active' : ''}" data-page="${page}"${page === currentPage ? ' aria-current="page"' : ''} aria-label="Page ${page}">${page}</button>`
    ).join('') + `<span class="page-status" aria-hidden="true">Page ${currentPage} of ${totalPages}</span>`;
    pageNumbers.querySelectorAll('button[data-page]').forEach(btn => {
        btn.onclick = () => show(Number(btn.dataset.page));
    });

    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    prevBtn.onclick = () => show(currentPage - 1);
    nextBtn.onclick = () => show(currentPage + 1);
}

// Splits rows into pages of ITEMS_PER_PAGE. With dayOf, a day's rows stay together:
// whole days fill a page up to the limit, and a longer day has a page of its own.
function paginateRows(rows, dayOf) {
    const pages = [];
    let page = [];
    for (let start = 0; start < rows.length;) {
        let end = start + 1;
        if (dayOf) while (end < rows.length && dayOf(rows[end]) === dayOf(rows[start])) end++;
        if (page.length && page.length + (end - start) > ITEMS_PER_PAGE) {
            pages.push(page);
            page = [];
        }
        page.push(...rows.slice(start, end));
        start = end;
    }
    if (page.length) pages.push(page);
    return pages;
}

function renderLogsPagination(currentPage, totalPages) {
    renderPagination('logs', currentPage, totalPages, page => { logsCurrentPage = page; updateLogsList(); });
}

function renderDbPagination(currentPage, totalPages) {
    renderPagination('db', currentPage, totalPages, page => { dbCurrentPage = page; updateDatabaseList(); });
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
// Keeps segmented buttons rounded at both ends of every line they wrap onto,
// whenever their container changes size: a resize, the panel showing again,
// a label settling or a button added.
function watchButtonRows(container, update = updateButtonRows) {
    if (!container || container._rowObserver || typeof ResizeObserver === 'undefined') return;
    container._rowObserver = new ResizeObserver(() => update(container));
    container._rowObserver.observe(container);
}

function updateButtonRows(container) {
    if (!container) return;
    const items = Array.from(container.children).filter(el => !el.classList.contains('segment-thumb') && el.style.display !== 'none' && el.offsetParent !== null);

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
        return { course, code, title: getCourseTitle(course), offering, guest: course === guestCourse, icon: faIconClass(courseInfoMap[course]?.icon) };
    });
    // Courses in two or more programmes sit under a heading for each.
    const groups = groupCoursesByProgramme(coursesToDisplay);

    // The row stays mounted while the courses are unchanged; only the selection moves,
    // so the selected tab's icon can close smoothly.
    const signature = JSON.stringify([buttons, groups?.map(group => [group.programme?.id ?? null, group.courses])]);
    if (courseButtonsContainer.dataset.signature !== signature || !courseButtonsContainer.children.length) {
        courseButtonsContainer.dataset.signature = signature;
        courseButtonsContainer.innerHTML = '';
        courseButtonsContainer.classList.toggle('is-grouped', !!groups);
        const makeButton = ({ course, code, title, offering, guest, icon }, copy = '') => {
            const button = document.createElement('div');
            button.setAttribute('class', 'course-button');
            button.setAttribute('role', 'button');
            button.tabIndex = 0;
            button.dataset.course = course;
            if (copy) button.dataset.copy = copy; // Which programme's copy of the course

            // Mark guest courses visually
            if (guest) button.classList.add('btn-orange');

            const full = title && title.toLowerCase() !== code.toLowerCase() ? title : '';
            button.classList.toggle('has-full-name', !!full);
            // The course's own icon (Settings → its course → Appearance), else the list icon.
            button.innerHTML = faIconHtml(icon, 'fa-fw course-button-icon') + '<span class="course-button-label">' +
                `<span class="course-button-swap course-button-code"><span>${escapeHtml(code)}${offering ? `<small class="course-offering-id">${escapeHtml(offering)}</small>` : ''}</span></span>` +
                (full ? `<span class="course-button-swap course-button-full"><span>${escapeHtml(full)}</span></span>` : '') + '</span>';
            button.title = title ? `${code} ${title}` : course.replace(/_/g, ' ');
            button.addEventListener('click', () => {
                if (button.classList.contains('is-duplicate')) {
                    const where = document.querySelector('#course-buttons-container .course-button.active')
                        ?.closest('.course-group')?.querySelector('.course-group-label')?.textContent.trim();
                    showCourseBubble(button, where ? `Already selected under ${where}` : 'Already selected');
                    return;
                }
                selectedCourseCopy = button.dataset.copy || '';
                selectCourseButton(course);
            });
            return button;
        };
        if (groups) {
            const byCourse = new Map(buttons.map(button => [button.course, button]));
            groups.forEach(group => {
                const section = document.createElement('section');
                section.className = 'course-group';
                section.setAttribute('aria-label', group.programme ? programmeOptionLabel(group.programme) : 'Other courses');
                section.innerHTML = `<span class="course-group-label"${group.programme?.name ? ` title="${escapeHtml(programmeOptionLabel(group.programme))}"` : ''}>${escapeHtml(group.programme ? group.programme.code : 'Other')}</span><div class="course-group-buttons"></div>`;
                const row = section.querySelector('.course-group-buttons');
                group.courses.forEach(course => row.appendChild(makeButton(byCourse.get(course), group.programme ? `p${group.programme.id}` : 'other')));
                courseButtonsContainer.appendChild(section);
            });
        } else {
            buttons.forEach(button => courseButtonsContainer.appendChild(makeButton(button)));
        }
    }
    markCourseButtons(currentCourse);

    if (!currentCourse && coursesToDisplay.length > 0) {
        selectCourseButton(coursesToDisplay[0]);
    }

    // Apply row-aware rounding after buttons are in the DOM
    requestAnimationFrame(() => updateCourseButtonRows(courseButtonsContainer));

    // Rows re-compute whenever the container reflows.
    if (!courseButtonsContainer._rowObserver) {
        watchButtonRows(courseButtonsContainer, updateCourseButtonRows);
        // The selected tab changes width as its icon closes and its name grows; re-tag
        // the rows once that settles.
        courseButtonsContainer.addEventListener('transitionend', (event) => {
            const grew = event.propertyName === 'grid-template-columns' && event.target.classList?.contains('course-button-full');
            const closed = event.propertyName === 'width' && event.target.classList?.contains('course-button-icon');
            if (!grew && !closed) return;
            updateCourseButtonRows(courseButtonsContainer);
            const active = courseButtonsContainer.querySelector('.course-button.active');
            if (active && courseButtonsContainer.scrollWidth > courseButtonsContainer.clientWidth) {
                active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }
        });
    }
}

// Rounds the ends of each row of course buttons, in every programme's group.
function updateCourseButtonRows(container) {
    const rows = container.classList.contains('is-grouped') ? container.querySelectorAll('.course-group-buttons') : [container];
    rows.forEach(updateButtonRows);
}

// The copy of a course chosen last (its programme), when a course shows under two.
let selectedCourseCopy = '';

// The chosen course's button is pressed; its copies under other programmes are
// dimmed (tapping one says the course is already selected).
function markCourseButtons(course, pressNow = false) {
    const buttons = [...document.querySelectorAll('#course-buttons-container .course-button')];
    const copies = buttons.filter(button => button.dataset.course === course);
    const chosen = copies.find(button => (button.dataset.copy || '') === selectedCourseCopy) || copies[0];
    if (chosen) selectedCourseCopy = chosen.dataset.copy || '';
    buttons.forEach(button => {
        const selected = button === chosen;
        const duplicate = !selected && button.dataset.course === course;
        button.classList.toggle('active', selected);
        button.classList.toggle('is-duplicate', duplicate);
        button.classList.remove('selecting');
        button.setAttribute('aria-pressed', String(selected));
        if (duplicate) button.setAttribute('aria-disabled', 'true');
        else button.removeAttribute('aria-disabled');
    });
    if (chosen && pressNow) {
        chosen.classList.add('selecting');
        setTimeout(() => chosen.classList.remove('selecting'), 150);
    }
}

// A small dark note by a course button, as in Syllabase: below it, or above it when the
// button is too near the bottom of the screen to fit it there. It goes by itself, when
// the page scrolls, or when swiped sideways (it follows the finger or mouse and fades;
// let go early and it springs back).
let bubbleTimer = null;
function showCourseBubble(anchor, message) {
    let bubble = document.getElementById('course-bubble');
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.id = 'course-bubble';
        bubble.className = 'course-bubble';
        bubble.setAttribute('role', 'status');
        bubble.setAttribute('aria-live', 'polite');
        document.body.appendChild(bubble);
        bindBubbleDrag(bubble);
        window.addEventListener('scroll', () => {
            if (!bubble.classList.contains('is-dragging')) hideCourseBubble();
        }, { passive: true, capture: true });
    }
    bubble.textContent = message;
    bubble.classList.remove('show', 'is-leaving', 'below');
    bubble.style.removeProperty('--drag-x');
    bubble.style.removeProperty('--drag-fade');
    bubble.style.left = '0px';
    bubble.style.top = '0px';
    const at = anchor.getBoundingClientRect();
    const size = bubble.getBoundingClientRect();
    const gap = 8;
    const below = at.bottom + gap + size.height <= window.innerHeight - 8 || at.top - size.height - gap < 8;
    const left = Math.min(Math.max(8, at.left + at.width / 2 - size.width / 2), window.innerWidth - size.width - 8);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${below ? at.bottom + gap : at.top - size.height - gap}px`;
    // Its arrow points at the button's middle, even when the note is kept on screen.
    bubble.style.setProperty('--arrow-x', `${Math.min(Math.max(12, at.left + at.width / 2 - left), size.width - 12)}px`);
    bubble.classList.toggle('below', below);
    void bubble.offsetWidth;
    bubble.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideCourseBubble, 2200);
}

function hideCourseBubble() {
    clearTimeout(bubbleTimer);
    document.getElementById('course-bubble')?.classList.remove('show');
}

function bindBubbleDrag(bubble) {
    let drag = null;
    const move = x => {
        bubble.style.setProperty('--drag-x', `${x}px`);
        bubble.style.setProperty('--drag-fade', String(Math.max(0.15, 1 - Math.abs(x) / 160)));
    };
    bubble.addEventListener('pointerdown', (event) => {
        if (!bubble.classList.contains('show')) return;
        drag = { id: event.pointerId, x: event.clientX };
        bubble.setPointerCapture(event.pointerId);
        bubble.classList.add('is-dragging');
        clearTimeout(bubbleTimer);
    });
    bubble.addEventListener('pointermove', (event) => {
        if (drag?.id === event.pointerId) move(event.clientX - drag.x);
    });
    const release = (event) => {
        if (drag?.id !== event.pointerId) return;
        const dx = event.clientX - drag.x;
        drag = null;
        bubble.classList.remove('is-dragging');
        if (Math.abs(dx) > 50) {
            // Off it goes, the way it was pushed.
            bubble.classList.add('is-leaving');
            move(Math.sign(dx) * 260);
            bubble.style.setProperty('--drag-fade', '0');
            bubbleTimer = setTimeout(() => bubble.classList.remove('show', 'is-leaving'), 260);
        } else {
            // Back with a bounce; a tap just closes it.
            move(0);
            bubble.style.removeProperty('--drag-fade');
            if (Math.abs(dx) < 4) hideCourseBubble();
            else bubbleTimer = setTimeout(hideCourseBubble, 1600);
        }
    };
    bubble.addEventListener('pointerup', release);
    bubble.addEventListener('pointercancel', release);
}

function selectCourseButton(course) {
    // Give instant visual feedback by updating classes immediately
    markCourseButtons(course, true);

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
