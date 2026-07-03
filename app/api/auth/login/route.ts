// POST /api/auth/login  { email, password } → set the session cookie. Public (the proxy lets
// /api/auth/* through).
//   1) First check the MySQL `sst_transport_users` table (source of truth for role-based access:
//      role 'admin' = full edit, anything else = read-only — enforced in proxy.ts).
//   2) If the email isn't a transport user, fall back to the legacy SafeStorage admin_login.
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, SESSION_MAX_AGE, signSession, SessionUser, verifyPassword } from "@/lib/auth";
import { db, hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const API_BASE = process.env.SAFESTORAGE_API_BASE || "https://safestorage.in/back";

function withSession(session: SessionUser) {
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

// Temporary diagnostic (no secrets): GET /api/auth/login → DB env + connectivity.
export async function GET() {
  const out: any = {
    hasDb,
    env: {
      MYSQL_HOST: Boolean(process.env.MYSQL_HOST),
      MYSQL_USER: Boolean(process.env.MYSQL_USER),
      MYSQL_PASSWORD: Boolean(process.env.MYSQL_PASSWORD),
      MYSQL_DATABASE: process.env.MYSQL_DATABASE || null,
      MYSQL_URL: Boolean(process.env.MYSQL_URL),
      SESSION_SECRET: Boolean(process.env.SESSION_SECRET),
    },
  };
  if (hasDb) {
    try {
      const { error } = await db().from("transport_users").select("id").limit(1);
      out.dbOk = !error;
      if (error) { out.code = (error as any).code; out.msg = error.message; }
    } catch (e: any) { out.dbOk = false; out.code = e?.code; out.msg = e?.message; }
  }
  return NextResponse.json(out);
}

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
          return withSession(session);
        }
        // Email is a known transport user but wrong password / inactive — reject here.
        return NextResponse.json({ ok: false, error: "Invalid email or password" }, { status: 401 });
      }
    } catch {
      // DB unreachable — fall through to the legacy login below.
    }
  }

  // Verify the credentials with the existing SafeStorage admin login endpoint.
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

  return withSession(session);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
