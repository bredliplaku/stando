// Smart Attendance — transactional email via Resend.
// Replaces the Apps Script MailApp templates 1:1.
//
// Secrets required (Dashboard → Edge Functions → Secrets, or `supabase secrets set`):
//   RESEND_API_KEY  — from resend.com (free tier)
//   MAIL_FROM       — e.g.  Smart Attendance <attendance@bredliplaku.com>
// Optional: STANDO_APP_URL — the app address used in email links (see below).
//
// Templates: absence_submitted | absence_approved | absence_rejected
//            | registration_approved | registration_rejected
//
// Security: the caller's Supabase JWT is verified; admin-only templates check
// check_admin_status(); absence_submitted requires the request to belong to
// the caller (or an admin). The service key never leaves this function.

import { createClient } from "npm:@supabase/supabase-js@2";

// Kept in this file so it can be pasted directly into the Supabase dashboard.
// Only the central installation is built in; set the STANDO_APP_URL secret when
// Stando moves. Manage all other websites through the complete
// STANDO_ALLOWED_ORIGINS value in Supabase Edge Function secrets.
const DEFAULT_APP_URL = "https://bredliplaku.com/stando/";
const APP_URL = (() => {
  try {
    const url = new URL(Deno.env.get("STANDO_APP_URL") || DEFAULT_APP_URL);
    if (url.protocol === "https:") return url.origin + url.pathname.replace(/\/?$/, "/");
  } catch { /* Fall back to the default address. */ }
  return DEFAULT_APP_URL;
})();
const allowedOrigins = new Set([new URL(APP_URL).origin]);
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

for (const value of (Deno.env.get("STANDO_ALLOWED_ORIGINS") ?? "").split(",")) {
  const raw = value.trim();
  if (!raw) continue;
  try {
    const url = new URL(raw);
    // Accept exact HTTPS origins only; no wildcards, credentials or page paths.
    if (url.protocol === "https:" && !url.username && !url.password &&
      url.pathname === "/" && !url.search && !url.hash && !url.hostname.includes("*")) {
      allowedOrigins.add(url.origin);
    }
  } catch { /* Ignore invalid entries without affecting the existing websites. */ }
}

function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins.has(origin) || localhostPattern.test(origin);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else if (!origin) {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}

const FALLBACK_GLOBAL_ADMINS = ["bplaku@epoka.edu.al"];

const service = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// ---------------------------------------------------------------------------
// Shared formatting helpers (ported from gscript.js)
// ---------------------------------------------------------------------------

