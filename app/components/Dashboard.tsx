"use client";

import { useMemo, useState } from "react";
import { OptimizationResult } from "@/lib/types";
import { Diagnostics } from "@/lib/diagnostics";
import { filterByScope, countByCategory, timeRequests, Scope } from "@/lib/filter";
import Sidebar from "./Sidebar";
import { KpiCards, SavingsPanel, ObligationPanel, UtilizationPanel } from "./Panels";
import AssignmentBoard from "./AssignmentBoard";
import DiagnosticsPanel from "./Diagnostics";
import RouteMap from "./RouteMap";
import Timeline from "./Timeline";
import StatusBoard from "./StatusBoard";
import Profitability from "./Profitability";
import ModuleTabs from "./ModuleTabs";
import { Card } from "./ui";

type Tab = "overview" | "timeline" | "assignments" | "map" | "confirmations" | "pnl" | "savings";

export default function Dashboard({
  result, source, dateLabel, mode, diagnostics, activeSource, cities, dates, activeCity, activeDate,
}: {
  result: OptimizationResult;
  source: "live" | "sample" | "real";
  dateLabel: string;
  mode: "optimized" | "real";
  diagnostics?: Diagnostics;
  activeSource: string;
  cities?: { slug: string; name: string; count: number }[];
  dates?: { date: string; count: number }[];
  activeCity?: string;
  activeDate?: string;
  precisePins?: number;
}) {
  const counts = countByCategory(result);
  const total = counts.pickup + counts.full_retrieval + counts.partial_retrieval;
  const [scope, setScope] = useState<Scope>("all");
  const [tab, setTab] = useState<Tab>("overview");

  const view = useMemo(() => filterByScope(result, scope), [result, scope]);
  const reqs = useMemo(() => timeRequests(view), [view]);

  const SEGMENTS: { id: Scope; label: string; count: number }[] = [
    { id: "all", label: "All", count: total },
    { id: "pickup", label: "Pickup", count: counts.pickup },
    { id: "full_retrieval", label: "Retrieval", count: counts.full_retrieval },
    { id: "partial_retrieval", label: "Partial retrieval", count: counts.partial_retrieval },
  ];

  const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "timeline", label: "Timeline" },
    { id: "assignments", label: mode === "real" ? "Teams" : "Allocation" },
    { id: "map", label: "Route map" },
    { id: "confirmations", label: "Confirmations" },
    { id: "pnl", label: "Profit & loss" },
    { id: "savings", label: mode === "real" ? "Plan health" : "Savings" },
  ];

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar active="pr" />

      {/* ── Module content: Pickup & Retrieval ──────────────────────── */}
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <ModuleTabs active="dashboard" />
        <div className="mb-4">
          <h1 className="text-lg font-bold text-slate-900">Old schedules</h1>
          <p className="text-xs text-slate-500">Browse any city &amp; date · {result.city} · {dateLabel} · {total} orders</p>
        </div>

        {/* Toolbar: source / city / date / excel (inside the module) */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <a href="/?src=live" className={`rounded-md px-2.5 py-1 text-xs font-medium ${activeSource === "live" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Live</a>
          <a href="/?src=sample" className={`rounded-md px-2.5 py-1 text-xs font-medium ${activeSource === "sample" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Sample</a>
        </div>
        {source === "live" && cities && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">City
              <select defaultValue={activeCity} onChange={(e) => { window.location.href = `/?src=live&city=${e.currentTarget.value}`; }}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800">
                {cities.map((c) => <option key={c.slug} value={c.slug}>{c.name} ({c.count})</option>)}
              </select>
            </label>
            {dates && dates.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500">Date
                <select defaultValue={activeDate} onChange={(e) => { window.location.href = `/?src=live&city=${activeCity}&date=${e.currentTarget.value}`; }}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-800">
                  {dates.map((d) => <option key={d.date} value={d.date}>{d.date} ({d.count})</option>)}
                </select>
              </label>
            )}
            <a href={`/api/export?date=${activeDate}`} className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">⬇ Download Excel</a>
          </div>
        )}

        {/* Order-type segment (inside the module) */}
        <div className="mb-4 inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {SEGMENTS.map((s) => (
            <button key={s.id} onClick={() => setScope(s.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${scope === s.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
              {s.label} <span className={scope === s.id ? "text-slate-400" : "text-slate-400"}>{s.count}</span>
            </button>
          ))}
        </div>

        {reqs.length > 0 && (
          <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
            ⏰ <span className="font-semibold">{reqs.length}</span> order{reqs.length > 1 ? "s" : ""} in this view have a customer time request — scheduled in that slot on the Timeline.
          </div>
        )}

        {source === "live" && (
          <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
            <span className="font-semibold">Live orders</span> from your system. Pickup revenue = total pickup charge (with GST);
            retrieval revenue = retrieval transport charge. Team notes &amp; customer time requests are read from the order.
          </div>
        )}

        <KpiCards result={view} mode={mode} diagnostics={diagnostics} />

        <nav className="mt-6 flex gap-1 overflow-x-auto border-b border-slate-200">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 ${
                tab === t.id ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="mt-6">
          {tab === "overview" && (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                {mode === "real" && diagnostics ? <DiagnosticsPanel d={diagnostics} /> : <SavingsPanel result={view} />}
                <Card className="p-5"><h3 className="mb-3 text-sm font-semibold text-slate-700">Allocation map</h3><RouteMap result={view} /></Card>
              </div>
              <div className="space-y-6">
                {mode === "real" ? <UtilizationPanel result={view} /> : <><ObligationPanel result={view} /><UtilizationPanel result={view} /></>}
              </div>
            </div>
          )}
          {tab === "timeline" && <Timeline result={view} />}
          {tab === "confirmations" && <StatusBoard result={view} />}
          {tab === "pnl" && <Profitability result={view} />}
          {tab === "assignments" && <AssignmentBoard result={view} />}
          {tab === "map" && <Card className="p-5"><RouteMap result={view} /></Card>}
          {tab === "savings" && (
            <div className="grid gap-6 lg:grid-cols-2">
              {mode === "real" && diagnostics ? <DiagnosticsPanel d={diagnostics} /> : <SavingsPanel result={view} />}
              {mode === "real" ? <UtilizationPanel result={view} /> : <ObligationPanel result={view} />}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
