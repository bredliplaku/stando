// ==UserScript==
// @name         EIS Attendance Sheet Generator
// @namespace    https://bredliplaku.com/
// @version      3.1
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

    // The faculty's own PDF (EIS prints it with wkhtmltopdf on A4) has 10 mm
    // margins above and below and about 11.8 mm at the sides, on every page.
    const PAGE_MARGIN = "10mm 11.8mm";

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
        { value: "blank", label: "Nothing (signed by hand)", symbol: "" },
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
           Like EIS itself: white with rounded corners and no coloured edge,
           EIS's own buttons (btn) and fields (form-control), and chevrons on
           what folds. */
        html.asg-open,
        html.asg-open body {
            overflow: hidden !important;
        }

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
            width: 900px;
            max-width: 100%;
            max-height: calc(100vh - 40px);
            overflow: auto;
            overscroll-behavior: contain;
            box-sizing: border-box;
            border-radius: 6px;
            background-color: #ffffff;
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
            color: #263238;
            font-size: 13px;
            line-height: 1.45;
            text-align: left;
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
            padding: 12px 14px 12px 24px;
            border-bottom: 1px solid #e5e9ec;
            background: #fff;
            user-select: none;
        }

        #sheet-controls .asg-heading {
            flex: 1;
            min-width: 0;
        }

        #sheet-controls h2 {
            margin: 0;
            color: #263238;
            font-size: 15px;
            font-weight: 700;
            line-height: 1.3;
        }

        #sheet-controls .asg-summary {
            overflow: hidden;
            color: #78909c;
            font-size: 12px;
            white-space: nowrap;
            text-overflow: ellipsis;
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
        /* No blue focus rings in the window: nothing after a click, and a quiet
           grey ring only when moving with the keyboard. */
        #attendance-sheet-content:focus,
        #attendance-sheet-content :focus {
            outline: none !important;
        }

        #attendance-sheet-content :is(.btn, .asg-icon-btn, summary):focus-visible {
            outline: 2px solid #b0bec5 !important;
            outline-offset: 1px;
        }

        #attendance-sheet-content .form-control:focus {
            border-color: #90a4ae;
            box-shadow: none;
        }
        #close-sheet-btn { width: 32px; height: 32px; font-size: 20px; }

        /* ---------- Settings ---------- */
        #config-panel {
            padding: 16px 24px 18px;
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

        #config-panel .asg-hint {
            margin: 14px 0 0;
            color: #78909c;
            font-size: 12px;
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

        /* ---------- The sheet: the faculty's attendance list ----------
           Sizes are in pt and mm, measured from the PDF EIS itself prints, so the
           preview is the printed page: A4, Times New Roman, 7 mm rows. */
        .asg-desk {
            overflow-x: auto;
            padding: 20px;
            border-top: 1px solid #e5e9ec;
            background: #eceff1;
        }

        #attendance-sheet-page {
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            padding: ${PAGE_MARGIN};
            background: #fff;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), 0 6px 18px rgba(0, 0, 0, 0.08);
            color: #000;
            font-size: 7.2pt;
            font-weight: 400;
            line-height: 1.15;
            text-align: left;
            user-select: text;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        /* EIS gives some tags (p, strong…) fonts and sizes of its own; on the
           sheet, its typeface and sizes win (the handwriting keeps its font). */
        #attendance-sheet-page,
        #attendance-sheet-page *:not(.student-signature) {
            font-family: "Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif !important;
        }

        #attendance-sheet-page * {
            letter-spacing: normal;
            text-transform: none;
        }

        #attendance-sheet-page :is(b, i) {
            font-size: inherit !important;
            line-height: inherit !important;
        }

        #attendance-sheet-page .asg-uni {
            font-size: 11.4pt !important;
            font-weight: 700;
        }

        #attendance-sheet-page .asg-title {
            margin-top: 4.4mm;
            font-size: 14.4pt !important;
            font-weight: 700;
            text-align: center;
        }

        /* The course on the left; the print date over the first date column. */
        .asg-course-row {
            display: flex;
            align-items: baseline;
            margin-top: 6.7mm;
        }

        #attendance-sheet-page .asg-course {
            flex: 0 0 46%;
            padding-left: 0.5mm;
            font-size: 7.8pt !important;
            font-weight: 700;
        }

        #attendance-sheet-page .asg-printed {
            position: relative;
            top: 1mm;
            flex: 1;
            padding-left: 2mm;
            font-size: 6.6pt !important;
        }

        .asg-table {
            width: 100%;
            margin: 2.4mm 0 0;
            border-collapse: collapse;
            border-spacing: 0;
            table-layout: fixed;
            background: #fff;
        }

        .asg-table th,
        .asg-table td {
            height: 7mm;
            padding: 0 1.1mm;
            border: 0.25mm solid #333;
            background: #fff;
            color: #000;
            font-size: 7.2pt !important;
            font-weight: 400;
            line-height: 1.15;
            text-align: center;
            vertical-align: middle;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .asg-table th { font-weight: 700; }
        .asg-table th.date-column { font-weight: 400; }
        .asg-table .col-nr { text-align: right; }
        .asg-table .col-name { text-align: left; }

        /* Marks look written in blue pen, in print too (EIS prints all text black). */
        #attendance-sheet-page .asg-mark {
            color: #00008b !important;
            font-size: 9pt !important;
            font-weight: 700;
            line-height: 1;
        }

        #attendance-sheet-page .student-signature {
            color: #00008b !important;
            font-size: 10pt !important;
            font-weight: 400;
            line-height: 1;
        }

        ${SIGNATURE_FONTS.map(font => `.${font.value} { font-family: '${font.family}', cursive !important; }`).join("\n        ")}

        /* The note and the lecturers: the same Times New Roman at 9.6 pt. */
        #attendance-sheet-page .asg-note,
        #attendance-sheet-page .asg-signers {
            color: #000;
            font-size: 9.6pt !important;
            line-height: 1.15 !important;
        }

        #attendance-sheet-page .asg-note *,
        #attendance-sheet-page .asg-signers * {
            font-size: inherit !important;
            line-height: inherit !important;
        }

        .asg-note {
            margin-top: 4.9mm;
            break-inside: avoid;
        }

        .asg-note-line { margin: 0 0 5.7mm; }
        .asg-note-line:first-child { margin-bottom: 3.5mm; }
        .asg-note-line:last-child { margin-bottom: 0; }
        .asg-note b { font-weight: 700; }

        .asg-signers {
            margin-top: 8.6mm;
            padding-right: 4.3mm;
            font-weight: 700;
            text-align: right;
            break-inside: avoid;
        }

        /* Room to sign under each lecturer before the next one. */
        .asg-signer + .asg-signer { margin-top: 12mm; }
        .asg-signer-sign { margin-top: 1.2mm; font-style: italic; }

        /* ---------- Printing ----------
           Only while the sheet is open, so EIS pages still print as themselves.
           The sheet stays in the page's flow: positioned, it would lose the page
           margins after the first page. */
        @media print {
            html.asg-open,
            html.asg-open body {
                width: auto !important;
                min-width: 0 !important;
                max-width: none !important;
                height: auto !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow: visible !important;
                background: #fff !important;
            }

            html.asg-open body > :not(#attendance-sheet-container) {
                display: none !important;
            }

            html.asg-open #attendance-sheet-container {
                position: static !important;
                display: block !important;
                padding: 0 !important;
                background: none !important;
            }

            html.asg-open #attendance-sheet-content {
                display: block !important;
                width: auto !important;
                max-width: none !important;
                max-height: none !important;
                overflow: visible !important;
                border: 0 !important;
                border-radius: 0 !important;
                box-shadow: none !important;
            }

            html.asg-open #sheet-controls,
            html.asg-open #config-panel {
                display: none !important;
            }

            html.asg-open .asg-desk {
                overflow: visible !important;
                padding: 0 !important;
                border: 0 !important;
                background: none !important;
            }

            html.asg-open #attendance-sheet-page {
                width: auto !important;
                min-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                box-shadow: none !important;
            }

            /* The column headings (and their dates) repeat at the top of every
               page, unlike the faculty's sheet, so each page shows which column is
               which day. */
            #attendance-sheet-page thead { display: table-header-group !important; }
            #attendance-sheet-page tr { break-inside: avoid; page-break-inside: avoid; }
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

    // A form field's value, or the text of a select's chosen option. A new
    // attendance (newcl) keeps its date, category, group and hours in the form.
    function fieldText(id) {
        const field = document.getElementById(id);
        if (!field) return "";
        if (field.tagName === "SELECT") {
            const option = field.options[field.selectedIndex];
            return option && option.value ? option.text.trim() : "";
        }
        return String(field.value || "").trim();
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

    // "2026-10-15", "15.10.2026" or "15/10/2026" → "2026-10-15"; anything else → "".
    function toIsoDate(text) {
        const pad = value => value.padStart(2, "0");
        let match = String(text).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
        match = String(text).match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
        if (match) return `${match[3]}-${pad(match[2])}-${pad(match[1])}`;
        return "";
    }

    // "2026-10-15" → "15.10.2026"
    function isoToDotted(iso) {
        const [y, m, d] = String(iso || "").split("-");
        return d ? `${d}.${m}.${y}` : "";
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

        const category = detailText("Category") || fieldText("didcourseattendance_categoryen");
        const group = detailText("Group") || fieldText("didcourseattendance_section");
        let formattedCategory = "";
        if (category && category.toUpperCase() !== "ALL") {
            formattedCategory = " - " + category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
            if (group && group.toUpperCase() !== "ALL") formattedCategory += " " + group;
        }

        data.courseTitle = (courseCode ? courseCode + " - " : "") + courseName + formattedCategory;
        data.storageKey = (courseCode ? courseCode + "_" + courseName : courseName).replace(/[^a-z0-9]/gi, "_");

        data.isoDate = toIsoDate(detailText("Date")) || toIsoDate(fieldText("didcourseattendance_date")) ||
            formatDate(new Date(), "iso");

        const rows = document.querySelectorAll("#student_list_table tbody tr");

        const hoursText = detailText("Nr. of Hours", "Num. of Hours") ||
            document.querySelector(".attendance-details li:nth-child(5) .text-cont")?.textContent ||
            fieldText("didcourseattendance_nrhours");
        let hours = parseInt(hoursText, 10);
        if (!(hours > 0)) {
            // Last resort: one checkbox per hour, after the one that ticks them all.
            const boxes = rows[0]?.querySelectorAll('.checkboxes_row_td input[type="checkbox"]').length || 0;
            if (boxes > 1) hours = boxes - 1;
        }
        if (hours > 0) data.totalHours = hours;

        // Students and their hours, in editable and locked (view) pages alike.
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
    // The button in EIS's bar
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

        // After the importer's buttons, whichever script runs first, and before
        // EIS's own (before the first button, not the first node: whitespace
        // there would show as a gap).
        const ours = actionBar.querySelectorAll(":scope > .stando-eis-btn");
        const before = ours.length ? ours[ours.length - 1].nextElementSibling : actionBar.firstElementChild;
        actionBar.insertBefore(button, before);
    }

    // EIS may draw its bar late or again; the button follows it.
    function keepAttendanceButton() {
        addAttendanceButton();
        let queued = false;
        new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                addAttendanceButton();
            });
        }).observe(document.body, { childList: true, subtree: true });
    }

    // ---------------------------------------------------------------------------
    // The sheet window
    // ---------------------------------------------------------------------------

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

    // Closes the open sheet, if any.
    let closeOpenSheet = null;

    function generateAttendanceSheet() {
        const data = extractAttendanceData();
        if (data.students.length === 0) {
            alert("No students found. Open an attendance page with its student list first.");
            return;
        }
        console.log("[Attendance sheet] Extracted:", data);
        loadSignatureFonts();

        // Opening again replaces the open sheet.
        closeOpenSheet?.();

        const savedDisplay = store.get(STORE.display, "checkmarks");
        const savedFont = store.get(STORE.font, "random");
        const state = {
            display: MARKS.some(m => m.value === savedDisplay) ? savedDisplay : "checkmarks",
            font: savedFont === "random" || SIGNATURE_FONTS.some(f => f.value === savedFont) ? savedFont : "random",
            printedDate: formatDate(new Date(), "iso"),
            dates: Array(Math.min(data.totalHours, DATE_COLUMNS)).fill(data.isoDate),
            signers: loadSigners(data).map(s => ({ title: TITLES.includes(s.title) ? s.title : "Lecturer", name: String(s.name || "") })),
        };

        const summary = [
            data.courseTitle,
            `${data.students.length} student${data.students.length === 1 ? "" : "s"}`,
            `${data.totalHours} hour${data.totalHours === 1 ? "" : "s"}`,
        ].join(" · ");

        const container = document.createElement("div");
        container.id = "attendance-sheet-container";
        container.innerHTML = `
            <div id="attendance-sheet-content" role="dialog" aria-modal="true" aria-labelledby="asg-title" tabindex="-1">
                <div id="sheet-controls">
                    <div class="asg-heading">
                        <h2 id="asg-title">Attendance sheet</h2>
                        <div class="asg-summary" title="${escapeHtml(summary)}">${escapeHtml(summary)}</div>
                    </div>
                    <button type="button" id="print-sheet-btn" class="btn btn-success btn-sm" title="Print, or choose Save as PDF as the printer (Ctrl+P)"><i class="fa fa-print" aria-hidden="true"></i> Print / PDF</button>
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

                    <p class="asg-hint"><i class="fa fa-info-circle" aria-hidden="true"></i>
                        In the print window, keep Margins on Default and untick Headers and footers.</p>
                </div>

                <div class="asg-desk">
                    <div id="attendance-sheet-page">
                        <div class="asg-uni">EPOKA University</div>
                        <div class="asg-uni">Faculty of Architecture and Engineering</div>
                        <div class="asg-title">ATTENDANCE LIST</div>
                        <div class="asg-course-row">
                            <div class="asg-course">${escapeHtml(data.courseTitle)}</div>
                            <div class="asg-printed" id="printed-date-display"></div>
                        </div>
                        <table class="asg-table">
                            <colgroup>
                                <col style="width: 5%"><col style="width: 4%"><col style="width: 11%"><col style="width: 26%">
                                ${`<col style="width: 10%">`.repeat(DATE_COLUMNS)}
                                <col style="width: 4%">
                            </colgroup>
                            <thead><tr>
                                <th class="col-nr">No.</th><th>R</th><th>Student ID</th><th class="col-name">Name Surname</th>
                                ${Array.from({ length: DATE_COLUMNS }, (_, i) => `<th class="date-column" data-index="${i}"></th>`).join("")}
                                <th>Ex</th>
                            </tr></thead>
                            <tbody>
                                ${data.students.map(student => `
                                <tr>
                                    <td class="col-nr">${student.index}</td>
                                    <td>${student.repeated ? "R" : ""}</td>
                                    <td>${escapeHtml(student.id)}</td>
                                    <td class="col-name">${escapeHtml(student.name)}</td>
                                    ${Array.from({ length: DATE_COLUMNS }, (_, i) => `<td class="mark-cell" data-present="${student.attendance[i] ? 1 : 0}"></td>`).join("")}
                                    <td>${student.exempt ? "Ex" : ""}</td>
                                </tr>`).join("")}
                            </tbody>
                        </table>
                        <div class="asg-note">
                            <div class="asg-note-line"><b>NOTE:</b></div>
                            <div class="asg-note-line">Students that are not listed in the attendance list will not be considered as enrolled in the course!</div>
                            <div class="asg-note-line">All attendance sheets should be delivered to department coordinators by the end of the week after recording the entries electronically through EIS system.</div>
                            <div class="asg-note-line"><b>R</b> - Repeated Course, <b>Ex</b> - Exempted from attendances.</div>
                        </div>
                        <div class="asg-signers" id="signature-area"></div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(container);

        const $ = selector => container.querySelector(selector);
        const markRows = Array.from(container.querySelectorAll(".asg-table tbody tr"));

        // --- Rendering from state ---
        function renderMarks() {
            const mark = MARKS.find(m => m.value === state.display) || MARKS[0];
            markRows.forEach((row, r) => {
                const student = data.students[r];
                const fontClass = state.font === "random" ? student.fontClass : state.font;
                const firstName = student.name.split(" ")[0];
                row.querySelectorAll(".mark-cell").forEach(cell => {
                    if (cell.dataset.present !== "1" || mark.value === "blank") {
                        cell.textContent = "";
                    } else if (mark.value === "names") {
                        cell.innerHTML = `<span class="student-signature ${fontClass}">${escapeHtml(firstName)}</span>`;
                    } else {
                        cell.innerHTML = `<span class="asg-mark">${mark.symbol}</span>`;
                    }
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
            $("#printed-date-display").innerHTML = `<i>Printed on</i>: ${isoToDotted(state.printedDate)}`;
        }

        function renderSignatureArea() {
            $("#signature-area").innerHTML = state.signers
                .filter(s => s.name.trim())
                .map(s => `
                    <div class="asg-signer">
                        <div>${escapeHtml(`${s.title} ${s.name}`.trim())}</div>
                        <div class="asg-signer-sign">(Signature)</div>
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

        // --- The page around the sheet ---
        // While open: the page behind stays still and out of reach of Tab, and
        // printing (the button or Ctrl+P) prints only the sheet, with the
        // faculty's margins on every page and the course as the PDF's name.
        const opener = document.activeElement;
        const root = document.documentElement;
        root.classList.add("asg-open");

        const pageStyle = document.createElement("style");
        pageStyle.id = "asg-page-style";
        pageStyle.textContent = `@page { size: A4 portrait; margin: ${PAGE_MARGIN}; }`;
        document.head.appendChild(pageStyle);

        const madeInert = Array.from(document.body.children).filter(el => el !== container && !el.inert);
        madeInert.forEach(el => { el.inert = true; });

        let titleBeforePrint = null;
        const onBeforePrint = () => {
            titleBeforePrint = document.title;
            const date = isoToDotted(state.dates[0]);
            document.title = `Attendance list - ${data.courseTitle}${date ? ` - ${date}` : ""}`;
        };
        const onAfterPrint = () => {
            if (titleBeforePrint !== null) document.title = titleBeforePrint;
            titleBeforePrint = null;
        };
        window.addEventListener("beforeprint", onBeforePrint);
        window.addEventListener("afterprint", onAfterPrint);

        const close = () => {
            container.remove();
            pageStyle.remove();
            root.classList.remove("asg-open");
            madeInert.forEach(el => { el.inert = false; });
            document.removeEventListener("keydown", onKey, true);
            window.removeEventListener("beforeprint", onBeforePrint);
            window.removeEventListener("afterprint", onAfterPrint);
            closeOpenSheet = null;
            if (opener?.isConnected) opener.focus?.();
        };
        closeOpenSheet = close;

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

        // The handwriting fonts load on first use; print once they have (or after
        // a few seconds without them).
        $("#print-sheet-btn").addEventListener("click", async () => {
            const button = $("#print-sheet-btn");
            button.disabled = true;
            try {
                await Promise.race([document.fonts?.ready, new Promise(resolve => setTimeout(resolve, 3000))]);
            } catch { /* Print with what has loaded. */ }
            button.disabled = false;
            window.print();
            // Back to the window, so the button does not keep a focus border.
            $("#attendance-sheet-content").focus({ preventScroll: true });
        });

        renderMarks();
        renderDates();
        renderPrintedDate();
        renderSignerList();
        // The window takes the focus (Tab starts inside it, Esc closes it) with
        // no button showing a focus border.
        $("#attendance-sheet-content").focus({ preventScroll: true });
    }

    // Format date as DD.MM.YYYY or ISO format
    function formatDate(date, format = "regular") {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return format === "iso" ? `${y}-${m}-${d}` : `${d}.${m}.${y}`;
    }

    keepAttendanceButton();
})();
