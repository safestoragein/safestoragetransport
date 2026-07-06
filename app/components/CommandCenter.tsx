"use client";

import { OpsDashboard, OpsCity } from "@/lib/dashboard";
import { money } from "@/lib/format";
import { SessionUser } from "@/lib/auth";
import { withBase } from "@/lib/base";
import { Card, Bar } from "./ui";
import AppShell from "./AppShell";

// Small colored stat tile.
function Stat({ label, value, sub, tone = "slate", href }: {
  label: string; value: string | number; sub?: string; tone?: "slate" | "emerald" | "amber" | "red" | "blue" | "violet"; href?: string;
}) {
  const tones: Record<string, string> = {
    slate: "text-slate-900", emerald: "text-emerald-600", amber: "text-amber-600",
    red: "text-red-600", blue: "text-blue-600", violet: "text-violet-600",
  };
  const body = (
    <Card className={`p-4 ${href ? "transition-shadow hover:shadow-md" : ""}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </Card>
  );
  return href ? <a href={href} className="block">{body}</a> : body;
}

export default function CommandCenter({
  ops, dateLabel, dates, activeDate, user,
}: {
  ops: OpsDashboard;
  dateLabel: string;
  dates: { date: string; count: number }[];
  activeDate: string;
  user: SessionUser | null;
}) {
  const t = ops.totals;
  const isToday = ops.isToday;
  const donePct = t.orders > 0 ? Math.round((t.done / t.orders) * 100) : 0;
  const marginPct = t.revenue > 0 ? Math.round((t.margin / t.revenue) * 100) : 0;
  const maxRev = Math.max(1, ...ops.cities.map((c) => c.revenue));
  const hasCities = ops.cities.length > 0;

  return (
    <AppShell active="dashboard" user={user}>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Dashboard</h1>
          <p className="text-xs text-slate-500">
            {isToday ? "Live operations" : "Schedule"} · all cities · {dateLabel}
            {ops.generatedAt && <span className="text-slate-400"> · plan built {new Date(String(ops.generatedAt).replace(" ", "T")).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isToday && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Live</span>}
          {dates.length > 0 && (
            <select
              defaultValue={activeDate}
              onChange={(e) => { window.location.href = withBase(`/?view=dashboard&date=${e.currentTarget.value}`); }}
              className="max-w-[50vw] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 sm:max-w-none"
            >
              {dates.map((d) => <option key={d.date} value={d.date}>{d.date} ({d.count})</option>)}
            </select>
          )}
        </div>
      </header>

      {!hasCities && (
        <Card className="p-8 text-center text-sm text-slate-500">
          No schedule has been generated for {dateLabel}. Open <a href={withBase("/?view=schedule")} className="font-medium text-blue-600 hover:underline">Tomorrow&apos;s schedule</a> to generate one.
        </Card>
      )}

      {hasCities && (
        <>
          {/* Attention strip — the two things an ops manager must act on. */}
          {(t.unassigned > 0 || (isToday && t.atRisk > 0)) && (
            <div className="mb-5 flex flex-wrap gap-3">
              {t.unassigned > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                  <span className="text-base">⚠️</span>
                  <span><span className="font-semibold">{t.unassigned}</span> order{t.unassigned > 1 ? "s" : ""} still need a team assigned</span>
                </div>
              )}
              {isToday && t.atRisk > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
                  <span className="text-base">⏰</span>
                  <span><span className="font-semibold">{t.atRisk}</span> order{t.atRisk > 1 ? "s" : ""} past the slot window &amp; not done</span>
                </div>
              )}
            </div>
          )}

          {/* Operations KPIs */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Orders today" value={t.orders} sub={`${t.pickups} pickup · ${t.retrievals} retrieval`} />
            <Stat label="Completed" value={t.done} sub={`${donePct}% done`} tone={donePct >= 100 ? "emerald" : "slate"} />
            <Stat label="In progress" value={t.inProgress} tone="blue" />
            <Stat label="Not started" value={t.notStarted} tone={t.notStarted > 0 ? "slate" : "emerald"} />
            {isToday
              ? <Stat label="At risk" value={t.atRisk} tone={t.atRisk > 0 ? "red" : "emerald"} sub="slot window passed" />
              : <Stat label="Teams" value={t.teams} sub="vehicles" />}
            {isToday
              ? <Stat label="Teams live now" value={t.liveTeams} tone="violet" sub={`of ${t.teams} deployed`} />
              : <Stat label="Unassigned" value={t.unassigned} tone={t.unassigned > 0 ? "amber" : "emerald"} />}
          </div>

          {/* Overall progress bar */}
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Day progress</span>
              <span className="font-medium text-slate-700">{t.done}/{t.orders} completed · {t.inProgress} moving · {t.notStarted} waiting</span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="bg-emerald-500" style={{ width: `${t.orders ? (t.done / t.orders) * 100 : 0}%` }} />
              <div className="bg-blue-400" style={{ width: `${t.orders ? (t.inProgress / t.orders) * 100 : 0}%` }} />
            </div>
          </div>

          {/* Financials */}
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Revenue" value={money(t.revenue)} tone="slate" />
            <Stat label="Vendor cost" value={money(t.cost)} tone="slate" />
            <Stat label="Margin" value={money(t.margin)} tone={t.margin >= 0 ? "emerald" : "red"} sub={`${marginPct}% of revenue`} />
            <Stat label="Cities operating" value={ops.cities.length} tone="slate" sub={`${t.teams} teams`} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* Revenue by city */}
            <Card className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Revenue &amp; margin by city</h3>
              <div className="space-y-2.5">
                {ops.cities.map((s) => (
                  <div key={s.slug}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-slate-600">{s.name}</span>
                      <span className="text-slate-400">{money(s.revenue)} rev · <span className={s.margin >= 0 ? "text-emerald-600" : "text-red-600"}>{money(s.margin)}</span></span>
                    </div>
                    <Bar value={s.revenue} max={maxRev} color="#2563eb" />
                  </div>
                ))}
              </div>
            </Card>

            {/* City operations table */}
            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 p-4 text-sm font-semibold text-slate-700">City status</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-xs text-slate-500">
                      <th className="px-3 py-2 font-medium">City</th>
                      <th className="px-3 py-2 font-medium">Progress</th>
                      {isToday && <th className="px-3 py-2 font-medium">Live</th>}
                      <th className="px-3 py-2 font-medium">Margin</th>
                      <th className="px-3 py-2 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ops.cities.map((s) => <CityRow key={s.slug} s={s} isToday={isToday} />)}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-400">
            Progress blends the vendor app&apos;s live status with the WMS work-order feed. Click a city to open its live monitoring board.
          </footer>
        </>
      )}
    </AppShell>
  );
}

function CityRow({ s, isToday }: { s: OpsCity; isToday: boolean }) {
  const donePct = s.orders > 0 ? Math.round((s.done / s.orders) * 100) : 0;
  return (
    <tr className="border-t border-slate-100 hover:bg-slate-50">
      <td className="px-3 py-2.5">
        <a href={withBase(`/?view=today&city=${s.slug}`)} className="font-medium text-blue-600 hover:underline">{s.name}</a>
        <div className="text-xs text-slate-400">{s.orders} orders · {s.pickups}p / {s.retrievals}r</div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-emerald-500" style={{ width: `${donePct}%` }} />
          </div>
          <span className="text-xs text-slate-500">{s.done}/{s.orders}</span>
        </div>
      </td>
      {isToday && (
        <td className="px-3 py-2.5">
          {s.liveTeams > 0
            ? <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500" />{s.liveTeams}</span>
            : <span className="text-xs text-slate-400">—</span>}
        </td>
      )}
      <td className="px-3 py-2.5 font-medium text-slate-800">{money(s.margin)}</td>
      <td className="px-3 py-2.5">
        {isToday && s.atRisk > 0 && <span className="mr-1 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">{s.atRisk} risk</span>}
        {s.unassigned > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700">{s.unassigned} open</span>}
        {(!isToday || s.atRisk === 0) && s.unassigned === 0 && <span className="text-xs text-emerald-600">✓ clean</span>}
      </td>
    </tr>
  );
}
