"use client";

import { useEffect, useState } from "react";
import { ScheduleData } from "@/lib/schedule";
import { teamsNeeded } from "@/lib/config";
import { LifeStep } from "./Lifecycle";

const cityName = (slug: string) => slug.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

type Live = { wms: string | null; wmsCode: number | null; status: string | null; transport: number | null; booked?: string | null };
type LiveMap = Record<string, Live>;

/* eslint-disable @typescript-eslint/no-explicit-any */
const isPickup = (o: any) => o.order_type === "pickup";
const liveOf = (o: any, m: LiveMap): Live | null => m[String(o.order_id ?? "")] ?? null;
// A big order runs 2 teams of one vendor — label the node so the monitor shows it.
const refWithTeams = (o: any): string => { const t = teamsNeeded(Number(o.pallets) || 0); return t > 1 ? `${o.customer_unique_id} · ${t} teams` : o.customer_unique_id; };
const statusOf = (o: any, m: LiveMap) => (liveOf(o, m)?.status ?? o.order_status ?? "").toLowerCase();
const wmsOf = (o: any, m: LiveMap) => (liveOf(o, m)?.wms ?? "").toUpperCase();

// The vendor app's live status (what the SUPERVISOR taps in the phone) is the PRIMARY signal — the
// WMS feed is the fallback. Flow: assigned → en_route → arrived → packing → loaded → delivered.
const appStatus = (o: any) => String(o.live_status ?? "").toLowerCase();
const appStarted = (o: any) => ["collected", "en_route", "arrived", "packing", "loaded", "delivered"].includes(appStatus(o));
const APP_ORDER = ["assigned", "collected", "en_route", "arrived", "packing", "loaded", "delivered"];
const APP_LABEL: Record<string, string> = { collected: "📦 collected", en_route: "🚚 on the way", arrived: "📍 reached", packing: "📦 packing", loaded: "✅ loaded", delivered: "🏁 delivered" };

// Map the vendor-app status (or the WMS feed as fallback) to the on-ground milestones.
const collected = (o: any, m: LiveMap) => appStarted(o) || (() => { const n = wmsOf(o, m); return n === "GATE_PASS" || n === "RETRIEVAL_COMPLETD" || statusOf(o, m) === "completed"; })();
const delivered = (o: any, m: LiveMap) => appStatus(o) === "delivered" || wmsOf(o, m) === "RETRIEVAL_COMPLETD" || statusOf(o, m) === "completed";
const pickedUp = (o: any, m: LiveMap) => ["loaded", "delivered"].includes(appStatus(o)) || statusOf(o, m) === "completed" || /INBOUND|RECEIV|GRN|INWARD/.test(wmsOf(o, m));
const droppedWh = (o: any, m: LiveMap) => appStatus(o) === "delivered" || /INBOUND|RECEIV|GRN|INWARD/.test(wmsOf(o, m)) || statusOf(o, m) === "completed";

const FRIENDLY: Record<string, string> = { GATE_PASS: "out of warehouse", RETRIEVAL_COMPLETD: "delivered", READY_TO_OUTBOUND: "ready at WH", READY_FOR_PICKLIST: "picking at WH" };
// Prefer the vendor-app live state; fall back to the WMS label.
const friendly = (o: any, m: LiveMap) => { const a = APP_LABEL[appStatus(o)]; if (a) return a; const n = wmsOf(o, m); return n ? (FRIENDLY[n] ?? n.toLowerCase().replace(/_/g, " ")) : null; };

