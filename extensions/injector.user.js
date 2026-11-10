// ==UserScript==
// @name         EIS Attendance Importer
// @namespace    https://bredliplaku.com/
// @version      3.1
// @description  Fills the EIS attendance form from Stando's "Add to EIS" (clipboard or file).
// @author       Bredli Plaku
// @match        https://eis.epoka.edu.al/courseattendance/*/newcl
// @updateURL    https://github.com/bredliplaku/stando/raw/refs/heads/main/extensions/injector.user.js
// @downloadURL  https://github.com/bredliplaku/stando/raw/refs/heads/main/extensions/injector.user.js
// @icon         https://raw.githubusercontent.com/bredliplaku/stando/refs/heads/main/miscellaneous/EPOKA_icon.png
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * Stando copies (or saves) a small JSON payload:
 *   { version: 2,
 *     parameters: { eisId, week, date, topic, category, section, hours, course },
 *     options:    { markMissingAsAbsent, markExemptedAsAbsent, manualHours },
 *     attendance: { "Student Name": hoursPresent, ... },   // who scanned, by name
 *     known:      [ "Student Name", ... ] }                // everyone this course has seen
 * Version 1 (attendance by card UID plus a nameMap of the whole Student List) is
 * still read. Names are compared without accents, case or extra spaces.
 *
 * It arrives by Paste (or by itself on load), by Import file, or by dropping
 * the saved file on the page. Data that EIS has already saved once is not
 * filled in again by itself, so an old clipboard cannot become a new record.
 */
