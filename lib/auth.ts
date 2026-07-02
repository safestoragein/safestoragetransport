// Auth primitives for the Transport module — no framework imports so this is safe to use from
// proxy.ts (Node runtime), Route Handlers, and standalone scripts. Passwords are scrypt-hashed;
// sessions are stateless signed tokens (HMAC-SHA256) stored in an httpOnly cookie.
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export const COOKIE_NAME = "ss_transport_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days (seconds)

function secret(): string {
  return process.env.SESSION_SECRET || process.env.MYSQL_PASSWORD || "dev-insecure-secret";
}

// ── Passwords (scrypt) ───────────────────────────────────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored || "").split(":");
  if (!saltHex || !hashHex) return false;
  const hash = Buffer.from(hashHex, "hex");
  const test = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return hash.length === test.length && timingSafeEqual(hash, test);
}

// ── Stateless sessions (HMAC-signed token) ───────────────────────────────────────────────────
export interface SessionUser { id: string; email: string; name: string; role: string }
interface TokenPayload extends SessionUser { exp: number }

const b64url = (b: Buffer) => b.toString("base64url");
const sign = (data: string) => b64url(createHmac("sha256", secret()).update(data).digest());

export function signSession(user: SessionUser, maxAgeSec = SESSION_MAX_AGE, nowMs = Date.now()): string {
  const payload: TokenPayload = { ...user, exp: Math.floor(nowMs / 1000) + maxAgeSec };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return `${body}.${sign(body)}`;
}

export function verifySession(token: string | undefined | null, nowMs = Date.now()): SessionUser | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  // constant-time signature check
  const expected = sign(body);
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenPayload;
    if (!p.exp || p.exp * 1000 < nowMs) return null;
    return { id: p.id, email: p.email, name: p.name, role: p.role };
  } catch {
    return null;
  }
}
