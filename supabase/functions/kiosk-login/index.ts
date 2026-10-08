// Kiosk NFC login — replaces the Apps Script `loginWithNfc` action.
//
// Flow: browser sends { uid, deviceId } -> we check the staff card + trusted
// device with the service key -> mint a one-time magic-link token for that
// staff member's email -> browser calls supabase.auth.verifyOtp() with the
// returned token_hash and receives a REAL Supabase session, so every RLS
// policy applies to kiosk users exactly like Google-signed-in users.
//
// Deploy:  supabase functions deploy kiosk-login
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

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

function convertUidToExternalId(rawUid: string): string {
  if (typeof rawUid !== "string") return rawUid;
  const bytes = rawUid.split(":");
  if (bytes.length !== 4 || !bytes.every((b) => /^[0-9a-fA-F]{2}$/.test(b))) {
    return rawUid;
  }
  const decimal = parseInt(bytes[2] + bytes[1] + bytes[0], 16);
  return isNaN(decimal) ? rawUid : String(decimal);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const isAllowed = isAllowedOrigin(origin) || !origin;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && isAllowed) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else if (!origin) {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}

// Brute-force guard: this endpoint is unauthenticated by design (it IS the
// login step), and student UIDs need no trusted-device check, so it's the
// one place in the app reachable by a caller with no credentials at all.
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

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
    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json({ result: "error", message: "Invalid JSON payload" }, 400);
    const { uid, deviceId } = payload;
    if (typeof uid !== "string" || !uid.trim() || uid.length > 128) return json({ result: "error", message: "Invalid uid" }, 400);
    if (deviceId != null && (typeof deviceId !== "string" || deviceId.length > 128)) return json({ result: "error", message: "Invalid device ID" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000).toISOString();

    // Guard rate-limit table gracefully in case it's not provisioned
    try {
      await admin.from("login_attempts").delete().lt("created_at", windowStart);
      const { count: recentAttempts } = await admin
        .from("login_attempts")
        .select("id", { count: "exact", head: true })
        .eq("ip", ip)
        .gte("created_at", windowStart);

      if ((recentAttempts ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS) {
        return json({ result: "error", message: "Too many attempts. Try again shortly." }, 429);
      }
      await admin.from("login_attempts").insert({ ip });
    } catch (rlErr) {
      console.warn("Rate limit check non-fatal warning:", rlErr);
    }

    // 1. Does this card belong to a staff member? (Match raw hex or converted decimal format)
    const rawTrimmed = String(uid).trim();
    const converted = convertUidToExternalId(rawTrimmed);
    const candidateUids = Array.from(
      new Set([
        rawTrimmed,
        rawTrimmed.toLowerCase(),
        rawTrimmed.toUpperCase(),
        converted,
      ]),
    );

    const { data: staffRows, error: staffErr } = await admin
      .from("staff")
      .select("name,email,role")
      .in("uid", candidateUids);
    if (staffErr) throw staffErr;
    if (!staffRows || staffRows.length === 0) {
      // A student's card is greeted by name on the sign-in page, as a check that
      // it works. Only the name is returned, never the card's other details.
      const findStudent = async (column: "uids" | "hardware_uids") => {
        const { data, error } = await admin.from("students").select("name").overlaps(column, candidateUids).limit(1);
        if (error) throw error;
        return data?.[0]?.name as string | undefined;
      };
      const studentName = (await findStudent("uids")) ?? (await findStudent("hardware_uids"));
      return json({
        result: "not_admin",
        message: "UID not recognized as staff.",
        ...(studentName ? { student: { name: studentName } } : {}),
      });
    }

    const { name, email, role } = staffRows[0];

    // 2. Non-students may only log in from a trusted device
    if (role !== "Student") {
      const devIdTrimmed = String(deviceId ?? "").trim();
      const { data: devices, error: devErr } = await admin
        .from("trusted_devices")
        .select("id")
        .eq("device_id", devIdTrimmed);
      if (devErr) throw devErr;
      if (!devices || devices.length === 0) {
        return json({
          result: "error",
          message: "Device not trusted. Sign in with Google to register this device.",
        });
      }
    }

    // 3. Mint a one-time token (creating the auth user on first kiosk login)
    let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error && /not found/i.test(link.error.message ?? "")) {
      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (createErr) throw createErr;
      link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    }
    if (link.error) throw link.error;

    return json({
      result: "success",
      token_hash: link.data.properties.hashed_token,
      user: {
        email,
        name,
        picture:
          "https://ui-avatars.com/api/?name=" + encodeURIComponent(name) + "&background=random",
      },
    });
  } catch (e) {
    return json({ result: "error", message: String((e as Error)?.message ?? e) }, 500);
  }
});
