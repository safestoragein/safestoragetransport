// Schedule generation + retrieval. Generation pulls the day's orders, runs the optimiser using
// the Supabase vendor master, and PERSISTS the result (orders + run + assignments). The UI then
// loads the schedule back from those tables.

import { db, isUuid } from "./db";
import { loadLive, loadLiveRaw, allLiveOrders } from "./safestorage-api";
import { masterVendorsForCity } from "./vendor-source";
import { optimize } from "./optimizer";
import { computePnL } from "./economics";
import { getPackingPerPallet } from "./settings";
import { REGION } from "./config";
import { buildVendorPlan, VendorPlan } from "./dayplan";
import { Booking } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function generateSchedule(citySlug: string, date: string, trigger: "cron" | "manual" = "manual") {
  const snap = await loadLive(citySlug, date);
  let vendors = await masterVendorsForCity(citySlug);
  const usedMaster = vendors.length > 0;
  if (!usedMaster) vendors = snap.vendors; // fallback to derived teams when no master vendors

  const result = optimize(snap.date, snap.city, snap.bookings, vendors);
  const pnl = computePnL(result, { packingPerPallet: await getPackingPerPallet() });
  const c = db();

  // 1) upsert the order snapshot
  const orderRows = snap.bookings.map((b: Booking) => ({
    schedule_date: date,
    city: citySlug,
    order_id: b.orderId!,
    customer_unique_id: b.refNo,
    customer_name: b.customerName,
    contact: b.contact ?? null,
    order_type: b.category ?? b.type,
    is_intercity: !!b.isIntercity,
    is_shifting: !!b.isShifting,
    pallets: b.pallets,
    stated_pallets: b.statedPallets ?? null,
    lift: b.lift ?? null,
    transport_charge: b.transportCharge ?? null,
    packing_charge: b.packingCharge ?? null,
    locality: b.location.label ?? null,
    lat: b.location.lat,
    lng: b.location.lng,
    warehouse_name: b.warehouse.label ?? null,
    warehouse_lat: b.warehouse.lat ?? null,
    warehouse_lng: b.warehouse.lng ?? null,
    time_slot: b.timeSlot ?? null,
    required_time: b.requiredTimeText ?? null,
    team_notes: b.teamNotes ?? null,
    order_status: b.orderStatus ?? null,
    booking_date: b.bookingDate ?? null,
  }));
  if (orderRows.length) {
    const { error } = await c.from("orders").upsert(orderRows, { onConflict: "order_id" });
    // Resilient to newer columns not existing yet: retry without them.
    if (error && /(stated_pallets|lift|warehouse_lat|warehouse_lng|is_shifting|booking_date)/.test(error.message || "")) {
      const stripped = orderRows.map(({ stated_pallets, lift, warehouse_lat, warehouse_lng, is_shifting, booking_date, ...rest }) => rest);
      await c.from("orders").upsert(stripped, { onConflict: "order_id" });
    }
  }

  const { data: orders } = await c.from("orders").select("id, order_id").in("order_id", orderRows.map((o) => o.order_id));
  const orderUuidByOrderId = new Map((orders ?? []).map((o: any) => [o.order_id, o.id]));
  const orderUuidByBooking = new Map(snap.bookings.map((b) => [b.id, orderUuidByOrderId.get(b.orderId!)]));

  // 2) create the run
  const { data: run, error: runErr } = await c.from("schedule_runs").insert({
    schedule_date: date, city: citySlug, trigger, status: "draft",
    total_orders: result.kpis.totalBookings, total_vendors: result.kpis.vendorsActive,
    total_cost: pnl.cost, total_margin: pnl.margin,
  }).select().single();
  if (runErr || !run) throw new Error(runErr?.message ?? "could not create run");

  // 3) insert assignments
  const vName = new Map(vendors.map((v) => [v.id, v.name]));
  const rows: any[] = [];
  for (const a of result.assignments) {
    a.trips.forEach((t, ti) => t.bookingIds.forEach((bid, si) => {
      const oid = orderUuidByBooking.get(bid);
      if (!oid) return;
      rows.push({
        run_id: run.id,
        vendor_id: isUuid(a.vendorId) ? a.vendorId : null,
        vendor_name: vName.get(a.vendorId) ?? a.vendorId,
        order_id: oid, trip_no: ti + 1, stop_seq: si + 1,
      });
    }));
  }
  // Unassigned (intercity retrievals + any overflow) get a null-vendor row so they're scoped to THIS
  // run and surface in the "team to assign" bucket — without picking up stale orders from past runs.
  for (const bid of result.unassigned) {
    const oid = orderUuidByBooking.get(bid);
    if (oid) rows.push({ run_id: run.id, vendor_id: null, vendor_name: null, order_id: oid, trip_no: 0, stop_seq: 0 });
  }
  if (rows.length) await c.from("schedule_assignments").insert(rows);

  return { runId: run.id, orders: result.kpis.totalBookings, vendors: result.kpis.vendorsActive, usedMaster };
}

