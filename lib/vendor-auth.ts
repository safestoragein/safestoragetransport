// Vendor mobile-app authentication.
//   Login  : phone + PIN  ->  match a sst_vendors row  ->  issue a Bearer token.
//   Requests: send "Authorization: Bearer <token>"; verifyVendor() returns the vendor id.
//
// The token reuses the app's stateless HMAC session (lib/auth) with role="vendor", so no new
// signing scheme is needed. A vendor is identified by its supervisor phone (supervisor_contact,
// or any number in the supervisors[] JSON) — that's the bridge from a human login to sst_vendors.id.
import { NextRequest } from "next/server";
import { signSession, verifySession, SessionUser } from "./auth";
import { db, hasDb } from "./db";

export interface VendorIdentity {
  vendorId: string;
  name: string;
  city: string;
  phone: string;
}

// Keep only digits, then the last 10 (drops +91 / 0 / spaces) so "+91 98765 43210" == "9876543210".
export function normalizePhone(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

function phonesOf(v: any): string[] {
  const list: string[] = [];
  if (v.supervisor_contact) list.push(v.supervisor_contact);
  if (v.driver_contact) list.push(v.driver_contact);
  // supervisors JSON: MySQL returns array, MariaDB returns a string — handle both.
  let sups = v.supervisors;
  if (typeof sups === "string") { try { sups = JSON.parse(sups); } catch { sups = null; } }
  if (Array.isArray(sups)) for (const s of sups) if (s?.phone) list.push(s.phone);
  return [...new Set(list.map(normalizePhone).filter(Boolean))];
}

// Find the active vendor whose PIN matches AND whose phone matches the login phone.
export async function vendorLogin(phone: string, pin: string): Promise<VendorIdentity | null> {
  if (!hasDb) return null;
  const wantPhone = normalizePhone(phone);
  const wantPin = String(pin ?? "").trim();
  if (!wantPhone || !wantPin) return null;
  const { data } = await db().from("vendors").select("*").eq("active", true);
  for (const v of data ?? []) {
    if (String(v.app_pin ?? "").trim() !== wantPin) continue;
    if (!phonesOf(v).includes(wantPhone)) continue;
    return { vendorId: v.id, name: v.name, city: v.city, phone: wantPhone };
  }
  return null;
}

const VENDOR_TOKEN_AGE = 60 * 60 * 24 * 30; // 30 days

export function issueVendorToken(id: VendorIdentity): string {
  const u: SessionUser = { id: id.vendorId, email: id.phone, name: id.name, role: "vendor" };
  return signSession(u, VENDOR_TOKEN_AGE);
}

// Read + verify the Bearer token from a request. Returns the vendor id, or null if missing/invalid.
export function verifyVendor(req: NextRequest): { vendorId: string; name: string; phone: string } | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const s = verifySession(token);
  if (!s || s.role !== "vendor") return null;
  return { vendorId: s.id, name: s.name, phone: s.email };
}
