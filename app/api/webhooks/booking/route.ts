// Booking webhook receiver — the SafeStorage booking system POSTs here when a booking is created,
// rescheduled, cancelled or otherwise changed AFTER the 6 AM cut-off. Each event is stored in
// safestorage.schedule_changes for the team to review + manually assign.
//
//   POST /api/webhooks/booking
//   Header:  x-webhook-secret: <WEBHOOK_SECRET>     (or  Authorization: Bearer <WEBHOOK_SECRET>)
//   Body (JSON, lenient — extra fields are kept in `payload`):
//     { event, order_id, customer_unique_id, city, service_date, order_type,
//       is_intercity, total_pallet, order_timeslot, order_status, order_address, customer_name }
//
// Public to the auth gate (proxy lets /api/webhooks/* through) — secured by the shared secret below.
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db, hasDb } from "@/lib/db";
import { flag } from "@/lib/format";

export const dynamic = "force-dynamic";

function checkSecret(req: NextRequest): { ok: boolean; code?: number; msg?: string } {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return { ok: false, code: 503, msg: "webhook not configured — set WEBHOOK_SECRET in the environment" };
  const got = req.headers.get("x-webhook-secret") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got || ""), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, code: 401, msg: "invalid or missing webhook secret" };
  return { ok: true };
}

export async function GET() {
  return NextResponse.json({ ok: true, message: "SafeStorage Transport booking webhook. POST booking events here with header 'x-webhook-secret'." });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(req: NextRequest) {
  const auth = checkSecret(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.msg }, { status: auth.code });
  if (!hasDb) return NextResponse.json({ ok: false, error: "database not configured" }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });

  const pick = (...keys: string[]) => { for (const k of keys) if (body[k] != null && body[k] !== "") return body[k]; return null; };
  const dateRaw = pick("service_date", "schedule_date", "date", "serviceDate");
  const service_date = dateRaw && /^\d{4}-\d{2}-\d{2}/.test(String(dateRaw)) ? String(dateRaw).slice(0, 10) : null;

  const row = {
    order_id: pick("order_id", "orderId", "id") != null ? String(pick("order_id", "orderId", "id")) : null,
    customer_unique_id: pick("customer_unique_id", "refNo", "customer_id", "customerId"),
    city: pick("city"),
    service_date,
    event: String(pick("event", "type", "action") || "updated").toLowerCase(),
    order_type: pick("order_type", "orderType"),
    is_intercity: body.is_intercity != null ? flag(body.is_intercity) : null,
    time_slot: pick("order_timeslot", "time_slot", "timeSlot"),
    order_status: pick("order_status", "status"),
    source: "webhook",
    payload: body,
    handled: false,
  };
  if (!row.order_id && !row.customer_unique_id) {
    return NextResponse.json({ ok: false, error: "order_id or customer_unique_id is required" }, { status: 400 });
  }

  try {
    const { error } = await db().from("schedule_changes").insert(row);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, received: { order_id: row.order_id, event: row.event } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
