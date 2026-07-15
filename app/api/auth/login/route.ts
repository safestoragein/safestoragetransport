// POST /api/auth/login  { email, password } → set the session cookie. Public (the proxy lets
// /api/auth/* through).
//   1) First check the MySQL `sst_transport_users` table (source of truth for role-based access:
//      role 'admin' = full edit, anything else = read-only — enforced in proxy.ts).
//   2) Then the CENTRAL SafeStorage user table shared with the other apps
//      (get_user_credentials_api) — the team's single login. status 0 = active; role_id 1 = admin.
//   3) If the email is in neither, fall back to the legacy SafeStorage admin_login.
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, SESSION_MAX_AGE, signSession, SessionUser, verifyPassword } from "@/lib/auth";
import { db, hasDb } from "@/lib/db";
import { logActivity } from "@/lib/usage";

export const dynamic = "force-dynamic";

const API_BASE = process.env.SAFESTORAGE_API_BASE || "https://safestorage.in/back";

async function withSession(session: SessionUser, req: NextRequest) {
  // Every successful login is recorded for the admin usage insights (best-effort).
  const fwd = req.headers.get("x-forwarded-for");
  await logActivity(session, "login", null, fwd ? fwd.split(",")[0].trim() : null);
  const res = NextResponse.json({ ok: true, user: session });
  res.cookies.set(COOKIE_NAME, signSession(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Email and password are required" }, { status: 400 });
  }

  // 1) MySQL transport users (scrypt-hashed passwords, per-user role).
  if (hasDb) {
    try {
      const { data } = await db().from("transport_users").select("*").ilike("email", String(email).trim()).maybeSingle();
      if (data) {
        const active = data.active !== false && data.active !== 0;
        if (active && verifyPassword(String(password), String(data.password_hash || ""))) {
          const session: SessionUser = {
            id: String(data.id),
            email: String(data.email),
            name: String(data.name || email),
            role: String(data.role || "staff"),
          };
          try { await db().from("transport_users").update({ last_login_at: new Date() }).eq("id", data.id); } catch {}
          return await withSession(session, req);
        }
        // Email is a known transport user but wrong password / inactive — reject here.
        return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
      }
    } catch {
      // DB unreachable — fall through to the legacy login below.
    }
  }

  // 2) CENTRAL SafeStorage user table (same logins as the other SafeStorage apps).
  try {
    const key = process.env.SS_USER_API_KEY || "SS-USR-9f3c7a2e5b8d41f0a6c1";
    const r = await fetch(`${API_BASE}/transport_controller_Dev0/get_user_credentials_api?api_key=${encodeURIComponent(key)}`, { cache: "no-store" });
    const j: any = await r.json().catch(() => null);
    const users: any[] = Array.isArray(j?.data) ? j.data : [];
    const em = String(email).trim().toLowerCase();
    const u = users.find((x) => String(x.user_email ?? "").trim().toLowerCase() === em);
    if (u) {
      const active = String(u.status ?? "0") === "0"; // observed: every live user carries status 0
      if (active && String(u.user_password ?? "") === String(password)) {
        const name = [u.user_fname, u.user_lname].filter(Boolean).join(" ").trim() || em.split("@")[0];
        return await withSession({
          id: String(u.user_id ?? em),
          email: String(u.user_email),
          name,
          role: String(u.role_id ?? "1") === "1" ? "admin" : "staff",
        }, req);
      }
      // Known central user but wrong password / inactive — reject (don't leak to legacy).
      return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
    }
  } catch { /* central service unreachable — fall through to the legacy login */ }

  // 3) Verify the credentials with the existing SafeStorage admin login endpoint.
  let data: any = null;
  try {
    const body = new URLSearchParams({ email: String(email).trim(), password: String(password) });
    const r = await fetch(`${API_BASE}/transport_controller_Dev0/admin_login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    data = await r.json().catch(() => null);
  } catch {
    return NextResponse.json({ ok: false, error: "Could not reach the login service — please try again." }, { status: 502 });
  }

  // The endpoint returns { status: true|false, message, ...user fields } — only a truthy status passes.
  const ok = data && (data.status === true || data.status === "true" || data.success === true);
  if (!ok) {
    return NextResponse.json({ ok: false, error: data?.message || "Invalid email or password" }, { status: 401 });
  }

  // Build the session from whatever user fields the backend returned (with safe fallbacks).
  const u = data.user || data.data || data;
  const session: SessionUser = {
    id: String(u.id ?? u.user_id ?? u.admin_id ?? email),
    email: String(u.email ?? email),
    name: String(u.name ?? u.admin_name ?? u.username ?? String(email).split("@")[0]),
    role: String(u.role ?? u.user_role ?? "admin"),
  };

  return await withSession(session, req);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
