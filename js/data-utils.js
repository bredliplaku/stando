/* Shared, DOM-free rules for course identities and student file transfers. */
(function (root) {
    'use strict';
    const text = value => value == null ? '' : String(value).trim();
    const key = value => text(value).toLowerCase();
    const unique = values => [...new Map(values.map(value => [key(value), text(value)]).filter(([k]) => k)).values()];
    const list = value => unique((Array.isArray(value) ? value : text(value).split(/[;,\r\n]+/)));
    const isHardwareUid = value => /^[\da-f]{2}(?::[\da-f]{2}){3}$/i.test(value);
    const hardwareToId = uid => String(parseInt(uid.split(':').slice(0, 3).reverse().join(''), 16));

    function cleanCourseCode(courseName, eisId) {
        let name = text(courseName).replace(/_archived(?:_\d+)?$/i, '');
        const eis = text(eisId);
        // Compare literal suffixes: an old malformed EIS ID must never become a RegExp.
        const suffix = eis && [`_EIS_${eis}`, `_${eis}`].find(part => name.toLowerCase().endsWith(part.toLowerCase()));
        if (suffix) name = name.slice(0, -suffix.length);
        else {
            name = name.replace(/_EIS_\d+$/i, '');
            if (name.split('_').length >= 3) name = name.replace(/_\d{4,7}$/, '');
        }
        return name.replace(/_/g, ' ');
    }

    function resolveCourseName({ code, eisId, originalName = '', originalData = {}, archived = false, courses = {} }) {
        const base = text(code).replace(/\s+/g, '_');
        if (!base) throw new Error('Course code is required.');
        if (base.length > 50) throw new Error('Course code is too long (max 50 characters).');
        const forbidden = [...base].find(char => ':\\/?*[]'.includes(char) || char.charCodeAt(0) < 32);
        if (forbidden) throw new Error(`Course code contains an unsupported character: ${JSON.stringify(forbidden)}. Remove it and try again.`);
        const eis = text(eisId);
        if (eis && !/^\d+$/.test(eis)) throw new Error('EIS ID must contain numbers only.');
        const originalBase = cleanCourseCode(originalName, originalData.eisId).replace(/\s+/g, '_');
        // Archive status is metadata. Restoring or editing an identified course keeps its key.
        if (originalName && base === originalBase &&
            (originalName !== originalBase || !archived || originalData.archived)) return originalName;

        const occupied = name => name !== originalName && Object.hasOwn(courses, name);
        let candidate = base;
        if (archived || occupied(base)) {
            if (eis) candidate = `${base}_${eis}`;
            else if (archived) {
                candidate = `${base}_archived`;
                for (let n = 2; occupied(candidate); n++) candidate = `${base}_archived_${n}`;
            }
        }
        // Do not create a second record for the same offering when the base name is free.
        const sameOffering = eis && Object.entries(courses).some(([name, data]) =>
            name !== originalName && text(data.eisId) === eis &&
            cleanCourseCode(name, data.eisId).replace(/\s+/g, '_') === base);
        if (occupied(candidate) || sameOffering) throw new Error(`A course named '${base.replace(/_/g, ' ')}' already exists. Use a different course code or EIS ID.`);
        if (candidate.length > 50) throw new Error('Course code plus its archive/EIS suffix exceeds 50 characters. Use a shorter course code.');
        return candidate;
    }

    // "UID" is read back as the card's UID (detectStudentColumns: legacyUid).
    const studentColumns = ['Name', 'Card ID', 'Email', 'Programme', 'UID'];
    // programmeCode(id) names a student's programme in the file.
    function studentExportRows(database, programmeCode = () => '') {
        return [studentColumns.slice(), ...Object.values(database).filter(student => !student.isStaff)
            .sort((a, b) => text(a.name).localeCompare(text(b.name)))
            .map(student => [text(student.name), list(student.uids).join('; '), text(student.email),
                text(programmeCode(student.programmeId)), list(student.hardware_uids).join('; ')])];
    }

    // A programme cell matches a programme's code or full name, ignoring case and spacing.
    function findProgramme(programmes, value) {
        const wanted = key(value).replace(/\s+/g, ' ');
        return wanted ? programmes.find(p => [p.code, p.name].some(label => key(label).replace(/\s+/g, ' ') === wanted)) : null;
    }

    function matchingKeys(database, student) {
        const ids = new Set(list(student.uids).map(key));
        const hardware = new Set(list(student.hardware_uids).map(key));
        return Object.keys(database).filter(dbKey => {
            const existing = database[dbKey];
            return !existing.isStaff && ((key(student.email) && key(student.email) === key(existing.email)) ||
                list(existing.uids).some(id => ids.has(key(id))) ||
                list(existing.hardware_uids).some(uid => hardware.has(key(uid))));
        });
    }

    function detectStudentColumns(row, strict = false) {
        const headers = row.map(value => key(value).replace(/[\s_().-]+/g, ''));
        const column = aliases => {
            const matches = headers.flatMap((header, index) => aliases.includes(header) ? [index] : []);
            if (matches.length > 1) {
                if (strict) throw new Error(`More than one column matches '${row[matches[0]]}'. Keep one column for each field.`);
                return -1; // Let the user choose between ambiguous columns.
            }
            return matches[0] ?? -1;
        };
        const name = column(['name', 'fullname', 'studentname']);
        const cardAliases = ['cardid', 'cardids', 'cardnumber', 'cardno'];
        const cardIdCol = column(cardAliases);
        // An explicit Card ID takes precedence over a separate institutional Student ID.
        // Retain the old header aliases for files exported by earlier versions.
        const cardId = headers.some(header => cardAliases.includes(header)) ? cardIdCol : column(['id', 'ids', 'studentid', 'studentids', 'studentnumber', 'studentno', 'externalid', 'uids']);
        const email = column(['email', 'emailaddress', 'studentemail', 'institutionalemail']);
        const hardwareUid = column(['hardwareuid', 'hardwareuids', 'hardwareid', 'hardwareids', 'hardwareuidlegacy', 'carduid', 'carduids', 'nfcuid']);
        const legacyUid = column(['uid']);
        const programme = column(['programme', 'program', 'programmecode', 'programcode', 'studyprogramme', 'studyprogram']);
        return { name, cardId, email, hardwareUid, legacyUid, programme };
    }

    function getStudentImportLayout(rows, options = {}) {
        const startRow = options.startRow ?? rows.findIndex(row => row.some(value => text(value)));
        if (!Number.isInteger(startRow) || startRow < 0 || startRow >= rows.length) throw new Error('Choose a row within the selected sheet.');
        const hasHeaders = options.hasHeaders !== false;
        const columns = detectStudentColumns(hasHeaders ? rows[startRow] : [], !options.mapping);
        if (options.mapping) {
            const mapping = options.mapping;
            const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
            const fields = ['name', 'cardId', 'email', ...('programme' in mapping ? ['programme'] : [])];
            const chosen = fields.map(field => mapping[field]);
            if (chosen.some(index => !Number.isInteger(index) || index < -1 || index >= width)) throw new Error('Choose valid columns for this sheet.');
            if (new Set(chosen.filter(index => index >= 0)).size !== chosen.filter(index => index >= 0).length) throw new Error('Assign a different column to each field.');
            if (mapping.name < 0) throw new Error('Choose the Name column.');
            if (mapping.cardId < 0 && mapping.email < 0) throw new Error('Choose a Card ID or Email column.');
            const legacyCard = mapping.cardId >= 0 && (mapping.cardId === columns.legacyUid || mapping.cardId === columns.hardwareUid);
            // Retain recognized legacy fields only when they are not assigned elsewhere.
            columns.hardwareUid = chosen.includes(columns.hardwareUid) ? -1 : columns.hardwareUid;
            columns.legacyUid = mapping.cardId < 0 || chosen.includes(columns.legacyUid) ? -1 : columns.legacyUid;
            columns.programme = 'programme' in mapping ? mapping.programme : chosen.includes(columns.programme) ? -1 : columns.programme;
            Object.assign(columns, { name: mapping.name, cardId: mapping.cardId, email: mapping.email });
            if (legacyCard) { columns.legacyUid = mapping.cardId; columns.cardId = -1; }
        }
        if (columns.name < 0 || (columns.cardId < 0 && columns.legacyUid < 0 && columns.hardwareUid < 0 && columns.email < 0)) {
            throw new Error('Use Name, Card ID and Email as column headers, or assign the columns manually.');
        }
        const dataStartRow = startRow + (hasHeaders ? 1 : 0);
        if (!rows.slice(dataStartRow).some(row => row.some(value => text(value)))) throw new Error('No student rows follow the selected row.');
        return { ...columns, dataStartRow };
    }

    function mapStudentRow(row, columns) {
        const uids = list(row[columns.cardId]);
        const hardware = list(row[columns.hardwareUid]);
        list(row[columns.legacyUid]).forEach(uid => {
            if (isHardwareUid(uid)) {
                hardware.push(uid.toLowerCase());
                if (columns.cardId < 0) uids.push(hardwareToId(uid));
            } else if (columns.cardId < 0) uids.push(uid);
            else hardware.push(uid);
        });
        return { name: text(row[columns.name]), email: text(row[columns.email]), uids: unique(uids), hardware_uids: unique(hardware),
            programme: text(row[columns.programme]) };
    }

    function previewStudentRows(rows, options = {}, limit = 5) {
        const columns = getStudentImportLayout(rows, options);
        const preview = [];
        for (let index = columns.dataStartRow; index < rows.length && preview.length < limit; index++) {
            if (rows[index].some(value => text(value))) preview.push({ rowNumber: index + 1, ...mapStudentRow(rows[index], columns) });
        }
        return preview;
    }

    // options.programmes ([{ id, code, name }]) resolves a Programme column; options.programmeId
    // gives every student without one that programme. A student's programmeId stays
    // undefined when the file says nothing, so a merge keeps the one they have.
    function parseStudentRows(rows, options = {}) {
        const columns = getStudentImportLayout(rows, options);
        const imported = {};
        for (let index = columns.dataStartRow; index < rows.length; index++) {
            const row = rows[index];
            if (!row.some(value => text(value))) continue;
            const fail = message => { throw new Error(`Row ${index + 1}: ${message}`); };
            const { programme, ...student } = mapStudentRow(row, columns);
            const { name, email, uids, hardware_uids: hardware } = student;
            if (!name) fail('Name is required.');
            if (!uids.length && !hardware.length && !email) fail('Provide a Card ID or email.');
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Email address is invalid.');
            if (uids.some(id => /^(undefined|null|nan)$/i.test(id))) fail('Card ID is invalid.');
            if (programme && options.programmes) {
                const found = findProgramme(options.programmes, programme);
                if (!found) fail(`There is no programme called "${programme}". Add it in Settings → Programmes, or correct the file.`);
                student.programmeId = found.id;
            } else if (options.programmeId) student.programmeId = options.programmeId;
            const matches = matchingKeys(imported, student);
            if (matches.length > 1) fail('The IDs and email match different students. Correct the file before importing.');
            if (matches.length) {
                const previous = imported[matches[0]];
                if (email && previous.email && key(email) !== key(previous.email)) fail('The same ID is assigned to different email addresses.');
                imported[matches[0]] = { name, email: email || previous.email,
                    uids: unique([...previous.uids, ...student.uids]),
                    hardware_uids: unique([...previous.hardware_uids, ...student.hardware_uids]),
                    programmeId: student.programmeId ?? previous.programmeId };
            } else imported[index] = student;
        }
        const students = Object.values(imported);
        if (!students.length) throw new Error('No student rows were found below the header.');
        return students;
    }

    function planStudentImport(database, students, replace = false) {
        const next = Object.fromEntries(Object.entries(database).filter(([, student]) => !replace || student.isStaff)
            .map(([dbKey, student]) => [dbKey, { ...student, uids: list(student.uids), hardware_uids: list(student.hardware_uids) }]));
        let added = 0, updated = 0;
        students.forEach((student, index) => {
            const matches = matchingKeys(next, student);
            if (matches.length > 1) throw new Error(`${student.name}: the IDs and email match different existing students. Resolve that conflict before importing.`);
            if (matches.length) {
                const existing = next[matches[0]];
                next[matches[0]] = { ...existing, name: student.name, email: student.email || existing.email,
                    uids: unique([...existing.uids, ...student.uids]),
                    hardware_uids: unique([...existing.hardware_uids, ...student.hardware_uids]),
                    programmeId: student.programmeId ?? existing.programmeId ?? null };
                updated++;
            } else {
                let dbKey = `import_${index}`;
                while (Object.hasOwn(next, dbKey)) dbKey += '_';
                // Replacing the list keeps a returning student's programme unless the file names one.
                const previous = student.programmeId === undefined ? matchingKeys(database, student) : [];
                next[dbKey] = { ...student, uids: list(student.uids), hardware_uids: list(student.hardware_uids),
                    programmeId: student.programmeId ?? (previous.length === 1 ? database[previous[0]].programmeId ?? null : null) };
                added++;
            }
        });
        return { database: next, added, updated };
    }

    const api = { cleanCourseCode, resolveCourseName, studentColumns, studentExportRows, findProgramme,
        detectStudentColumns, getStudentImportLayout, previewStudentRows, parseStudentRows, planStudentImport };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.StandoData = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