(function () {
    'use strict';

    const log = (...args) => console.log('[Stando → EIS]', ...args);

    const DEFAULT_OPTIONS = {
        checkedMeansAbsent: false,   // EIS ticks mean "present"
        markMissingAsAbsent: true,   // rows Stando has never seen: all hours absent
        markExemptedAsAbsent: false, // rows marked EX: all hours absent
        manualHours: false,          // use Stando's hours instead of EIS's own
        autoReadClipboard: true,     // import on page load when the clipboard holds Stando data
        autoSave: false              // ask to save once filled
    };

    // Stando's categories as EIS lists them.
    const CATEGORY_MAP = { theory: 'Theory', lab: 'Lab', practice: 'Practice' };

    // The course in this page's address, to refuse another course's data.
    const pageEisId = (location.pathname.match(/courseattendance\/([^/]+)\/newcl/) || [])[1] || '';

    // A file larger than this is not one Stando saved.
    const MAX_FILE_BYTES = 2 * 1024 * 1024;

    let busy = false;
    // The fingerprint of the data last filled in, remembered as saved when EIS saves.
    let filledFingerprint = null;

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => document.documentElement.classList.toggle('eis-dark-mode', prefersDark.matches);
    prefersDark.addEventListener('change', applyTheme);
    applyTheme();

    applyStyles();
    watchSave();
    waitForElement('#student_list_table', 15000)
        .then(async () => {
            await waitForElement('.record_actions', 5000).catch(() => null);
            addButtons();
            enableFileDrop();
            if (DEFAULT_OPTIONS.autoReadClipboard) await autoImport();
        })
        .catch(error => {
            console.error(error);
            notify('error', 'Importer not started', 'The attendance table did not appear on this page.');
        });

    // --- Waiting ---------------------------------------------------------------

    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const found = document.querySelector(selector);
            if (found) return resolve(found);
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) { observer.disconnect(); clearTimeout(timer); resolve(element); }
            });
            const timer = setTimeout(() => { observer.disconnect(); reject(new Error(`Timed out waiting for ${selector}`)); }, timeout);
            observer.observe(document.documentElement, { childList: true, subtree: true });
        });
    }

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    // After a change that makes EIS reload part of the form: wait until jQuery's
    // requests finish (or, without jQuery, a fixed time), then a moment for EIS to
    // draw the result.
    async function settle(fallbackMs, timeout = 10000) {
        await delay(250);
        const $ = window.jQuery;
        if (!$ || typeof $.active !== 'number') return delay(fallbackMs);
        const started = Date.now();
        while ($.active > 0 && Date.now() - started < timeout) await delay(100);
        await delay(200);
    }

    // The student list, once EIS has drawn at least one row of it.
    async function waitForRows(timeout = 6000) {
        const count = () => document.querySelectorAll('#student_list_table tbody tr').length;
        const started = Date.now();
        while (!count() && Date.now() - started < timeout) await delay(150);
        return count();
    }

    // --- Reading the payload ----------------------------------------------------

    function normalizeName(name) {
        return String(name || '')
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // Either version of Stando's payload as
    // { parameters, options, hours: Map, known: Set, names: Map(key → name as Stando wrote it) }.
    function parsePayload(data) {
        const notStando = 'This is not attendance from Stando. In Stando, press Add to EIS, then try again.';
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch { throw new Error(notStando); }
        }
        const params = data && data.parameters;
        if (!params || typeof params.category !== 'string' || !params.category.trim() ||
            !data.attendance || typeof data.attendance !== 'object' || Array.isArray(data.attendance)) {
            throw new Error(notStando);
        }

        const hours = new Map();
        const known = new Set();
        const names = new Map();
        const add = (name, count) => {
            const key = normalizeName(name);
            if (!key) return;
            known.add(key);
            if (!names.has(key)) names.set(key, String(name).replace(/\s+/g, ' ').trim());
            if (count > 0) hours.set(key, (hours.get(key) || 0) + count);
        };

        if (data.nameMap && typeof data.nameMap === 'object') {
            // Version 1: attendance by card UID, nameMap of every student.
            Object.entries(data.nameMap).forEach(([uid, name]) => add(name, Number(data.attendance[uid]) || 0));
        } else {
            Object.entries(data.attendance).forEach(([name, count]) => add(name, Number(count) || 0));
            (Array.isArray(data.known) ? data.known : []).forEach(name => add(name, 0));
        }
        return { parameters: params, options: { ...DEFAULT_OPTIONS, ...(data.options || {}) }, hours, known, names };
    }

    function looksLikeStando(text) {
        return /^\s*\{/.test(text || '') && /"parameters"/.test(text) && /"attendance"/.test(text);
    }

    // A short fingerprint of a payload, the same however its JSON is spaced.
    function fingerprint(text) {
        let canonical = String(text || '');
        try { canonical = JSON.stringify(JSON.parse(canonical)); } catch { /* As it is. */ }
        let hash = 0x811c9dc5;
        for (let i = 0; i < canonical.length; i++) {
            hash ^= canonical.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(36) + '-' + canonical.length.toString(36);
    }

    // Fingerprints of the data EIS has saved (the last 50).
    const savedImports = {
        key: 'stando_eis_saved_imports',
        list() {
            try {
                const list = JSON.parse(localStorage.getItem(this.key));
                return Array.isArray(list) ? list : [];
            } catch {
                return [];
            }
        },
        has(print) {
            return this.list().some(item => item && item.fp === print);
        },
        add(print) {
            try {
                const list = this.list().filter(item => item && item.fp !== print);
                list.push({ fp: print, at: Date.now() });
                localStorage.setItem(this.key, JSON.stringify(list.slice(-50)));
            } catch { /* Not remembered. */ }
        }
    };

    // When EIS saves the form, the data filled in from Stando counts as saved.
    function watchSave() {
        const onSave = () => {
            if (filledFingerprint) savedImports.add(filledFingerprint);
        };
        document.addEventListener('submit', onSave, true);
        document.addEventListener('click', event => {
            if (event.target.closest?.('button[name="submit"], input[type="submit"][name="submit"]')) onSave();
        }, true);
    }

    async function autoImport() {
        let text;
        try {
            text = await navigator.clipboard.readText();
        } catch (error) {
            // Chrome asks for permission, or the page was not focused yet.
            log('Clipboard not readable on load:', error.message);
            notify('info', 'Ready to import', 'Press Paste from Stando, or drop the file Stando saved onto this page.');
            return;
        }
        if (!looksLikeStando(text)) {
            log('The clipboard holds no Stando data.');
            return;
        }
        if (savedImports.has(fingerprint(text))) {
            log('The clipboard holds attendance EIS has already saved.');
            notify('info', 'Already saved once',
                'The attendance on the clipboard was saved before, so it was not filled in again. Press Paste from Stando to use it anyway.');
            return;
        }
        await runImport(text, { auto: true });
    }

    async function pasteImport() {
        let text = null;
        try {
            text = await navigator.clipboard.readText();
        } catch {
            text = await askForText();
        }
        if (text == null) return;
        if (!text.trim()) {
            notify('warning', 'Clipboard empty', 'In Stando, press Add to EIS first.');
            return;
        }
        await runImport(text);
    }

    function fileImport() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = () => {
            const file = input.files && input.files[0];
            if (file) importFile(file);
        };
        input.click();
    }

    function importFile(file) {
        if (file.size > MAX_FILE_BYTES) {
            notify('warning', 'Not a Stando file', `${file.name} is too large to be the file Stando saves.`);
            return;
        }
        const reader = new FileReader();
        reader.onload = () => runImport(String(reader.result));
        reader.onerror = () => notify('error', 'Could not read the file', file.name);
        reader.readAsText(file);
    }

    // A file dropped anywhere on the page imports like Import file. File fields
    // of EIS's own keep their drops.
    function enableFileDrop() {
        let depth = 0;
        let hint = null;
        const carriesFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
        const ownField = event => !!event.target.closest?.('input[type="file"]');
        const show = () => {
            if (hint) return;
            hint = document.createElement('div');
            hint.className = 'eis-drop';
            hint.innerHTML = '<span><i class="fa fa-upload" aria-hidden="true"></i> Drop the file Stando saved to fill in the attendance</span>';
            document.body.appendChild(hint);
        };
        const hide = () => {
            depth = 0;
            hint?.remove();
            hint = null;
        };

        document.addEventListener('dragenter', event => {
            if (!carriesFiles(event) || ownField(event)) return;
            depth++;
            show();
        });
        document.addEventListener('dragleave', event => {
            if (carriesFiles(event) && --depth <= 0) hide();
        });
        document.addEventListener('dragover', event => {
            if (carriesFiles(event) && !ownField(event)) event.preventDefault();
        });
        document.addEventListener('drop', event => {
            if (!carriesFiles(event) || ownField(event)) return;
            event.preventDefault();
            hide();
            const file = event.dataTransfer.files[0];
            if (file) importFile(file);
        });
    }

    // --- Filling the form -------------------------------------------------------

    async function runImport(raw, { auto = false } = {}) {
        if (busy) return;
        busy = true;
        try {
            const payload = parsePayload(raw);
            const { parameters: p, options } = payload;
            log('Importing', p, `${payload.hours.size} present, ${payload.known.size} known`);

            if (p.eisId && pageEisId && String(p.eisId) !== pageEisId) {
                const course = p.course || 'another course';
                if (auto) {
                    notify('info', 'Clipboard is for another course',
                        `Stando copied the attendance of ${course}. For this course, choose it in Stando and press Add to EIS.`);
                    return;
                }
                throw new Error(`This data is for ${course}, not the course on this page. In Stando, choose this course and press Add to EIS again.`);
            }

            showLoading('Filling in the week, date and topic…');
            setField('didcourseattendance_week', p.week);
            setField('didcourseattendance_topicen', p.topic);
            setField('didcourseattendance_date', p.date);

            showLoading('Choosing the category…');
            const category = CATEGORY_MAP[p.category.toLowerCase()] || p.category;
            if (!setField('didcourseattendance_categoryen', category)) {
                throw new Error(`EIS has no category "${category}" for this course.`);
            }
            await settle(1500);

            const section = p.section && p.section !== 'ALL' ? p.section : '';
            if (section) {
                showLoading('Choosing the group…');
                if (!setField('didcourseattendance_section', section)) {
                    notify('warning', 'Group not found', `EIS has no group "${section}"; the list shows the default one.`);
                }
            }
            showLoading('Loading the student list…');
            await settle(2500);
            if (!(await waitForRows())) {
                throw new Error('EIS shows no students for this category and group.');
            }

            let numHours = p.hours;
            if (options.manualHours) {
                setField('didcourseattendance_nrhours', numHours);
                await settle(300);
            } else {
                const hoursField = document.getElementById('didcourseattendance_nrhours');
                if (hoursField && hoursField.value) numHours = hoursField.value;
            }

            showLoading('Ticking the hours…');
            const result = fillRows(payload, Number(numHours), options);
            hideLoading();
            if (!result) return;
            filledFingerprint = fingerprint(raw);
            const filledIn = [p.week ? `Week ${p.week}` : '', p.date || '', [category, section].filter(Boolean).join(' ')]
                .filter(Boolean).join(' · ');
            reportResult(result, filledIn);

            if (options.autoSave) {
                await delay(400);
                const saveButton = document.querySelector('button[name="submit"]');
                if (saveButton && confirm('Save the attendance now?')) saveButton.click();
            }
        } catch (error) {
            hideLoading();
            console.error(error);
            notify('error', 'Import failed', error.message);
        } finally {
            busy = false;
        }
    }

    function setField(id, value) {
        const element = document.getElementById(id);
        if (!element || value == null) return false;
        const wanted = String(value).trim().toLowerCase();

        if (element.tagName === 'SELECT') {
            const options = Array.from(element.options);
            const option = options.find(o => o.text.trim().toLowerCase() === wanted)
                || options.find(o => o.value.trim().toLowerCase() === wanted)
                || options.find(o => o.text.trim().toLowerCase().includes(wanted));
            if (!option) {
                console.warn(`[Stando → EIS] No option "${value}" in #${id}`, options.map(o => o.text.trim()));
                return false;
            }
            element.value = option.value;
        } else {
            element.value = value;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        const $ = window.jQuery;
        if ($) {
            try {
                $(element).trigger('change');
                if ($.fn.selectpicker) $(element).selectpicker('refresh');
            } catch { /* EIS without the plugin. */ }
        }
        return true;
    }

    // "Name Surname R EX" → { name: "Name Surname", exempt: true }
    function readRowName(row) {
        const cell = row.querySelector('td:nth-child(3)');
        if (!cell) return null;
        const raw = cell.textContent.replace(/\s+/g, ' ').trim();
        const exempt = /\sEX$/.test(raw) || !!cell.querySelector('.label-info');
        const name = raw.replace(/\s+(?:R\s+)?EX$/, '').replace(/\s+R$/, '').trim();
        return { name, exempt };
    }

    function hourCheckboxes(row, numHours) {
        // The first checkbox ticks all of a row's hours when there is one more
        // than hours (as the sheet generator reads it).
        const boxes = Array.from(row.querySelectorAll("input[type='checkbox']"));
        return boxes.slice(boxes.length > numHours ? 1 : 0).slice(0, numHours);
    }

    function fillRows(payload, numHours, options) {
        if (!Number.isSafeInteger(numHours) || numHours < 1) {
            hideLoading();
            notify('error', 'No class hours', 'Choose the number of hours in EIS, then press Paste again.');
            return null;
        }

        const rows = document.querySelectorAll('#student_list_table tbody tr');
        const result = { present: 0, absent: 0, exempt: 0, unknown: [], notOnList: [] };
        const listed = new Set();

        rows.forEach(row => {
            const info = readRowName(row);
            if (!info || !info.name) return;
            const key = normalizeName(info.name);
            listed.add(key);
            row.classList.remove('eis-row-filled', 'eis-row-unknown');
            row.removeAttribute('title');

            if (info.exempt && options.markExemptedAsAbsent) {
                setRowHours(row, numHours, 0, options);
                row.classList.add('eis-row-filled');
                result.exempt++;
                return;
            }

            if (!payload.known.has(key)) {
                result.unknown.push(info.name);
                row.classList.add('eis-row-unknown');
                row.title = 'Stando has not seen this student in this course.';
                if (options.markMissingAsAbsent) setRowHours(row, numHours, 0, options);
                return;
            }

            const present = Math.max(0, Math.min(numHours, Math.floor(payload.hours.get(key) || 0)));
            setRowHours(row, numHours, present, options);
            row.classList.add('eis-row-filled');
            if (present > 0) result.present++;
            else result.absent++;
        });

        // Scanned in Stando, but EIS does not list them in this group.
        payload.hours.forEach((count, key) => {
            if (!listed.has(key)) result.notOnList.push(payload.names.get(key) || key);
        });
        log('Result', result);
        return result;
    }

    // Ticks the first `present` hours as present and the rest as absent, and fills
    // EIS's hidden fields to match.
    function setRowHours(row, numHours, present, options) {
        hourCheckboxes(row, numHours).forEach((checkbox, i) => {
            const isPresent = i < present;
            const checked = options.checkedMeansAbsent ? !isPresent : isPresent;
            if (checkbox.checked !== checked) checkbox.click();
        });

        const rowIndex = row.querySelector('.checkboxes_row_td')?.getAttribute('data-row');
        if (!rowIndex) return;
        const hoursField = document.getElementById(`stdabsences_${rowIndex}_numofhours`);
        const checkedField = document.getElementById(`stdabsences_${rowIndex}_checked`);
        const updateField = document.getElementById(`stdabsences_${rowIndex}_update`);
        if (!hoursField || !checkedField || !updateField) return;

        const absentHours = [];
        for (let hour = present + 1; hour <= numHours; hour++) absentHours.push(hour);
        hoursField.value = absentHours.length;
        checkedField.value = absentHours.join(',');
        updateField.value = '1';
    }

    function reportResult(result, filledIn) {
        const parts = [`${result.present} present`, `${result.absent} absent`];
        if (result.exempt) parts.push(`${result.exempt} exempted`);
        const details = [];
        if (result.unknown.length) {
            details.push({
                title: `Not seen in Stando (${result.unknown.length})`,
                names: result.unknown
            });
        }
        if (result.notOnList.length) {
            details.push({
                title: `Scanned but not on this EIS list (${result.notOnList.length})`,
                names: result.notOnList
            });
        }
        const type = result.notOnList.length ? 'warning' : 'success';
        const lines = [`${parts.join(' · ')}.`];
        if (filledIn) lines.push(`${filledIn}. Check it, then press Save.`);
        notify(type, 'Attendance filled in', lines, details, 20000);
        document.querySelector('.eis-row-unknown')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    // --- Page controls ----------------------------------------------------------

    function addButtons() {
        const actionBar = document.querySelector('.record_actions');
        if (!actionBar || document.getElementById('eis-paste-btn')) return;

        // type="button": inside EIS's form a plain <button> would submit it.
        const make = (id, className, icon, label, title, onClick) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = id;
            button.className = `btn ${className} eis-import-btn stando-eis-btn`;
            button.title = title;
            button.innerHTML = `<i class="fa ${icon}" aria-hidden="true"></i> `;
            button.append(label);
            button.addEventListener('click', event => { event.preventDefault(); onClick(); });
            return button;
        };

        const paste = make('eis-paste-btn', 'btn-success', 'fa-clipboard', 'Paste from Stando',
            'Fill the form with the attendance Stando copied', pasteImport);
        const file = make('eis-import-btn', 'btn-info', 'fa-upload', 'Import file',
            'Fill the form from a file saved with Stando (or drop the file on the page)', fileImport);
        // Before the first button, not the first node: whitespace there would show as a gap.
        actionBar.insertBefore(paste, actionBar.firstElementChild);
        actionBar.insertBefore(file, paste.nextSibling);
    }

    function applyStyles() {
        if (document.getElementById('eis-importer-styles')) return;
        const style = document.createElement('style');
        style.id = 'eis-importer-styles';
        style.textContent = `
            /* Stando's buttons join EIS's own bar: no gaps, and square corners where
               two buttons meet (both scripts carry this rule, either may run alone). */
            .record_actions > .stando-eis-btn { margin: 0 !important; }
            .record_actions > .stando-eis-btn:not(:first-child) { border-top-left-radius: 0; border-bottom-left-radius: 0; }
            .record_actions > .stando-eis-btn:not(:last-child) { border-top-right-radius: 0; border-bottom-right-radius: 0; }
            .record_actions > .stando-eis-btn + :not(.stando-eis-btn) { margin-left: 0 !important; border-top-left-radius: 0; border-bottom-left-radius: 0; }
            #student_list_table tr.eis-row-filled > td { animation: eis-flash 1.4s ease-in-out; }
            #student_list_table tr.eis-row-unknown > td { background-color: #fff3e0 !important; }
            .eis-dark-mode #student_list_table tr.eis-row-unknown > td { background-color: #4e3410 !important; }
            @keyframes eis-flash { 50% { background-color: rgba(57, 73, 171, 0.18); } }

            .eis-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center;
                justify-content: center; padding: 16px; background: rgba(15, 23, 42, 0.55); }
            .eis-panel { min-width: 260px; max-width: 460px; padding: 22px 24px; border-radius: 16px;
                background: #fff; color: #263238; box-shadow: 0 12px 32px rgba(0,0,0,0.3); font-size: 14px; }
            .eis-panel textarea { width: 100%; height: 120px; margin: 10px 0; padding: 8px; box-sizing: border-box;
                border: 1px solid #cfd8dc; border-radius: 8px; font: 12px monospace; }
            .eis-panel-actions { display: flex; justify-content: flex-end; gap: 8px; }
            .eis-loading { display: flex; align-items: center; gap: 14px; }
            .eis-spinner { width: 22px; height: 22px; flex: none; border: 3px solid #c5cae9;
                border-top-color: #3949ab; border-radius: 50%; animation: eis-spin 0.8s linear infinite; }
            @keyframes eis-spin { to { transform: rotate(360deg); } }

            /* A file dragged over the page: where it goes. */
            .eis-drop { position: fixed; inset: 12px; z-index: 10002; display: flex; align-items: center;
                justify-content: center; border: 2px dashed #3949ab; border-radius: 12px;
                background: rgba(57, 73, 171, 0.10); pointer-events: none; }
            .eis-drop span { padding: 12px 18px; border-radius: 8px; background: #fff; color: #283593;
                font-size: 15px; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,0.16); }

            /* Top left, beside EIS's sidebar and under its header (see placeToasts). */
            .eis-toasts { position: fixed; top: 16px; left: 16px; z-index: 10001; display: flex;
                flex-direction: column; gap: 8px; width: min(360px, calc(100vw - 32px)); }
            /* The coloured edge stays straight: only the corners away from it are rounded. */
            .eis-toast { display: flex; gap: 10px; align-items: flex-start; padding: 12px 12px 12px 14px;
                border-left: 4px solid #3949ab; border-radius: 0 6px 6px 0;
                background: #fff; color: #263238; box-shadow: 0 4px 14px rgba(0,0,0,0.16);
                font-size: 13px; line-height: 1.45; user-select: none; -webkit-user-select: none; }
            .eis-toast-success { border-left-color: #2e7d32; }
            .eis-toast-warning { border-left-color: #ef6c00; }
            .eis-toast-error { border-left-color: #c62828; }
            .eis-toast-body { flex: 1; min-width: 0; }
            .eis-toast-body strong { display: block; margin-bottom: 2px; }
            .eis-toast details { margin-top: 6px; }
            .eis-toast summary { display: flex; align-items: center; gap: 7px; width: max-content;
                list-style: none; cursor: pointer; color: #546e7a; }
            .eis-toast summary::-webkit-details-marker { display: none; }
            /* A small chevron: right when closed, down when open. */
            .eis-toast summary::before { content: ''; width: 5px; height: 5px; margin-top: -1px;
                border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
                transform: rotate(-45deg); transition: transform 0.15s ease; }
            .eis-toast details[open] > summary::before { transform: rotate(45deg); margin-top: -4px; }
            .eis-toast summary:hover { color: #263238; }
            .eis-toast ul { max-height: 160px; overflow: auto; margin: 4px 0 0; padding-left: 30px; }
            /* Only the names can be selected and copied. */
            .eis-toast li { user-select: text; -webkit-user-select: text; cursor: text; }
            .eis-toast-close { border: 0; background: none; color: inherit; font-size: 18px; line-height: 1;
                cursor: pointer; opacity: 0.6; padding: 0 2px; }
            .eis-toast-close:hover { opacity: 1; }

            .eis-dark-mode .eis-panel, .eis-dark-mode .eis-toast { background: #2c2c2e; color: #e0e0e0; }
            .eis-dark-mode .eis-panel textarea { background: #1c1c1e; color: #e0e0e0; border-color: #555; }
            .eis-dark-mode .eis-toast summary { color: #b0bec5; }
            .eis-dark-mode .eis-toast summary:hover { color: #fff; }
            .eis-dark-mode .eis-drop span { background: #2c2c2e; color: #c5cae9; }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    function showLoading(message) {
        let overlay = document.getElementById('eis-loading');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'eis-loading';
            overlay.className = 'eis-overlay';
            overlay.innerHTML = '<div class="eis-panel eis-loading"><span class="eis-spinner"></span><span class="eis-loading-text"></span></div>';
            document.body.appendChild(overlay);
        }
        overlay.querySelector('.eis-loading-text').textContent = message;
    }

    function hideLoading() {
        document.getElementById('eis-loading')?.remove();
    }

    // Without clipboard access: paste by hand. Pasting Stando's data imports it
    // at once; Ctrl+Enter imports what was typed. Resolves null when cancelled.
    function askForText() {
        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.className = 'eis-overlay';
            overlay.innerHTML = `
                <div class="eis-panel" role="dialog" aria-modal="true" aria-label="Paste from Stando">
                    <strong>Paste from Stando</strong>
                    <div>The browser did not allow reading the clipboard. Paste here (Ctrl+V):</div>
                    <textarea spellcheck="false"></textarea>
                    <div class="eis-panel-actions">
                        <button type="button" class="btn btn-default" data-action="cancel">Cancel</button>
                        <button type="button" class="btn btn-success" data-action="ok">Import</button>
                    </div>
                </div>`;
            const textarea = overlay.querySelector('textarea');
            const close = value => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(value); };
            const onKey = event => { if (event.key === 'Escape') close(null); };
            textarea.addEventListener('paste', event => {
                const text = event.clipboardData?.getData('text') || '';
                if (looksLikeStando(text)) {
                    event.preventDefault();
                    close(text);
                }
            });
            textarea.addEventListener('keydown', event => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    close(textarea.value);
                }
            });
            overlay.querySelector('[data-action="cancel"]').onclick = () => close(null);
            overlay.querySelector('[data-action="ok"]').onclick = () => close(textarea.value);
            overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });
            document.addEventListener('keydown', onKey, true);
            document.body.appendChild(overlay);
            textarea.focus();
        });
    }

    // The toasts' corner: right of a left sidebar and under a header that is in
    // view, so they cover neither (EIS's theme names them differently over time).
    function placeToasts(container) {
        const gap = 16;
        let left = gap;
        let top = gap;
        const visible = el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden' ? rect : null;
        };
        document.querySelectorAll('.page-sidebar, .page-sidebar-wrapper, .main-sidebar, .sidebar, #sidebar, aside').forEach(el => {
            const rect = visible(el);
            if (rect && rect.left <= 10 && rect.width < window.innerWidth / 2 && rect.bottom > 100) left = Math.max(left, rect.right + gap);
        });
        document.querySelectorAll('.page-header, .main-header, .navbar-fixed-top, header, .navbar').forEach(el => {
            const rect = visible(el);
            if (rect && rect.top <= 5 && rect.bottom > 0 && rect.width > window.innerWidth / 2) top = Math.max(top, rect.bottom + gap);
        });
        container.style.left = `${Math.min(left, Math.max(gap, window.innerWidth - container.offsetWidth - gap))}px`;
        container.style.top = `${top}px`;
    }

    // A toast; message is a line or a list of lines, details are
    // [{ title, names: [] }] shown as collapsible lists.
    function notify(type, title, message, details = [], timeout = type === 'error' ? 15000 : 8000) {
        let container = document.getElementById('eis-toasts');
        if (!container) {
            container = document.createElement('div');
            container.id = 'eis-toasts';
            container.className = 'eis-toasts';
            container.setAttribute('aria-live', 'polite');
            document.body.appendChild(container);
            let frame = 0;
            const replace = () => {
                if (frame) return;
                frame = requestAnimationFrame(() => { frame = 0; placeToasts(container); });
            };
            window.addEventListener('resize', replace);
            window.addEventListener('scroll', replace, { passive: true });
        }
        placeToasts(container);
        const toast = document.createElement('div');
        toast.className = `eis-toast eis-toast-${type}`;
        const body = document.createElement('div');
        body.className = 'eis-toast-body';
        const heading = document.createElement('strong');
        heading.textContent = title;
        body.append(heading);
        [].concat(message).forEach(line => {
            const text = document.createElement('div');
            text.textContent = line;
            body.appendChild(text);
        });
        details.forEach(group => {
            const block = document.createElement('details');
            const summary = document.createElement('summary');
            summary.textContent = group.title;
            const list = document.createElement('ul');
            group.names.forEach(name => {
                const item = document.createElement('li');
                item.textContent = name;
                list.appendChild(item);
            });
            block.append(summary, list);
            body.appendChild(block);
        });
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'eis-toast-close';
        close.setAttribute('aria-label', 'Dismiss');
        close.textContent = '×';
        close.onclick = () => toast.remove();
        toast.append(body, close);
        container.appendChild(toast);

        // Stays while the pointer is on it or a list is open.
        let timer;
        const arm = () => { clearTimeout(timer); timer = setTimeout(() => toast.remove(), timeout); };
        toast.addEventListener('mouseenter', () => clearTimeout(timer));
        toast.addEventListener('mouseleave', () => { if (!toast.querySelector('details[open]')) arm(); });
        toast.addEventListener('toggle', () => clearTimeout(timer), true);
        arm();
    }
})();
