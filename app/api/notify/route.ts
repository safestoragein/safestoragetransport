// Send a WhatsApp notification (vendor or customer) via Interakt and log it.
//   POST /api/notify { runId, kind:'vendor'|'customer', vendorId?, orderId? }
//     - customer: orderId is orders.id (UUID). Sends the customer template (NO vendor details).
//     - vendor:   vendorId is the vendor UUID. Sends one message PER assigned order to the vendor
//                 (each includes that customer's contact + timing).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interaktConfigured, sendTemplate } from "@/lib/interakt";
import { customerMessage, vendorOrderMessage } from "@/lib/notify-templates";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b?.runId || !b?.kind) return NextResponse.json({ ok: false, error: "runId and kind required" }, { status: 400 });
  if (!interaktConfigured) return NextResponse.json({ ok: false, error: "WhatsApp is not configured yet (set INTERAKT_API_KEY)." }, { status: 503 });

  try {
    const c = db();
    const { data: run } = await c.from("schedule_runs").select("schedule_date, city").eq("id", b.runId).maybeSingle();
    const date = run?.schedule_date ?? null;

    // ── Customer: one message to the order's contact (no vendor details) ──────
    if (b.kind === "customer") {
      if (!b.orderId) return NextResponse.json({ ok: false, error: "orderId required" }, { status: 400 });
      const { data: order } = await c.from("orders").select("*").eq("id", b.orderId).maybeSingle();
      if (!order) return NextResponse.json({ ok: false, error: "order not found" }, { status: 404 });
      if (!order.contact) return NextResponse.json({ ok: false, error: "no customer phone on this order" }, { status: 422 });

      const msg = customerMessage(order, date);
      const r = await sendTemplate({ phone: order.contact, template: msg.template, bodyValues: msg.bodyValues });
      if (!r.ok) return NextResponse.json({ ok: false, error: `WhatsApp send failed: ${r.error}` }, { status: 502 });

      await c.from("notifications").insert({ run_id: b.runId, order_id: b.orderId, kind: "customer", channel: "whatsapp", status: "sent", detail: `interakt:${msg.template}` });
      return NextResponse.json({ ok: true, sentAt: new Date().toISOString() });
    }

    // ── Vendor: one message per assigned order (customer contact + timing) ────
    if (b.kind === "vendor") {
      if (!b.vendorId) return NextResponse.json({ ok: false, error: "vendorId required" }, { status: 400 });
      const { data: vendor } = await c.from("vendors").select("*").eq("id", b.vendorId).maybeSingle();
      if (!vendor) return NextResponse.json({ ok: false, error: "vendor not found" }, { status: 404 });
      const phone = vendor.supervisor_contact || vendor.driver_contact;
      if (!phone) return NextResponse.json({ ok: false, error: "no supervisor/driver phone on this vendor" }, { status: 422 });
      const vendorName = vendor.supervisor_name || vendor.name || "Partner";

      const { data: assigns } = await c.from("schedule_assignments").select("order_id").eq("run_id", b.runId).eq("vendor_id", b.vendorId);
      const orderIds = [...new Set((assigns ?? []).map((a: any) => a.order_id))];
      if (!orderIds.length) return NextResponse.json({ ok: false, error: "no orders assigned to this vendor in this run" }, { status: 422 });
      const { data: orders } = await c.from("orders").select("*").in("id", orderIds);

      let sent = 0; const errors: string[] = [];
      for (const o of (orders ?? []) as any[]) {
        const msg = vendorOrderMessage(vendorName, o, date);
        const r = await sendTemplate({ phone, template: msg.template, bodyValues: msg.bodyValues });
        if (r.ok) sent++; else errors.push(`${o.order_id}: ${r.error}`);
      }
      if (sent === 0) return NextResponse.json({ ok: false, error: `WhatsApp send failed: ${errors[0] ?? "unknown"}` }, { status: 502 });

      await c.from("notifications").insert({ run_id: b.runId, vendor_id: b.vendorId, kind: "vendor", channel: "whatsapp", status: errors.length ? "partial" : "sent", detail: `sent ${sent}/${(orders ?? []).length}${errors.length ? "; " + errors.join(" | ") : ""}`.slice(0, 250) });
      return NextResponse.json({ ok: true, sent, total: (orders ?? []).length, errors, sentAt: new Date().toISOString() });
    }

    return NextResponse.json({ ok: false, error: "unknown kind" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