// One order-snapshot row from a live booking (shared by generate + post-cutoff sync).
function orderRowOf(b: Booking, date: string, citySlug: string) {
  return {
    schedule_date: date, city: citySlug, order_id: b.orderId!, customer_unique_id: b.refNo,
    customer_name: b.customerName, contact: b.contact ?? null, order_type: b.category ?? b.type,
    is_intercity: !!b.isIntercity, is_shifting: !!b.isShifting, pallets: b.pallets, stated_pallets: b.statedPallets ?? null,
    lift: b.lift ?? null, transport_charge: b.transportCharge ?? null, packing_charge: b.packingCharge ?? null,
    locality: b.location.label ?? null, lat: b.location.lat, lng: b.location.lng,
    warehouse_name: b.warehouse.label ?? null, warehouse_lat: b.warehouse.lat ?? null, warehouse_lng: b.warehouse.lng ?? null,
    time_slot: b.timeSlot ?? null, required_time: b.requiredTimeText ?? null, team_notes: b.teamNotes ?? null, order_status: b.orderStatus ?? null,
    booking_date: b.bookingDate ?? null,
  };
}

// Pull any orders that appeared/changed in the live feed AFTER the 6 AM run into that run's
// "team to assign" bucket — WITHOUT re-running allocation (existing assignments are preserved).
// Refreshes the order snapshot (so reschedules show the new slot) and adds net-new orders as
// null-vendor rows for manual assignment.
export async function syncNewOrders(citySlug: string, date: string): Promise<{ added: number; error?: string }> {
  const c = db();
  const { data: runs } = await c.from("schedule_runs").select("id").eq("schedule_date", date).eq("city", citySlug).order("generated_at", { ascending: false }).limit(1);
  const run = runs?.[0];
  if (!run) return { added: 0, error: `no schedule run for ${citySlug} on ${date} — generate it first` };

  const snap = await loadLive(citySlug, date);
  const orderRows = snap.bookings.map((b) => orderRowOf(b, date, citySlug));
  if (orderRows.length) {
    const { error } = await c.from("orders").upsert(orderRows, { onConflict: "order_id" });
    if (error && /(stated_pallets|lift|warehouse_lat|warehouse_lng|is_shifting|booking_date)/.test(error.message || "")) {
      const stripped = orderRows.map(({ stated_pallets, lift, warehouse_lat, warehouse_lng, is_shifting, booking_date, ...rest }) => rest);
      await c.from("orders").upsert(stripped, { onConflict: "order_id" });
    }
  }
  const { data: orders } = await c.from("orders").select("id, order_id").in("order_id", orderRows.map((o) => o.order_id));
  const uuidByOrderId = new Map((orders ?? []).map((o: any) => [o.order_id, o.id]));
  const { data: assigns } = await c.from("schedule_assignments").select("order_id").eq("run_id", run.id);
  const existing = new Set((assigns ?? []).map((a: any) => a.order_id));

  const newRows: any[] = [];
  for (const b of snap.bookings) {
    const uuid = uuidByOrderId.get(b.orderId!);
    if (uuid && !existing.has(uuid)) newRows.push({ run_id: run.id, vendor_id: null, vendor_name: null, order_id: uuid, trip_no: 0, stop_seq: 0 });
  }
  if (newRows.length) await c.from("schedule_assignments").insert(newRows);
  return { added: newRows.length };
}

