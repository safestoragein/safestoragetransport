// Schedule generation + retrieval. Generation pulls the day's orders, runs the optimiser using
// the Supabase vendor master, and PERSISTS the result (orders + run + assignments). The UI then
// loads the schedule back from those tables.

import { db, isUuid } from "./db";
import { loadLive } from "./safestorage-api";
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
  }));
  if (orderRows.length) {
    const { error } = await c.from("orders").upsert(orderRows, { onConflict: "order_id" });
    // Resilient to newer columns not existing yet (07/09/10 migrations): retry without them.
    if (error && /(stated_pallets|lift|warehouse_lat|warehouse_lng)/.test(error.message || "")) {
      const stripped = orderRows.map(({ stated_pallets, lift, warehouse_lat, warehouse_lng, ...rest }) => rest);
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

export interface ScheduleOrder {
  id: string; // orders.id (UUID) — used to reassign / set resources
  order_id: string; customer_unique_id: string; customer_name: string; contact: string | null;
  order_type: string; is_intercity: boolean; pallets: number | null; stated_pallets: number | null; transport_charge: number | null;
  locality: string | null; time_slot: string | null; required_time: string | null; team_notes: string | null; lift: string | null;
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
    const unassigned = !a.vendor_id && !a.vendor_name; // null-vendor row = team to assign
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
    sv.orders.push({ ...o, trip_no: a.trip_no, stop_seq: a.stop_seq, customerNotifiedAt: customerNotified.get(a.order_id) ?? null } as any);
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

// Distinct dates that have persisted schedule runs (newest first) — for the Old-schedules picker.
export async function loadScheduleDates(): Promise<{ date: string; runs: number; orders: number }[]> {
  const c = db();
  const { data } = await c.from("schedule_runs").select("schedule_date, total_orders");
  const by = new Map<string, { runs: number; orders: number }>();
  (data ?? []).forEach((r: any) => {
    const cur = by.get(r.schedule_date) ?? { runs: 0, orders: 0 };
    cur.runs += 1; cur.orders += Number(r.total_orders) || 0;
    by.set(r.schedule_date, cur);
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
