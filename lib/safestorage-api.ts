// Read-only adapter to the EXISTING SafeStorage transport system.
// The endpoints are PUBLIC (no auth needed) — verified live. This module only ever READS.
//
// Live endpoints (base https://safestorage.in/back), confirmed field shapes:
//   transport_controller_Dev0/get_work_order_list_api_new  -> orders
//       { customer_unique_id, customer_name, customer_local_city, order_schedule_date,
//         total_pallet, order_type, is_intercity, order_timeslot, order_address,
//         warehouse_id, supervisor_id, supervisor_name, transport_status, floor, lift }
//   transport_controller_Dev0/get_vehicle_list_api         -> teams/vehicles
//       { main_team_id, team_no, supervisor_name, driver_city, vt_name, team_working_status, packer_names }
//   transport_controller_Dev0/get_all_cities_with_warehouses -> cities + warehouses
//
// Missing from the live data (must come from the vendor master to enable full optimisation):
//   per-team: real depot/start lat-lng, tier A/B/C, vehicle type (14ft/10ft), rate card.

import { Booking, Vendor, GeoPoint, VehicleType } from "./types";
import { getBookings, getVendors } from "./mock-data";
import { geocodeAddress, CITY_WAREHOUSE, CITY_CENTER } from "./geocode";
import { VEHICLE_CAPACITY, bufferedPickupPallets, requiredVehicleFor } from "./config";
import { parseRequiredTime } from "./timeslot";
import { flag } from "./format";
import { geocodeCached } from "./geocode-remote";

const API_BASE = process.env.SAFESTORAGE_API_BASE || "https://safestorage.in/back";

function timeFromNotes(notes?: string): { requiredTimeText?: string; requiredSlot?: { start: number; end: number } } {
  const r = parseRequiredTime(notes);
  if (!r) return {};
  return { requiredTimeText: r.text, requiredSlot: r.slot ? { start: r.slot.startMin, end: r.slot.endMin } : undefined };
}

