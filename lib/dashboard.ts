// Operational dashboard aggregation — a fast, cross-city "what's happening today" snapshot.
//
// Unlike loadSchedule() (which builds per-vendor OSRM day plans and is heavy), this reads only the
// persisted runs + a single WMS feed fetch, so it can fan out across every city on the landing page
// without the routing cost. It answers: how many orders, how many done / in progress / at risk, how
// many unassigned, how many teams are live right now, and the day's revenue / cost / margin.
import { db } from "./db";
import { allLiveOrders } from "./safestorage-api";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Completion logic mirrored from app/components/MonitoringView.tsx so the dashboard agrees with the
// per-city monitoring board. WMS feed is the fallback when the vendor app hasn't reported.
type Wms = { wms: string | null; status: string | null };
const appStatus = (o: any) => String(o.live_status ?? "").toLowerCase();
const appStarted = (o: any) => ["en_route", "arrived", "packing", "loaded", "delivered"].includes(appStatus(o));
const MID_WMS = ["GATE_PASS", "READY_TO_OUTBOUND", "READY_FOR_PICKLIST"];
const isPickup = (o: any) => String(o.order_type ?? "").toLowerCase().includes("pickup") && !String(o.order_type ?? "").toLowerCase().includes("retriev");

const deliveredDone = (o: any, w?: Wms) => appStatus(o) === "delivered" || w?.wms === "RETRIEVAL_COMPLETD" || w?.status === "completed";
const pickedUpDone = (o: any, w?: Wms) => ["loaded", "delivered"].includes(appStatus(o)) || w?.status === "completed" || /INBOUND|RECEIV|GRN|INWARD/.test(w?.wms ?? "");
const isDone = (o: any, w?: Wms) => (isPickup(o) ? pickedUpDone(o, w) : deliveredDone(o, w));
const isMoving = (o: any, w?: Wms) => appStarted(o) || MID_WMS.includes(w?.wms ?? "");

// IST helpers — the infra clock isn't guaranteed to be IST, so derive it explicitly.
function nowIst(): Date { return new Date(Date.now() + 5.5 * 3600 * 1000); }
function istToday(): string { return nowIst().toISOString().slice(0, 10); }
function istMinutesNow(): number { const d = nowIst(); return d.getUTCHours() * 60 + d.getUTCMinutes(); }

// Best-effort: latest clock time inside a slot string ("2:00 PM - 4:00 PM" → 16:00 → 960). null if
// no parseable time. Used only to flag "slot window has closed and it's still not done" as at-risk.
function slotEndMinutes(slot: string | null | undefined): number | null {
  if (!slot) return null;
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi; let m: RegExpExecArray | null; let best: number | null = null;
  while ((m = re.exec(slot))) {
    let h = Number(m[1]); const min = m[2] ? Number(m[2]) : 0; const ap = (m[3] || "").toLowerCase();
    if (h > 24 || min > 59) continue;
    if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
    const tot = h * 60 + min; if (best == null || tot > best) best = tot;
  }
  return best;
}

const CITY_NAMES: Record<string, string> = {
  bangalore: "Bangalore", hyderabad: "Hyderabad", chennai: "Chennai", mumbai: "Mumbai",
  pune: "Pune", delhi: "Delhi", kolkata: "Kolkata", gurgaon: "Gurgaon", noida: "Noida",
};
const cityName = (slug: string) => CITY_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);

export interface OpsCity {
  slug: string; name: string;
  orders: number; pickups: number; retrievals: number;
  done: number; inProgress: number; notStarted: number; atRisk: number;
  unassigned: number; liveTeams: number; teams: number;
  revenue: number; cost: number; margin: number;
}
export interface OpsDashboard {
  date: string; isToday: boolean; generatedAt: string | null;
  cities: OpsCity[];
  totals: Omit<OpsCity, "slug" | "name">;
}

