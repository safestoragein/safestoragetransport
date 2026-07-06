"use client";

import { useState, useEffect } from "react";
import { ScheduleData } from "@/lib/schedule";
import { money } from "@/lib/format";
import { teamsNeeded } from "@/lib/config";
import { Card } from "./ui";
import VendorDetails from "./VendorDetails";

const TYPE: Record<string, { label: string; cls: string; dot: string }> = {
  pickup: { label: "Pickup", cls: "bg-blue-50 border-blue-200", dot: "bg-blue-500" },
  full_retrieval: { label: "Retrieval", cls: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500" },
  partial_retrieval: { label: "Partial", cls: "bg-amber-50 border-amber-200", dot: "bg-amber-500" },
};

// Live status pushed by the vendor from the mobile app.
const LIVE: Record<string, { label: string; cls: string }> = {
  en_route: { label: "🚚 On the way", cls: "bg-purple-100 text-purple-700" },
  arrived: { label: "📍 Reached", cls: "bg-indigo-100 text-indigo-700" },
  packing: { label: "📦 Packing", cls: "bg-amber-100 text-amber-800" },
  loaded: { label: "✅ Loaded", cls: "bg-teal-100 text-teal-700" },
  delivered: { label: "🏁 Delivered", cls: "bg-emerald-600 text-white" },
};
// "2026-07-04 09:31:29" → "9:31 AM" (short, for the "updated" tooltip/label)
function shortTime(raw: string | null | undefined) {
  if (!raw) return "";
  const m = String(raw).match(/(\d{1,2}):(\d{2})/);
  if (!m) return "";
  let h = Number(m[1]); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
// Minutes since a DB timestamp (best-effort; both server + client are IST). null if unparseable.
function minsAgo(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = new Date(String(raw).replace(" ", "T")).getTime();
  if (isNaN(t)) return null;
  return Math.round((Date.now() - t) / 60000);
}
// Freshness label — "just now / 5m ago / 2h ago"; falls back to the clock for odd/old values.
function agoText(raw: string | null | undefined): string {
  const m = minsAgo(raw);
  if (m == null) return "";
  if (m < 0 || m > 1440) return shortTime(raw);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
// Green (<5m) / amber (<20m) / grey (stale) dot for how fresh a GPS ping is.
function freshDot(raw: string | null | undefined): string {
  const m = minsAgo(raw);
  if (m == null) return "text-slate-300";
  if (m < 5) return "text-emerald-500";
  if (m < 20) return "text-amber-500";
  return "text-slate-400";
}
// Google Maps link: prefer exact coords, else search the address text.
function mapsUrl(lat?: number | null, lng?: number | null, label?: string | null): string {
  if (lat != null && lng != null) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label || "")}`;
}

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
export default function ScheduleCityView({ initial, tab = "all", readOnly = false }: { initial: ScheduleData; tab?: "all" | "schedule" | "intercity" | "shifting"; readOnly?: boolean }) {
  const [sched, setSched] = useState<ScheduleData>(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [openPlan, setOpenPlan] = useState<string | null>(null);

  // Sync when the parent hands down fresh data (e.g. Today's 45s live poll). Local optimistic
  // edits (reassign/notify) keep the same `initial` object, so they're not clobbered mid-action.
  useEffect(() => { setSched(initial); }, [initial]);

  async function reload() {
    const r = await fetch(`/api/schedule?city=${sched.city}&date=${sched.date}`).then((x) => x.json());
    if (r.schedule) setSched(r.schedule);
  }

  async function notify(kind: "vendor" | "customer", ids: { vendorId?: string | null; orderId?: string }) {
    const key = `${kind}:${ids.vendorId ?? ids.orderId}`;
    setPending(key);
    try {
      const r = await fetch("/api/notify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: sched.runId, kind, ...ids }) }).then((x) => x.json());
      if (!r?.ok) alert(r?.error || "Notification failed");
      else if (r.errors?.length) alert(`Sent ${r.sent}/${r.total}. Some failed:\n${r.errors.join("\n")}`);
    } catch {
      alert("Network error while sending the notification.");
    }
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
      {/* Live monitoring summary — only appears once vendors start acting in the app today */}
      {(() => {
        const all = displayVendors.flatMap((v) => v.orders as any[]);
        const c: Record<string, number> = { en_route: 0, arrived: 0, packing: 0, loaded: 0, delivered: 0 };
        let started = 0;
        for (const o of all) { const s = o.live_status; if (s && s in c) { c[s]++; started++; } }
        if (!started) return null;
        const notStarted = all.length - started;
        const item = (emoji: string, label: string, n: number, cls: string) =>
          n > 0 ? <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${cls}`}>{emoji} {n} {label}</span> : null;
        return (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
            <span className="font-semibold text-slate-700">🔴 Live:</span>
            {item("🚚", "on the way", c.en_route, "bg-purple-50 text-purple-700")}
            {item("📍", "reached", c.arrived, "bg-indigo-50 text-indigo-700")}
            {item("📦", "packing", c.packing, "bg-amber-50 text-amber-800")}
            {item("✅", "loaded", c.loaded, "bg-teal-50 text-teal-700")}
            {item("🏁", "delivered", c.delivered, "bg-emerald-100 text-emerald-700")}
            {notStarted > 0 && <span className="text-slate-400">· {notStarted} not started</span>}
          </div>
        );
      })()}
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
              {/* Live tracking (from the vendor app): current GPS + delivery progress */}
              {!v.isUnassigned && (() => {
                const total = v.orders.length;
                const delivered = v.orders.filter((o) => o.live_status === "delivered").length;
                const active = v.orders.filter((o) => o.live_status && o.live_status !== "delivered").length;
                const hasLive = v.liveLat != null && v.liveLng != null;
                if (!hasLive && !delivered && !active) return null; // nothing live yet
                return (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {hasLive && (
                      <a href={mapsUrl(v.liveLat, v.liveLng)} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                        title="Vendor's live GPS from the app — open in Google Maps">
                        <span className={freshDot(v.liveLocationAt)}>●</span> Live location · {agoText(v.liveLocationAt)}
                      </a>
                    )}
                    {total > 0 && (delivered > 0 || active > 0) && (
                      <span className="text-slate-500">Progress: <b className="text-slate-700">{delivered}/{total}</b> done{active ? ` · ${active} in progress` : ""}</span>
                    )}
                  </div>
                );
              })()}
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
                {v.vendorNotifiedAt ? (
                  <div className="flex items-center gap-1.5">
                    <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">Vendor notified ✓</span>
                    <button disabled={pending === `vendor:${v.vendorId}` || !v.vendorId} onClick={() => notify("vendor", { vendorId: v.vendorId })} title="Resend WhatsApp to vendor" className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
                      {pending === `vendor:${v.vendorId}` ? "…" : "Resend"}
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={pending === `vendor:${v.vendorId}` || !v.vendorId}
                    onClick={() => notify("vendor", { vendorId: v.vendorId })}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {pending === `vendor:${v.vendorId}` ? "…" : "Notify vendor"}
                  </button>
                )}
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
                    {teamsNeeded(Number(o.pallets) || 0) > 1 && (
                      <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-700" title={`Big order — ${v.vendorName} sends ${teamsNeeded(Number(o.pallets) || 0)} teams (order kept whole)`}>
                        🚚 {teamsNeeded(Number(o.pallets) || 0)} teams
                      </span>
                    )}
                    {o.live_status && LIVE[o.live_status] && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${LIVE[o.live_status].cls}`} title={o.live_status_at ? `updated ${shortTime(o.live_status_at)}` : "from the vendor app"}>
                        {LIVE[o.live_status].label}{o.live_status_at ? ` · ${shortTime(o.live_status_at)}` : ""}
                      </span>
                    )}
                    <span className="text-sm text-slate-600">{o.customer_name}</span>
                    {o.contact && (
                      <a href={`tel:${String(o.contact).split(/[/,]/)[0].trim()}`} className="text-xs font-medium text-blue-600 hover:underline" title="Call customer">📞 {o.contact}</a>
                    )}
                    {o.locality && (
                      <a href={mapsUrl(o.lat, o.lng, o.locality)} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline" title="Open customer location in Google Maps">📍 {o.locality}</a>
                    )}
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
                    {o.schedule_date && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600" title="Scheduled service date">service {fmtBooked(o.schedule_date)}</span>}
                    {fmtBooked(o.booking_date) && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500" title="When the customer booked this order">booked {fmtBooked(o.booking_date)}</span>}
                  </div>
                  {o.team_notes && <div className="mt-1 truncate text-[11px] text-slate-500">📝 {o.team_notes}</div>}

                  {/* controls: reassign vendor · notify customer (resource is per-vendor, in the header) */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {readOnly ? (
                      // Old schedules are already sent to vendors/customers — vendor is locked.
                      <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600" title="Past schedule — vendor cannot be changed">
                        🔒 {v.isUnassigned ? "Unassigned" : (v.vendorName || "—")}
                      </span>
                    ) : (
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
                    )}

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
                      o.customerNotifiedAt ? (
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          <span className="rounded bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-700">Customer notified ✓</span>
                          <button disabled={pending === `customer:${o.id}`} onClick={() => notify("customer", { orderId: o.id })} title="Resend WhatsApp to customer" className="rounded px-2 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
                            {pending === `customer:${o.id}` ? "…" : "Resend"}
                          </button>
                        </span>
                      ) : (
                        <button
                          disabled={pending === `customer:${o.id}`}
                          onClick={() => notify("customer", { orderId: o.id })}
                          className="ml-auto shrink-0 rounded bg-white px-2 py-1 text-[11px] font-medium text-blue-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {pending === `customer:${o.id}` ? "…" : "Notify customer"}
                        </button>
                      )
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
