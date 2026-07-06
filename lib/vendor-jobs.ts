// Vendor-facing data: "my jobs for a day" and the status/location writes behind the app buttons.
// Reads the SAME tables the web dashboard uses (schedule_runs -> schedule_assignments -> orders),
// so the vendor app and Today's schedule are always the same source of truth.
import { db, hasDb } from "./db";

export interface VendorJob {
  orderId: string;            // sst_orders.id (use this for status updates)
  refNo: string;              // customer_unique_id (e.g. BH46789)
  customerName: string;
  contact: string | null;
  orderType: string;          // pickup / full_retrieval / partial_retrieval
  isRetrieval: boolean;
  address: string | null;
  lat: number | null;
  lng: number | null;
  warehouseName: string | null;
  warehouseLat: number | null;
  warehouseLng: number | null;
  pallets: number | null;
  timeSlot: string | null;
  lift: string | null;
  teamNotes: string | null;
  tripNo: number;
  stopSeq: number;
  liveStatus: string | null;
  liveStatusAt: string | null;
}

// The vendor's stops for the schedule they were MOST RECENTLY notified about (today's, or the
// upcoming one the office published the evening before — date-agnostic on purpose). Empty/`published:
// false` until the office has actually sent this vendor their notification. `_date` is accepted for
// backwards-compat but ignored — the notification is the source of truth.
export async function vendorJobs(vendorId: string, date?: string | null): Promise<{ published: boolean; notifiedAt: string | null; date: string | null; jobs: VendorJob[] }> {
  const empty = { published: false, notifiedAt: null as string | null, date: null as string | null, jobs: [] as VendorJob[] };
  if (!hasDb) return empty;
  const c = db();
  // The vendor's notifications point at the runs they can see. Without a date → the latest one
  // (their current schedule). With a date → that specific day's run (history/date filter).
  const { data: notifs } = await c.from("notifications").select("run_id, sent_at").eq("vendor_id", vendorId).eq("kind", "vendor").order("sent_at", { ascending: false });
  if (!notifs?.length) return empty;
  let runId = notifs[0].run_id as string;
  let notifiedAt = notifs[0].sent_at as string;
  if (date) {
    const runIds = [...new Set(notifs.map((n: any) => n.run_id))];
    const { data: runs } = await c.from("schedule_runs").select("id, schedule_date").in("id", runIds);
    const dateByRun = new Map((runs ?? []).map((r: any) => [r.id, String(r.schedule_date).slice(0, 10)]));
    const match = notifs.find((n: any) => dateByRun.get(n.run_id) === date);
    if (!match) return empty; // that date has nothing for this vendor
    runId = match.run_id; notifiedAt = match.sent_at;
  }
  const { data: runRow } = await c.from("schedule_runs").select("schedule_date").eq("id", runId).limit(1);
  const runDate = runRow?.[0]?.schedule_date ? String(runRow[0].schedule_date).slice(0, 10) : null;
  const { data: assigns } = await c.from("schedule_assignments").select("*").eq("run_id", runId).eq("vendor_id", vendorId);
  const rows = assigns ?? [];
  if (!rows.length) return { published: true, notifiedAt, date: runDate, jobs: [] };
  const orderIds = [...new Set(rows.map((a: any) => a.order_id))];
  const { data: orders } = await c.from("orders").select("*").in("id", orderIds);
  const byId = new Map((orders ?? []).map((o: any) => [o.id, o]));
  const jobs = rows
    .sort((a: any, b: any) => a.trip_no - b.trip_no || a.stop_seq - b.stop_seq)
    .map((a: any) => {
      const o: any = byId.get(a.order_id) || {};
      const isRet = /retriev/i.test(o.order_type || "");
      return {
        orderId: a.order_id,
        refNo: o.customer_unique_id ?? o.order_id,
        customerName: o.customer_name ?? "Customer",
        contact: o.contact ?? null,
        orderType: o.order_type ?? "pickup",
        isRetrieval: isRet,
        address: o.locality ?? null,
        lat: o.lat ?? null,
        lng: o.lng ?? null,
        warehouseName: o.warehouse_name ?? null,
        warehouseLat: o.warehouse_lat ?? null,
        warehouseLng: o.warehouse_lng ?? null,
        pallets: o.pallets != null ? Number(o.pallets) : null,
        timeSlot: o.time_slot ?? null,
        lift: o.lift ?? null,
        teamNotes: o.team_notes ?? null,
        tripNo: a.trip_no ?? 0,
        stopSeq: a.stop_seq ?? 0,
        liveStatus: o.live_status ?? null,
        liveStatusAt: o.live_status_at ?? null,
      } as VendorJob;
    });
  return { published: true, notifiedAt, date: runDate, jobs };
}

// Distinct service dates this vendor has (notified) schedules for — powers the app's date filter.
export async function vendorDates(vendorId: string): Promise<string[]> {
  if (!hasDb) return [];
  const c = db();
  const { data: notifs } = await c.from("notifications").select("run_id").eq("vendor_id", vendorId).eq("kind", "vendor");
  const runIds = [...new Set((notifs ?? []).map((n: any) => n.run_id))];
  if (!runIds.length) return [];
  const { data: runs } = await c.from("schedule_runs").select("schedule_date").in("id", runIds);
  const dates = [...new Set((runs ?? []).map((r: any) => String(r.schedule_date).slice(0, 10)).filter(Boolean))];
  return dates.sort((a, b) => (a < b ? 1 : -1)); // newest first
}

// The status lifecycle a vendor advances through, in order. Kept server-side so the app and the
// dashboard agree on valid values.
export const JOB_STATUSES = ["assigned", "en_route", "arrived", "packing", "loaded", "delivered"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// Record a status tap: append an immutable event (with GPS) + update the order's live status.
export async function recordOrderEvent(opts: {
  vendorId: string; orderId: string; event: string; lat?: number | null; lng?: number | null; note?: string | null;
}): Promise<void> {
  if (!hasDb) return;
  const c = db();
  // Guard: the order must belong to this vendor in some run (don't let a token touch others' orders).
  const { data: mine } = await c.from("schedule_assignments").select("id").eq("order_id", opts.orderId).eq("vendor_id", opts.vendorId).limit(1);
  if (!mine?.length) throw new Error("order is not assigned to this vendor");
  await c.from("order_events").insert({
    order_id: opts.orderId, vendor_id: opts.vendorId, event: opts.event,
    lat: opts.lat ?? null, lng: opts.lng ?? null, note: opts.note ?? null,
  });
  if ((JOB_STATUSES as readonly string[]).includes(opts.event)) {
    await c.from("orders").update({ live_status: opts.event, live_status_at: new Date() }).eq("id", opts.orderId);
  }
}

export async function recordVendorLocation(vendorId: string, lat: number, lng: number, accuracy?: number | null): Promise<void> {
  if (!hasDb) return;
  await db().from("vendor_locations").insert({ vendor_id: vendorId, lat, lng, accuracy: accuracy ?? null });
}