export interface ScheduleOrder {
  id: string; // orders.id (UUID) — used to reassign / set resources
  order_id: string; customer_unique_id: string; customer_name: string; contact: string | null;
  order_type: string; is_intercity: boolean; is_shifting?: boolean; intercity_profit?: number | null; pallets: number | null; stated_pallets: number | null; transport_charge: number | null;
  locality: string | null; time_slot: string | null; required_time: string | null; team_notes: string | null; lift: string | null;
  booking_date: string | null; // order_created_at — when the customer booked
  trip_no: number; stop_seq: number; resources: number;
}
export interface ScheduleVendor {
  vendorId: string | null; vendorName: string; isUnassigned?: boolean;
  supervisorName?: string | null; supervisorContact?: string | null;
  driverName?: string | null; driverContact?: string | null;
  vehicleNo?: string | null; vehicleType?: string | null; startingPoint?: string | null; depotLat?: number | null; depotLng?: number | null;
  orders: ScheduleOrder[]; pallets: number; actualPallets: number; revenue: number; resources: number; extraTrips: number; tripCount: number;
  vendorNotifiedAt?: string | null;
  // pricing (what WE pay this vendor) + intercity flag
  isIntercity?: boolean; tier?: string; dailyPrice?: number | null; perTransaction?: number | null; pricingNote?: string | null;
  plan?: VendorPlan; // server-computed day plan (real OSRM travel times)
}
export interface AvailableVendor { id: string; name: string; vehicleType: string; tier: string; isIntercity: boolean }
export interface ScheduleData {
  runId: string; date: string; city: string; status: string; generatedAt: string;
  totals: { orders: number; vendors: number; cost: number; margin: number; resources: number; extraTrips: number };
  resourceCost: number; extraTripCost: number;
  availableVendors: AvailableVendor[];
  vendors: ScheduleVendor[];
}

const UNASSIGNED_KEY = "__unassigned__";

