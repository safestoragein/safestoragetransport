// Send a WhatsApp notification (vendor or customer) via Interakt and log it.
//   POST /api/notify { runId, kind:'vendor'|'customer', vendorId?, orderId? }
//     - customer: orderId is orders.id (UUID). Sends the customer template (NO vendor details).
//     - vendor:   vendorId is the vendor UUID. Sends one message PER assigned order to the vendor
//                 (each includes that customer's contact + timing).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { interaktConfigured, sendTemplate } from "@/lib/interakt";
import { customerMessage, vendorMessage } from "@/lib/notify-templates";

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
      if (!r.ok) return NextResponse.json({ ok: false, error: `WhatsApp send failed (to ${r.to ?? order.contact}): ${r.error}` }, { status: 502 });

      await c.from("notifications").insert({ run_id: b.runId, order_id: b.orderId, kind: "customer", channel: "whatsapp", status: "sent", detail: `interakt:${msg.template}` });
      return NextResponse.json({ ok: true, sentAt: new Date().toISOString() });
    }

    // ── Vendor: ONE clubbed message with all assigned stops (in planned order) ─
    if (b.kind === "vendor") {
      if (!b.vendorId) return NextResponse.json({ ok: false, error: "vendorId required" }, { status: 400 });
      const { data: vendor } = await c.from("vendors").select("*").eq("id", b.vendorId).maybeSingle();
      if (!vendor) return NextResponse.json({ ok: false, error: "vendor not found" }, { status: 404 });
      const phone = vendor.supervisor_contact || vendor.driver_contact;
      if (!phone) return NextResponse.json({ ok: false, error: "no supervisor/driver phone on this vendor" }, { status: 422 });
      const vendorName = vendor.supervisor_name || vendor.name || "Partner";

      // Order the stops by the planned sequence (trip, then stop).
      const { data: assigns } = await c.from("schedule_assignments").select("order_id, trip_no, stop_seq").eq("run_id", b.runId).eq("vendor_id", b.vendorId);
      const seq = [...(assigns ?? [])].sort((a: any, z: any) => (a.trip_no - z.trip_no) || (a.stop_seq - z.stop_seq));
      const orderIds = [...new Set(seq.map((a: any) => a.order_id))];
      if (!orderIds.length) return NextResponse.json({ ok: false, error: "no orders assigned to this vendor in this run" }, { status: 422 });
      const { data: orders } = await c.from("orders").select("*").in("id", orderIds);
      const byId = new Map((orders ?? []).map((o: any) => [o.id, o]));
      const ordered = orderIds.map((id) => byId.get(id)).filter(Boolean) as any[];

      const msg = vendorMessage(vendorName, ordered, date);
      const r = await sendTemplate({ phone, template: msg.template, bodyValues: msg.bodyValues });
      // The notification row is what makes the run visible in the vendor APP — it must be written
      // even when WhatsApp fails (test vendors with fake numbers, interakt hiccups). WhatsApp
      // failure is reported as a warning, not a block.
      await c.from("notifications").insert({
        run_id: b.runId, vendor_id: b.vendorId, kind: "vendor", channel: "whatsapp",
        status: r.ok ? "sent" : "wa-failed",
        detail: r.ok ? `interakt:${msg.template} (${ordered.length} stops)` : `app-only (${ordered.length} stops); WhatsApp failed: ${r.error}`,
      });

      // Big orders run 2+ teams of the same vendor — notify the reserved co-team(s) too, with the
      // same shared-order details, so both teams show up.
      const coTeams: { name: string; ok: boolean; error?: string; skipped?: boolean }[] = [];
      const sentPhones = new Set<string>([String(phone).replace(/\D/g, "").slice(-10)]); // don't message one number twice
      const { data: coRows } = await c.from("schedule_assignments").select("order_id, vendor_id, vendor_name").eq("run_id", b.runId).eq("stop_seq", -1).in("order_id", orderIds);
      const coOrdersByVendor = new Map<string, string[]>();
      for (const cr of coRows ?? []) { if (!cr.vendor_id) continue; const l = coOrdersByVendor.get(cr.vendor_id) ?? []; l.push(cr.order_id); coOrdersByVendor.set(cr.vendor_id, l); }
      for (const [coVid, coOrderIds] of coOrdersByVendor) {
        const { data: coVendor } = await c.from("vendors").select("*").eq("id", coVid).maybeSingle();
        const coPhone = coVendor?.supervisor_contact || coVendor?.driver_contact;
        const coName = coVendor?.supervisor_name || coVendor?.name || "Partner";
        if (!coPhone) { coTeams.push({ name: coName, ok: false, error: "no supervisor/driver phone" }); continue; }
        // Both teams share one supervisor number? Then the primary message already covered it.
        const key = String(coPhone).replace(/\D/g, "").slice(-10);
        if (sentPhones.has(key)) { coTeams.push({ name: coName, ok: true, skipped: true }); continue; }
        sentPhones.add(key);
        const coOrders = coOrderIds.map((id) => byId.get(id)).filter(Boolean) as any[];
        const cm = vendorMessage(coName, coOrders, date);
        const cr = await sendTemplate({ phone: coPhone, template: cm.template, bodyValues: cm.bodyValues });
        // Same rule as the primary team: app visibility never depends on WhatsApp succeeding.
        await c.from("notifications").insert({
          run_id: b.runId, vendor_id: coVid, kind: "vendor", channel: "whatsapp",
          status: cr.ok ? "sent" : "wa-failed",
          detail: cr.ok ? `interakt:${cm.template} (co-team, ${coOrders.length})` : `app-only (co-team, ${coOrders.length}); WhatsApp failed: ${cr.error}`,
        });
        coTeams.push({ name: coName, ok: cr.ok, error: cr.error });
      }

      return NextResponse.json({
        ok: true, stops: ordered.length, coTeams, sentAt: new Date().toISOString(),
        whatsapp: r.ok,
        ...(r.ok ? {} : { warning: `Jobs published to the vendor's APP, but the WhatsApp message failed: ${r.error}` }),
      });
    }

    return NextResponse.json({ ok: false, error: "unknown kind" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
