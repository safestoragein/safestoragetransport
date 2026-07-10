// Manual overrides on a persisted schedule:
//   PATCH /api/schedule/assignment { runId, orderUuid, action: "reassign", vendorId, vendorName }
//        - vendorId null/"" -> unassign (move the order to the "team to assign" bucket)
//   PATCH /api/schedule/assignment { runId, orderUuid, action: "resources", resources }
//        - set the labour-resource count on the order (₹800 each); requires an assigned vendor
//   PATCH /api/schedule/assignment { runId, action: "trips", vendorName, extraTrips }
//        - set the optional 3rd-trip count on a vendor (₹1,500 each)
//   PATCH /api/schedule/assignment { runId, orderUuid, action: "timeslot", timeSlot }
//        - change the customer time window on an order (admin can shift morning <-> afternoon)
//   PATCH /api/schedule/assignment { runId, orderUuid, action: "pallets", pallets }
//        - team corrects the ACTUAL pallet count; sticky (feed refreshes keep it), applied to
//          allocation on the next Generate. Pickups get the assumed buffer recomputed.
//   PATCH /api/schedule/assignment { runId, action: "sequence", orderUuids: [uuid, …] }
//        - set a vendor's manual stop order (the team interchanges stops); 1..N in array order
import { NextRequest, NextResponse } from "next/server";
import { db, isUuid } from "@/lib/db";
import { bufferedPickupPallets } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b?.runId) return NextResponse.json({ ok: false, error: "runId required" }, { status: 400 });
  try {
    const c = db();

    // Manual stop order for a vendor: the client sends the order UUIDs in the new 1..N order and we
    // stamp manual_seq on each assignment row. Honoured by the day plan (badges + ETAs) on reload.
    if (b.action === "sequence") {
      const ids: string[] = Array.isArray(b.orderUuids) ? b.orderUuids.filter(Boolean) : [];
      if (!ids.length) return NextResponse.json({ ok: false, error: "orderUuids required" }, { status: 400 });
      try {
        for (let i = 0; i < ids.length; i++) {
          const { error } = await c.from("schedule_assignments").update({ manual_seq: i + 1 }).eq("run_id", b.runId).eq("order_id", ids[i]);
          if (error) throw new Error(error.message);
        }
      } catch (e) {
        const msg = (e as Error).message || "";
        if (/manual_seq/i.test(msg)) return NextResponse.json({ ok: false, error: "Run the 2026-07-07-assignment-manual-seq.sql migration to enable manual stop ordering." }, { status: 400 });
        throw e;
      }
      return NextResponse.json({ ok: true, order: ids });
    }

    // per-vendor add-ons (whole day): extra 3rd trip (+₹1,500) and labour resource (+₹800)
    if (b.action === "trips" || b.action === "resources") {
      if (!b.vendorName) return NextResponse.json({ ok: false, error: "vendorName required" }, { status: 400 });
      const col = b.action === "trips" ? "extra_trips" : "resources";
      const n = Math.max(0, Math.round(Number(b.action === "trips" ? b.extraTrips : b.resources) || 0));
      const { error } = await c.from("schedule_vendor_addons").upsert({ run_id: b.runId, vendor_key: b.vendorName, [col]: n }, { onConflict: "run_id,vendor_key" });
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, [col]: n });
    }

    if (!b.orderUuid) return NextResponse.json({ ok: false, error: "orderUuid required" }, { status: 400 });

    // Manually change the customer time window on an order (e.g. shift an afternoon stop to morning).
    // Persisted on the order itself; the day plan re-sequences on the next reload.
    if (b.action === "timeslot") {
      const slot = b.timeSlot === "" || b.timeSlot == null ? null : String(b.timeSlot).trim();
      const { error } = await c.from("orders").update({ time_slot: slot }).eq("id", b.orderUuid);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, timeSlot: slot });
    }

    // Team corrects the ACTUAL pallet count. The saved value is authoritative from here on — the
    // live feed never overwrites an existing order's pallets — so it survives Generate, which is
    // exactly when it takes effect on allocation. The assumed (buffered) count is kept in sync.
    if (b.action === "pallets") {
      const n = Number(b.pallets);
      if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ ok: false, error: "Enter a pallet count above 0 (e.g. 2.5)." }, { status: 400 });
      const stated = Math.round(n * 10) / 10;
      const { data: ord } = await c.from("orders").select("order_type").eq("id", b.orderUuid).maybeSingle();
      const isPickup = !/retriev/i.test(String(ord?.order_type ?? ""));
      const { error } = await c.from("orders").update({ stated_pallets: stated, pallets: isPickup ? bufferedPickupPallets(stated) : stated }).eq("id", b.orderUuid);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, pallets: stated });
    }

    const { data: existing } = await c.from("schedule_assignments").select("*").eq("run_id", b.runId).eq("order_id", b.orderUuid).maybeSingle();

    // manual intercity profit on an order
    if (b.action === "profit") {
      const p = b.profit === "" || b.profit == null ? null : Number(b.profit);
      if (existing) { const { error } = await c.from("schedule_assignments").update({ intercity_profit: p }).eq("id", existing.id); if (error) throw new Error(error.message); }
      else { const { error } = await c.from("schedule_assignments").insert({ run_id: b.runId, order_id: b.orderUuid, vendor_id: null, vendor_name: null, trip_no: 0, stop_seq: 0, intercity_profit: p }); if (error) throw new Error(error.message); }
      return NextResponse.json({ ok: true, profit: p });
    }

    // reassign (default)
    const vendorId = isUuid(b.vendorId) ? b.vendorId : null;
    const vendorName = b.vendorName ?? null;
    if (!vendorId && !vendorName) {
      // unassign -> keep a null-vendor row so the order stays in the "team to assign" bucket
      if (existing) await c.from("schedule_assignments").update({ vendor_id: null, vendor_name: null }).eq("id", existing.id);
      else await c.from("schedule_assignments").insert({ run_id: b.runId, order_id: b.orderUuid, vendor_id: null, vendor_name: null, trip_no: 0, stop_seq: 0 });
      return NextResponse.json({ ok: true, vendorId: null });
    }
    if (existing) {
      const { error } = await c.from("schedule_assignments").update({ vendor_id: vendorId, vendor_name: vendorName }).eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await c.from("schedule_assignments").insert({ run_id: b.runId, order_id: b.orderUuid, vendor_id: vendorId, vendor_name: vendorName, trip_no: 1, stop_seq: 1 });
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, vendorId, vendorName });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