// When the customer booked this order (order_created_at from the live feed, "2026-01-04 09:31:29")
// → a short "4 Jan 2026" the team can read. Falls back to undefined if missing/unparseable.
const bookedOn = (o: any, m: LiveMap): string | undefined => {
  const raw = liveOf(o, m)?.booked;
  if (!raw) return undefined;
  const d = new Date(String(raw).replace(" ", "T"));
  return isNaN(d.getTime()) ? undefined : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

// Short clock (from a "YYYY-MM-DD HH:MM:SS" timestamp) → "2:15 PM".
const shortClock = (raw: string | null | undefined): string | undefined => {
  if (!raw) return undefined;
  const mt = String(raw).match(/(\d{1,2}):(\d{2})/);
  if (!mt) return undefined;
  let h = Number(mt[1]); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${mt[2]} ${ap}`;
};
// The time a stop was actually completed. The WMS feed carries NO timestamps, so we use the vendor
// app's live_status_at (set when the vendor taps loaded/delivered). "done at 2:15 PM".
const doneTime = (o: any): string | undefined =>
  o?.live_status_at && (o.live_status === "delivered" || o.live_status === "loaded")
    ? `done ${shortClock(o.live_status_at)}`
    : undefined;

// ── Live location + ETA (from the vendor app's GPS pings) ─────────────────────
function havKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
// Rough city ETA: straight-line × 1.4 road factor at ~22 km/h.
const etaMin = (km: number) => Math.max(1, Math.round((km * 1.4) / 22 * 60));
function minsSince(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = new Date(String(raw).replace(" ", "T")).getTime();
  if (isNaN(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}
const agoLabel = (m: number | null) => (m == null ? "" : m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`);
// Freshness of the last GPS ping → dot colour.
const freshDot = (m: number | null) => (m == null ? "bg-slate-300" : m < 5 ? "bg-emerald-500" : m < 20 ? "bg-amber-500" : "bg-slate-400");

// ---- Per-order app flow: each order gets its OWN round-circle step flow (exactly the buttons the
// vendor presses in the app), with the tap time under each completed step.
// "Loading started" (packing) was dropped from the app — one "Loaded" step now. A legacy 'packing'
// status from older app builds still counts as past "Reached" via APP_ORDER.
const PICKUP_FLOW: [string, string][] = [["en_route", "Started"], ["arrived", "Reached"], ["loaded", "Loaded"], ["delivered", "At WH"]];
const RETR_FLOW: [string, string][] = [["collected", "Collected"], ["en_route", "Started"], ["arrived", "Reached"], ["loaded", "Unloaded"], ["delivered", "Done"]];

// Chip label per photo kind the vendor app captures.
const PHOTO_KIND: Record<string, string> = { team: "👥 Team photo", kyc: "🪪 KYC", delivery: "📦 Delivery", damage: "⚠️ Damage" };

function OrderFlow({ o, live, photos }: { o: any; live: LiveMap; photos?: { id: string; kind: string; createdAt: string }[] }) {
  const [viewPhoto, setViewPhoto] = useState<{ id: string; label: string } | null>(null);
  const pk = isPickup(o);
  const flow = pk ? PICKUP_FLOW : RETR_FLOW;
  const appIdx = APP_ORDER.indexOf(String(o.live_status ?? "assigned"));
  const blendDone = pk ? pickedUp(o, live) : delivered(o, live); // WMS says finished (vendor may not have used the app)
  // Next pending step = first flow step BEYOND the current status (the flow may skip statuses
  // that exist in APP_ORDER, e.g. the retired 'packing').
  const activeIdx = flow.findIndex(([st]) => APP_ORDER.indexOf(st) > appIdx);
  const floorOk = o.floor != null && String(o.floor).trim() !== "" && !/^na$/i.test(String(o.floor).trim());
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
      {/* header: ref + customer + the order facts the office needs at a glance */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-white ${pk ? "bg-blue-600" : "bg-emerald-600"}`}>{pk ? "Pickup" : "Retrieval"}</span>
        <span className="text-[13px] font-bold text-slate-900">{o.customer_unique_id}</span>
        <span className="text-slate-600">{o.customer_name}</span>
        {o.locality && <span className="text-slate-400">📍 {o.locality}</span>}
        {o.contact && <a className="font-medium text-blue-600 hover:underline" href={`tel:${String(o.contact).split(/[/,]/)[0].trim()}`}>📞 {String(o.contact).split(/[/,]/)[0].trim()}</a>}
        {(o.stated_pallets ?? o.pallets) != null && <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200"><b>{o.stated_pallets ?? o.pallets}p</b></span>}
        {o.transport_charge != null && Number(o.transport_charge) > 0 && <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">₹{Number(o.transport_charge).toLocaleString("en-IN")} transport</span>}
        {o.lift != null && String(o.lift).trim() !== "" && <span className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ${/^(n|no|false|0|na)$/i.test(String(o.lift).trim()) ? "bg-orange-50 text-orange-700 ring-orange-200" : "bg-white text-slate-600 ring-slate-200"}`}>{/^(n|no|false|0|na)$/i.test(String(o.lift).trim()) ? "⚠ no lift" : "lift ✓"}</span>}
        {floorOk && <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">🏢 floor {String(o.floor).trim()}</span>}
        {o.time_slot && <span className="text-[11px] text-slate-400">wants {String(o.time_slot).replace(/:00/g, "")}</span>}
        {/* Public live-tracking link — copy & WhatsApp it to the customer (page needs no login). */}
        <button
          onClick={() => {
            const url = `${location.origin}/safestorage-transport/track/${o.id}`;
            navigator.clipboard?.writeText(url).then(
              () => alert(`Live-tracking link copied for ${o.customer_unique_id}:\n${url}\n\nPaste it to the customer on WhatsApp.`),
              () => alert(url),
            );
          }}
          className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
          title="Copy the customer's live-tracking link"
        >
          🔗 track link
        </button>
        {/* Photos the vendor captured in the app (team / KYC / delivery / damage) with upload time —
            click to view. The team photo is the proof the crew was on site. */}
        {(photos ?? []).map((p) => (
          <button
            key={p.id}
            onClick={() => setViewPhoto({ id: p.id, label: `${PHOTO_KIND[p.kind] ?? p.kind} · ${o.customer_unique_id}` })}
            className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100"
            title="Uploaded from the vendor app — click to view"
          >
            {PHOTO_KIND[p.kind] ?? `📷 ${p.kind}`} · {shortClock(p.createdAt) ?? ""}
          </button>
        ))}
      </div>
      {viewPhoto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4" onClick={() => setViewPhoto(null)}>
          <div className="max-h-full max-w-2xl overflow-auto rounded-xl bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-bold text-slate-800">{viewPhoto.label}</span>
              <button onClick={() => setViewPhoto(null)} className="ml-auto rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">✕</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/schedule/order-photos?img=${viewPhoto.id}`} alt={viewPhoto.label} className="max-h-[75vh] w-auto rounded-lg" />
          </div>
        </div>
      )}
      {/* compact stepper: small circles, one tight row */}
      <div className="flex items-center gap-0 overflow-x-auto pb-0.5">
        {flow.map(([st, label], i) => {
          const done = appIdx >= APP_ORDER.indexOf(st) || (blendDone && appIdx <= 0);
          const active = !done && i === (activeIdx === -1 ? 0 : activeIdx) && !blendDone && appIdx >= 0;
          const at = o.app_events?.[st] ? shortClock(o.app_events[st]) : (blendDone && appIdx <= 0 && i === flow.length - 1 ? "WMS" : undefined);
          return (
            <div key={st} className="flex items-center">
              {i > 0 && <div className={`h-0.5 w-5 shrink-0 sm:w-8 ${done ? "bg-emerald-400" : "bg-slate-200"}`} />}
              <div className="flex w-[64px] shrink-0 flex-col items-center">
                <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-emerald-500 text-white" : active ? "bg-amber-400 text-white ring-2 ring-amber-200" : "bg-slate-200 text-slate-500"}`}>
                  {done ? "✓" : i + 1}
                </div>
                <span className={`mt-0.5 text-[10px] font-semibold leading-tight ${done ? "text-emerald-700" : active ? "text-amber-700" : "text-slate-400"}`}>{label}</span>
                <span className="h-3 text-[9px] leading-tight text-slate-400">{at ?? ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ordered(orders: any[], plan: any) {
  return [...orders].sort((a, b) =>
    (plan?.byOrder?.[a.customer_unique_id]?.arrive ?? a.stop_seq ?? 0) -
    (plan?.byOrder?.[b.customer_unique_id]?.arrive ?? b.stop_seq ?? 0));
}

// Combined chain: collect retrievals from warehouse → deliver each → do each pickup → drop pickups.
// Step done-states come from the live WMS feed.
function vendorChain(v: any, m: LiveMap): LifeStep[] {
  const retr = ordered(v.orders.filter((o: any) => !isPickup(o)), v.plan);
  const pick = ordered(v.orders.filter((o: any) => isPickup(o)), v.plan);
  const steps: LifeStep[] = [];

  if (retr.length) {
    // The team collects every retrieval from the warehouse in one go, then delivers them one by one.
    // "Collect" is done only when all retrievals have actually left the warehouse (GATE_PASS) — the
    // sub-label shows that progress live (e.g. "1/2 picked" → "all picked from WH").
    const got = retr.filter((o) => collected(o, m)).length;
    const allGot = got === retr.length;
    steps.push({
      label: "Collect", kind: "retrieval", done: allGot,
      sub: allGot ? (retr.length > 1 ? "all picked from WH" : "picked from WH") : `${got}/${retr.length} picked`,
      top: { ref: `${retr.length} retrieval${retr.length > 1 ? "s" : ""}`, name: "from warehouse" },
    });
    for (const o of retr) steps.push({ label: "Deliver", sub: friendly(o, m) ?? undefined, at: doneTime(o), kind: "retrieval", done: delivered(o, m), top: { ref: refWithTeams(o), name: o.customer_name, area: o.locality ?? undefined, phone: o.contact, booked: bookedOn(o, m) } });
  }
  for (const o of pick) steps.push({ label: "Pick up", sub: friendly(o, m) ?? undefined, at: doneTime(o), kind: "pickup", done: pickedUp(o, m), top: { ref: refWithTeams(o), name: o.customer_name, area: o.locality ?? undefined, phone: o.contact, booked: bookedOn(o, m) } });
  if (pick.length) {
    const dropped = pick.filter((o) => droppedWh(o, m)).length;
    const allDropped = dropped === pick.length;
    steps.push({
      label: "Drop", kind: "pickup", done: allDropped,
      sub: allDropped ? (pick.length > 1 ? "all dropped at WH" : "dropped at WH") : `${dropped}/${pick.length} dropped`,
      top: { ref: `${pick.length} pickup${pick.length > 1 ? "s" : ""}`, name: "to warehouse" },
    });
  }
  return steps;
}

// Current wall-clock in IST, as minutes-from-midnight — to compare against the plan's arrive/depart
// (which are built on a 9 AM IST start). Independent of the viewer's own timezone.
function nowMinIST(): number {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const mi = Number(p.find((x) => x.type === "minute")?.value ?? 0);
  return h * 60 + mi;
}

// How off-track a team is RIGHT NOW. For every stop not yet done we compare the planned finish time
// (depart) against the clock: a stop whose time has passed but isn't done is "overdue", and we add up
// how many minutes behind. Higher score = more / longer overdue stops = needs attention first.
function vendorRisk(v: any, m: LiveMap, now: number) {
  let behind = 0, overdue = 0, pendingLate = 0, done = 0;
  const total = v.orders.length;
  for (const o of v.orders) {
    const isDone = isPickup(o) ? pickedUp(o, m) : delivered(o, m);
    if (isDone) { done++; continue; }
    const bo = v.plan?.byOrder?.[o.customer_unique_id];
    if (bo?.late) pendingLate++;
    const planned = bo?.depart ?? bo?.arrive ?? null;
    if (planned != null && now > planned) { overdue++; behind += now - planned; }
  }
  const allDone = total > 0 && done === total;
  // allDone sinks to the bottom; on-track-but-pending sits above that; any overdue ranks on top.
  const score = allDone ? -1 : behind + overdue * 10 + pendingLate * 20;
  return { score, behind, overdue, pendingLate, allDone };
}

const behindLabel = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);

export default function MonitoringView({ cities, vendorFilter = "All" }: { cities: ScheduleData[]; vendorFilter?: string }) {
  const [live, setLive] = useState<LiveMap>({});
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  // Photos captured in the vendor app (team/KYC/delivery/damage) keyed by order UUID — shown as
  // clickable chips with the upload time on each order row.
  const [orderPhotos, setOrderPhotos] = useState<Record<string, { id: string; kind: string; createdAt: string }[]>>({});
  useEffect(() => {
    const ids = cities.flatMap((c) => c.vendors.flatMap((v: any) => v.orders.map((o: any) => o.id))).filter(Boolean);
    if (!ids.length) return;
    let alive = true;
    fetch(`/api/schedule/order-photos?ids=${ids.join(",")}`)
      .then((r) => r.json())
      .then((j) => { if (alive && j?.ok) setOrderPhotos(j.photos ?? {}); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cities.map((c) => c.vendors.map((v: any) => v.orders.map((o: any) => o.id))))]);
  // Same-day notify: a vendor assigned TODAY (e.g. via the manual-assign card) sees nothing in the
  // app until notified — so today's cards need the button too, not just tomorrow's schedule.
  const [notifPending, setNotifPending] = useState<string | null>(null);
  const [notifDone, setNotifDone] = useState<Record<string, boolean>>({});
  const notifyVendor = async (runId: string, v: any) => {
    const key = String(v.vendorId);
    setNotifPending(key);
    try {
      const r = await fetch("/api/notify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, kind: "vendor", vendorId: v.vendorId }),
      }).then((x) => x.json()).catch(() => null);
      if (r?.ok) {
        setNotifDone((m) => ({ ...m, [key]: true }));
        if (r.warning) alert(`⚠ ${r.warning}`);
      } else {
        alert(`Notify failed: ${r?.error ?? "network error"}`);
      }
    } finally { setNotifPending(null); }
  };

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const j = await fetch("/api/wms-status").then((r) => r.json());
        if (alive && j?.map) { setLive(j.map); setUpdatedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })); }
      } catch { /* keep last */ }
    };
    pull();
    const t = setInterval(pull, 60_000); // refresh live status every minute
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (cities.length === 0) return null;
  const now = nowMinIST();

  // Live roll-up — uses the SAME done-logic as the timeline (vendor app status + WMS feed), so the
  // cards always agree with the green ticks below.
  let pickups = 0, retr = 0, pickDone = 0, retrDone = 0, inProg = 0, notStarted = 0, danger = 0;
  const liveTeams = new Set<string>();
  for (const c of cities) for (const v of c.vendors as any[]) {
    if (v.isUnassigned) continue;
    if (v.liveLat != null && v.liveLng != null) liveTeams.add(String(v.vendorId ?? v.vendorName));
    for (const o of v.orders as any[]) {
      const isP = isPickup(o);
      if (isP) pickups++; else retr++;
      const done = isP ? pickedUp(o, live) : delivered(o, live);
      if (done) { if (isP) pickDone++; else retrDone++; continue; }
      const started = appStarted(o) || collected(o, live);
      if (started) inProg++; else notStarted++;
      const bo = v.plan?.byOrder?.[o.customer_unique_id];
      if ((bo?.arrive != null && now > bo.arrive) || bo?.late) danger++;
    }
  }
  const cards = [
    { label: "Orders", value: pickups + retr },
    { label: "Pickups done", value: `${pickDone}/${pickups}`, good: pickups > 0 && pickDone === pickups },
    { label: "Retrievals done", value: `${retrDone}/${retr}`, good: retr > 0 && retrDone === retr },
    { label: "In progress", value: inProg, accent: true },
    { label: "Not started", value: notStarted },
    { label: "⚠ At risk", value: danger, neg: danger > 0 },
    { label: "Live teams", value: liveTeams.size },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {cards.map((s: any) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{s.label}</div>
            <div className={`mt-0.5 text-lg font-bold ${s.neg ? "text-red-600" : s.good ? "text-emerald-600" : s.accent ? "text-amber-600" : "text-slate-900"}`}>{s.value}</div>
          </div>
        ))}
      </div>
      {updatedAt && <div className="-mt-4 text-right text-[11px] text-slate-400">live status · updated {updatedAt} · auto-refreshes every minute</div>}
      {cities.map((c) => {
        // Worst-first: teams running late float to the top, on-track teams sink, finished ones last.
        const assigned = c.vendors
          .filter((v: any) => !v.isUnassigned && v.orders.length)
          .filter((v: any) => vendorFilter === "All" || v.vendorName === vendorFilter)
          .map((v: any) => ({ v, risk: vendorRisk(v, live, now) }))
          .sort((a, b) => b.risk.score - a.risk.score || b.risk.overdue - a.risk.overdue)
          .map((x) => x.v);
        const unassigned = c.vendors.filter((v: any) => v.isUnassigned).flatMap((v: any) => v.orders);
        if (assigned.length === 0 && unassigned.length === 0) return null;
        return (
          <section key={c.city}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b border-slate-200 pb-1">
              <h2 className="text-base font-bold text-slate-900">{cityName(c.city)}</h2>
              <span className="text-xs text-slate-500">{assigned.length} teams · {c.vendors.reduce((s: number, v: any) => s + v.orders.length, 0)} bookings</span>
            </div>

            <div className="space-y-3">
              {assigned.map((v: any) => {
                const retr = v.orders.filter((o: any) => !isPickup(o)).length;
                const pick = v.orders.filter((o: any) => isPickup(o)).length;
                const vendorContact = v.driverContact || v.supervisorContact || null;
                const steps = vendorChain(v, live);
                const doneCount = steps.filter((s) => s.done).length;
                const activeIdx = steps.findIndex((s) => !s.done);
                const allDone = activeIdx === -1;
                const next = allDone ? null : steps[activeIdx];
                const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
                const risk = vendorRisk(v, live, now);
                const late = !allDone && risk.overdue > 0;
                return (
                  <div key={v.vendorId ?? v.vendorName} className={`rounded-xl border bg-white p-4 border-l-4 ${late ? "border-rose-200 border-l-rose-500 ring-1 ring-rose-100" : allDone ? "border-slate-200 border-l-emerald-500" : "border-slate-200 border-l-amber-400"}`}>
                    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-bold text-slate-900">{v.vendorName}</span>
                      {vendorContact && <span className="text-xs text-slate-400">{vendorContact}</span>}
                      {v.isIntercity && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200">intercity</span>}
                      <span className="text-xs text-slate-500">{retr ? `${retr} retrieval${retr > 1 ? "s" : ""}` : ""}{retr && pick ? " · " : ""}{pick ? `${pick} pickup${pick > 1 ? "s" : ""}` : ""}</span>
                      {/* Where this team is right now — late warning first, then the next/done state */}
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        {v.vendorId && (() => {
                          const key = String(v.vendorId);
                          const done = !!v.vendorNotifiedAt || notifDone[key];
                          const busy = notifPending === key;
                          return done ? (
                            <button onClick={() => notifyVendor(c.runId, v)} disabled={busy}
                              title="Schedule already sent to this vendor's app — click to resend (WhatsApp + app)"
                              className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50">
                              {busy ? "…" : "✓ Notified · resend"}
                            </button>
                          ) : (
                            <button onClick={() => notifyVendor(c.runId, v)} disabled={busy}
                              title="Send today's jobs to this vendor — WhatsApp message + makes the jobs appear in their app"
                              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                              {busy ? "…" : "📣 Notify vendor"}
                            </button>
                          );
                        })()}
                        {late && (
                          <span className="flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" /></span>
                            ⚠ Running late · {risk.overdue} stop{risk.overdue > 1 ? "s" : ""} · {behindLabel(risk.behind)} behind
                          </span>
                        )}
                        {allDone ? (
                          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><path d="m5 13 4 4L19 7" /></svg>
                            All stops done
                          </span>
                        ) : (
                          <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${late ? "bg-slate-50 text-slate-600 ring-1 ring-slate-200" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"}`}>
                            {!late && <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" /></span>}
                            Next: <b className={late ? "font-semibold text-slate-800" : "font-semibold text-amber-900"}>{next?.label}{next?.top?.ref ? ` · ${next.top.ref}` : ""}</b>
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Live location + ETA (from the vendor app's GPS pings) */}
                    {v.liveLat != null && v.liveLng != null && (() => {
                      const ago = minsSince(v.liveLocationAt);
                      const pending = ordered(v.orders, v.plan).filter((o: any) => (isPickup(o) ? !pickedUp(o, live) : !delivered(o, live)));
                      const nx = pending.find((o: any) => o.lat != null && o.lng != null);
                      // Prefer the real road ETA (OSRM, from the server); fall back to a straight-line estimate.
                      const eta = v.etaMin != null ? v.etaMin : (nx ? etaMin(havKm(v.liveLat, v.liveLng, nx.lat, nx.lng)) : null);
                      const etaRef = v.etaToRef ?? (nx ? nx.customer_unique_id : null);
                      return (
                        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <a href={`https://www.google.com/maps/search/?api=1&query=${v.liveLat},${v.liveLng}`} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100" title="Vendor's live GPS from the app">
                            <span className={`h-2 w-2 rounded-full ${freshDot(ago)}`} /> Live location · {agoLabel(ago)}
                          </a>
                          {eta != null && etaRef && (
                            <span className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700 ring-1 ring-blue-200" title="Driving ETA from the vendor's current location to the next stop">
                              ~{eta} min to {etaRef}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    {/* Progress bar: how far through the run this team is */}
                    <div className="mb-3 flex items-center gap-2.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${late ? "bg-rose-500" : allDone ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="shrink-0 text-[11px] font-medium text-slate-500">{doneCount}/{steps.length} stops</span>
                    </div>
                    {/* ONE round-circle flow PER ORDER — the exact app steps, with tap times */}
                    <div className="space-y-2.5">
                      {ordered(v.orders, v.plan).map((o: any) => <OrderFlow key={o.id ?? o.order_id} o={o} live={live} photos={orderPhotos[o.id]} />)}
                    </div>
                  </div>
                );
              })}

              {unassigned.length > 0 && (
                <div className="rounded-xl border border-amber-200 border-l-4 border-l-amber-400 bg-amber-50/40 p-4">
                  <div className="mb-2 text-sm font-bold text-amber-700">Awaiting team assignment · {unassigned.length}</div>
                  <div className="flex flex-wrap gap-2">
                    {unassigned.map((o: any, i: number) => (
                      <span key={(o.customer_unique_id ?? i) + "-" + i} className="rounded-lg bg-white px-2.5 py-1 text-xs ring-1 ring-amber-200">
                        <b className="font-semibold text-slate-800">{o.customer_unique_id}</b> <span className="text-slate-600">{o.customer_name}</span>
                        <span className="ml-1 text-slate-400">{isPickup(o) ? "pickup" : "retrieval"}{o.is_intercity ? " · intercity" : ""}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