export async function loadSchedule(citySlug: string, date: string): Promise<ScheduleData | null> {
  const c = db();
  const { data: runs } = await c.from("schedule_runs").select("*").eq("schedule_date", date).eq("city", citySlug).order("generated_at", { ascending: false }).limit(1);
  const run = runs?.[0];
  if (!run) return null;

  // Everything in this run is defined by its assignment rows (assigned + null-vendor "to assign"),
  // so the schedule is scoped to the run and never picks up stale orders from earlier generations.
  const { data: assigns } = await c.from("schedule_assignments").select("*").eq("run_id", run.id);
  const orderIds = [...new Set((assigns ?? []).map((a: any) => a.order_id))];
  const { data: orders } = await c.from("orders").select("*").in("id", orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]);
  const orderById = new Map((orders ?? []).map((o: any) => [o.id, o]));

  // active vendors in this city — for the reassignment dropdown
  const { data: avRows } = await c.from("vendors").select("id, name, vehicle_type, tier, is_intercity_vendor, daily_price, per_transaction, pricing_note, supervisor_name, supervisor_contact, driver_name, driver_contact, vehicle_no, starting_point, starting_lat, starting_lng").ilike("city", citySlug).eq("active", true);
  const availableVendors: AvailableVendor[] = (avRows ?? []).map((v: any) => ({ id: v.id, name: v.name, vehicleType: v.vehicle_type, tier: v.tier, isIntercity: !!v.is_intercity_vendor }));
  const vById = new Map((avRows ?? []).map((v: any) => [v.id, v]));

  // per-vendor add-ons (whole day): 3rd trip @ ₹1,500 + labour resources @ ₹800 — keyed by vendor name
  const { data: addonRows } = await c.from("schedule_vendor_addons").select("vendor_key, extra_trips, resources").eq("run_id", run.id);
  const extraTripsByVendor = new Map<string, number>((addonRows ?? []).map((a: any) => [a.vendor_key, Number(a.extra_trips) || 0]));
  const resourcesByVendor = new Map<string, number>((addonRows ?? []).map((a: any) => [a.vendor_key, Number(a.resources) || 0]));

  // notifications
  const { data: notifs } = await c.from("notifications").select("vendor_id, order_id, kind, sent_at").eq("run_id", run.id);
  const vendorNotified = new Map<string, string>();
  const customerNotified = new Map<string, string>();
  (notifs ?? []).forEach((n: any) => {
    if (n.kind === "vendor" && n.vendor_id) vendorNotified.set(n.vendor_id, n.sent_at);
    if (n.kind === "customer" && n.order_id) customerNotified.set(n.order_id, n.sent_at);
  });

  const byVendor = new Map<string, ScheduleVendor>();
  const ensureVendor = (key: string, init: () => ScheduleVendor) => { if (!byVendor.has(key)) byVendor.set(key, init()); return byVendor.get(key)!; };

  (assigns ?? []).sort((a: any, b: any) => a.trip_no - b.trip_no || a.stop_seq - b.stop_seq).forEach((a: any) => {
    const o: any = orderById.get(a.order_id);
    if (!o) return;
    // An intercity order must never sit under a regular vendor — if a stale assignment put it there,
    // surface it in the "team to assign" bucket (at the end) instead of mixing with local orders.
    const vendorIsIntercity = a.vendor_id ? !!(vById.get(a.vendor_id) as any)?.is_intercity_vendor : false;
    const unassigned = (!a.vendor_id && !a.vendor_name) || (o.is_intercity && !vendorIsIntercity);
    const key = unassigned ? UNASSIGNED_KEY : (a.vendor_id ?? a.vendor_name);
    const sv = ensureVendor(key, () => {
      if (unassigned) return { vendorId: null, vendorName: "Unassigned — team to assign", isUnassigned: true, orders: [], pallets: 0, actualPallets: 0, revenue: 0, resources: 0, extraTrips: 0, tripCount: 0, vendorNotifiedAt: null };
      const v: any = a.vendor_id ? vById.get(a.vendor_id) : null;
      return {
        vendorId: a.vendor_id, vendorName: a.vendor_name,
        supervisorName: v?.supervisor_name, supervisorContact: v?.supervisor_contact,
        driverName: v?.driver_name, driverContact: v?.driver_contact,
        vehicleNo: v?.vehicle_no, vehicleType: v?.vehicle_type, startingPoint: v?.starting_point, depotLat: v?.starting_lat, depotLng: v?.starting_lng,
        isIntercity: !!v?.is_intercity_vendor, tier: v?.tier,
        dailyPrice: v?.daily_price != null ? Number(v.daily_price) : null,
        perTransaction: v?.per_transaction != null ? Number(v.per_transaction) : null,
        pricingNote: v?.pricing_note ?? null,
        orders: [], pallets: 0, actualPallets: 0, revenue: 0, resources: resourcesByVendor.get(a.vendor_name) ?? 0, extraTrips: extraTripsByVendor.get(a.vendor_name) ?? 0, tripCount: 0,
        vendorNotifiedAt: a.vendor_id ? vendorNotified.get(a.vendor_id) ?? null : null,
      };
    });
    sv.orders.push({ ...o, trip_no: a.trip_no, stop_seq: a.stop_seq, intercity_profit: a.intercity_profit ?? null, customerNotifiedAt: customerNotified.get(a.order_id) ?? null } as any);
    sv.pallets += Number(o.pallets) || 0;
    sv.actualPallets += Number(o.stated_pallets ?? o.pallets) || 0;
    sv.revenue += Number(o.transport_charge) || 0;
  });

  const resourceCost = REGION.resourceCost;
  const extraTripCost = REGION.extraTripCost;
  const rank = (v: ScheduleVendor) => (v.isUnassigned ? 2 : v.isIntercity ? 1 : 0); // local vendors → intercity → unassigned
  const vendors = [...byVendor.values()]
    .map((v) => ({ ...v, pallets: Math.round(v.pallets * 10) / 10, actualPallets: Math.round(v.actualPallets * 10) / 10, tripCount: new Set(v.orders.map((o) => o.trip_no)).size }))
    .sort((a, b) => rank(a) - rank(b));
  // Attach the realistic day plan (real road travel via OSRM) to each assigned vendor.
  await Promise.all(vendors.map(async (v) => { if (!v.isUnassigned) v.plan = await buildVendorPlan(v); }));

  const totalResources = vendors.reduce((s, v) => s + (v.resources || 0), 0);
  const totalExtraTrips = vendors.reduce((s, v) => s + (v.extraTrips || 0), 0);
  const addOnCost = totalResources * resourceCost + totalExtraTrips * extraTripCost;

  return {
    runId: run.id, date, city: citySlug, status: run.status, generatedAt: run.generated_at,
    totals: {
      orders: run.total_orders, vendors: run.total_vendors,
      cost: Number(run.total_cost) + addOnCost,
      margin: Number(run.total_margin) - addOnCost,
      resources: totalResources, extraTrips: totalExtraTrips,
    },
    resourceCost, extraTripCost,
    availableVendors,
    vendors,
  };
}

