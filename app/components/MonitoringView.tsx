"use client";

import { useEffect, useState } from "react";
import { ScheduleData } from "@/lib/schedule";
import Lifecycle, { LifeStep } from "./Lifecycle";

const cityName = (slug: string) => slug.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

type Live = { wms: string | null; wmsCode: number | null; status: string | null; transport: number | null };
type LiveMap = Record<string, Live>;

/* eslint-disable @typescript-eslint/no-explicit-any */
const isPickup = (o: any) => o.order_type === "pickup";
const liveOf = (o: any, m: LiveMap): Live | null => m[String(o.order_id ?? "")] ?? null;
const statusOf = (o: any, m: LiveMap) => (liveOf(o, m)?.status ?? o.order_status ?? "").toLowerCase();
const wmsOf = (o: any, m: LiveMap) => (liveOf(o, m)?.wms ?? "").toUpperCase();

// Map the WMS / order status to the on-ground milestones.
const collected = (o: any, m: LiveMap) => { const n = wmsOf(o, m); return n === "GATE_PASS" || n === "RETRIEVAL_COMPLETD" || statusOf(o, m) === "completed"; }; // retrieval left the warehouse
const delivered = (o: any, m: LiveMap) => wmsOf(o, m) === "RETRIEVAL_COMPLETD" || statusOf(o, m) === "completed";
const pickedUp = (o: any, m: LiveMap) => statusOf(o, m) === "completed" || /INBOUND|RECEIV|GRN|INWARD/.test(wmsOf(o, m));
const droppedWh = (o: any, m: LiveMap) => /INBOUND|RECEIV|GRN|INWARD/.test(wmsOf(o, m)) || statusOf(o, m) === "completed";

const FRIENDLY: Record<string, string> = { GATE_PASS: "out of warehouse", RETRIEVAL_COMPLETD: "delivered", READY_TO_OUTBOUND: "ready at WH", READY_FOR_PICKLIST: "picking at WH" };
const friendly = (o: any, m: LiveMap) => { const n = wmsOf(o, m); return n ? (FRIENDLY[n] ?? n.toLowerCase().replace(/_/g, " ")) : null; };

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
    for (const o of retr) steps.push({ label: "Deliver", sub: friendly(o, m) ?? undefined, kind: "retrieval", done: delivered(o, m), top: { ref: o.customer_unique_id, name: o.customer_name, phone: o.contact } });
  }
  for (const o of pick) steps.push({ label: "Pick up", sub: friendly(o, m) ?? undefined, kind: "pickup", done: pickedUp(o, m), top: { ref: o.customer_unique_id, name: o.customer_name, phone: o.contact } });
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

export default function MonitoringView({ cities }: { cities: ScheduleData[] }) {
  const [live, setLive] = useState<LiveMap>({});
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

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
  return (
    <div className="space-y-8">
      {updatedAt && <div className="-mt-2 text-right text-[11px] text-slate-400">live status · updated {updatedAt} · auto-refreshes every minute</div>}
      {cities.map((c) => {
        const assigned = c.vendors.filter((v: any) => !v.isUnassigned && v.orders.length);
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
                return (
                  <div key={v.vendorId ?? v.vendorName} className={`rounded-xl border border-slate-200 border-l-4 bg-white p-4 ${allDone ? "border-l-emerald-500" : "border-l-amber-400"}`}>
                    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-bold text-slate-900">{v.vendorName}</span>
                      {vendorContact && <span className="text-xs text-slate-400">{vendorContact}</span>}
                      {v.isIntercity && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200">intercity</span>}
                      <span className="text-xs text-slate-500">{retr ? `${retr} retrieval${retr > 1 ? "s" : ""}` : ""}{retr && pick ? " · " : ""}{pick ? `${pick} pickup${pick > 1 ? "s" : ""}` : ""}</span>
                      {/* Where this team is right now — reads before you scan the steps */}
                      {allDone ? (
                        <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><path d="m5 13 4 4L19 7" /></svg>
                          All stops done
                        </span>
                      ) : (
                        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                          <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" /></span>
                          Next: <b className="font-semibold text-amber-900">{next?.label}{next?.top?.ref ? ` · ${next.top.ref}` : ""}</b>
                        </span>
                      )}
                    </div>
                    {/* Progress bar: how far through the run this team is */}
                    <div className="mb-3 flex items-center gap-2.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${allDone ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="shrink-0 text-[11px] font-medium text-slate-500">{doneCount}/{steps.length} stops</span>
                    </div>
                    <Lifecycle steps={steps} />
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
