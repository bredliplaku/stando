// ==UserScript==
// @name         EIS Attendance Sheet Generator
// @namespace    https://bredliplaku.com/
// @version      3.0
// @description  Generates attendance sheet that perfectly matches the original template with customizable fields
// @author       Bredli Plaku
// @match        https://eis.epoka.edu.al/courseattendance/*/editcl
// @match        https://eis.epoka.edu.al/courseattendance/*/newcl
// @updateURL    https://github.com/bredliplaku/stando/raw/refs/heads/main/extensions/form_generator.user.js
// @downloadURL  https://github.com/bredliplaku/stando/raw/refs/heads/main/extensions/form_generator.user.js
// @icon         https://raw.githubusercontent.com/bredliplaku/stando/refs/heads/main/miscellaneous/EPOKA_icon.png
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    "use strict";

    // Five hour columns, as on the paper template.
    const DATE_COLUMNS = 5;

    // Titles in the order they are offered. A lecturer's EIS name may begin with
    // one; TITLE_PATTERNS recognise it so it is not printed twice.
    const TITLES = [
        "Lecturer Prof. Dr.",
        "Lecturer Assoc. Prof. Dr.",
        "Lecturer Dr.",
        "Lecturer",
        "Assistant Lecturer",
    ];
    const TITLE_PATTERNS = [
        [/^(?:Lecturer\s+)?Assoc\.?\s*Prof\.?\s*Dr\.?\s*/i, "Lecturer Assoc. Prof. Dr."],
        [/^(?:Lecturer\s+)?Prof\.?\s*Dr\.?\s*/i, "Lecturer Prof. Dr."],
        [/^(?:Lecturer\s+)?Dr\.?\s+/i, "Lecturer Dr."],
        [/^Assistant\s+Lecturer(?:\s+M\.?\s?Sc\.?)?\s*/i, "Assistant Lecturer"],
        [/^Lecturer(?:\s+M\.?\s?Sc\.?)?\s+/i, "Lecturer"],
    ];

    const MARKS = [
        { value: "checkmarks", label: "Checkmarks (✓)", symbol: "✓" },
        { value: "pluses", label: "Pluses (+)", symbol: "+" },
        { value: "crosses", label: "Crosses (✗)", symbol: "✗" },
        { value: "filled_circles", label: "Filled circles (●)", symbol: "●" },
        { value: "names", label: "Student names", symbol: "" },
    ];

    const SIGNATURE_FONTS = [
        { name: "Great Vibes", value: "font-great-vibes", family: "Great Vibes" },
        { name: "Courgette", value: "font-courgette", family: "Courgette" },
        { name: "Playball", value: "font-playball", family: "Playball" },
        { name: "Dancing Script", value: "font-dancing-script", family: "Dancing Script" },
        { name: "Pacifico", value: "font-pacifico", family: "Pacifico" },
        { name: "Satisfy", value: "font-satisfy", family: "Satisfy" },
        { name: "Sacramento", value: "font-sacramento", family: "Sacramento" },
        { name: "Yellowtail", value: "font-yellowtail", family: "Yellowtail" },
        { name: "Homemade Apple", value: "font-homemade-apple", family: "Homemade Apple" },
        { name: "Caveat", value: "font-caveat", family: "Caveat" },
        { name: "Indie Flower", value: "font-indie-flower", family: "Indie Flower" },
        { name: "Kalam", value: "font-kalam", family: "Kalam" },
        { name: "Shadows Into Light", value: "font-shadows-into-light", family: "Shadows Into Light" },
    ];

    const STORE = {
        display: "EIS_attendance_display_type",
        font: "EIS_attendance_font_type",
        // Lecturers per course, in the order they sign. The older key was printed
        // sorted by title; it is read once and kept in that order.
        signers: key => `EIS_attendance_signers_${key}`,
        legacySigners: key => `EIS_attendance_sigs_${key}`,
    };

    const store = {
        get(key, fallback = null) {
            try {
                const value = localStorage.getItem(key);
                return value === null ? fallback : value;
            } catch {
                return fallback;
            }
        },
        getJson(key, fallback = null) {
            try {
                return JSON.parse(store.get(key)) ?? fallback;
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
            } catch { /* Not remembered. */ }
        },
    };

    const escapeHtml = value => String(value ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    function isPresentCellText(text) {
        return /^(?:✓|✔|P|Present)$/i.test(String(text).trim());
    }

    GM_addStyle(`
        /* ---------- The window around the sheet ----------
           Like the importer's notices and EIS itself: white, a straight coloured
           edge on the left with only the other corners rounded, EIS's own buttons
           (btn) and fields (form-control), and chevrons on what folds. */
        #attendance-sheet-container {
            position: fixed;
            inset: 0;
            z-index: 9999;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
            box-sizing: border-box;
            background-color: rgba(15, 23, 42, 0.55);
        }

        #attendance-sheet-content {
            position: relative;
            width: 860px;
            max-width: 100%;
            max-height: calc(100vh - 40px);
            overflow: auto;
            box-sizing: border-box;
            padding: 0 24px 24px;
            border-left: 4px solid #3949ab;
            border-radius: 0 6px 6px 0;
            background-color: #ffffff;
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
            color: #263238;
            font-size: 13px;
            line-height: 1.45;
        }

        #attendance-sheet-content *,
        #attendance-sheet-content *::before,
        #attendance-sheet-content *::after {
            box-sizing: border-box;
        }

        #sheet-controls {
            position: sticky;
            top: 0;
            z-index: 2;
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0 -24px 14px;
            padding: 12px 14px 12px 24px;
            border-bottom: 1px solid #e5e9ec;
            background: #fff;
            user-select: none;
        }

        #sheet-controls h2 {
            flex: 1;
            margin: 0;
            color: #263238;
            font-size: 15px;
            font-weight: 700;
            line-height: 1.3;
        }

        #sheet-controls .btn {
            margin: 0;
        }

        .asg-icon-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: none;
            width: 28px;
            height: 28px;
            margin: 0;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: #78909c;
            font-size: 13px;
            line-height: 1;
            cursor: pointer;
        }

        .asg-icon-btn:hover:not(:disabled) { background: #eceff1; color: #263238; }
        .asg-icon-btn.is-danger:hover:not(:disabled) { background: #ffebee; color: #c62828; }
        .asg-icon-btn:disabled { opacity: 0.3; cursor: default; }
        .asg-icon-btn:focus-visible { outline: 2px solid #3949ab; outline-offset: 1px; }
        #close-sheet-btn { width: 32px; height: 32px; font-size: 20px; }

        /* ---------- Settings ---------- */
        #config-panel {
            margin: 0 0 22px;
            user-select: none;
        }

        /* Folding sections: a chevron, right when closed and down when open. */
        #config-panel details > summary {
            display: flex;
            align-items: center;
            gap: 8px;
            width: max-content;
            margin: 0;
            list-style: none;
            color: #546e7a;
            font-weight: 600;
            cursor: pointer;
        }

        #config-panel details > summary::-webkit-details-marker { display: none; }

        #config-panel details > summary::before {
            content: "";
            width: 6px;
            height: 6px;
            margin-top: -1px;
            border-right: 1.5px solid currentColor;
            border-bottom: 1.5px solid currentColor;
            transform: rotate(-45deg);
            transition: transform 0.15s ease;
        }

        #config-panel details[open] > summary::before {
            margin-top: -4px;
            transform: rotate(45deg);
        }

        #config-panel details > summary:hover { color: #263238; }

        .asg-section + .asg-section {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid #eef1f3;
        }

        .asg-section > summary + * {
            margin-top: 10px;
        }

        .asg-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
            gap: 10px 12px;
        }

        .asg-grid + details {
            margin-top: 10px;
        }

        details > .asg-grid {
            margin-top: 8px;
        }

        #config-panel .asg-field {
            display: flex;
            flex-direction: column;
            gap: 3px;
            min-width: 0;
            max-width: none;
            margin: 0;
            font-weight: normal;
        }

        #config-panel .asg-field[hidden] {
            display: none;
        }

        #config-panel .asg-field > span {
            color: #546e7a;
            font-size: 12px;
            font-weight: 600;
        }

        #config-panel .form-control {
            width: 100%;
            margin: 0;
        }

        #signatures-container {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .signature-item {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 0;
        }

        .signature-item .asg-order {
            flex: none;
            width: 16px;
            color: #90a4ae;
            font-size: 12px;
            font-weight: 600;
            text-align: right;
        }

        #config-panel .signature-item select { flex: 0 0 190px; width: 190px; }
        #config-panel .signature-item input { flex: 1 1 auto; width: auto; min-width: 0; }

        #add-signature-btn {
            margin: 8px 0 0 22px;
        }

        @media (max-width: 640px) {
            #config-panel .signature-item { flex-wrap: wrap; }
            #config-panel .signature-item select { flex: 1 1 calc(100% - 22px); width: auto; }
        }

        /* Stando's buttons join EIS's own bar: no gaps, and square corners where
           two buttons meet (both scripts carry this rule, either may run alone). */
        .record_actions > .stando-eis-btn { margin: 0 !important; }
        .record_actions > .stando-eis-btn:not(:first-child) { border-top-left-radius: 0; border-bottom-left-radius: 0; }
        .record_actions > .stando-eis-btn:not(:last-child) { border-top-right-radius: 0; border-bottom-right-radius: 0; }
        .record_actions > .stando-eis-btn + :not(.stando-eis-btn) { margin-left: 0 !important; border-top-left-radius: 0; border-bottom-left-radius: 0; }

        /* ---------- The sheet: the paper template ---------- */
        #attendance-sheet-page,
        #attendance-sheet-page *:not(.student-signature) {
            font-family: Verdana, Geneva, sans-serif !important;
        }

        .sheet-header {
            margin-bottom: 8px;
        }

        .sheet-header h2 {
            font-size: 16px;
            margin: 5px 0;
            font-weight: 700 !important;
            color: #000;
            text-align: left;
        }

        .sheet-header h3 {
            font-size: 18px;
            margin: 25px 0 15px 0;
            font-weight: 700 !important;
            color: #000;
            text-align: center;
            text-transform: uppercase;
        }

        .sheet-header h4 {
            font-size: 12px;
            margin: 5px 0;
            font-weight: 700 !important;
            color: #000;
            text-align: left;
        }

        .header-flex {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
        }

        .sheet-header p {
            margin: 0;
            text-align: right;
            color: #000;
            white-space: nowrap;
        }

        #printed-date-display {
            font-size: 11px !important;
        }

        .attendance-table {
            border-collapse: collapse;
            width: 100%;
            margin-top: 4px;
            table-layout: fixed;
        }

        .attendance-table th, .attendance-table td {
            border: 1px solid #000;
            padding: 5px 2px;
            text-align: center;
            vertical-align: middle;
            height: 22px;
            font-size: 11px;
            overflow: hidden;
            color: #000;
            background-color: #fff;
        }

        .attendance-table th { font-weight: bold; }
        .attendance-table th.date-column { font-weight: normal; }
        .attendance-table th:nth-child(1) { width: 30px; }
        .attendance-table th:nth-child(2) { width: 25px; }
        .attendance-table th:nth-child(3) { width: 75px; }
        .attendance-table th:nth-child(4) { width: 140px; }
        .attendance-table th:nth-child(n+5):nth-child(-n+9) { width: 70px; }
        .attendance-table th:nth-child(10) { width: 25px; }

        .attendance-table td:nth-child(1) {
            text-align: right;
            padding-right: 5px;
        }

        .attendance-table :is(.name-cell, .id-cell) {
            text-align: left;
            padding-left: 10px;
            font-weight: normal;
        }

        .student-signature {
            font-size: 14px;
            color: #00008b;
            font-weight: 400;
            white-space: nowrap;
            overflow: hidden;
        }

        .student-checkmark {
            font-size: 12px;
            color: #00008b;
            font-weight: bold;
        }

        ${SIGNATURE_FONTS.map(font => `.${font.value} { font-family: '${font.family}', cursive !important; }`).join("\n        ")}

        .footer-note {
            margin-top: 12px;
            font-size: 10px;
            color: #000;
            text-align: left;
        }

        .footer-note p {
            margin: 0 0 10px;
        }

        .signature-line {
            margin-top: 15px;
            text-align: right;
            color: #000;
        }

        .signature-line .signer {
            margin-bottom: 40px;
        }

        .signature-line .signer p {
            margin: 0 0 2px;
            font-size: 14px;
            font-weight: bold;
        }

        .signature-line .signer small {
            font-size: 11px;
            font-style: italic;
        }

        @media print {
            @page {
                size: A4 portrait;
                margin: 12mm 8mm 8mm 8mm;
            }

            *, *::before, *::after {
                box-sizing: border-box !important;
            }

            html, body {
                width: 794px !important;
                min-width: 794px !important;
                max-width: 794px !important;
                height: auto !important;
                margin: 0 !important;
                padding: 0 !important;
                background-color: white !important;
            }

            body > * {
                display: none !important;
            }

            body > #attendance-sheet-container {
                display: block !important;
                position: absolute !important;
                inset: 0 auto auto 0 !important;
                width: 794px !important;
                height: auto !important;
                margin: 0 !important;
                padding: 0 !important;
                background: transparent !important;
                backdrop-filter: none !important;
            }

            #attendance-sheet-content {
                display: block !important;
                width: 750px !important;
                min-width: 750px !important;
                max-width: 750px !important;
                height: auto !important;
                max-height: none !important;
                margin: 0 auto !important;
                padding: 15px 0 !important;
                border: none !important;
                border-radius: 0 !important;
                background-color: white !important;
                box-shadow: none !important;
                overflow: visible !important;
            }

            #sheet-controls, #config-panel {
                display: none !important;
            }

            .attendance-table tr {
                page-break-inside: avoid !important;
            }

            .attendance-table thead {
                display: table-header-group !important;
            }
        }
    `);

    // The signature fonts load the first time a sheet opens, not on every EIS page.
    function loadSignatureFonts() {
        if (document.getElementById("asg-signature-fonts")) return;
        const link = document.createElement("link");
        link.id = "asg-signature-fonts";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?" +
            SIGNATURE_FONTS.map(font => "family=" + font.family.replace(/ /g, "+")).join("&") + "&display=swap";
        document.head.appendChild(link);
    }

    // ---------------------------------------------------------------------------
    // Reading EIS
    // ---------------------------------------------------------------------------

    // Matches a standalone EIS status badge such as "Finalized" / "Finalised" /
    // "Not Finalized", optionally bracketed.
    const STATUS_BADGE_RE =
        /^[([{]?\s*(?:not\s+|non[-\s]?)?finali[sz](?:ed|ing|ation)\s*[)\]}]?$/i;

    // Strip the "Finalized"/"Finalised" status word EIS appends to a closed course.
    // Only removes it when it trails the text (optionally wrapped in brackets or
    // preceded by a separator), so a course actually named e.g. "Finalized Design"
    // keeps its word.
    function stripFinalizedStatus(text) {
        const cleaned = text
            .replace(
                /\s*[-–—|,:;/]?\s*[([{]?\s*(?:not\s+|non[-\s]?)?finali[sz](?:ed|ing|ation)\s*[)\]}]?\s*$/i,
                "",
            )
            .replace(/[\s\-–—|,:;/]+$/, "")
            .trim();
        // Never let the cleanup swallow the whole value
        return cleaned || text.trim();
    }

    // Read an element's text with EIS status badges removed. Works on a clone so
    // the page itself is never modified.
    function getCourseText(elem) {
        if (!elem) return "";

        const clone = elem.cloneNode(true);
        clone
            .querySelectorAll("span, small, label, i, em, sup, .label, .badge")
            .forEach((el) => {
                if (STATUS_BADGE_RE.test(el.textContent.replace(/\s+/g, " ").trim())) {
                    el.remove();
                }
            });

        // Fallback for pages where the status is plain text rather than a badge
        return stripFinalizedStatus(clone.textContent.replace(/\s+/g, " ").trim());
    }

    // The value beside one of these labels in the attendance details list.
    function detailText(...labels) {
        for (const li of document.querySelectorAll(".attendance-details li")) {
            const label = li.querySelector(".label-cont")?.textContent?.trim();
            if (labels.includes(label)) return li.querySelector(".text-cont")?.textContent?.trim() || "";
        }
        return "";
    }

    function hasRLabel(studentNameCell, row) {
        if (studentNameCell.querySelector(".label-warning") !== null) return true;
        if (row.querySelector('td[data-repeated="R"]') !== null) return true;
        const text = studentNameCell.textContent.trim();
        return text.includes(" R ") || text.endsWith(" R") || text.includes("(R)");
    }

    function hasExLabel(studentNameCell, row) {
        if (studentNameCell.querySelector(".label-info") !== null) return true;
        if (row.querySelector('td[data-exempted="EX"]') !== null) return true;
        const text = studentNameCell.textContent.trim();
        return text.includes(" EX ") || text.endsWith(" EX") || text.includes("(EX)");
    }

    // "2026-10-15" or "15.10.2026" → "2026-10-15"; anything else → "".
    function toIsoDate(text) {
        let match = String(text).match(/(\d{4})-(\d{2})-(\d{2})/);
        if (match) return `${match[1]}-${match[2]}-${match[3]}`;
        match = String(text).match(/(\d{2})\.(\d{2})\.(\d{4})/);
        if (match) return `${match[3]}-${match[2]}-${match[1]}`;
        return "";
    }

    // The lecturer's EIS name as a title and a name, e.g.
    // "Assistant Lecturer M.Sc. Bredli Plaku" → "Assistant Lecturer", "Bredli Plaku".
    function splitTitle(fullName) {
        const text = String(fullName || "").replace(/\s+/g, " ").trim();
        for (const [pattern, title] of TITLE_PATTERNS) {
            if (pattern.test(text)) return { title, name: text.replace(pattern, "").trim() };
        }
        return { title: "Assistant Lecturer", name: text };
    }

    function extractAttendanceData() {
        const data = {
            courseTitle: "",
            storageKey: "",
            isoDate: "",
            students: [],
            totalHours: 1,
            username: document.querySelector(".username")?.textContent?.trim() || "",
        };

        // Course code, name, category and group.
        const courseName = getCourseText(document.querySelector(".course h4")) || "Attendance Sheet";
        // The caption carries the "Finalized" badge on closed courses; by design the
        // title shows both the caption code and the full heading, e.g.
        // "CEN / MTH 102 - MTH 102 CALCULUS II 2025".
        const courseCode = getCourseText(document.querySelector(".course .caption"));

        const category = detailText("Category");
        const group = detailText("Group");
        let formattedCategory = "";
        if (category && category.toUpperCase() !== "ALL") {
            formattedCategory = " - " + category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
            if (group && group.toUpperCase() !== "ALL") formattedCategory += " " + group;
        }

        data.courseTitle = (courseCode ? courseCode + " - " : "") + courseName + formattedCategory;
        data.storageKey = (courseCode ? courseCode + "_" + courseName : courseName).replace(/[^a-z0-9]/gi, "_");

        data.isoDate = toIsoDate(detailText("Date")) || formatDate(new Date(), "iso");

        const hoursText = detailText("Nr. of Hours", "Num. of Hours") ||
            document.querySelector(".attendance-details li:nth-child(5) .text-cont")?.textContent || "";
        const hours = parseInt(hoursText, 10);
        if (!isNaN(hours) && hours > 0) data.totalHours = hours;

        // Students and their hours, in editable and locked (view) pages alike.
        const rows = document.querySelectorAll("#student_list_table tbody tr");
        rows.forEach((row, index) => {
            const studentId = row.querySelector("td:nth-child(2)")?.textContent?.trim();
            const studentNameCell = row.querySelector("td:nth-child(3)");
            if (!studentId || !studentNameCell) return;

            // Only suffixes at the very end are removed, so names like "Alexander" stay whole.
            const cleanName = studentNameCell.textContent.trim()
                .replace(/\s+R\s+EX$/, "")
                .replace(/\s+\(EX\)$/, "")
                .replace(/\s+EX$/, "")
                .replace(/\s+R$/, "")
                .replace(/\s+\(R\)$/, "")
                .replace(/\s+/g, " ")
                .trim();
            if (!cleanName) return;

            data.students.push({
                id: studentId,
                name: cleanName,
                repeated: hasRLabel(studentNameCell, row),
                exempt: hasExLabel(studentNameCell, row),
                index: index + 1,
                fontClass: SIGNATURE_FONTS[Math.floor(Math.random() * SIGNATURE_FONTS.length)].value,
                attendance: readRowAttendance(row, data.totalHours),
            });
        });

        return data;
    }

    function readRowAttendance(row, totalHours) {
        const attended = Array(totalHours).fill(false);
        const checkElements = row.querySelectorAll(
            '.checkboxes_row_td input[type="checkbox"], .checkboxes.pull-left, input.checkboxes, .checkboxes_row_td i.fa-check-square, .checkboxes_row_td i.fa-square, .checkboxes_row_td i.fa-check-square-o, .checkboxes_row_td i.fa-square-o',
        );

        if (checkElements.length >= totalHours) {
            // The first checkbox ticks the whole row when there is one more than hours.
            const start = checkElements.length > totalHours ? 1 : 0;
            for (let i = 0; i < totalHours; i++) {
                const el = checkElements[start + i];
                attended[i] = !!el && (el.checked ||
                    el.classList.contains("fa-check-square-o") ||
                    el.classList.contains("fa-check-square") ||
                    el.classList.contains("fa-check"));
            }
            return attended;
        }

        const hiddenChecked = row.querySelector('input[name^="stdabsences"][name$="[checked]"]');
        if (hiddenChecked) {
            hiddenChecked.value.split(",").forEach(value => {
                const hour = parseInt(value, 10) - 1;
                if (hour >= 0 && hour < totalHours) attended[hour] = true;
            });
            return attended;
        }

        // View mode: icons or text in the hour cells.
        const cells = Array.from(row.querySelectorAll("td")).slice(4);
        for (let i = 0; i < totalHours && i < cells.length; i++) {
            const cell = cells[i];
            attended[i] = !!cell.querySelector(".fa-check-square-o, .fa-check-square, .fa-check") ||
                isPresentCellText(cell.textContent);
        }
        return attended;
    }

    // ---------------------------------------------------------------------------
    // The sheet window
    // ---------------------------------------------------------------------------

    function addAttendanceButton() {
        const actionBar = document.querySelector(".record_actions");
        if (!actionBar || document.getElementById("attendance-btn")) return;

        const button = document.createElement("button");
        // type="button": inside EIS's form a plain <button> would submit it.
        button.type = "button";
        button.id = "attendance-btn";
        button.className = "btn btn-info stando-eis-btn";
        button.innerHTML = '<i class="fa fa-table" aria-hidden="true"></i> Generate Attendance Sheet';
        button.addEventListener("click", event => {
            event.preventDefault();
            generateAttendanceSheet();
        });

        // Before the first button, not the first node: whitespace there would show as a gap.
        actionBar.insertBefore(button, actionBar.firstElementChild);
    }

    function loadSigners(data) {
        const saved = store.getJson(STORE.signers(data.storageKey));
        if (Array.isArray(saved) && saved.length) return saved;

        // The older list, printed sorted by title: keep that order.
        const legacy = store.getJson(STORE.legacySigners(data.storageKey));
        if (Array.isArray(legacy) && legacy.length) {
            const rank = title => {
                const i = TITLES.indexOf(title);
                return i < 0 ? 99 : i;
            };
            return [...legacy].sort((a, b) => rank(a.title) - rank(b.title) || String(a.name).localeCompare(String(b.name)));
        }

        return [splitTitle(data.username)];
    }

    function generateAttendanceSheet() {
        const data = extractAttendanceData();
        if (data.students.length === 0) {
            alert("No students found. Open an attendance page with its student list first.");
            return;
        }
        console.log("[Attendance sheet] Extracted:", data);
        loadSignatureFonts();

        // Opening again replaces the open sheet.
        document.getElementById("attendance-sheet-container")?.remove();

        const savedDisplay = store.get(STORE.display, "checkmarks");
        const savedFont = store.get(STORE.font, "random");
        const state = {
            display: MARKS.some(m => m.value === savedDisplay) ? savedDisplay : "checkmarks",
            font: savedFont === "random" || SIGNATURE_FONTS.some(f => f.value === savedFont) ? savedFont : "random",
            printedDate: formatDate(new Date(), "iso"),
            dates: Array(Math.min(data.totalHours, DATE_COLUMNS)).fill(data.isoDate),
            signers: loadSigners(data).map(s => ({ title: TITLES.includes(s.title) ? s.title : "Lecturer", name: String(s.name || "") })),
        };

        const container = document.createElement("div");
        container.id = "attendance-sheet-container";
        container.innerHTML = `
            <div id="attendance-sheet-content" role="dialog" aria-modal="true" aria-labelledby="asg-title">
                <div id="sheet-controls">
                    <h2 id="asg-title">Attendance sheet</h2>
                    <button type="button" id="print-sheet-btn" class="btn btn-success btn-sm"><i class="fa fa-print" aria-hidden="true"></i> Print PDF</button>
                    <button type="button" id="close-sheet-btn" class="asg-icon-btn" title="Close (Esc)" aria-label="Close">&times;</button>
                </div>

                <div id="config-panel">
                    <details class="asg-section" open>
                    <summary>Sheet</summary>
                    <div class="asg-grid">
                        <label class="asg-field"><span>Marks</span>
                            <select id="signature-display-select" class="form-control input-sm">
                                ${MARKS.map(m => `<option value="${m.value}">${escapeHtml(m.label)}</option>`).join("")}
                            </select>
                        </label>
                        <label class="asg-field" id="signature-font-row"><span>Signature font</span>
                            <select id="signature-font-select" class="form-control input-sm">
                                <option value="random">Random per student</option>
                                ${SIGNATURE_FONTS.map(f => `<option value="${f.value}">${escapeHtml(f.name)}</option>`).join("")}
                            </select>
                        </label>
                        <label class="asg-field"><span>Class date</span>
                            <input type="date" id="all-dates-input" class="form-control input-sm">
                        </label>
                        <label class="asg-field"><span>Printed on</span>
                            <input type="date" id="printed-date-input" class="form-control input-sm">
                        </label>
                    </div>
                    ${state.dates.length > 1 ? `
                    <details>
                        <summary>A different date for each hour</summary>
                        <div class="asg-grid">
                            ${state.dates.map((_, i) => `
                            <label class="asg-field"><span>Hour ${i + 1}</span>
                                <input type="date" class="form-control input-sm single-date-input" data-index="${i}">
                            </label>`).join("")}
                        </div>
                    </details>` : ""}
                    </details>

                    <details class="asg-section" open>
                    <summary>Lecturers, in the order they sign</summary>
                    <div>
                        <ol id="signatures-container"></ol>
                        <button type="button" id="add-signature-btn" class="btn btn-default btn-sm"><i class="fa fa-plus" aria-hidden="true"></i> Add lecturer</button>
                    </div>
                    </details>
                </div>

                <div id="attendance-sheet-page">
                    <div class="sheet-header">
                        <h2>Epoka University</h2>
                        <h2>Faculty of Architecture and Engineering</h2>
                        <h3>ATTENDANCE LIST</h3>
                        <div class="header-flex">
                            <h4>${escapeHtml(data.courseTitle)}</h4>
                            <p id="printed-date-display"></p>
                        </div>
                    </div>
                    <table class="attendance-table">
                        <thead><tr>
                            <th>No.</th><th>R</th><th>Student ID</th><th>Name Surname</th>
                            ${Array.from({ length: DATE_COLUMNS }, (_, i) => `<th class="date-column" data-index="${i}"></th>`).join("")}
                            <th>EX</th>
                        </tr></thead>
                        <tbody>
                            ${data.students.map(student => `
                            <tr>
                                <td>${student.index}</td>
                                <td>${student.repeated ? "R" : ""}</td>
                                <td class="id-cell">${escapeHtml(student.id)}</td>
                                <td class="name-cell">${escapeHtml(student.name)}</td>
                                ${Array.from({ length: DATE_COLUMNS }, (_, i) => `<td class="mark-cell" data-present="${student.attendance[i] ? 1 : 0}"></td>`).join("")}
                                <td>${student.exempt ? "EX" : ""}</td>
                            </tr>`).join("")}
                        </tbody>
                    </table>
                    <div class="footer-note">
                        <p><strong>NOTE:</strong></p>
                        <p>Students that are not listed in the attendance list will not be considered as enrolled in the course!</p>
                        <p>All attendance sheets should be delivered to department coordinators by the end of the week after recording the entries electronically through EIS.</p>
                        <p><strong>R</strong> - Repeated Course, <strong>EX</strong> - Exempted from attendances.</p>
                    </div>
                    <div class="signature-line" id="signature-area"></div>
                </div>
            </div>`;
        document.body.appendChild(container);

        const $ = selector => container.querySelector(selector);
        const markRows = Array.from(container.querySelectorAll(".attendance-table tbody tr"));

        // --- Rendering from state ---
        function renderMarks() {
            const mark = MARKS.find(m => m.value === state.display) || MARKS[0];
            markRows.forEach((row, r) => {
                const student = data.students[r];
                const fontClass = state.font === "random" ? student.fontClass : state.font;
                const firstName = student.name.split(" ")[0];
                row.querySelectorAll(".mark-cell").forEach(cell => {
                    if (cell.dataset.present !== "1") return;
                    cell.innerHTML = mark.value === "names"
                        ? `<span class="student-signature ${fontClass}">${escapeHtml(firstName)}</span>`
                        : `<span class="student-checkmark">${mark.symbol}</span>`;
                });
            });
            $("#signature-font-row").hidden = state.display !== "names";
        }

        function renderDates() {
            container.querySelectorAll(".date-column").forEach(th => {
                const i = Number(th.dataset.index);
                if (i >= state.dates.length) {
                    th.textContent = "";
                    return;
                }
                const [y, m, d] = (state.dates[i] || "").split("-");
                th.textContent = d ? `${d}/${m}/${y}` : `__/__/${new Date().getFullYear()}`;
            });
            const allSame = state.dates.every(date => date === state.dates[0]);
            $("#all-dates-input").value = allSame ? state.dates[0] || "" : "";
            container.querySelectorAll(".single-date-input").forEach(input => {
                input.value = state.dates[Number(input.dataset.index)] || "";
            });
        }

        function renderPrintedDate() {
            const [y, m, d] = state.printedDate.split("-");
            $("#printed-date-display").innerHTML = `<i>Printed on:</i> ${d ? `${d}.${m}.${y}` : ""}`;
        }

        function renderSignatureArea() {
            $("#signature-area").innerHTML = state.signers
                .filter(s => s.name.trim())
                .map(s => `
                    <div class="signer">
                        <p>${escapeHtml(`${s.title} ${s.name}`.trim())}</p>
                        <small>(Signature)</small>
                    </div>`).join("");
            store.set(STORE.signers(data.storageKey), state.signers);
        }

        // The editable list; drawn again only when its order or length changes, so
        // typing keeps its focus.
        function renderSignerList(focusIndex = -1, focusSelector = "input") {
            const list = $("#signatures-container");
            const last = state.signers.length - 1;
            list.innerHTML = state.signers.map((s, i) => `
                <li class="signature-item" data-index="${i}">
                    <span class="asg-order">${i + 1}</span>
                    <select class="form-control input-sm" aria-label="Title of lecturer ${i + 1}">
                        ${TITLES.map(t => `<option value="${escapeHtml(t)}"${t === s.title ? " selected" : ""}>${escapeHtml(t)}</option>`).join("")}
                    </select>
                    <input type="text" class="form-control input-sm" value="${escapeHtml(s.name)}" placeholder="Name Surname" aria-label="Name of lecturer ${i + 1}">
                    <button type="button" class="asg-icon-btn" data-move="-1" title="Move up" aria-label="Move up"${i === 0 ? " disabled" : ""}><i class="fa fa-arrow-up" aria-hidden="true"></i></button>
                    <button type="button" class="asg-icon-btn" data-move="1" title="Move down" aria-label="Move down"${i === last ? " disabled" : ""}><i class="fa fa-arrow-down" aria-hidden="true"></i></button>
                    <button type="button" class="asg-icon-btn is-danger" data-remove title="Remove" aria-label="Remove lecturer ${i + 1}"${last === 0 ? " disabled" : ""}><i class="fa fa-times" aria-hidden="true"></i></button>
                </li>`).join("");
            if (focusIndex >= 0) {
                const item = list.querySelector(`[data-index="${focusIndex}"]`);
                (item?.querySelector(`${focusSelector}:not(:disabled)`) || item?.querySelector("input"))?.focus();
            }
            renderSignatureArea();
        }

        // --- Controls ---
        $("#signature-display-select").value = state.display;
        $("#signature-font-select").value = state.font;
        $("#printed-date-input").value = state.printedDate;

        $("#signature-display-select").addEventListener("change", event => {
            state.display = event.target.value;
            store.set(STORE.display, state.display);
            renderMarks();
        });
        $("#signature-font-select").addEventListener("change", event => {
            state.font = event.target.value;
            store.set(STORE.font, state.font);
            renderMarks();
        });
        $("#all-dates-input").addEventListener("change", event => {
            state.dates = state.dates.map(() => event.target.value);
            renderDates();
        });
        container.querySelectorAll(".single-date-input").forEach(input => {
            input.addEventListener("change", () => {
                state.dates[Number(input.dataset.index)] = input.value;
                renderDates();
            });
        });
        $("#printed-date-input").addEventListener("change", event => {
            state.printedDate = event.target.value;
            renderPrintedDate();
        });

        const signerList = $("#signatures-container");
        signerList.addEventListener("input", event => {
            const index = Number(event.target.closest(".signature-item")?.dataset.index);
            if (isNaN(index)) return;
            if (event.target.matches("input")) state.signers[index].name = event.target.value;
            if (event.target.matches("select")) state.signers[index].title = event.target.value;
            renderSignatureArea();
        });
        signerList.addEventListener("click", event => {
            const button = event.target.closest("button");
            const index = Number(button?.closest(".signature-item")?.dataset.index);
            if (!button || isNaN(index)) return;
            if (button.hasAttribute("data-remove")) {
                state.signers.splice(index, 1);
                renderSignerList(Math.min(index, state.signers.length - 1), "select");
            } else {
                const to = index + Number(button.dataset.move);
                if (to < 0 || to >= state.signers.length) return;
                [state.signers[index], state.signers[to]] = [state.signers[to], state.signers[index]];
                renderSignerList(to, `[data-move="${button.dataset.move}"]`);
            }
        });
        $("#add-signature-btn").addEventListener("click", () => {
            state.signers.push({ title: "Lecturer Dr.", name: "" });
            renderSignerList(state.signers.length - 1);
        });

        const close = () => {
            container.remove();
            document.removeEventListener("keydown", onKey, true);
        };
        const onKey = event => {
            if (event.key === "Escape" && !event.target.closest?.("select")) close();
        };
        document.addEventListener("keydown", onKey, true);
        $("#close-sheet-btn").addEventListener("click", close);
        // A click on the dimmed page around the sheet closes it; a press that
        // starts in a field and ends outside (selecting text) does not.
        let pressedOutside = false;
        container.addEventListener("mousedown", event => { pressedOutside = event.target === container; });
        container.addEventListener("click", event => {
            if (pressedOutside && event.target === container) close();
            pressedOutside = false;
        });
        $("#print-sheet-btn").addEventListener("click", () => window.print());

        renderMarks();
        renderDates();
        renderPrintedDate();
        renderSignerList();
        $("#print-sheet-btn").focus();
    }

    // Format date as DD.MM.YYYY or ISO format
    function formatDate(date, format = "regular") {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return format === "iso" ? `${y}-${m}-${d}` : `${d}.${m}.${y}`;
    }

    addAttendanceButton();
})();
