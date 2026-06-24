"use client";

import { useState } from "react";
import { ScheduleData } from "@/lib/schedule";
import { money } from "@/lib/format";
import { Card } from "./ui";

const TYPE: Record<string, { label: string; cls: string; dot: string }> = {
  pickup: { label: "Pickup", cls: "bg-blue-50 border-blue-200", dot: "bg-blue-500" },
  full_retrieval: { label: "Retrieval", cls: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  partial_retrieval: { label: "Partial", cls: "bg-amber-50 border-amber-200", dot: "bg-amber-500" },
};

// ── Day-plan estimation (realistic, Bengaluru) ───────────────────────────────────────────────
const START_MIN = 9 * 60;     // day starts 9:00 AM
const SPEED_KMH = 18;         // avg city speed in traffic
const PICKUP_WORK = 240;      // pickup = packing + loading ~4h
const RETR_DELIVER = 60;      // retrieval = deliver/unload ~1h
const WH_LOAD = 30;           // load retrieval goods at the warehouse
const WH_UNLOAD = 30;         // unload pickups at the warehouse
const FLAT_TRAVEL = 30;       // fallback / warehouse legs (no coords)

type Pt = { lat: number; lng: number } | null;
function haversineKm(a: Pt, b: Pt) {
  if (!a || !b) return null;
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function travelMin(a: Pt, b: Pt) {
  const km = haversineKm(a, b);
  return km == null ? FLAT_TRAVEL : Math.max(10, Math.round((km / SPEED_KMH) * 60));
}
function fmtClock(min: number) {
  const h = Math.floor(min / 60) % 24, m = Math.round(min % 60);
  const ap = h >= 12 ? "PM" : "AM"; let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}
function pt(o: any): Pt { return o?.lat && o?.lng ? { lat: Number(o.lat), lng: Number(o.lng) } : null; }
// Parse a customer slot ("9am_11am", "10:00 AM - 11:00 AM", "10am_12pm") -> {start,end} minutes.
function slotRange(slot: string | null | undefined): { start: number; end: number } | null {
  if (!slot) return null;
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g; const times: number[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(String(slot).toLowerCase()))) {
    let h = +m[1]; const mi = m[2] ? +m[2] : 0; const ap = m[3];
    if (ap === "pm" && h !== 12) h += 12; if (ap === "am" && h === 12) h = 0;
    times.push(h * 60 + mi);
  }
  if (!times.length) return null;
  return { start: times[0], end: times[times.length - 1] || times[0] };
}
const slotStart = (o: any) => slotRange(o.time_slot)?.start ?? Infinity;

interface Step { kind: string; label: string; travel: number; work: number; arrive: number; depart: number; slot?: string | null; lift?: string | null; late?: boolean }
function buildDayPlan(v: any): { steps: Step[]; end: number; byOrder: Map<string, { arrive: number; depart: number; late: boolean }> } {
  const steps: Step[] = [];
  const byOrder = new Map<string, { arrive: number; depart: number; late: boolean }>();
  let clock = START_MIN;
  let prev: Pt = v.depotLat && v.depotLng ? { lat: Number(v.depotLat), lng: Number(v.depotLng) } : null;
  steps.push({ kind: "start", label: `Start from ${v.startingPoint || "depot"}`, travel: 0, work: 0, arrive: clock, depart: clock });
  const byTrip = new Map<number, any[]>();
  v.orders.forEach((o: any) => { (byTrip.get(o.trip_no) ?? byTrip.set(o.trip_no, []).get(o.trip_no)!).push(o); });
  const push = (kind: string, label: string, travel: number, work: number, o?: any) => {
    const arrive = clock + travel; clock = arrive + work;
    const r = o ? slotRange(o.time_slot) : null;
    const late = r ? arrive > r.end : false;
    steps.push({ kind, label, travel, work, arrive, depart: clock, slot: o?.time_slot, lift: o?.lift, late });
    if (o) byOrder.set(o.customer_unique_id, { arrive, depart: clock, late });
  };
  // Run the EARLIEST customer-window trips first (so 9-11am work isn't pushed to the afternoon).
  const tripWindow = (tn: number) => Math.min(...byTrip.get(tn)!.map(slotStart));
  for (const tn of [...byTrip.keys()].sort((a, b) => tripWindow(a) - tripWindow(b) || a - b)) {
    const ords = byTrip.get(tn)!.slice().sort((a, b) => slotStart(a) - slotStart(b) || a.stop_seq - b.stop_seq);
    const retr = ords.filter((o) => o.order_type !== "pickup");
    const pick = ords.filter((o) => o.order_type === "pickup");
    const whSrc = ords.find((o) => o.warehouse_lat && o.warehouse_lng);
    const whPt: Pt = whSrc ? { lat: Number(whSrc.warehouse_lat), lng: Number(whSrc.warehouse_lng) } : null;
    const whName = ords[0]?.warehouse_name ? ` (${String(ords[0].warehouse_name).split("·")[0].trim()})` : "";
    if (retr.length) {
      push("wh", `Go to warehouse${whName} — load goods for ${retr.map((o) => o.customer_unique_id).join(", ")}`, travelMin(prev, whPt), WH_LOAD + 10 * retr.length);
      prev = whPt;
      for (const o of retr) { push("deliver", `Deliver to ${o.locality || "site"} — ${o.customer_name}`, travelMin(prev, pt(o)), RETR_DELIVER, o); prev = pt(o); }
    }
    for (const o of pick) { push("pickup", `Pick up & pack at ${o.locality || "site"} — ${o.customer_name}`, travelMin(prev, pt(o)), PICKUP_WORK, o); prev = pt(o); }
    if (pick.length) { push("wh", `Return to warehouse${whName} — unload`, travelMin(prev, whPt), WH_UNLOAD); prev = whPt; }
  }
  return { steps, end: clock, byOrder };
}

const KIND_DOT: Record<string, string> = { start: "bg-slate-300", wh: "bg-slate-400", deliver: "bg-emerald-500", pickup: "bg-blue-500" };

// Lift available at the site? No lift => more manual carry => the team typically adds a resource.
function liftBadge(raw: string | null | undefined) {
  if (raw == null || String(raw).trim() === "") return null;
  const v = String(raw).trim().toLowerCase();
  if (/^(y|yes|true|1|available)$/.test(v)) return { ok: true, text: "Lift ✓" };
  if (/^(n|no|false|0|not available|na)$/.test(v)) return { ok: false, text: "⚠ No lift" };
  return { ok: null as null, text: `Lift: ${raw}` };
}

// One city's persisted schedule. Owns its own state; reloads from the server after any change
// (reassign vendor / add resource / notify) so groupings stay correct.
export default function ScheduleCityView({ initial }: { initial: ScheduleData }) {
  const [sched, setSched] = useState<ScheduleData>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [openPlan, setOpenPlan] = useState<string | null>(null);

  async function reload() {
    const r = await fetch(`/api/schedule?city=${sched.city}&date=${sched.date}`).then((x) => x.json());
    if (r.schedule) setSched(r.schedule);
  }

  async function notify(kind: "vendor" | "customer", ids: { vendorId?: string | null; orderId?: string }) {
    const key = `${kind}:${ids.vendorId ?? ids.orderId}`;
    setPending(key);
    await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: sched.runId, kind, ...ids }) });
    await reload();
    setPending(null);
  }

  async function reassign(orderUuid: string, vendorId: string) {
    const av = sched.availableVendors.find((x) => x.id === vendorId);
    setPending(`assign:${orderUuid}`);
    await fetch("/api/schedule/assignment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: sched.runId, orderUuid, action: "reassign", vendorId: vendorId || null, vendorName: av?.name ?? null }) });
    await reload();
    setPending(null);
  }

  async function setResources(vendorName: string, n: number) {
    setPending(`res:${vendorName}`);
    await fetch("/api/schedule/assignment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: sched.runId, action: "resources", vendorName, resources: Math.max(0, n) }) });
    await reload();
    setPending(null);
  }

  return (
    <div className="space-y-3">
      {sched.vendors.map((v) => {
        const plan = !v.isUnassigned ? buildDayPlan(v) : null;
        return (
        <Card key={v.vendorId ?? v.vendorName} className={`overflow-hidden ${v.isUnassigned ? "ring-1 ring-amber-300" : ""}`}>
          <div className={`flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 ${v.isUnassigned ? "bg-amber-50" : "bg-slate-50"}`}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800">{v.vendorName}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {v.startingPoint ? `from ${v.startingPoint} · ` : ""}{!v.isUnassigned && `${v.tripCount} trip${v.tripCount > 1 ? "s" : ""} · `}{v.orders.length} stops · {v.actualPallets} pallets{v.actualPallets !== v.pallets ? ` (${v.pallets} assumed)` : ""} · {money(v.revenue)} transport
                {v.resources > 0 && <span className="text-slate-400"> · {v.resources} resource{v.resources > 1 ? "s" : ""} (+{money(v.resources * sched.resourceCost)})</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                {v.supervisorName && <span>Supervisor: <b className="font-medium text-slate-700">{v.supervisorName}</b> {v.supervisorContact}</span>}
                {v.driverName && <span>Driver: <b className="font-medium text-slate-700">{v.driverName}</b> {v.driverContact}</span>}
                {(v.vehicleType || v.vehicleNo) && <span>Vehicle: <b className="font-medium text-slate-700">{v.vehicleType === "others" ? "Other" : v.vehicleType || ""}</b>{v.vehicleNo ? `${v.vehicleType ? " · " : ""}${v.vehicleNo}` : ""}</span>}
              </div>
            </div>
            {v.isUnassigned ? (
              <span className="shrink-0 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800">Assign a vendor on each order ↓</span>
            ) : (
              <div className="flex shrink-0 items-center gap-2">
                <span className="flex items-center gap-1 text-[11px] text-slate-500" title="Extra labour resource for the whole day">
                  <span>Resource:</span>
                  <button disabled={pending === `res:${v.vendorName}` || v.resources <= 0} onClick={() => setResources(v.vendorName, v.resources - 1)} className="h-5 w-5 rounded bg-white text-slate-600 ring-1 ring-slate-200 disabled:opacity-30">−</button>
                  <span className="w-4 text-center font-medium text-slate-700">{v.resources}</span>
                  <button disabled={pending === `res:${v.vendorName}`} onClick={() => setResources(v.vendorName, v.resources + 1)} className="rounded bg-white px-1.5 py-0.5 text-slate-700 ring-1 ring-slate-200">+ {money(sched.resourceCost)}</button>
                </span>
                <button
                  onClick={() => setOpenPlan(openPlan === (v.vendorId ?? v.vendorName) ? null : (v.vendorId ?? v.vendorName))}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  {openPlan === (v.vendorId ?? v.vendorName) ? "Hide details" : "Details"}
                </button>
                <button
                  disabled={pending === `vendor:${v.vendorId}` || !v.vendorId}
                  onClick={() => notify("vendor", { vendorId: v.vendorId })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${v.vendorNotifiedAt ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-900 text-white hover:bg-slate-700"}`}
                >
                  {pending === `vendor:${v.vendorId}` ? "…" : v.vendorNotifiedAt ? "Vendor notified ✓" : "Notify vendor"}
                </button>
              </div>
            )}
          </div>

          {!v.isUnassigned && plan && openPlan === (v.vendorId ?? v.vendorName) && (() => {
            return (
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div className="mb-2 text-xs font-semibold text-slate-700">
                  Estimated day plan · starts {fmtClock(START_MIN)} · ends ~{fmtClock(plan.end)}
                  <span className="ml-2 font-normal text-slate-400">times are estimates (18 km/h in traffic; pack ~4h/pickup, deliver ~1h)</span>
                </div>
                <ol className="space-y-1.5">
                  {plan.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[s.kind] ?? "bg-slate-400"}`} />
                      <span className="w-28 shrink-0 font-medium text-slate-700">{fmtClock(s.arrive)}–{fmtClock(s.depart)}</span>
                      <span className="min-w-0 text-slate-600">
                        {s.label}
                        <span className="text-slate-400"> · {s.travel}m travel + {s.work}m work</span>
                        {s.slot && <span className={`ml-1 rounded px-1 text-[10px] ring-1 ${s.late ? "bg-red-50 text-red-600 ring-red-200" : "bg-white text-slate-500 ring-slate-200"}`}>customer wants {s.slot.replace(/:00/g, "")}{s.late ? " · LATE" : ""}</span>}
                        {liftBadge(s.lift)?.ok === false && <span className="ml-1 rounded bg-orange-100 px-1 text-[10px] font-medium text-orange-700">⚠ no lift</span>}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })()}

          <div className="divide-y divide-slate-100">
            {(v.isUnassigned ? v.orders : [...v.orders].sort((a: any, b: any) => (plan?.byOrder.get(a.customer_unique_id)?.arrive ?? 1e9) - (plan?.byOrder.get(b.customer_unique_id)?.arrive ?? 1e9))).map((o: any, idx: number) => {
              const t = TYPE[o.order_type] ?? TYPE.pickup;
              return (
                <div key={o.id ?? o.order_id} className={`border-l-4 px-4 py-2.5 ${t.cls}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {!v.isUnassigned && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">{idx + 1}</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${t.dot}`}>{t.label}{o.is_intercity ? " · intercity" : ""}</span>
                    <span className="text-sm font-medium text-slate-800">{o.customer_unique_id}</span>
                    <span className="text-sm text-slate-600">{o.locality} · {o.customer_name}</span>
                    {/* pallets: ACTUAL (as booked) first, ASSUMED (buffered for pickups) in brackets */}
                    <span className="text-xs text-slate-600">
                      <b className="font-semibold">{(o.stated_pallets ?? o.pallets) ?? "—"}p</b> <span className="text-slate-400">actual</span>
                      {o.order_type === "pickup" && o.stated_pallets != null && Number(o.stated_pallets) !== Number(o.pallets) && (
                        <span className="ml-1 text-slate-400">({o.pallets}p assumed)</span>
                      )}
                    </span>
                    <span className="text-xs text-slate-500">{o.transport_charge != null ? money(o.transport_charge) : "—"}</span>
                    {/* PLANNED arrival (from the day plan) vs the customer's REQUESTED window */}
                    {plan?.byOrder.get(o.customer_unique_id) && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${plan.byOrder.get(o.customer_unique_id)!.late ? "bg-red-600" : "bg-slate-900"}`}>~{fmtClock(plan.byOrder.get(o.customer_unique_id)!.arrive)}</span>
                    )}
                    {o.time_slot && <span className={`text-xs ${plan?.byOrder.get(o.customer_unique_id)?.late ? "text-red-500" : "text-slate-400"}`}>wants {o.time_slot.replace(/:00/g, "")}</span>}
                    {o.required_time && <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">⏰ {o.required_time}</span>}
                    {(() => { const lb = liftBadge(o.lift); return lb ? <span className={`rounded px-1 text-[10px] font-medium ${lb.ok === false ? "bg-orange-100 text-orange-700" : lb.ok ? "bg-slate-100 text-slate-500" : "bg-slate-100 text-slate-500"}`}>{lb.text}</span> : null; })()}
                  </div>
                  {o.team_notes && <div className="mt-1 truncate text-[11px] text-slate-500">📝 {o.team_notes}</div>}

                  {/* controls: reassign vendor · notify customer (resource is per-vendor, in the header) */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <select
                      value={v.vendorId ?? ""}
                      disabled={pending === `assign:${o.id}`}
                      onChange={(e) => reassign(o.id, e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700"
                    >
                      <option value="">— team to assign —</option>
                      {sched.availableVendors.map((av) => (
                        <option key={av.id} value={av.id}>{av.name}</option>
                      ))}
                    </select>

                    {!v.isUnassigned && (
                      <button
                        disabled={pending === `customer:${o.order_id}`}
                        onClick={() => notify("customer", { orderId: o.order_id })}
                        className={`ml-auto shrink-0 rounded px-2 py-1 text-[11px] font-medium ${o.customerNotifiedAt ? "bg-emerald-100 text-emerald-700" : "bg-white text-blue-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
                      >
                        {pending === `customer:${o.order_id}` ? "…" : o.customerNotifiedAt ? "Customer notified ✓" : "Notify customer"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        );
      })}
    </div>
  );
}
