"use client";

import { OptimizationResult } from "@/lib/types";
import { Diagnostics } from "@/lib/diagnostics";
import { computePnL } from "@/lib/economics";
import { REGION } from "@/lib/config";
import { money, km, pct } from "@/lib/format";
import { Card, Bar, TIER_STYLE, vendorColor } from "./ui";

export function KpiCards({ result, mode, diagnostics }: { result: OptimizationResult; mode: "optimized" | "real"; diagnostics?: Diagnostics }) {
  const k = result.kpis;
  const c = result.comparison;
  const pnl = computePnL(result);
  const base = [
    { label: "Bookings today", value: String(k.totalBookings), sub: `${k.totalPallets} pallets` },
    { label: "Vehicles deployed", value: String(k.vendorsActive), sub: `${k.totalTrips} trips · ${result.vendors.length} available` },
    { label: "Pallet utilisation", value: pct(k.palletUtilization), sub: `${k.consolidatedTrips} combined trips` },
    { label: pnl.margin < 0 ? "Transport loss" : "Transport margin", value: money(pnl.margin), sub: `${money(pnl.revenue)} rev − ${money(pnl.cost)} cost`, bad: pnl.margin < 0, good: pnl.margin >= 0 },
  ];
  const cells: { label: string; value: string; sub: string; good?: boolean; bad?: boolean }[] =
    mode === "real" && diagnostics
      ? [
          ...base,
          { label: "Capacity overloads", value: String(diagnostics.capacityOverloads), sub: "vehicle / oversize", bad: diagnostics.capacityOverloads > 0 },
          { label: "Unassigned", value: String(diagnostics.unassignedCount), sub: "need a team", bad: diagnostics.unassignedCount > 0 },
        ]
      : [
          ...base,
          { label: "Cost saved", value: money(c.costSaved), sub: "vs manual", good: true },
          { label: "Type B pallets cut", value: String(Math.max(0, Math.round((c.manualNonGenPallets - c.optimizedNonGenPallets) * 10) / 10)), sub: `B pallets: ${c.manualNonGenPallets}→${c.optimizedNonGenPallets}`, good: true },
        ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cells.map((cell) => (
        <Card key={cell.label} className="p-4">
          <div className="text-xs font-medium text-slate-500">{cell.label}</div>
          <div className={`mt-1 text-2xl font-bold ${cell.good ? "text-emerald-600" : cell.bad ? "text-red-600" : "text-slate-900"}`}>{cell.value}</div>
          <div className="mt-0.5 text-xs text-slate-400">{cell.sub}</div>
        </Card>
      ))}
    </div>
  );
}

export function SavingsPanel({ result }: { result: OptimizationResult }) {
  const c = result.comparison;
  const savePct = c.manualCost > 0 ? c.costSaved / c.manualCost : 0;
  const rows = [
    { label: "Total payout", manual: money(c.manualCost), opt: money(c.optimizedCost) },
    { label: "Type B (non-general) pallets", manual: String(c.manualNonGenPallets), opt: String(c.optimizedNonGenPallets) },
    { label: "Type A obligations filled", manual: `${c.manualGeneralFilled}/${c.generalTotal}`, opt: `${c.optimizedGeneralFilled}/${c.generalTotal}` },
    { label: "Route distance (operational only)", manual: km(c.manualKm), opt: km(c.optimizedKm) },
  ];
  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Optimised vs existing manual plan</h3>
        <span className="text-xs text-slate-400">same {result.bookings.length} bookings · same cost model</span>
      </div>

      <div className="mt-4 flex items-end gap-3">
        <div className="text-4xl font-bold text-emerald-600">{money(c.costSaved)}</div>
        <div className="pb-1 text-sm text-slate-500">
          saved today ({pct(savePct)} lower) · {Math.max(0, Math.round((c.manualNonGenPallets - c.optimizedNonGenPallets) * 10) / 10)} fewer Type B pallets
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-4 py-2 font-medium">Metric</th>
              <th className="px-4 py-2 font-medium">Existing (manual)</th>
              <th className="px-4 py-2 font-medium text-emerald-700">Optimised</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-slate-600">{r.label}</td>
                <td className="px-4 py-2.5 text-slate-500">{r.manual}</td>
                <td className="px-4 py-2.5 font-semibold text-slate-900">{r.opt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-blue-50 p-3 ring-1 ring-blue-100">
        <span className="mt-0.5 text-blue-600">●</span>
        <p className="text-xs leading-relaxed text-slate-700">
          Savings come from <span className="font-semibold">who does the work, not distance</span>. Type A vendors are
          prepaid (₹6,500 for 7 pallets, any distance) so we fill them first; the existing plan filled only
          <span className="font-semibold"> {c.manualGeneralFilled} of {c.generalTotal}</span> A obligations and pushed
          {" "}{c.manualNonGenPallets} pallets onto costly Type B — the optimised plan fills
          {" "}<span className="font-semibold">{c.optimizedGeneralFilled} of {c.generalTotal}</span> and cuts Type B to {c.optimizedNonGenPallets} pallets.
        </p>
      </div>
    </Card>
  );
}