const rowStyle = "border-bottom:1px solid #efefef;";
const labelStyle = `padding:10px 14px;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.6px;white-space:nowrap;vertical-align:middle;width:110px;${rowStyle}`;
const valueStyle = `padding:10px 14px;font-size:14px;color:#333;${rowStyle}`;
const lastLabelStyle = `padding:10px 14px;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.6px;white-space:nowrap;vertical-align:middle;width:110px;`;
const lastValueStyle = `padding:10px 14px;font-size:14px;color:#333;`;
const footerHtml = `<hr style="border:none;border-top:1px solid #eee;margin:20px 0 8px;">
<p style="font-size:11px;color:#aaa;margin:0;">This is an automatically generated email.</p>`;

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatDateForEmail(dateStr: string): string {
  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return String(dateStr);
  const day = parseInt(parts[2], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  if (isNaN(day) || monthIdx < 0 || monthIdx > 11) return String(dateStr);
  return `${day} ${MONTHS[monthIdx]} ${parts[0]}`;
}

function buildHourPillsHtml(hoursStr: string, approvedHoursStr: string | null): string {
  const hoursArray = (hoursStr || "").split(",").map((h) => h.trim()).filter(Boolean);
  const total = hoursArray.length;
  if (total === 0) return "";

  let approvedSet: Set<string> | null = null;
  if (approvedHoursStr !== null && approvedHoursStr !== undefined) {
    approvedSet = new Set(approvedHoursStr.split(",").map((h) => h.trim()).filter(Boolean));
  }

  return hoursArray.map((h, i) => {
    const isFirst = i === 0, isLast = i === total - 1, isOnly = total === 1;
    let borderRadius: string;
    if (isOnly) borderRadius = "8px";
    else if (isFirst) borderRadius = "8px 2px 2px 8px";
    else if (isLast) borderRadius = "2px 8px 8px 2px";
    else borderRadius = "2px";

    const tdPadding = isLast ? "0" : "0 2px 0 0";
    let bg: string, color: string, borderColor: string;
    if (approvedSet === null || approvedSet.has(h)) {
      bg = "#e8f0fe"; color = "#1a56db"; borderColor = "#c3d4fb";
    } else {
      bg = "#f5f5f5"; color = "#999"; borderColor = "#ddd";
    }
    const displayTime = h.split(/[–\-]/)[0].trim();
    return `<td style="padding:${tdPadding};"><span style="display:inline-block;background:${bg};color:${color};font-weight:600;font-size:13px;white-space:nowrap;padding:2px 10px;border-radius:${borderRadius};border:1px solid ${borderColor};">${escapeHtml(displayTime)}</span></td>`;
  }).join("");
}

function sessionBadgeHtml(session: string): string {
  return (session && session !== "Default" && session.trim())
    ? `&nbsp;<span style="background:#e3f2fd;color:#0053A1;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">${escapeHtml(session)}</span>`
    : "";
}

function attachmentLinkHtml(url: string): string {
  return url
    ? `<a href="${escapeHtml(url)}" style="color:#0053A1;text-decoration:none;font-weight:600;">View Document</a>`
    : `<span style="color:#aaa;font-style:italic;">No attachment</span>`;
}

function getSignatureHtml(): string {
  return `<tbody><tr><td style="padding:15px 0px;vertical-align:top"><table cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid rgb(0,83,161);padding-left:12px;padding-bottom:10px"><tbody><tr><td style="padding-bottom:5px"><span style="font-weight:800;color:rgb(0,83,161);font-size:14px">Bredli PLAKU</span><br><span style="font-size:12px;color:rgb(0,0,0)">Assistant Lecturer | MSc</span><br><span style="color:rgb(0,83,161);font-size:12px">Department of Civil Engineering</span><br><span style="color:rgb(0,83,161);font-size:12px">Faculty of Architecture and Engineering</span><br></td></tr><tr><td><table cellpadding="0" cellspacing="0" border="0" style="font-size:12px"><tbody><tr><td style="padding-bottom:3px;width:60px"><strong>Website:</strong></td><td style="padding-bottom:3px;color:rgb(0,0,0)"><a href="https://bredliplaku.com" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none;">bredliplaku.com</a></td></tr><tr><td style="padding-bottom:3px;width:60px"><strong>Office:</strong></td><td style="padding-bottom:3px;color:rgb(0,0,0)">A-032</td></tr><tr><td style="padding-bottom:3px;width:60px"><strong>Phone:</strong></td><td style="padding-bottom:3px;color:rgb(0,0,0)">+355 42 232 086 ext. 1556</td></tr><tr><td style="padding-bottom:3px;width:60px"><strong>Email:</strong></td><td style="padding-bottom:3px;color:rgb(0,0,0)">bplaku@epoka.edu.al</td></tr><tr><td style="padding-bottom:3px;width:60px;vertical-align:top"><strong>Address:</strong></td><td style="color:rgb(0,0,0)">Rruga Tiranë-Rinas, Km. 12<br>1032 Vorë, Tirana, Albania 🇦🇱</td></tr></tbody></table></td></tr></tbody></table></td></tr></tbody>`;
}

// A name that starts with an academic title signs in full ("Assoc. Prof. Dr. Ana
// Hoxha"); any other name signs with the first name ("Ana").
const TITLE_WORD = /^(?:(?:dr|prof|professor|assoc|associate|asst|assist|assistant|lect|lecturer|msc|phd|mr|mrs|ms|ing)\.?)+$/i;

function signatureName(fullName: string): string {
  const words = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const nameWords = words.filter((word) => !TITLE_WORD.test(word));
  if (nameWords.length === 0) return "";
  return TITLE_WORD.test(words[0]) ? words.join(" ") : nameWords[0];
}

// Name and address as an email header value, e.g. "Ana Hoxha" <ana@example.com>.
function mailbox(name: string, email: string): string {
  const cleanName = String(name ?? "").replace(/["<>\r\n]/g, "").trim();
  return cleanName ? `"${cleanName}" <${email}>` : email;
}

// The Staff name when one is set, otherwise the caller's Google name.
async function getCallerName(callerEmail: string, googleName: string): Promise<string> {
  const { data } = await service.from("staff").select("name").ilike("email", callerEmail);
  return String(data?.[0]?.name ?? "").trim() || googleName.trim();
}

function getSignatureForAdmin(adminEmail: string, adminName: string): string {
  const isGlobalOwner = FALLBACK_GLOBAL_ADMINS.some(
    (a) => a.trim().toLowerCase() === (adminEmail || "").trim().toLowerCase(),
  );
  if (isGlobalOwner) {
    return `<p style="margin:0 0 4px;">Best,<br>Bredli</p><table cellpadding="0" cellspacing="0" border="0">${getSignatureHtml()}</table>`;
  }
  const name = signatureName(adminName);
  return name ? `<p>Best,<br>${escapeHtml(name)}</p>` : `<p>Best,</p>`;
}

// A course as people write it: "CE 121" without the archive or EIS suffix of its
// key, and its name ("Civil Engineering Drawing") when one is set. Same rules as
// cleanCourseCode() in js/data-utils.js.
async function getCourseLabel(courseName: string): Promise<{ code: string; title: string; label: string }> {
  const { data } = await service.from("courses").select("name,title,eis_id").eq("name", courseName);
  const course = data?.[0];
  let code = String(courseName ?? "").trim().replace(/_archived(?:_\d+)?$/i, "");
  const eis = String(course?.eis_id ?? "").trim();
  const suffix = eis && [`_EIS_${eis}`, `_${eis}`].find((part) => code.toLowerCase().endsWith(part.toLowerCase()));
  if (suffix) code = code.slice(0, -suffix.length);
  else {
    code = code.replace(/_EIS_\d+$/i, "");
    if (code.split("_").length >= 3) code = code.replace(/_\d{4,7}$/, "");
  }
  code = code.replace(/_/g, " ");
  const title = String(course?.title ?? "").trim();
  return { code, title, label: title ? `${code} ${title}` : code };
}

function courseValueHtml(course: { code: string; title: string }, session: string): string {
  return `<strong>${escapeHtml(course.code)}</strong>${course.title ? ` ${escapeHtml(course.title)}` : ""}${sessionBadgeHtml(session)}`;
}

// "BA CE Bachelor in Civil Engineering", or "" when the student has no programme.
async function getStudentProgramme(email: string): Promise<string> {
  const { data: students } = await service.from("students").select("programme_id").ilike("email", email);
  const id = students?.find((row) => row.programme_id != null)?.programme_id;
  if (id == null) return "";
  const { data: programmes } = await service.from("programmes").select("code,name").eq("id", id);
  const programme = programmes?.[0];
  if (!programme) return "";
  return programme.name ? `${programme.code} ${programme.name}` : String(programme.code);
}

async function getAdminEmailsForCourse(courseName: string): Promise<string[]> {
  const { data } = await service.from("courses").select("admin_emails").eq("name", courseName);
  if (data && data.length > 0 && data[0].admin_emails) {
    return String(data[0].admin_emails).split(",").map((e) => e.trim()).filter(Boolean);
  }
  return [];
}

async function getAllGlobalAdminEmails(): Promise<string[]> {
  const globalEmails = [...FALLBACK_GLOBAL_ADMINS];
  const { data } = await service.from("staff").select("email").eq("role", "Global");
  (data || []).forEach((row) => { if (row.email) globalEmails.push(row.email); });
  // One address per person, however its case was typed.
  const seen = new Set<string>();
  return globalEmails.map((email) => email.trim()).filter((email) => {
    const key = email.toLowerCase();
    if (!email || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Card registration decisions are copied to every global administrator (Staff role
// Global), never to lecturers, and never to the student the email is addressed to.
async function getGlobalAdminCC(studentEmail: string): Promise<string[]> {
  const student = studentEmail.trim().toLowerCase();
  const admins = (await getAllGlobalAdminEmails()).filter((email) => email.toLowerCase() !== student);
  return await formatAdminEmailsForCC(admins);
}

async function formatAdminEmailsForCC(emails: string[]): Promise<string[]> {
  if (!emails || emails.length === 0) return emails;
  const { data } = await service.from("staff").select("name,email").in("email", emails);
  const nameMap: Record<string, string> = {};
  (data || []).forEach((row) => { if (row.email) nameMap[row.email.toLowerCase()] = row.name; });
  return emails.map((email) => {
    const name = nameMap[email.toLowerCase()];
    return mailbox(name, email);
  });
}

// Old rows store full Drive URLs; new rows store a Storage path. Storage paths
// become app deep-links, so the document is only reachable after signing in —
// the Storage RLS policy limits it to the requester and admins. A leaked email
// therefore never exposes the file itself.
function resolveAttachmentUrl(stored: string): string {
  if (!stored) return "";
  if (/^https?:\/\//i.test(stored)) return stored;
  return APP_URL + "?attachment=" + encodeURIComponent(stored);
}

// Replies go to replyTo (the person the email speaks for), not to MAIL_FROM.
async function sendViaResend(mail: { to: string[]; cc?: string[]; replyTo: string; subject: string; html: string }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + Deno.env.get("RESEND_API_KEY")!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("MAIL_FROM")!,
      to: mail.to,
      cc: mail.cc && mail.cc.length > 0 ? mail.cc : undefined,
      reply_to: mail.replyTo,
      subject: mail.subject,
      html: mail.html,
    }),
  });
  if (!res.ok) throw new Error(`Resend [${res.status}]: ${await res.text()}`);
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const origin = req.headers.get("origin") ?? "";
  if (origin && !isAllowedOrigin(origin)) {
    return new Response("Origin not allowed", { status: 403, headers: cors });
  }
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...cors, Allow: "POST, OPTIONS" } });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const params = await req.json().catch(() => null);
    if (!params || typeof params !== "object" || Array.isArray(params)) return json({ result: "error", message: "Invalid JSON payload" }, 400);
    const template = params.template as string;

    // Verify the caller's session
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user?.email) return json({ result: "error", message: "Not signed in." }, 401);
    const callerEmail = user.email.toLowerCase();

    const adminTemplates = ["absence_approved", "absence_rejected", "registration_approved", "registration_rejected"];
    let isAdmin = false;
    let isGlobalAdmin = false;
    let adminCourses: string[] = [];
    if (adminTemplates.includes(template) || template === "absence_submitted") {
      const { data: status } = await userClient.rpc("check_admin_status");
      isAdmin = !!(status && status.isAdmin);
      isGlobalAdmin = !!status?.isGlobalAdmin;
      adminCourses = Array.isArray(status?.courses) ? status.courses : [];
      if (adminTemplates.includes(template) && !isAdmin) {
        return json({ result: "error", message: "Not authorized." }, 403);
      }
      // Only global administrators handle card registrations.
      if (template.startsWith("registration_") && !isGlobalAdmin) {
        return json({ result: "error", message: "Not authorized." }, 403);
      }
    }

    // Admin emails speak for whoever clicked: signed with their name, replies go to them.
    const callerName = adminTemplates.includes(template)
      ? await getCallerName(callerEmail, String(user.user_metadata?.full_name ?? user.user_metadata?.name ?? ""))
      : "";
    const callerMailbox = mailbox(callerName, callerEmail);

    // ------------------------------------------------------------------
    if (template === "absence_submitted") {
      const { data: rows } = await service.from("absences").select("*")
        .eq("request_id", params.request_id);
      const reqRow = rows?.[0];
      if (!reqRow) throw new Error("Request not found.");
      if (!(isAdmin && (isGlobalAdmin || adminCourses.includes(reqRow.course))) && (reqRow.student_email || "").toLowerCase() !== callerEmail) {
        return json({ result: "error", message: "Not authorized." }, 403);
      }

      const courseAdmins = await getAdminEmailsForCourse(reqRow.course);
      const globalAdmins = await getAllGlobalAdminEmails();
      const notifyAdmins = courseAdmins.length > 0 ? courseAdmins : globalAdmins;

      const course = await getCourseLabel(reqRow.course);
      const programme = await getStudentProgramme(reqRow.student_email || "");
      const programmeRow = programme
        ? `<tr><td style="${labelStyle}">Programme</td><td style="${valueStyle}">${escapeHtml(programme)}</td></tr>` : "";
      const attachmentUrl = resolveAttachmentUrl(reqRow.attachment_url || "");
      const reviewUrl = APP_URL + "#" + encodeURIComponent(reqRow.course);
      const descriptionHtml = (reqRow.description && reqRow.description.trim())
        ? escapeHtml(reqRow.description).replace(/\n/g, "<br>")
        : '<span style="color:#aaa;font-style:italic;">No description provided.</span>';

      const bodyHtml = `
        <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;">
          <p style="margin:0 0 16px;color:#333;">Greetings,<br><br><span style="color:#555;">I am writing to submit a formal permission request. Please find the details of my request and the supporting documentation provided below for your review.</span></p>
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e5e5e5;border-radius:6px;margin-bottom:20px;background:#fafafa;cursor:default;">
            <tr><td style="${labelStyle}">Student</td><td style="${valueStyle}"><strong>${escapeHtml(reqRow.student_name)}</strong><br><span style="font-size:12px;color:#888;">${escapeHtml(reqRow.student_email)}</span></td></tr>
            ${programmeRow}
            <tr><td style="${labelStyle}">Course</td><td style="${valueStyle}">${courseValueHtml(course, reqRow.session || "")}</td></tr>
            <tr><td style="${labelStyle}">Date</td><td style="${valueStyle}">${formatDateForEmail(reqRow.absence_date)}</td></tr>
            <tr><td style="${labelStyle}">Hours</td><td style="${valueStyle}"><table cellpadding="0" cellspacing="0" border="0"><tr>${buildHourPillsHtml(reqRow.hours, null)}</tr></table></td></tr>
            <tr><td style="${labelStyle}">Reason</td><td style="${valueStyle}">${escapeHtml(reqRow.reason_type)}</td></tr>
            <tr><td style="${labelStyle}">Description</td><td style="${valueStyle}text-align:justify;hyphens:auto;-webkit-hyphens:auto;-ms-hyphens:auto;" lang="en">${descriptionHtml}</td></tr>
            <tr><td style="${lastLabelStyle}">Attachment</td><td style="${lastValueStyle}">${attachmentLinkHtml(attachmentUrl)}</td></tr>
          </table>
          <p style="text-align:right;"><a href="${reviewUrl}" target="_blank" style="display:inline-block;background:#0053A1;color:#fff;text-decoration:none;font-weight:600;font-size:12px;border-radius:20px;padding:5px 16px;">Review Request</a></p>
          <p style="color:#333;">Kind regards,<br>${escapeHtml(reqRow.student_name)}</p>
          ${footerHtml}
        </div>`;

      await sendViaResend({
        to: await formatAdminEmailsForCC(notifyAdmins),
        cc: [mailbox(reqRow.student_name, reqRow.student_email)],
        replyTo: mailbox(reqRow.student_name, reqRow.student_email),
        subject: `Permission Request for ${course.label}`,
        html: bodyHtml,
      });
      return json({ result: "success" });
    }

    // ------------------------------------------------------------------
    if (template === "absence_approved" || template === "absence_rejected") {
      const { data: rows } = await service.from("absences").select("*")
        .eq("request_id", params.request_id);
      const reqRow = rows?.[0];
      if (!reqRow) throw new Error("Request not found.");
      if (!isGlobalAdmin && !adminCourses.includes(reqRow.course)) return json({ result: "error", message: "Not authorized for this course." }, 403);

      const course = await getCourseLabel(reqRow.course);
      const subject = `Permission Request for ${course.label}`;
      const firstName = reqRow.student_name ? reqRow.student_name.split(" ")[0] : "Student";
      const signatureHtml = getSignatureForAdmin(callerEmail, callerName);
      const courseAdmins = await getAdminEmailsForCourse(reqRow.course);
      const attachmentUrl = resolveAttachmentUrl(reqRow.attachment_url || "");
      const formattedDate = reqRow.absence_date ? formatDateForEmail(reqRow.absence_date) : "";

      const dateRow = formattedDate
        ? `<tr><td style="${labelStyle}">Date</td><td style="${valueStyle}">${formattedDate}</td></tr>` : "";
      const reasonRow = reqRow.reason_type
        ? `<tr><td style="${labelStyle}">Reason</td><td style="${valueStyle}">${escapeHtml(reqRow.reason_type)}</td></tr>` : "";
      const descriptionHtml = (reqRow.description && String(reqRow.description).trim())
        ? escapeHtml(reqRow.description).replace(/\n/g, "<br>") : "";
      const descriptionRow = descriptionHtml
        ? `<tr><td style="${labelStyle}">Description</td><td style="${valueStyle}text-align:justify;hyphens:auto;-webkit-hyphens:auto;-ms-hyphens:auto;" lang="en">${descriptionHtml}</td></tr>` : "";
      const attachmentRow =
        `<tr><td style="${lastLabelStyle}">Attachment</td><td style="${lastValueStyle}">${attachmentLinkHtml(attachmentUrl)}</td></tr>`;

      let bodyHtml: string;

      if (template === "absence_approved") {
        const approvedHours = String(params.approvedHours ?? reqRow.hours);
        const originalHours = String(params.originalHours ?? reqRow.hours);
        const customMessage = String(params.customMessage ?? "");
        const isPartial = approvedHours !== originalHours;
        const statusText = isPartial ? "partially approved" : "approved";
        const statusColor = isPartial ? "#e67e22" : "#1a56db";
        const partialNote = isPartial
          ? `<p style="margin:4px 0 0;font-size:11px;color:#888;">Blue&nbsp;=&nbsp;approved, grey&nbsp;=&nbsp;not approved</p>` : "";
        const customMessageHtml = customMessage.trim()
          ? `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px;">
              <tr><td style="background:#f0f7ff;border-left:3px solid #0053A1;padding:10px 14px;font-style:italic;color:#555;font-size:13px;text-align:justify;hyphens:auto;-webkit-hyphens:auto;-ms-hyphens:auto;" lang="en">${escapeHtml(customMessage).replace(/\n/g, "<br>")}</td></tr>
             </table>` : "";

        bodyHtml = `
          <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;">
            <p style="margin:0 0 16px;">Dear ${escapeHtml(firstName)},</p>
            <p style="margin:0 0 20px;">Your permission request for <strong>${escapeHtml(course.label)}</strong> has been <strong style="color:${statusColor};">${statusText}</strong>.</p>
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e5e5e5;border-radius:6px;margin-bottom:20px;background:#fafafa;cursor:default;">
              <tr><td style="${labelStyle}">Course</td><td style="${valueStyle}">${courseValueHtml(course, reqRow.session || "")}</td></tr>
              ${dateRow}
              <tr><td style="${labelStyle}">Hours</td><td style="${valueStyle}"><table cellpadding="0" cellspacing="0" border="0"><tr>${buildHourPillsHtml(originalHours, approvedHours)}</tr></table>${partialNote}</td></tr>
              ${reasonRow}
              ${descriptionRow}
              ${attachmentRow}
            </table>
            ${customMessageHtml}
            ${signatureHtml}
            ${footerHtml}
          </div>`;
      } else {
        const rejectionMessage = String(params.rejectionMessage ?? "");
        const rejectionBoxHtml = rejectionMessage.trim()
          ? `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px;">
              <tr><td style="background:#fdf5f5;border-left:3px solid #c0392b;padding:10px 14px;font-style:italic;color:#555;font-size:13px;text-align:justify;hyphens:auto;-webkit-hyphens:auto;-ms-hyphens:auto;" lang="en">${escapeHtml(rejectionMessage).replace(/\n/g, "<br>")}</td></tr>
             </table>` : "";

        bodyHtml = `
          <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;">
            <p style="margin:0 0 16px;">Dear ${escapeHtml(firstName)},</p>
            <p style="margin:0 0 20px;">Your permission request for <strong>${escapeHtml(course.label)}</strong> has <span style="color:#c0392b;font-weight:600;">not been approved</span>.</p>
            <table cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #e5e5e5;border-radius:6px;margin-bottom:20px;background:#fafafa;cursor:default;">
              <tr><td style="${labelStyle}">Course</td><td style="${valueStyle}">${courseValueHtml(course, reqRow.session || "")}</td></tr>
              ${dateRow}
              <tr><td style="${labelStyle}">Hours</td><td style="${valueStyle}"><table cellpadding="0" cellspacing="0" border="0"><tr>${buildHourPillsHtml(reqRow.hours, "")}</tr></table></td></tr>
              ${reasonRow}
              ${descriptionRow}
              ${attachmentRow}
            </table>
            ${rejectionBoxHtml}
            <p style="margin:0 0 20px;">Please feel free to reach out if you have any questions.</p>
            ${signatureHtml}
            ${footerHtml}
          </div>`;
      }

      await sendViaResend({
        to: [mailbox(reqRow.student_name, reqRow.student_email)],
        cc: courseAdmins.length > 0 ? await formatAdminEmailsForCC(courseAdmins) : undefined,
        replyTo: callerMailbox,
        subject,
        html: bodyHtml,
      });
      return json({ result: "success" });
    }

    // ------------------------------------------------------------------
    if (template === "registration_approved") {
      const name = String(params.name ?? "");
      const email = String(params.email ?? "");
      if (!email) throw new Error("Missing student email.");
      const firstName = name.trim() ? name.split(" ")[0] : "Student";
      const greeting = name.trim() ? `Dear ${escapeHtml(firstName)},` : "Dear,";
      const signatureHtml = getSignatureForAdmin(callerEmail, callerName);

      const bodyHtml = `
        <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;">
          <p style="margin:0 0 16px;">${greeting}<br>I hope this email finds you well.</p>
          <p style="margin:0 0 20px;">Your application for your <strong>Student ID Card</strong> has been <span style="color:#1a7c3e;font-weight:600;">approved</span>.</p>
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px;">
            <tr><td style="background:#f0f7f1;border-left:3px solid #1a7c3e;padding:10px 14px;font-size:13px;color:#333;">
              Please ensure you always bring your student ID card to class. You are responsible for your own attendance if you do not have it with you.
            </td></tr>
          </table>
          <p style="margin:0 0 20px;font-size:13px;color:#555;">Track your attendance at <a href="${APP_URL}" target="_blank" style="color:#0053A1;">${escapeHtml(APP_URL.replace(/^https:\/\//, "").replace(/\/$/, ""))}</a>.</p>
          ${signatureHtml}
          ${footerHtml}
        </div>`;

      await sendViaResend({
        to: [mailbox(name, email)],
        cc: await getGlobalAdminCC(email),
        replyTo: callerMailbox,
        subject: "Your Student ID Card Application has been Approved",
        html: bodyHtml,
      });
      return json({ result: "success" });
    }

    // ------------------------------------------------------------------
    if (template === "registration_rejected") {
      const name = String(params.name ?? "");
      const email = String(params.email ?? "");
      const message = String(params.message ?? "");
      if (!email || !message) return json({ result: "success" }); // nothing to send
      const firstName = name.trim() ? name.split(" ")[0] : "Student";
      const signatureHtml = getSignatureForAdmin(callerEmail, callerName);

      const bodyHtml = `
        <div style="font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6;max-width:600px;">
          <p style="margin:0 0 16px;">Dear ${escapeHtml(firstName)},</p>
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-bottom:20px;">
            <tr><td style="background:#fdf5f5;border-left:3px solid #c0392b;padding:10px 14px;color:#333;text-align:justify;hyphens:auto;-webkit-hyphens:auto;-ms-hyphens:auto;" lang="en">${escapeHtml(message).replace(/\n/g, "<br>")}</td></tr>
          </table>
          ${signatureHtml}
          ${footerHtml}
        </div>`;

      await sendViaResend({
        to: [mailbox(name, email)],
        cc: await getGlobalAdminCC(email),
        replyTo: callerMailbox,
        subject: "Your Student ID Card Application has been Rejected",
        html: bodyHtml,
      });
      return json({ result: "success" });
    }

    return json({ result: "error", message: `Unknown template: ${template}` }, 400);
  } catch (e) {
    return json({ result: "error", message: String((e as Error)?.message ?? e) }, 500);
  }
});
