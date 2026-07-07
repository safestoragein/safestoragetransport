// Server-side day plan for one vendor: a realistic itinerary with REAL road travel + distance
// (OSRM, cached). Default rhythm: RETRIEVALS in the morning (collected the night before), PICKUPS
// in the afternoon — but an explicit customer request (e.g. "morning slot") always wins. A stop
// that lands after its requested window is flagged late. Computed in loadSchedule.

import { roadMatrix } from "./routing";

const MORNING = 9 * 60;     // 9:00 AM — day start
const PICKUP_WORK = 240;    // pickup = packing + loading ~4h
const RETR_DELIVER = 60;    // retrieval = deliver/unload ~1h
const WH_UNLOAD = 30;       // unload pickups at the warehouse
const FLAT_TRAVEL = 30;     // fallback when a point has no coordinates

type Pt = { lat: number; lng: number } | null;

export interface PlanStep { kind: string; label: string; travel: number; km?: number | null; work: number; arrive: number; depart: number; slot?: string | null; lift?: string | null; late?: boolean }
export interface VendorPlan { steps: PlanStep[]; end: number; totalKm: number; byOrder: Record<string, { arrive: number; depart: number; late: boolean }> }

/* eslint-disable @typescript-eslint/no-explicit-any */
function ptOf(o: any): Pt { return o?.lat && o?.lng ? { lat: Number(o.lat), lng: Number(o.lng) } : null; }
function whOf(o: any): Pt { return o?.warehouse_lat && o?.warehouse_lng ? { lat: Number(o.warehouse_lat), lng: Number(o.warehouse_lng) } : null; }

function slotRange(slot: string | null | undefined): { start: number; end: number } | null {
  if (!slot) return null;
  const s = String(slot).toLowerCase();
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g; const ts: number[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let h = +m[1]; const mi = m[2] ? +m[2] : 0; const ap = m[3];
    if (ap === "pm" && h !== 12) h += 12; if (ap === "am" && h === 12) h = 0;
    ts.push(h * 60 + mi);
  }
  if (ts.length) return { start: ts[0], end: ts[ts.length - 1] || ts[0] };
  if (/\bmorning\b/.test(s) || /\b(first half|1st half|forenoon)\b/.test(s)) return { start: 9 * 60, end: 12 * 60 };
  if (/\b(second half|2nd half)\b/.test(s)) return { start: 13 * 60, end: 18 * 60 };
  if (/\bnoon\b/.test(s)) return { start: 12 * 60, end: 13 * 60 };
  if (/\bafter\s?noon\b/.test(s)) return { start: 13 * 60, end: 16 * 60 };
  if (/\bevening\b/.test(s)) return { start: 16 * 60, end: 19 * 60 };
  if (/\bnight\b/.test(s)) return { start: 18 * 60, end: 21 * 60 };
  return null;
}
// Explicit customer request (required_time) outranks the booked slot — used for lateness + waiting.
const effWindow = (o: any) => slotRange(o.required_time) ?? slotRange(o.time_slot);
// Visit ORDER only: a requested window first; otherwise retrievals (pre-loaded, delivered first)
// before pickups. This never makes a vendor wait — it just sequences the day.
const sortKey = (o: any) => effWindow(o)?.start ?? (o.order_type === "pickup" ? 13 * 60 : MORNING);
// A stop WAITS only if the customer asked for a specific window; otherwise it's done as early as the
// vehicle can reach it (back-to-back from 9 AM) — no artificial afternoon floor.
const clampStart = (o: any) => effWindow(o)?.start ?? null;