export function ObligationPanel({ result }: { result: OptimizationResult }) {
  const items = result.obligations;
  const breaches = items.filter((o) => !o.met);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Obligation monitor</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${breaches.length ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"}`}>
          {breaches.length ? `${breaches.length} need attention` : "all minimums met"}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Every Type A vendor must receive at least 7 pallets/day (₹6,500 is paid regardless). A short A vendor
        is prepaid capacity being wasted.
      </p>

      <div className="mt-4 space-y-2">
        {items.map((o) => {
          const tone =
            o.severity === "breach"
              ? "border-red-200 bg-red-50"
              : o.severity === "at_risk"
                ? "border-amber-200 bg-amber-50"
                : "border-slate-100 bg-white";
          return (
            <div key={o.vendorId} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${tone}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${TIER_STYLE[o.tier].dot}`} />
              <div className="flex-1 text-sm text-slate-700">{o.vendorName}</div>
              <div className="text-xs text-slate-500">{TIER_STYLE[o.tier].label}</div>
              <div className="w-28">
                <Bar value={o.assigned} max={o.required} color={o.met ? "#059669" : o.severity === "breach" ? "#dc2626" : "#d97706"} />
              </div>
              <div className="w-20 text-right text-xs font-medium text-slate-600">
                {o.assigned}/{o.required}p
                {!o.met && <span className="ml-1 text-red-600">−{o.shortBy}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {breaches.length > 0 && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <span className="font-medium text-slate-700">Suggested action:</span> pull the nearest open order
          toward the short Type A vendor 2 days before the schedule to fill the prepaid 7-pallet slot —
          surfaced here while there is still time to act.
        </div>
      )}
    </Card>
  );
}

export function UtilizationPanel({ result }: { result: OptimizationResult }) {
  const vIndex = new Map(result.vendors.map((v, i) => [v.id, i]));
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-slate-700">Vehicle fill by vendor</h3>
      <p className="mt-1 text-xs text-slate-500">Pallets loaded vs vehicle capacity across the day.</p>
      <div className="mt-4 space-y-3">
        {result.assignments.map((a) => {
          const v = result.vendors.find((x) => x.id === a.vendorId)!;
          const used = Math.round(a.trips.reduce((s, t) => s + t.palletsUsed, 0) * 10) / 10;
          const cap = a.trips.reduce((s, t) => s + t.palletCapacity, 0);
          return (
            <div key={a.vendorId}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-600">{v.name}</span>
                <span className="text-slate-400">{used}/{cap} pallets</span>
              </div>
              <Bar value={used} max={cap} color={vendorColor(vIndex.get(v.id)!)} />
            </div>
          );
        })}
      </div>
      <div className="mt-4 text-xs text-slate-400">
        Cost model: {REGION.region} · per 7 pallets — A base {REGION.currencySymbol}{REGION.generalBaseBlockCost} · A extra {REGION.currencySymbol}{REGION.generalExtraBlockCost} · B {REGION.currencySymbol}{REGION.nonGeneralBlockCost} (distance not a cost lever)
      </div>
    </Card>
  );
}