export async function loadOpsDashboard(date: string): Promise<OpsDashboard> {
  const c = db();
  const today = date === istToday();
  const nowMin = istMinutesNow();

  // WMS status map (system order_id → status). One feed fetch, shared across all cities. Best-effort.
  const wmsMap: Record<string, Wms> = {};
  try {
    const feed = await allLiveOrders();
    for (const o of feed) {
      const id = String(o.order_id ?? ""); if (!id) continue;
      wmsMap[id] = { wms: o.wms_track_status_name ?? null, status: o.order_status ?? null };
    }
  } catch { /* feed down → fall back to app status only */ }

  // Latest run per city for the date.
  const { data: allRuns } = await c.from("schedule_runs")
    .select("id, city, total_cost, total_margin, generated_at")
    .eq("schedule_date", date).order("generated_at", { ascending: false });
  const runByCity = new Map<string, any>();
  for (const r of allRuns ?? []) if (!runByCity.has(r.city)) runByCity.set(r.city, r);

  let latestGen: string | null = null;
  const cities: OpsCity[] = [];

  for (const [slug, run] of runByCity) {
    if (!latestGen || String(run.generated_at) > latestGen) latestGen = String(run.generated_at);

    const { data: assigns } = await c.from("schedule_assignments").select("order_id, vendor_id, stop_seq").eq("run_id", run.id);
    const rows = assigns ?? [];
    const realStops = rows.filter((a: any) => a.stop_seq !== -1); // exclude co-team reservation rows
    const orderUuids = [...new Set(realStops.filter((a: any) => a.order_id).map((a: any) => a.order_id))];
    const unassigned = realStops.filter((a: any) => !a.vendor_id).length;
    const vendorIds = [...new Set(realStops.filter((a: any) => a.vendor_id).map((a: any) => a.vendor_id))];

    const { data: orders } = orderUuids.length
      ? await c.from("orders").select("order_id, order_type, live_status, time_slot").in("id", orderUuids)
      : { data: [] as any[] };

    let pickups = 0, retrievals = 0, done = 0, inProgress = 0, notStarted = 0, atRisk = 0;
    for (const o of orders ?? []) {
      const w = wmsMap[String(o.order_id ?? "")];
      if (isPickup(o)) pickups++; else retrievals++;
      const finished = isDone(o, w);
      if (finished) { done++; continue; }
      if (isMoving(o, w)) inProgress++; else notStarted++;
      // At risk: only meaningful for today — the slot window has closed and it's still not finished.
      if (today) { const end = slotEndMinutes(o.time_slot); if (end != null && nowMin > end) atRisk++; }
    }

    // Live teams: distinct assigned vendors that pinged GPS in the last 30 minutes.
    let liveTeams = 0;
    if (today && vendorIds.length) {
      const { data: locs } = await c.from("vendor_locations")
        .select("vendor_id, recorded_at").in("vendor_id", vendorIds).order("recorded_at", { ascending: false });
      const seen = new Set<string>();
      for (const l of locs ?? []) {
        if (seen.has(l.vendor_id)) continue;
        const t = new Date(String(l.recorded_at).replace(" ", "T") + (String(l.recorded_at).includes("Z") ? "" : "Z"));
        if (!isNaN(t.getTime()) && Date.now() - t.getTime() < 30 * 60 * 1000) seen.add(l.vendor_id);
      }
      liveTeams = seen.size;
    }

    const cost = Number(run.total_cost) || 0, margin = Number(run.total_margin) || 0;
    cities.push({
      slug, name: cityName(slug),
      orders: orderUuids.length, pickups, retrievals,
      done, inProgress, notStarted, atRisk,
      unassigned, liveTeams, teams: vendorIds.length,
      revenue: cost + margin, cost, margin,
    });
  }

  cities.sort((a, b) => b.orders - a.orders);
  const totals = cities.reduce((a, s) => ({
    orders: a.orders + s.orders, pickups: a.pickups + s.pickups, retrievals: a.retrievals + s.retrievals,
    done: a.done + s.done, inProgress: a.inProgress + s.inProgress, notStarted: a.notStarted + s.notStarted,
    atRisk: a.atRisk + s.atRisk, unassigned: a.unassigned + s.unassigned, liveTeams: a.liveTeams + s.liveTeams,
    teams: a.teams + s.teams, revenue: a.revenue + s.revenue, cost: a.cost + s.cost, margin: a.margin + s.margin,
  }), { orders: 0, pickups: 0, retrievals: 0, done: 0, inProgress: 0, notStarted: 0, atRisk: 0, unassigned: 0, liveTeams: 0, teams: 0, revenue: 0, cost: 0, margin: 0 });

  return { date, isToday: today, generatedAt: latestGen, cities, totals };
}