export interface DaySnapshot {
  date: string;
  city: string;
  citySlug: string;
  bookings: Booking[];
  vendors: Vendor[];
  source: "live" | "sample";
  meta?: { precisePins: number; total: number; depotsProxied: boolean; intercity: string[] };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

async function getJson(path: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/${path}`, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : json.data ?? [];
}

// ---- sample (synthetic, full vendor master) ----
export async function loadSample(date: string): Promise<DaySnapshot> {
  return { date, city: "Hyderabad", citySlug: "hyderabad", bookings: getBookings(date), vendors: getVendors(), source: "sample" };
}

// ---- live cities & dates for the selectors ----
// Pass a `date` to get the order count PER CITY for that specific day (so the dropdown count
// matches the selected date). Without a date it counts across all days. Every city that exists
// in the system is always listed, even if it has 0 orders on the chosen date.
export async function listLiveCities(date?: string): Promise<{ slug: string; name: string; count: number }[]> {
  const orders = await getJson("transport_controller_Dev0/get_work_order_list_api_new");
  const all = new Set<string>();
  const counts = new Map<string, number>();
  for (const o of orders) {
    const c = (o.customer_local_city || "").toLowerCase().trim();
    if (!c) continue;
    all.add(c);
    if (date && String(o.order_schedule_date || "").slice(0, 10) !== date) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...all]
    .map((slug) => ({ slug, name: CITY_CENTER[slug]?.label ?? cap(slug), count: counts.get(slug) ?? 0 }))
    .sort((a, b) => b.count - a.count);
}

export async function listLiveDates(citySlug: string): Promise<{ date: string; count: number }[]> {
  const orders = await getJson("transport_controller_Dev0/get_work_order_list_api_new");
  const counts = new Map<string, number>();
  for (const o of orders) {
    if ((o.customer_local_city || "").toLowerCase().trim() !== citySlug) continue;
    const d = String(o.order_schedule_date || "").slice(0, 10);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

// ---- dates across all cities (for the admin command-center selector) ----
export async function listAllDates(): Promise<{ date: string; count: number }[]> {
  const orders = await getJson("transport_controller_Dev0/get_work_order_list_api_new");
  const counts = new Map<string, number>();
  for (const o of orders) {
    const d = String(o.order_schedule_date || "").slice(0, 10);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

// ---- per-city rollup for a single date (admin command center) ----
export async function loadAllCitiesSummary(date: string): Promise<import("./types").CitySummary[]> {
  const { optimize } = await import("./optimizer");
  const { diagnose } = await import("./diagnostics");
  const cities = await listLiveCities();
  const out: import("./types").CitySummary[] = [];
  for (const c of cities) {
    const snap = await loadLive(c.slug, date);
    if (snap.bookings.length === 0) continue;
    const result = optimize(snap.date, snap.city, snap.bookings, snap.vendors);
    const diag = diagnose(result, { intercity: snap.meta?.intercity ?? [], rescheduled: [], smallVehicleTeams: [] });
    out.push({
      slug: c.slug,
      name: c.name,
      orders: result.kpis.totalBookings,
      pallets: result.kpis.totalPallets,
      vehicles: result.kpis.vendorsActive,
      trips: result.kpis.totalTrips,
      cost: result.comparison.optimizedCost,
      utilization: result.kpis.palletUtilization,
      overloads: diag.capacityOverloads,
      unassigned: result.unassigned.length,
    });
  }
  return out.sort((a, b) => b.orders - a.orders);
}

// ---- live snapshot for a city + date ----
export async function loadLive(citySlug: string, date: string): Promise<DaySnapshot> {
  const [orders, vehicles] = await Promise.all([
    getJson("transport_controller_Dev0/get_work_order_list_api_new"),
    getJson("transport_controller_Dev0/get_vehicle_list_api"),
  ]);
  const wh: GeoPoint = CITY_WAREHOUSE[citySlug] ?? { ...CITY_CENTER[citySlug], label: `${cap(citySlug)} WH` };

  const dayOrders = orders.filter(
    (o) => (o.customer_local_city || "").toLowerCase().trim() === citySlug && String(o.order_schedule_date || "").slice(0, 10) === date,
  );

  let precise = 0;
  const bookings: Booking[] = [];
  for (let i = 0; i < dayOrders.length; i++) {
    const o = dayOrders[i];
    const g = await geocodeCached(o.order_address || "", citySlug); // real geocode, cached in MySQL
    if (g.precise) precise++;
    const isPickup = !/retriev/i.test(o.order_type || "");
    const statedRaw = parseFloat(o.total_pallet);
    const stated = !statedRaw || statedRaw <= 0 ? null : Math.round(statedRaw * 10) / 10;
    // Pickups: customers under-report, so schedule for stated + buffer and size the vehicle off the
    // stated count. Retrievals are exact from the warehouse (no buffer). Missing count -> ~3.5 avg
    // so zero-pallet orders don't pile onto one team without limit.
    const palletsScheduled = stated == null ? 3.5 : isPickup ? bufferedPickupPallets(stated) : stated;
    bookings.push({
      id: `${o.customer_unique_id || "ORD"}-${o.order_id || i}`,
      refNo: o.customer_unique_id || `ORD-${i}`,
      date,
      type: /retriev/i.test(o.order_type || "") ? "retrieval" : "pickup",
      category: /partial/i.test(o.order_type || "") ? "partial_retrieval" : /retriev/i.test(o.order_type || "") ? "full_retrieval" : "pickup",
      orderId: String(o.order_id || `${o.customer_unique_id}-${i}`),
      isIntercity: flag(o.is_intercity) || /intercity|shifting/i.test(o.order_type || ""),
      isShifting: /shifting/i.test(o.order_type || ""),
      customerName: o.customer_name || o.customer_unique_id || "Customer",
      location: { lat: g.lat, lng: g.lng, label: g.locality ?? (o.order_address || "").split(",")[0] },
      warehouse: wh,
      pallets: palletsScheduled,
      statedPallets: stated ?? undefined,
      requiredVehicle: isPickup && stated != null ? requiredVehicleFor(stated) : undefined,
      lift: o.lift ?? o.lift_available ?? null,
      city: cap(citySlug),
      timeSlot: o.order_timeslot || undefined,
      orderStatus: o.order_status || undefined,
      bookingDate: o.order_created_at || undefined,
      contact: [o.customer_contact1, o.customer_contact2].filter(Boolean).join(" / ") || undefined,
      // revenue charged to the customer (team-confirmed fields): pickup vs retrieval
      transportCharge: /retriev/i.test(o.order_type || "")
        ? parseFloat(o.retrieval_transport_charges) || 0
        : parseFloat(o.total_pickup_charges_with_gst) || 0,
      packingCharge: parseFloat(o.item_packing_charges) || 0,
      teamNotes: (o.customer_notes || "").trim() || undefined,
      ...timeFromNotes(o.customer_notes),
      currentVendorId: null, // live orders carry only a generic supervisor; no reliable manual team
    });
  }

  const vendors = deriveTeams(vehicles, citySlug, wh);
  const intercity = dayOrders
    .filter((o) => o.is_intercity || /intercity|shifting/i.test(o.order_type || ""))
    .map((o) => o.customer_unique_id);
  return {
    date, city: cap(citySlug), citySlug, bookings, vendors, source: "live",
    meta: { precisePins: precise, total: bookings.length, depotsProxied: true, intercity },
  };
}

const CITY_PREFIX: Record<string, string> = {
  bangalore: "blr", hyderabad: "hyd", chennai: "che", pune: "pun", mumbai: "mum", delhi: "del", coimbatore: "coi",
};

function deriveTeams(vehicles: any[], citySlug: string, wh: GeoPoint): Vendor[] {
  const prefix = CITY_PREFIX[citySlug];
  const teams = vehicles.filter((v) => {
    const dc = (v.driver_city || v.supervisor_city || "").toLowerCase().trim();
    const tn = (v.team_no || "").toLowerCase();
    return dc === citySlug || (prefix && tn.startsWith(prefix));
  });
  return teams.map((t, i) => {
    const name = (t.team_no || t.supervisor_name || `Team ${i + 1}`).trim();
    const small = /small/i.test(name) || /small/i.test(t.vt_name || "");
    const vType: VehicleType = small ? "10ft" : "14ft"; // default 14ft until vt_name is populated
    return {
      id: `team-${t.main_team_id ?? i}`,
      name,
      tier: "general" as const, // unknown in live data -> assume Type A; real tier comes from vendor master
      city: cap(citySlug),
      depot: { ...wh, label: `${name} (depot proxied → WH)` },
      vehicle: { id: `team-${t.main_team_id ?? i}-VH`, type: vType, palletCapacity: VEHICLE_CAPACITY[vType] },
      palletObligation: 0, // real obligations unknown live -> don't force; the optimiser just allocates
      maxPalletsPerDay: 14, // ~2 trips/day until the real per-team capacity is provided
      obligated: false,
    };
  });
}

// Raw orders for a city + date (unmapped) — used by the Excel export so we can output every
// original column (contact, charges, notes, floor/lift, timeslot) alongside our recommended team.
export async function loadLiveRaw(citySlug: string, date: string): Promise<any[]> {
  const orders = await getJson("transport_controller_Dev0/get_work_order_list_api_new");
  return orders.filter(
    (o) => (o.customer_local_city || "").toLowerCase().trim() === citySlug && String(o.order_schedule_date || "").slice(0, 10) === date,
  );
}

// Retrievals have NO pallet count in the work-order feed (total_pallet is null for 100% of
// them). The team derives it from the customer's stored goods. We fetch that goods list here
// and return the total item quantity so the export can show an item count + a pallet ESTIMATE.
//   - full_retrieval    -> get_full_retrieval_order_list_of_items (customer_id) = whole inventory
//   - partial_retrieval -> get_pickup_order_list_of_partial_retrieval (order_id) = just the subset
// The exact figure needs SafeStorage's goods->pallet volume table.
async function postQty(path: string, body: string): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    const j = await res.json();
    const arr = Array.isArray(j) ? j : j.data ?? [];
    return arr.reduce((s: number, o: any) => s + (parseInt(o.goods_quantity) || 1), 0);
  } catch {
    return 0;
  }
}

export async function retrievalItemQty(order: { order_type?: string; customer_id?: string | number; order_id?: string | number }): Promise<number> {
  const isPartial = /partial/i.test(order.order_type || "");
  if (isPartial) {
    if (!order.order_id) return 0;
    return postQty("transport_controller_Dev0/get_pickup_order_list_of_partial_retrieval", `order_id=${encodeURIComponent(String(order.order_id))}`);
  }
  if (!order.customer_id) return 0;
  return postQty("transport_controller_Dev0/get_full_retrieval_order_list_of_items", `customer_id=${encodeURIComponent(String(order.customer_id))}`);
}

// Run async tasks with a concurrency cap (keeps the retrieval-goods fetches from overwhelming).
export async function pMap<T, R>(items: T[], fn: (x: T) => Promise<R>, concurrency = 8): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

export function liveIntercityRefs(citySlug: string, date: string, orders: any[]): string[] {
  return orders
    .filter((o) => (o.customer_local_city || "").toLowerCase().trim() === citySlug && String(o.order_schedule_date || "").slice(0, 10) === date)
    .filter((o) => o.is_intercity || /intercity|shifting/i.test(o.order_type || ""))
    .map((o) => o.customer_unique_id);
}

function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
