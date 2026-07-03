"use client";

import { useState } from "react";
import { ScheduleData } from "@/lib/schedule";
import { money } from "@/lib/format";
import { Card } from "./ui";
import VendorDetails from "./VendorDetails";

const TYPE: Record<string, { label: string; cls: string; dot: string }> = {
  pickup: { label: "Pickup", cls: "bg-blue-50 border-blue-200", dot: "bg-blue-500" },
  full_retrieval: { label: "Retrieval", cls: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  partial_retrieval: { label: "Partial", cls: "bg-amber-50 border-amber-200", dot: "bg-amber-500" },
};

// The day plan itself is computed SERVER-SIDE (real OSRM road travel) and arrives on v.plan.
function fmtClock(min: number) {
  const h = Math.floor(min / 60) % 24, m = Math.round(min % 60);
  const ap = h >= 12 ? "PM" : "AM"; let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}


// Booking date (order_created_at, e.g. "2026-01-04 09:31:29") → short "4 Jul 2026".
function fmtBooked(raw: string | null | undefined) {
  if (!raw) return null;
  const d = new Date(String(raw).replace(" ", "T"));
  if (isNaN(d.getTime())) return String(raw).slice(0, 10);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

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
export default function ScheduleCityView({ initial, tab = "all" }: { initial: ScheduleData; tab?: "all" | "schedule" | "intercity" | "shifting" }) {
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

  async function setProfit(orderUuid: string, val: string) {
    setPending(`profit:${orderUuid}`);
    await fetch("/api/schedule/assignment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: sched.runId, orderUuid, action: "profit", profit: val }) });
    await reload();
    setPending(null);
  }

  // Filter what shows per tab. Intercity + shifting orders live in the "to assign" bucket; the
  // regular Schedule tab hides them, and the Intercity/Shifting tabs show only those.
  const isShift = (o: any) => !!o.is_shifting;
  const isInter = (o: any) => !!o.is_intercity && !o.is_shifting;
  const isReg = (o: any) => !o.is_intercity && !o.is_shifting;
  const keep = tab === "intercity" ? isInter : tab === "shifting" ? isShift : tab === "schedule" ? isReg : null;
  const displayVendors = (keep == null
    ? sched.vendors
    : (tab === "intercity" || tab === "shifting")
      ? sched.vendors.filter((v) => v.isUnassigned).map((v) => ({ ...v, orders: (v.orders as any[]).filter(keep) }))
      : sched.vendors.map((v) => (v.isUnassigned ? { ...v, orders: (v.orders as any[]).filter(keep) } : v))
  ).filter((v) => !v.isUnassigned || v.orders.length > 0);

  return (
    <div className="space-y-3">
      {displayVendors.map((v) => {
        const plan = v.plan ?? null;
        // What WE pay this vendor for the day: base (general = flat daily; non-general/intercity =
        // per-transaction × orders) + add-ons (₹800/resource, ₹1,500/extra trip). Updates live as
        // resources change (the panel reloads after each +/−).
        const addOns = (v.resources || 0) * sched.resourceCost + (v.extraTrips || 0) * sched.extraTripCost;
        const perTxn = v.tier === "non_general" || v.isIntercity;
        const base = perTxn ? (v.perTransaction != null ? v.perTransaction * v.orders.length : null) : (v.dailyPrice ?? null);
        const pay = base != null ? base + addOns : null;
        return (
        <Card key={v.vendorId ?? v.vendorName} className={`overflow-hidden ${v.isUnassigned ? "ring-1 ring-amber-300" : ""}`}>
          <div className={`flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 ${v.isUnassigned ? "bg-amber-50" : "bg-slate-50"}`}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800">{v.vendorName}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {v.startingPoint ? `from ${v.startingPoint} · ` : ""}{!v.isUnassigned && `${v.tripCount} trip${v.tripCount > 1 ? "s" : ""} · `}{v.orders.length} stops · {v.actualPallets} pallets{v.actualPallets !== v.pallets ? ` (${v.pallets} assumed)` : ""} · {money(v.revenue)} transport collected
              </div>
              {!v.isUnassigned && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className="rounded-md bg-slate-900 px-2 py-0.5 font-semibold text-white">We pay {pay != null ? money(pay) : "—"}{pay != null && !perTxn ? "/day" : ""}</span>
                  <span className="text-slate-400">
                    {base != null
                      ? (perTxn ? `${money(v.perTransaction!)} × ${v.orders.length} order${v.orders.length > 1 ? "s" : ""}` : `${money(v.dailyPrice!)}/day`)
                      : (v.pricingNote || "per-trip pricing TBD")}
                    {addOns > 0 && ` + ${money(addOns)} add-ons (${v.resources ? `${v.resources}×₹${sched.resourceCost}` : ""}${v.resources && v.extraTrips ? ", " : ""}${v.extraTrips ? `${v.extraTrips}×₹${sched.extraTripCost}` : ""})`}
                  </span>
                </div>
              )}
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
                  <button disabled={pending === `res:${v.vendorName}` || v.resources <= 0} onClick={() => setResources(v.vendorName, v.resources - 1)} className="h-6 w-6 rounded bg-white text-slate-600 ring-1 ring-slate-200 disabled:opacity-30">−</button>
                  <span className="w-4 text-center font-medium text-slate-700">{v.resources}</span>
                  <button disabled={pending === `res:${v.vendorName}`} onClick={() => setResources(v.vendorName, v.resources + 1)} className="rounded-md bg-amber-500 px-2 py-1 font-semibold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50">+ {money(sched.resourceCost)}</button>
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

          {!v.isUnassigned && plan && openPlan === (v.vendorId ?? v.vendorName) && <VendorDetails v={v} />}

          <div className="divide-y divide-slate-100">
            {(v.isUnassigned ? v.orders : [...v.orders].sort((a: any, b: any) => (plan?.byOrder?.[a.customer_unique_id]?.arrive ?? 1e9) - (plan?.byOrder?.[b.customer_unique_id]?.arrive ?? 1e9))).map((o: any, idx: number) => {
              const t = TYPE[o.order_type] ?? TYPE.pickup;
              return (
                <div key={o.id ?? o.order_id} className={`border-l-4 px-4 py-2.5 ${t.cls}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {!v.isUnassigned && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">{idx + 1}</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${t.dot}`}>{t.label}{o.is_shifting ? " · shifting" : o.is_intercity ? " · intercity" : ""}</span>
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
                    {plan?.byOrder?.[o.customer_unique_id] && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${plan.byOrder[o.customer_unique_id].late ? "bg-red-600" : "bg-slate-900"}`}>~{fmtClock(plan.byOrder[o.customer_unique_id].arrive)}</span>
                    )}
                    {o.time_slot && <span className={`text-xs ${plan?.byOrder?.[o.customer_unique_id]?.late ? "text-red-500" : "text-slate-400"}`}>wants {o.time_slot.replace(/:00/g, "")}</span>}
                    {o.required_time && <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">⏰ {o.required_time}</span>}
                    {(() => { const lb = liftBadge(o.lift); return lb ? <span className={`rounded px-1 text-[10px] font-medium ${lb.ok === false ? "bg-orange-100 text-orange-700" : lb.ok ? "bg-slate-100 text-slate-500" : "bg-slate-100 text-slate-500"}`}>{lb.text}</span> : null; })()}
                    {fmtBooked(o.booking_date) && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500" title="When the customer booked this order">booked {fmtBooked(o.booking_date)}</span>}
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
                      {/* Intercity orders → only intercity vendors; local orders → only local vendors. */}
                      {sched.availableVendors.filter((av) => (o.is_intercity ? av.isIntercity : !av.isIntercity)).map((av) => (
                        <option key={av.id} value={av.id}>{av.name}</option>
                      ))}
                    </select>

                    {/* intercity profit is recorded manually (negotiated per trip) */}
                    {o.is_intercity && (
                      <span className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                        Profit ₹
                        <input
                          type="number" defaultValue={o.intercity_profit ?? ""} placeholder="enter"
                          disabled={pending === `profit:${o.id}`}
                          onBlur={(e) => { if (e.target.value !== String(o.intercity_profit ?? "")) setProfit(o.id, e.target.value); }}
                          className="w-20 rounded border border-emerald-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-800"
                        />
                      </span>
                    )}

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
