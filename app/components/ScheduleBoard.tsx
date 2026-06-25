"use client";

import { useCallback, useEffect, useState } from "react";
import { ScheduleData } from "@/lib/schedule";
import { money } from "@/lib/format";
import { SessionUser } from "@/lib/auth";
import AppShell from "./AppShell";
import ScheduleCityView from "./ScheduleCityView";
import MonitoringView from "./MonitoringView";
import { Card } from "./ui";

const cityName = (slug: string) => slug.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

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

  async function generate() {
    setBusy(true);
    await fetch("/api/schedule/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: data?.date }) });
    await load(mode === "history" ? selDate : undefined);
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
                href={`/api/export?date=${data.date}${cityFilter !== "All" ? `&city=${cityFilter}` : ""}`}
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

        {/* Summary stat cards */}
        {!loading && shown.length > 0 && (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              { label: "Cities", value: t.cities },
              { label: "Vendors", value: t.vendors },
              { label: "Orders", value: t.orders },
              { label: "Pallets", value: t.pallets },
              { label: "Revenue", value: money(t.revenue) },
              { label: "Cost", value: money(t.cost) },
              { label: "Margin", value: money(t.margin), neg: t.margin < 0 },
            ].map((s) => (
              <Card key={s.label} className="p-3">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{s.label}</div>
                <div className={`mt-0.5 text-lg font-bold ${s.neg ? "text-red-600" : "text-slate-900"}`}>{s.value}</div>
              </Card>
            ))}
          </div>
        )}

        {!loading && shown.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-500" /> Pickup ({t.pickup})</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Retrieval ({t.full})</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Partial ({t.partial})</span>
          </div>
        )}

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
                  ? "Today's bookings appear here for monitoring once the schedule exists. It's built automatically each morning — generate the next day from the Tomorrow's schedule tab."
                  : "The cron builds this automatically each morning at the cut-off. You can also generate it now — it pulls every city's orders for that day and allocates them across your vendor master."}
            </p>
            {!isHistory && !isToday && (
              <button onClick={generate} disabled={busy} className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {busy ? "Generating…" : "Generate now"}
              </button>
            )}
          </Card>
        ) : isToday ? (
          // Monitoring: one lifecycle tracker per booking (no editing / generating here).
          <MonitoringView cities={shown} />
        ) : (
          <div className="space-y-6">
            {shown.map((c) => (
              <section key={c.city}>
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3 border-b border-slate-200 pb-1">
                  <h2 className="text-base font-bold text-slate-900">{cityName(c.city)}</h2>
                  <span className="text-xs text-slate-500">{c.totals.vendors} vendors · {c.totals.orders} orders · {money(c.vendors.reduce((s, v) => s + v.revenue, 0))} transport</span>
                  <span className={`text-xs ${c.totals.margin < 0 ? "text-red-600" : "text-emerald-600"}`}>margin {money(c.totals.margin)}</span>
                </div>
                <ScheduleCityView initial={c} />
              </section>
            ))}
          </div>
        )}
    </AppShell>
  );
}
