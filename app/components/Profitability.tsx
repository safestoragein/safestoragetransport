"use client";

import { OptimizationResult } from "@/lib/types";
import { computePnL } from "@/lib/economics";
import { REGION } from "@/lib/config";
import { money, pct } from "@/lib/format";
import { Card } from "./ui";

export default function Profitability({ result }: { result: OptimizationResult }) {
  const pnl = computePnL(result);
  const marginNeg = pnl.margin < 0;
  const dropsNoRevenue = result.bookings.filter((b) => b.type === "retrieval" && !(b.transportCharge ?? 0)).length;

  const stat = [
    { label: "Revenue", value: money(pnl.revenue), sub: "transport + packing charged" },
    { label: "Transport cost", value: money(pnl.transportCost), sub: `${REGION.currencySymbol}${REGION.transportPerBlock}/trip × ${pnl.vendors.reduce((s, v) => s + v.trips, 0)} trips` },
    { label: "Packing material", value: money(pnl.packingCost), sub: `${REGION.currencySymbol}${REGION.packingPerPallet}/pallet · pickups only` },
    { label: marginNeg ? "Net loss" : "Net margin", value: money(pnl.margin), sub: `${pct(pnl.marginPct)} of revenue`, big: true, neg: marginNeg },
  ];

  return (
    <div className="space-y-6">
      {dropsNoRevenue > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <span className="mt-0.5">●</span>
          <span>
            <span className="font-semibold">{dropsNoRevenue} drop(s) show ₹0 revenue</span> — retrieval transport charges
            aren&apos;t in the live work-order feed (like retrieval pallets), so the margin below is <span className="font-semibold">understated</span>;
            actual margins are better. Pickups are fully costed. Wire the retrieval pricing source to complete this.
          </span>
        </div>
      )}
      <Card className="p-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Transport P&amp;L (today)</h3>
          <span className="text-xs text-slate-500">{pnl.combinedPickupDrop} trips combine a pickup + a drop</span>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Revenue = transport + packing charged to customers. Cost = {money(REGION.transportPerBlock)}/trip paid to the
          vendor + {money(REGION.packingPerPallet)}/pallet packing material (pickups only). Packing usually runs at a loss —
          recovered via monthly storage — so the goal is the smallest transport loss.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stat.map((s) => (
            <div key={s.label} className={`rounded-lg p-3 ${s.big ? (s.neg ? "bg-red-50 ring-1 ring-red-200" : "bg-emerald-50 ring-1 ring-emerald-200") : "bg-slate-50"}`}>
              <div className="text-xs font-medium text-slate-500">{s.label}</div>
              <div className={`mt-1 text-xl font-bold ${s.big ? (s.neg ? "text-red-600" : "text-emerald-600") : "text-slate-900"}`}>{s.value}</div>
              <div className="mt-0.5 text-xs text-slate-400">{s.sub}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 p-4 text-sm font-semibold text-slate-700">Per-team margin (worst first)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-medium">Team</th>
                <th className="px-3 py-2 font-medium">Mix</th>
                <th className="px-3 py-2 font-medium">Revenue</th>
                <th className="px-3 py-2 font-medium">Transport</th>
                <th className="px-3 py-2 font-medium">Packing</th>
                <th className="px-3 py-2 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {pnl.vendors.map((v) => (
                <tr key={v.vendorId} className="border-t border-slate-100">
                  <td className="px-3 py-2.5 font-medium text-slate-700">{v.name}</td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">
                    {v.pickups}P + {v.drops}D · {v.trips} trip{v.trips > 1 ? "s" : ""}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{money(v.revenue)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{money(v.transportCost)}</td>
                  <td className="px-3 py-2.5 text-slate-500">{money(v.packingCost)}</td>
                  <td className={`px-3 py-2.5 font-semibold ${v.margin < 0 ? "text-red-600" : "text-emerald-600"}`}>{money(v.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pnl.lossVendors > 0 && (
          <div className="border-t border-slate-100 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
            <span className="font-medium">{pnl.lossVendors} team{pnl.lossVendors > 1 ? "s" : ""} running at a loss.</span> Pairing each loss-making
            pickup with a nearby drop (retrieval) shares the transport block and lifts the margin — the optimiser already
            prefers this, but loss-makers here are pickups with high pallet counts where packing (₹{REGION.packingPerPallet}/pallet) outweighs the charge.
          </div>
        )}
      </Card>
    </div>
  );
}