// Drop orders from a run that are no longer in the live feed (cancelled, or rescheduled to another
// day). Removes their assignment rows so they disappear from the schedule. SAFE: if the live feed
// is empty/unreachable it removes nothing (so an API blip can't wipe the schedule).
export async function removeStaleFromRun(citySlug: string, date: string): Promise<{ removed: number }> {
  const c = db();
  const { data: runs } = await c.from("schedule_runs").select("id").eq("schedule_date", date).eq("city", citySlug).order("generated_at", { ascending: false }).limit(1);
  const run = runs?.[0];
  if (!run) return { removed: 0 };

  // Guard on the WHOLE feed: if the entire feed is empty/unreachable the API is likely down, so
  // remove nothing. If the feed has orders but THIS city+date has none, those orders were genuinely
  // cancelled/moved and should be dropped.
  let all: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { all = await allLiveOrders(); } catch { return { removed: 0 }; }
  if (!all.length) return { removed: 0 };
  const liveIds = new Set(
    all.filter((o: any) => (o.customer_local_city || "").toLowerCase().trim() === citySlug && String(o.order_schedule_date || "").slice(0, 10) === date) // eslint-disable-line @typescript-eslint/no-explicit-any
       .map((o: any) => String(o.order_id)), // eslint-disable-line @typescript-eslint/no-explicit-any
  );

  const { data: assigns } = await c.from("schedule_assignments").select("order_id").eq("run_id", run.id);
  const orderUuids = [...new Set((assigns ?? []).map((a: any) => a.order_id))]; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!orderUuids.length) return { removed: 0 };
  const { data: orders } = await c.from("orders").select("id, order_id").in("id", orderUuids);
  const stale = (orders ?? []).filter((o: any) => !liveIds.has(String(o.order_id))).map((o: any) => o.id); // eslint-disable-line @typescript-eslint/no-explicit-any

  let removed = 0;
  for (const uuid of stale) {
    const { error } = await c.from("schedule_assignments").delete().eq("run_id", run.id).eq("order_id", uuid);
    if (!error) removed++;
  }
  return { removed };
}

