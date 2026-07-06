"use client";

import { useCallback, useEffect, useState } from "react";
import { ScheduleData } from "@/lib/schedule";
import { money } from "@/lib/format";
import { SessionUser } from "@/lib/auth";
import { withBase } from "@/lib/base";
import AppShell from "./AppShell";
import ScheduleCityView from "./ScheduleCityView";
import MonitoringView from "./MonitoringView";
import { Card } from "./ui";

const cityName = (slug: string) => slug.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
const EVENT_COLOR: Record<string, string> = { created: "bg-emerald-600", rescheduled: "bg-amber-600", cancelled: "bg-red-600", updated: "bg-blue-600" };

function fmtDate(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
function fmtShort(d: string) {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

// Count everything from the actual loaded vendor groups so the all-cities totals always equal the
// sum of what's shown per city (cost/margin come from the stored run totals + add-ons).
function ordersIn(c: ScheduleData) { return c.vendors.reduce((s, v) => s + v.orders.length, 0); }
function agg(cities: ScheduleData[]) {
  let pickup = 0, full = 0, partial = 0, pallets = 0, revenue = 0, cost = 0, margin = 0, vendors = 0, orders = 0;
  for (const c of cities) {
    cost += c.totals.cost; margin += c.totals.margin;
    vendors += c.vendors.filter((v) => !v.isUnassigned).length;
    for (const v of c.vendors) {
      revenue += v.revenue;
      for (const o of v.orders as any[]) {
        orders++;
        pallets += Number(o.pallets) || 0;
        if (o.order_type === "pickup") pickup++;
        else if (o.order_type === "full_retrieval") full++;
        else if (o.order_type === "partial_retrieval") partial++;
      }
    }
  }
  return { pickup, full, partial, pallets: Math.round(pallets * 10) / 10, revenue, cost, margin, vendors, orders, cities: cities.length };
}


// Shared all-cities schedule view. The Schedule tab uses it for TOMORROW; the Old-schedules tab
// uses the SAME view with a date picker over every persisted date. Identical content either way.
export default function ScheduleBoard({ mode, user }: { mode: "today" | "tomorrow" | "history"; user: SessionUser | null }) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState<{ date: string; cities: ScheduleData[] } | null>(null);
  const [dates, setDates] = useState<{ date: string; runs: number; orders: number }[]>([]); // history only
  const [selDate, setSelDate] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cityFilter, setCityFilter] = useState("All");
  const [pnl, setPnl] = useState<any | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [pnlBusy, setPnlBusy] = useState(false);
  // post-cutoff changes (from the booking webhook)
  const [changes, setChanges] = useState<any[]>([]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [showChanges, setShowChanges] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Comparison-based diff (live feed vs the persisted run) — new / rescheduled / removed since the run.
  const [diff, setDiff] = useState<any | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [pulling, setPulling] = useState(false);

  async function refreshChanges(date?: string) {
    if (!date) return;
    const r = await fetch(`/api/schedule/changes?date=${date}`).then((x) => x.json()).catch(() => ({ changes: [] }));
    setChanges(r.changes ?? []);
  }
  async function syncNewBookings() {
    if (!data?.date) return;
    setSyncing(true);
    await fetch("/api/schedule/changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync", date: data.date }) });
    await load(mode === "history" ? selDate : mode === "today" ? todayStr : undefined);
    await refreshChanges(data.date);
    setSyncing(false);
  }
  async function dismissChange(id: string) {
    await fetch("/api/schedule/changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "handle", id }) });
    setChanges((cs) => cs.filter((c) => c.id !== id));
  }

  async function loadWeeklyPnl() {
    const base = selDate || data?.date;
    if (!base) return;
    setPnlBusy(true);
    const d = new Date(base + "T00:00:00Z");
    const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
    const mon = new Date(d); mon.setUTCDate(d.getUTCDate() - dow);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    const from = mon.toISOString().slice(0, 10), to = sun.toISOString().slice(0, 10);
    const r = await fetch(`/api/pnl?from=${from}&to=${to}`).then((x) => x.json()).catch(() => null);
    setPnl(r); setPnlBusy(false);
  }

  // editable packing-material cost per pallet
  const [packing, setPacking] = useState<number | null>(null);
  const [packingDraft, setPackingDraft] = useState("");
  const [savingPacking, setSavingPacking] = useState(false);

  const load = useCallback(async (dateArg?: string) => {
    setLoading(true);
    const qs = dateArg ? `?date=${dateArg}` : "";
    const [r, s] = await Promise.all([
      fetch(`/api/schedule/all${qs}`).then((x) => x.json()),
      fetch("/api/settings").then((x) => x.json()).catch(() => ({})),
    ]);
    setData({ date: r.date, cities: r.cities ?? [] });
    if (typeof s.packingPerPallet === "number") { setPacking(s.packingPerPallet); setPackingDraft(String(s.packingPerPallet)); }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      if (mode === "history") {
        const r = await fetch("/api/schedule/dates").then((x) => x.json()).catch(() => ({ dates: [] }));
        const ds: { date: string; runs: number; orders: number }[] = r.dates ?? [];
        setDates(ds);
        if (ds.length) { setSelDate(ds[0].date); await load(ds[0].date); }
        else { setData({ date: "", cities: [] }); setLoading(false); }
      } else if (mode === "today") {
        await load(todayStr);
      } else {
        await load(undefined); // tomorrow (server default)
      }
    })();
  }, [mode, load, todayStr]);

  // post-cutoff changes for the Tomorrow planning view only (not history, not today's monitoring view)
  useEffect(() => {
    if (mode !== "tomorrow" || !data?.date) return;
    fetch(`/api/schedule/changes?date=${data.date}`).then((x) => x.json()).then((r) => setChanges(r.changes ?? [])).catch(() => {});
  }, [mode, data?.date]);

  // Poll the live feed vs the persisted run to catch bookings added/removed/rescheduled AFTER the
  // 6 AM run — Tomorrow's planning view only. Re-checks on load and every 60s.
  useEffect(() => {
    if (mode !== "tomorrow" || !data?.date) return;
    let stop = false;
    const check = () => fetch(`/api/schedule/diff?date=${data.date}`).then((x) => x.json()).then((r) => { if (!stop) setDiff(r?.ok ? r : null); }).catch(() => {});
    check();
    const id = setInterval(check, 60_000);
    return () => { stop = true; clearInterval(id); };
  }, [mode, data?.date]);

  // Today's schedule is a live monitoring view — refresh every 45s so vendor-app status + GPS
  // updates flow in without a manual reload.
  useEffect(() => {
    if (mode !== "today") return;
    const id = setInterval(() => { load(todayStr); }, 45_000);
    return () => clearInterval(id);
  }, [mode, load, todayStr]);

  async function pullChanges() {
    if (!data?.date) return;
    setPulling(true);
    await fetch("/api/schedule/diff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: data.date }) }).catch(() => {});
    await load(undefined); // reload tomorrow
    const r = await fetch(`/api/schedule/diff?date=${data.date}`).then((x) => x.json()).catch(() => null);
    setDiff(r?.ok ? r : null);
    setPulling(false);
  }

  async function generate() {
    setBusy(true);
    const genDate = data?.date ?? (mode === "today" ? todayStr : undefined);
    await fetch("/api/schedule/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: genDate }) });
    await load(mode === "history" ? selDate : mode === "today" ? todayStr : undefined);
    setBusy(false);
  }

  async function savePacking() {
    const v = Number(packingDraft);
    if (!Number.isFinite(v) || v < 0) return;
    setSavingPacking(true);
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packingPerPallet: v }) }).then((x) => x.json());
    if (r.ok) setPacking(r.packingPerPallet);
    setSavingPacking(false);
  }

  const allCities = (data?.cities ?? []);
  const shown = cityFilter === "All" ? allCities : allCities.filter((c) => c.city === cityFilter);
  const t = agg(shown);
  const packingDirty = packing !== null && packingDraft !== String(packing);
  const isHistory = mode === "history";
  const isToday = mode === "today";
  const activeKey = isHistory ? "history" : isToday ? "today" : "schedule";
  const title = isHistory ? "Old schedules" : isToday ? "Today's schedule" : "Tomorrow's schedule";
  const subtitle = isHistory
    ? "every persisted schedule"
    : isToday
      ? "what every team is doing today — assignments, day plans & timings"
      : "auto-generated at the 6 AM cut-off, or generate now";

  // Tomorrow's schedule has Schedule / Intercity / Shifting sub-tabs (intercity + shifting are held
  // out of the regular schedule). Other modes show everything ("all").
  const [schedTab, setSchedTab] = useState<"schedule" | "intercity" | "shifting">("schedule");
  const cats = { schedule: 0, intercity: 0, shifting: 0 };
  for (const c of shown) for (const v of c.vendors) for (const o of v.orders as any[]) { if (o.is_shifting) cats.shifting++; else if (o.is_intercity) cats.intercity++; else cats.schedule++; }
  const tabbed = !isHistory && !isToday; // tomorrow only
  const cityTab: "all" | "schedule" | "intercity" | "shifting" = tabbed ? schedTab : "all";

  return (
    <AppShell active={activeKey} user={user}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-900">{title}</h1>
            <p className="text-xs text-slate-500">
              {data?.date ? fmtDate(data.date) : "…"} · all cities · {subtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data?.date && allCities.length > 0 && (
              <a
                href={withBase(`/api/export?date=${data.date}${cityFilter !== "All" ? `&city=${cityFilter}` : ""}`)}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                ⬇ Download Excel
              </a>
            )}
            {/* Today is monitoring-only — no generate. */}
            {!isToday && (
              <button onClick={generate} disabled={busy || (isHistory && !data?.date)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? "Generating all cities…" : "Generate / refresh all cities"}
              </button>
            )}
          </div>
        </div>

        {/* Live-feed diff vs the persisted run — highlights bookings added / rescheduled / removed
            AFTER the 6 AM run. Polls every 60s. Tomorrow's planning view only. */}
        {!isToday && !isHistory && diff && diff.total > 0 && (() => {
          const nNew = diff.cities.reduce((s: number, c: any) => s + c.newOrders.length, 0);
          const nRes = diff.cities.reduce((s: number, c: any) => s + c.rescheduled.length, 0);
          const nRem = diff.cities.reduce((s: number, c: any) => s + c.removed.length, 0);
          return (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-red-700">
                  🔴 {diff.total} booking change{diff.total > 1 ? "s" : ""} since the 6 AM run
                  {" — "}{nNew > 0 && `${nNew} new`}{nNew > 0 && (nRes || nRem) ? " · " : ""}{nRes > 0 && `${nRes} rescheduled`}{nRes > 0 && nRem ? " · " : ""}{nRem > 0 && `${nRem} removed`}
                </span>
                <button onClick={pullChanges} disabled={pulling} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {pulling ? "Pulling…" : "Pull changes"}
                </button>
              </div>
              <div className="mt-1.5 space-y-0.5 text-xs text-red-600">
                {diff.cities.map((c: any) => (
                  <div key={c.city}>
                    <b className="capitalize">{c.city}</b>:
                    {c.newOrders.length > 0 && <span> new [{c.newOrders.join(", ")}]</span>}
                    {c.rescheduled.length > 0 && <span> rescheduled [{c.rescheduled.join(", ")}]</span>}
                    {c.removed.length > 0 && <span> removed [{c.removed.join(", ")}]</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Post-cutoff changes from the booking webhook — Tomorrow's planning view only.
            Today is monitoring-only: the day was locked at the cut-off, so we don't surface changes here. */}
        {!isToday && !isHistory && changes.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-amber-800">⚠ {changes.length} change{changes.length > 1 ? "s" : ""} since the 6 AM cut-off</span>
              <button onClick={() => setShowChanges((s) => !s)} className="text-xs font-medium text-amber-700 underline">{showChanges ? "Hide" : "Review"}</button>
              <button onClick={syncNewBookings} disabled={syncing} className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">{syncing ? "Pulling…" : "⤓ Pull new orders into schedule"}</button>
            </div>
            {showChanges && (
              <div className="mt-3 space-y-1.5">
                {changes.map((ch) => (
                  <div key={ch.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-amber-100">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white ${EVENT_COLOR[ch.event] ?? "bg-slate-500"}`}>{ch.event}</span>
                    <b className="text-slate-800">{ch.customer_unique_id ?? ch.order_id}</b>
                    {ch.city && <span className="text-slate-500">{cityName(ch.city)}</span>}
                    {ch.order_type && <span className="text-slate-400">{ch.order_type}</span>}
                    {ch.time_slot && <span className="text-slate-400">slot {ch.time_slot}</span>}
                    {ch.order_status && <span className="text-slate-400">· {ch.order_status}</span>}
                    <span className="ml-auto text-[10px] text-slate-400">{ch.received_at ? new Date(ch.received_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                    <button onClick={() => dismissChange(ch.id)} className="text-[11px] font-medium text-slate-500 hover:text-slate-800">dismiss</button>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-amber-700">New orders are pulled into the “team to assign” bucket below — assign a vendor there. Reschedules/cancellations are flagged to update or remove manually.</p>
          </div>
        )}

        {/* Controls: (history) date picker + city filter + packing cost */}
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          {isHistory && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500">Date</label>
              <select
                value={selDate ?? ""}
                onChange={(e) => { setSelDate(e.target.value); setCityFilter("All"); load(e.target.value); }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
              >
                {dates.length === 0 && <option value="">No schedules yet</option>}
                {dates.map((d) => (
                  <option key={d.date} value={d.date}>{fmtShort(d.date)} · {d.orders} orders</option>
                ))}
              </select>
              <button onClick={loadWeeklyPnl} disabled={pnlBusy || (!selDate && !data?.date)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {pnlBusy ? "Calculating…" : "📊 Weekly P&L"}
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">City</label>
            <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700">
              <option value="All">All cities ({allCities.reduce((s, c) => s + ordersIn(c), 0)} orders)</option>
              {allCities.map((c) => (
                <option key={c.city} value={c.city}>{cityName(c.city)} ({ordersIn(c)})</option>
              ))}
            </select>
          </div>
          {!isToday && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500">Packing material ₹/pallet</label>
              <input
                type="number" min={0} value={packingDraft}
                onChange={(e) => setPackingDraft(e.target.value)}
                className="w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
              />
              <button onClick={savePacking} disabled={!packingDirty || savingPacking} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                {savingPacking ? "Saving…" : "Save"}
              </button>
              <span className="text-[11px] text-slate-400">applies on next generate</span>
            </div>
          )}
        </div>

        {/* Weekly P&L result (Old schedules) */}
        {isHistory && pnl && (
          <Card className="mb-5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-bold text-slate-800">Weekly P&amp;L · {pnl.ok ? `${fmtShort(pnl.from)} – ${fmtShort(pnl.to)}` : ""}</div>
              <button onClick={() => setPnl(null)} className="text-xs text-slate-400 hover:text-slate-600">✕ close</button>
            </div>
            {!pnl.ok ? (
              <div className="text-sm text-red-600">{pnl.error || "Could not calculate"}</div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Schedule margin", value: money(pnl.totals.regularMargin), neg: pnl.totals.regularMargin < 0 },
                    { label: "Intercity profit", value: money(pnl.totals.intercityProfit) },
                    { label: "Total P&L", value: money(pnl.totals.total), big: true, neg: pnl.totals.total < 0 },
                    { label: "Orders · days", value: `${pnl.totals.orders} · ${pnl.totals.days}d` },
                  ].map((s) => (
                    <div key={s.label} className={`rounded-lg p-3 ${s.big ? "bg-slate-900 text-white" : "bg-slate-50"}`}>
                      <div className={`text-[11px] font-medium uppercase tracking-wide ${s.big ? "text-slate-300" : "text-slate-400"}`}>{s.label}</div>
                      <div className={`mt-0.5 text-lg font-bold ${s.big ? "text-white" : s.neg ? "text-red-600" : "text-slate-900"}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-500"><th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 font-medium">Orders</th><th className="py-1 pr-3 font-medium">Schedule margin</th><th className="py-1 pr-3 font-medium">Intercity profit</th><th className="py-1 pr-3 font-medium">Day total</th></tr></thead>
                    <tbody>
                      {pnl.byDate.length === 0 && <tr><td colSpan={5} className="py-3 text-center text-xs text-slate-400">No schedules in this week.</td></tr>}
                      {pnl.byDate.map((d: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                        <tr key={d.date} className="border-t border-slate-100">
                          <td className="py-1.5 pr-3 text-slate-700">{fmtShort(d.date)}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{d.orders}</td>
                          <td className={`py-1.5 pr-3 ${d.margin < 0 ? "text-red-600" : "text-slate-700"}`}>{money(d.margin)}</td>
                          <td className="py-1.5 pr-3 text-emerald-700">{money(d.intercityProfit)}</td>
                          <td className="py-1.5 pr-3 font-medium text-slate-900">{money(d.margin + d.intercityProfit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">Total P&amp;L = schedule margin (revenue − vendor cost) + manually-recorded intercity profit, for the latest run of each day.</p>
              </>
            )}
          </Card>
        )}

        {/* Schedule / Intercity / Shifting sub-tabs (tomorrow only) */}
        {tabbed && (
          <div className="mb-4 flex gap-1 border-b border-slate-200">
            {([
              { id: "schedule", label: `Schedule (${cats.schedule})` },
              { id: "intercity", label: `Intercity (${cats.intercity})` },
              { id: "shifting", label: `Shifting (${cats.shifting})` },
            ] as const).map((tb) => (
              <button
                key={tb.id}
                onClick={() => setSchedTab(tb.id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${schedTab === tb.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
              >
                {tb.label}
              </button>
            ))}
          </div>
        )}

        {/* Financial summary cards — Tomorrow + Old schedules only. Today's live monitoring cards are
            rendered inside MonitoringView (they need its WMS/live status map). */}
        {!loading && !isToday && shown.length > 0 && cityTab !== "intercity" && cityTab !== "shifting" && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              { label: "Cities", value: t.cities },
              { label: "Vendors", value: t.vendors },
              { label: "Orders", value: t.orders },
              { label: "Pallets", value: t.pallets },
              { label: "Revenue", value: money(t.revenue) },
              { label: "Cost", value: money(t.cost) },
              { label: "Margin", value: money(t.margin), neg: t.margin < 0 },
            ].map((s: any) => (
              <Card key={s.label} className="p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{s.label}</div>
                <div className={`mt-0.5 text-lg font-bold ${s.neg ? "text-red-600" : "text-slate-900"}`}>{s.value}</div>
              </Card>
            ))}
          </div>
        )}

        {!loading && shown.length > 0 && cityTab !== "intercity" && cityTab !== "shifting" && (
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Pickup ({t.pickup})</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Retrieval ({t.full})</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Partial ({t.partial})</span>
          </div>
        )}
        {cityTab === "intercity" && <p className="mb-3 text-xs text-slate-500">Intercity bookings are kept out of the regular schedule — assign an intercity vendor on each one.</p>}
        {cityTab === "shifting" && <p className="mb-3 text-xs text-slate-500">House-shifting bookings (rare) — handled separately from the regular pickup/retrieval schedule.</p>}

        {loading ? (
          <Card className="p-8 text-center text-sm text-slate-500">Loading schedule…</Card>
        ) : allCities.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-sm font-semibold text-slate-700">
              {isHistory ? "No past schedules yet" : `No schedule for ${data?.date ? fmtDate(data.date) : (isToday ? "today" : "tomorrow")} yet`}
            </div>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
              {isHistory
                ? "Schedules accumulate here as the cron runs each morning (and whenever you generate one). Generate tomorrow's from the Tomorrow's schedule tab to get started."
                : isToday
                  ? "Today's bookings appear here for monitoring once the schedule exists. It's normally built automatically the morning before — if that was missed, you can generate it now."
                  : "The cron builds this automatically each morning at the cut-off. You can also generate it now — it pulls every city's orders for that day and allocates them across your vendor master."}
            </p>
            {!isHistory && (
              <button onClick={generate} disabled={busy} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? "Generating…" : isToday ? "Generate today's schedule" : "Generate now"}
              </button>
            )}
          </Card>
        ) : isToday ? (
          // Monitoring: one lifecycle tracker per booking (no editing / generating here).
          <MonitoringView cities={shown} />
        ) : (() => {
          const matchN = (c: ScheduleData) =>
            cityTab === "intercity" ? c.vendors.reduce((s, v) => s + (v.orders as any[]).filter((o) => o.is_intercity && !o.is_shifting).length, 0)
            : cityTab === "shifting" ? c.vendors.reduce((s, v) => s + (v.orders as any[]).filter((o) => o.is_shifting).length, 0)
            : 1;
          const list = shown.filter((c) => matchN(c) > 0);
          if (list.length === 0) {
            return <Card className="p-8 text-center text-sm text-slate-500">{cityTab === "intercity" ? "No intercity bookings for this day." : "No shifting bookings for this day."}</Card>;
          }
          return (
            <div className="space-y-6">
              {list.map((c) => (
                <section key={c.city}>
                  <div className="mb-2 flex flex-wrap items-baseline gap-x-3 border-b border-slate-200 pb-1">
                    <h2 className="text-base font-bold text-slate-900">{cityName(c.city)}</h2>
                    {cityTab === "intercity" || cityTab === "shifting"
                      ? <span className="text-xs text-slate-500">{matchN(c)} booking{matchN(c) > 1 ? "s" : ""}</span>
                      : <>
                          <span className="text-xs text-slate-500">{c.totals.vendors} vendors · {c.totals.orders} orders · {money(c.vendors.reduce((s, v) => s + v.revenue, 0))} transport</span>
                          <span className={`text-xs ${c.totals.margin < 0 ? "text-red-600" : "text-emerald-600"}`}>margin {money(c.totals.margin)}</span>
                        </>}
                  </div>
                  <ScheduleCityView initial={c} tab={cityTab} readOnly={isHistory} />
                </section>
              ))}
            </div>
          );
        })()}
    </AppShell>
  );
}
