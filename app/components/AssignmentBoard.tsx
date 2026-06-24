"use client";

import { useState } from "react";
import { OptimizationResult } from "@/lib/types";
import { TIER_DESCRIPTION } from "@/lib/config";
import { money, km } from "@/lib/format";
import { Card, Bar, TIER_STYLE, vendorColor } from "./ui";

export default function AssignmentBoard({ result }: { result: OptimizationResult }) {
  const order = ["general", "non_general"] as const;
  const vIndex = new Map(result.vendors.map((v, i) => [v.id, i]));
  const byId = new Map(result.bookings.map((b) => [b.id, b]));

  const idleVendors = result.vendors.filter((v) => !result.assignments.some((a) => a.vendorId === v.id));

  return (
    <div className="space-y-6">
      {order.map((tier) => {
        const items = result.assignments.filter((a) => result.vendors.find((v) => v.id === a.vendorId)?.tier === tier);
        if (items.length === 0) return null;
        return (
          <div key={tier}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${TIER_STYLE[tier].chip}`}>
                {TIER_STYLE[tier].label}
              </span>
              <span className="text-xs text-slate-500">{TIER_DESCRIPTION[tier]}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((a) => {
                const v = result.vendors.find((x) => x.id === a.vendorId)!;
                const color = vendorColor(vIndex.get(v.id)!);
                return <VendorCard key={a.vendorId} a={a} v={v} color={color} byId={byId} />;
              })}
            </div>
          </div>
        );
      })}

      {idleVendors.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-semibold text-slate-700">Idle vendors today ({idleVendors.length})</div>
          <div className="mt-1 text-xs text-slate-500">
            Not assigned any orders. General (A) vendors here represent prepaid capacity going unused.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {idleVendors.map((v) => (
              <span key={v.id} className={`rounded-full px-2.5 py-1 text-xs ring-1 ${TIER_STYLE[v.tier].chip}`}>
                {v.name} · {TIER_STYLE[v.tier].label}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function VendorCard({ a, v, color, byId }: { a: any; v: any; color: string; byId: Map<string, any> }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-800">{v.name}</div>
          <div className="truncate text-xs text-slate-500">{v.depot.label} · {v.vehicle.type} ({v.vehicle.palletCapacity} pallets)</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-slate-900">{money(a.cost)}</div>
          <div className="text-xs text-slate-500">{km(a.distanceKm)}</div>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span className="font-medium">{a.palletsAssigned} pallets</span>
          <span className="text-slate-300">|</span>
          <span>{a.ordersCount} order{a.ordersCount > 1 ? "s" : ""}</span>
          <span className="text-slate-300">|</span>
          <span>{a.trips.length} trip{a.trips.length > 1 ? "s" : ""}</span>
          {v.tier === "general" && (
            <>
              <span className="text-slate-300">|</span>
              <span className={a.palletsAssigned + 0.001 < v.palletObligation ? "text-red-600 font-medium" : "text-emerald-600"}>
                obligation {v.palletObligation}p {a.palletsAssigned + 0.001 < v.palletObligation ? "short" : "met"}
              </span>
            </>
          )}
        </div>

        {a.trips.map((trip: any, i: number) => {
          const stops = trip.bookingIds.map((id: string) => byId.get(id));
          return (
            <div key={i} className="rounded-lg bg-slate-50 p-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">
                  Trip {i + 1}{trip.bookingIds.length > 1 ? " · combined load" : ""}
                </span>
                <span className="text-xs text-slate-500">{trip.palletsUsed}/{trip.palletCapacity} pallets</span>
              </div>
              <Bar value={trip.palletsUsed} max={trip.palletCapacity} color={color} />
              <div className="mt-2 space-y-1">
                {stops.map((b: any) => (
                  <div key={b.id}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-700">
                        {b.location.label} · {b.customerName}
                        {b.requiredTimeText && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">⏰ {b.requiredTimeText}</span>}
                      </span>
                      <span className="text-slate-400">{b.refNo} · {b.pallets}p</span>
                    </div>
                    {b.teamNotes && <div className="mt-0.5 line-clamp-2 rounded bg-amber-50 px-1.5 py-1 text-[11px] text-amber-900">📝 {b.teamNotes}</div>}
                  </div>
                ))}
                <div className="text-xs text-slate-400">→ {stops[0].warehouse.label}</div>
              </div>
            </div>
          );
        })}

        <button onClick={() => setOpen(!open)} className="text-xs font-medium text-blue-600 hover:underline">
          {open ? "Hide reasoning" : "Why these assignments?"}
        </button>
        {open && (
          <ul className="space-y-1.5 border-l-2 border-blue-100 pl-3">
            {a.reasoning.map((r: string, i: number) => (
              <li key={i} className="text-xs leading-relaxed text-slate-600">{r}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