// Compare the LIVE booking feed against the persisted run(s) for a date and report what changed
// since the schedule was generated (the 6 AM cut-off) — new bookings, cancelled/moved-out orders,
// and reschedules (time-slot changes). Powers the red "new changes" banner + pull action.
export interface ScheduleDiff {
  date: string;
  cities: { city: string; newOrders: string[]; removed: string[]; rescheduled: string[] }[];
  total: number;
}
export async function diffSchedule(date: string): Promise<ScheduleDiff> {
  const c = db();
  const { data: runs } = await c.from("schedule_runs").select("id, city, generated_at").eq("schedule_date", date);
  const latest = new Map<string, any>();
  for (const r of (runs ?? []) as any[]) { const cur = latest.get(r.city); if (!cur || r.generated_at > cur.generated_at) latest.set(r.city, r); }

  const cities: ScheduleDiff["cities"] = [];
  let total = 0;
  for (const [city, run] of latest) {
    const { data: assigns } = await c.from("schedule_assignments").select("order_id").eq("run_id", run.id);
    const uuids = [...new Set((assigns ?? []).map((a: any) => a.order_id))];
    const persisted: any[] = uuids.length ? ((await c.from("orders").select("order_id, customer_unique_id, time_slot").in("id", uuids)).data ?? []) : [];
    const persById = new Map<string, any>(persisted.map((o: any) => [String(o.order_id), o]));

    let live: any[] = [];
    try { live = await loadLiveRaw(city, date); } catch { live = []; }
    const liveById = new Map(live.map((o: any) => [String(o.order_id), o]));

    const newOrders: string[] = [], removed: string[] = [], rescheduled: string[] = [];
    for (const [id, lo] of liveById) if (!persById.has(id)) newOrders.push(String(lo.customer_unique_id || id));
    for (const [id, po] of persById) if (!liveById.has(id)) removed.push(String(po.customer_unique_id || id));
    for (const [id, lo] of liveById) {
      const po = persById.get(id);
      if (po && String(lo.order_timeslot || "").trim() !== String(po.time_slot || "").trim()) rescheduled.push(String(lo.customer_unique_id || id));
    }
    const n = newOrders.length + removed.length + rescheduled.length;
    if (n > 0) { cities.push({ city, newOrders, removed, rescheduled }); total += n; }
  }
  return { date, cities, total };
}

// Distinct dates that have persisted schedule runs (newest first) — for the Old-schedules picker.
export async function loadScheduleDates(): Promise<{ date: string; runs: number; orders: number }[]> {
  const c = db();
  const { data } = await c.from("schedule_runs").select("schedule_date, total_orders");
  // "Old schedules" = past days only (today lives in Today's tab, tomorrow in Tomorrow's).
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST date
  const by = new Map<string, { runs: number; orders: number }>();
  (data ?? []).forEach((r: any) => {
    const d = String(r.schedule_date).slice(0, 10);
    if (d >= today) return; // skip today + future
    const cur = by.get(d) ?? { runs: 0, orders: 0 };
    cur.runs += 1; cur.orders += Number(r.total_orders) || 0;
    by.set(d, cur);
  });
  return [...by.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Load every city's persisted schedule for a date (used by the all-cities Schedule tab).
export async function loadAllSchedules(date: string): Promise<{ date: string; cities: ScheduleData[] }> {
  const c = db();
  const { data: runs } = await c.from("schedule_runs").select("city").eq("schedule_date", date);
  const citySlugs = [...new Set((runs ?? []).map((r: any) => r.city))] as string[];
  const cities: ScheduleData[] = [];
  for (const slug of citySlugs) {
    const s = await loadSchedule(slug, date);
    if (s) cities.push(s);
  }
  cities.sort((a, b) => b.totals.orders - a.totals.orders);
  return { date, cities };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