export async function buildVendorPlan(v: any): Promise<VendorPlan> {
  const pts: { lat: number; lng: number }[] = [];
  const idx = new Map<string, number>();
  const add = (p: Pt) => { if (!p) return; const k = `${p.lat},${p.lng}`; if (!idx.has(k)) { idx.set(k, pts.length); pts.push(p); } };
  const depot: Pt = v.depotLat && v.depotLng ? { lat: Number(v.depotLat), lng: Number(v.depotLng) } : null;
  add(depot);
  v.orders.forEach((o: any) => { add(ptOf(o)); add(whOf(o)); });
  const m = pts.length >= 2 ? await roadMatrix(pts) : { dur: [] as (number | null)[][], dist: [] as (number | null)[][] };
  const look = (a: Pt, b: Pt, which: "dur" | "dist"): number | null => {
    if (!a || !b) return null;
    const ia = idx.get(`${a.lat},${a.lng}`), ib = idx.get(`${b.lat},${b.lng}`);
    return ia != null && ib != null ? (m[which][ia]?.[ib] ?? null) : null;
  };
  const travel = (a: Pt, b: Pt): number => look(a, b, "dur") ?? FLAT_TRAVEL;
  const km = (a: Pt, b: Pt): number | null => look(a, b, "dist");

  const steps: PlanStep[] = [];
  const byOrder: VendorPlan["byOrder"] = {};
  let clock = MORNING;
  let prev: Pt = depot;
  let totalKm = 0;

  const push = (kind: string, label: string, t: number, kmLeg: number | null, work: number, o?: any) => {
    const ws = o ? clampStart(o) : null;
    const arrive = ws != null ? Math.max(clock + t, ws) : clock + t; // wait only for an explicit window
    clock = arrive + work;
    if (kmLeg) totalKm += kmLeg;
    const w = o ? effWindow(o) : null;
    const late = w ? arrive > w.end : false;
    steps.push({ kind, label, travel: t, km: kmLeg, work, arrive, depart: clock, slot: o ? (o.required_time || o.time_slot) : undefined, lift: o?.lift, late });
    if (o) byOrder[o.customer_unique_id] = { arrive, depart: clock, late };
  };

  // If the team manually interchanged this vendor's stops, that fixed 1..N order wins outright —
  // sequence and recomputed ETAs both follow it. Otherwise order by when a stop should happen
  // (customer request → else retrieval-morning / pickup-afternoon), tie-break retrieval before
  // pickup, then the optimiser's stop sequence.
  const hasManual = v.orders.some((o: any) => o.manual_seq != null);
  const seq = hasManual
    ? [...v.orders].sort((a: any, b: any) => (a.manual_seq ?? 1e9) - (b.manual_seq ?? 1e9))
    : [...v.orders].sort((a: any, b: any) =>
        sortKey(a) - sortKey(b) ||
        (a.order_type === "pickup" ? 1 : 0) - (b.order_type === "pickup" ? 1 : 0) ||
        (a.stop_seq || 0) - (b.stop_seq || 0));
  const retrCount = v.orders.filter((o: any) => o.order_type !== "pickup").length;
  const pickCount = v.orders.filter((o: any) => o.order_type === "pickup").length;
  const whPt = whOf(v.orders.find((o: any) => whOf(o)) ?? {});
  const whName = v.orders[0]?.warehouse_name ? ` (${String(v.orders[0].warehouse_name).split("·")[0].trim()})` : "";

  if (retrCount) {
    // evening-before: vehicle goes to the warehouse and brings the retrieval goods to the vendor's
    // start. Count that warehouse → start leg in the day's total km.
    const eveKm = km(whPt, depot) ?? 0;
    totalKm += eveKm;
    steps.push({ kind: "wh-eve", label: `Collect ${retrCount} retrieval load${retrCount > 1 ? "s" : ""} from warehouse${whName} → ${v.startingPoint || "start"} — evening before`, travel: 0, km: eveKm, work: 0, arrive: MORNING, depart: MORNING });
  }
  steps.push({ kind: "start", label: `Start from ${v.startingPoint || "depot"}${retrCount ? " (retrievals already loaded)" : ""}`, travel: 0, km: 0, work: 0, arrive: clock, depart: clock });
  for (const o of seq) {
    const p = ptOf(o);
    if (o.order_type === "pickup") push("pickup", `Pick up & pack at ${o.locality || "site"} — ${o.customer_name}`, travel(prev, p), km(prev, p), PICKUP_WORK, o);
    else push("deliver", `Deliver to ${o.locality || "site"} — ${o.customer_name}`, travel(prev, p), km(prev, p), RETR_DELIVER, o);
    prev = p;
  }
  if (pickCount) { push("wh", `Drop pickups at warehouse${whName}`, travel(prev, whPt), km(prev, whPt), WH_UNLOAD); prev = whPt; }
  return { steps, end: clock, totalKm: Math.round(totalKm * 10) / 10, byOrder };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
