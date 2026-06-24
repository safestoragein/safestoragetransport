"use client";

import { CitySummary } from "@/lib/types";
import { money, km, pct } from "@/lib/format";
import { Card, Bar } from "./ui";
import Sidebar from "./Sidebar";

export default function CommandCenter({
  summaries, dateLabel, dates, activeDate,
}: {
  summaries: CitySummary[];
  dateLabel: string;
  dates: { date: string; count: number }[];
  activeDate: string;
}) {
  const tot = summaries.reduce(
    (a, s) => ({
      orders: a.orders + s.orders, pallets: Math.round((a.pallets + s.pallets) * 10) / 10,
      vehicles: a.vehicles + s.vehicles, trips: a.trips + s.trips, cost: a.cost + s.cost,
      overloads: a.overloads + s.overloads, unassigned: a.unassigned + s.unassigned,
    }),
    { orders: 0, pallets: 0, vehicles: 0, trips: 0, cost: 0, overloads: 0, unassigned: 0 },
  );
  const maxCost = Math.max(1, ...summaries.map((s) => s.cost));

  const kpis = [
    { label: "Cities operating", value: String(summaries.length) },
    { label: "Total orders", value: String(tot.orders), sub: `${tot.pallets} pallets` },
    { label: "Vehicles deployed", value: String(tot.vehicles), sub: `${tot.trips} trips` },
    { label: "Total cost (est.)", value: money(tot.cost) },
    { label: "Capacity overloads", value: String(tot.overloads), bad: tot.overloads > 0 },
    { label: "Unassigned", value: String(tot.unassigned), bad: tot.unassigned > 0 },
  ];

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar active="admin" />
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Command Center</h1>
          <p className="text-xs text-slate-500">All cities · {dateLabel}</p>
        </div>
        {dates.length > 0 && (
          <select
            defaultValue={activeDate}
            onChange={(e) => { window.location.href = `/?src=admin&date=${e.currentTarget.value}`; }}
            className="max-w-[55vw] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 sm:max-w-none"
          >
            {dates.map((d) => <option key={d.date} value={d.date}>{d.date} ({d.count})</option>)}
          </select>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <div className="text-xs font-medium text-slate-500">{k.label}</div>
            <div className={`mt-1 text-2xl font-bold ${k.bad ? "text-red-600" : "text-slate-900"}`}>{k.value}</div>
            {k.sub && <div className="mt-0.5 text-xs text-slate-400">{k.sub}</div>}
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Cost by city</h3>
          <div className="space-y-2.5">
            {summaries.map((s) => (
              <div key={s.slug}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-600">{s.name}</span>
                  <span className="text-slate-400">{money(s.cost)} · {s.orders} orders</span>
                </div>
                <Bar value={s.cost} max={maxCost} color="#2563eb" />
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-slate-100 p-4 text-sm font-semibold text-slate-700">City breakdown</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-3 py-2 font-medium">City</th>
                  <th className="px-3 py-2 font-medium">Orders</th>
                  <th className="px-3 py-2 font-medium">Vehicles</th>
                  <th className="px-3 py-2 font-medium">Util.</th>
                  <th className="px-3 py-2 font-medium">Cost</th>
                  <th className="px-3 py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.slug} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <a href={`/?src=live&city=${s.slug}`} className="font-medium text-blue-600 hover:underline">{s.name}</a>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{s.orders} <span className="text-slate-400">· {s.pallets}p</span></td>
                    <td className="px-3 py-2.5 text-slate-600">{s.vehicles} <span className="text-slate-400">· {s.trips}t</span></td>
                    <td className="px-3 py-2.5 text-slate-600">{pct(s.utilization)}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{money(s.cost)}</td>
                    <td className="px-3 py-2.5">
                      {s.overloads > 0 && <span className="mr-1 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">{s.overloads} over</span>}
                      {s.unassigned > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">{s.unassigned} open</span>}
                      {s.overloads === 0 && s.unassigned === 0 && <span className="text-xs text-emerald-600">clean</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-400">
        Click a city to open its live allocation. Cost is the optimiser&apos;s estimate using default vendor attributes until the vendor master (depot, tier, rate, vehicle) is wired.
      </footer>
      </main>
    </div>
  );
}
