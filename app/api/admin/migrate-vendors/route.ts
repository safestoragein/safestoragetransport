// Admin-only, one-off: import the vendor master from Supabase into MySQL (sst_vendors).
// Runs INSIDE the app (mysql2 is bundled, env vars present, and it uses node:https rather
// than fetch — which avoids the CloudLinux undici/WASM OOM that breaks standalone scripts).
//
//   GET /api/vendors ... no — hit:  /safestorage-transport/api/admin/migrate-vendors
// while logged in as an ADMIN. Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env.
import { NextResponse } from "next/server";
import https from "node:https";
import http from "node:http";
import { db, hasDb } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + u.search, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// Columns copied across (both sides share these names). id preserved; timestamps left to MySQL.
const COLS = [
  "id", "city", "name", "vehicle_type", "pallet_capacity", "effective_capacity",
  "tier", "daily_price", "pricing_note", "per_transaction",
  "starting_point", "starting_lat", "starting_lng", "is_intercity_vendor",
  "system_team_id", "system_team_no", "vehicle_no", "vehicle_name",
  "driver_name", "driver_contact", "supervisor_name", "supervisor_contact",
  "packer_names", "team_working_status", "security_deposit",
  "service_agreement_url", "gst_document_url", "notes", "priority_group",
  "supervisors", "billing_cycle", "remarks", "active", "source",
];

export async function GET() {
  const session = await getSession();
  if (session?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });
  }
  if (!hasDb) return NextResponse.json({ ok: false, error: "MySQL not configured" }, { status: 500 });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !KEY) {
    return NextResponse.json({ ok: false, error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars first" }, { status: 400 });
  }

  try {
    const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/vendors?select=*&limit=10000`;
    const res = await httpGet(url, {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Accept-Profile": "safestorage",
    });
    if (res.status < 200 || res.status >= 300) {
      return NextResponse.json({ ok: false, error: `Supabase read failed: HTTP ${res.status}`, detail: res.body.slice(0, 300) }, { status: 502 });
    }
    const rows: any[] = JSON.parse(res.body);
    if (!rows.length) return NextResponse.json({ ok: true, fetched: 0, migrated: 0, note: "Supabase returned no vendors" });

    // Upsert each vendor (keyed on the natural key). The shim JSON-encodes `supervisors`,
    // converts booleans, and preserves existing ids on conflict.
    const payload = rows.map((r) => {
      const o: any = {};
      for (const c of COLS) o[c] = r[c] ?? null;
      return o;
    });
    const { error } = await db().from("vendors").upsert(payload, { onConflict: "city,name,vehicle_type" });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, fetched: rows.length, migrated: rows.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
