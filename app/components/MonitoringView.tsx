"use client";

import { ScheduleData } from "@/lib/schedule";
import Lifecycle, { LifeStep } from "./Lifecycle";

const cityName = (slug: string) => slug.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

const TYPE: Record<string, { label: string; cls: string }> = {
  pickup: { label: "Pickup", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  full_retrieval: { label: "Retrieval", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  partial_retrieval: { label: "Partial retrieval", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
};

function fmt(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return null; }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// On-ground flow. A pickup is collected from the customer and dropped at the warehouse. A retrieval
// is collected from the warehouse the evening before, then delivered to the customer in the morning.
// `done` flags for the field steps come from the WMS / pickup-done / delivery-done endpoints (wired
// when provided); for now a "completed" order marks them all done, otherwise only the assignment is.
function buildSteps(o: any, assignedAt: string | null, assigned: boolean): LifeStep[] {
  const pickup = o.order_type === "pickup";
  const completed = String(o.order_status ?? "").toLowerCase() === "completed";
  const a = (label: string, done: boolean, at: string | null = null): LifeStep => ({ label, done, at });
  if (pickup) {
    return [
      a("Vendor Assigned", assigned, assigned ? fmt(assignedAt) : null),
      a("Picked Up", completed),
      a("Dropped at Warehouse", completed),
    ];
  }
  return [
    a("Vendor Assigned", assigned, assigned ? fmt(assignedAt) : null),
    a("Collected from Warehouse", completed), // evening before
    a("Delivered to Customer", completed),
  ];
}

export default function MonitoringView({ cities }: { cities: ScheduleData[] }) {
  if (cities.length === 0) return null;
  return (
    <div className="space-y-8">
      {cities.map((c) => {
        const rows = c.vendors.flatMap((v: any) => v.orders.map((o: any) => ({ o, v })));
        if (rows.length === 0) return null;
        return (
          <section key={c.city}>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b border-slate-200 pb-1">
              <h2 className="text-base font-bold text-slate-900">{cityName(c.city)}</h2>
              <span className="text-xs text-slate-500">{rows.length} bookings today</span>
            </div>
            <div className="space-y-3">
              {rows.map(({ o, v }, i) => {
                const t = TYPE[o.order_type] ?? TYPE.pickup;
                const steps = buildSteps(o, v.vendorNotifiedAt ?? null, !v.isUnassigned);
                const vendorContact = v.driverContact || v.supervisorContact || null;
                return (
                  <div key={(o.customer_unique_id ?? o.id ?? i) + "-" + i} className="rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 bg-white p-4">
                    {/* TOP: order number + customer name */}
                    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-bold text-slate-900">{o.customer_unique_id ?? o.order_id}</span>
                      <span className="text-sm text-slate-700">{o.customer_name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${t.cls}`}>{t.label}{o.is_intercity ? " · intercity" : ""}</span>
                      {o.locality && <span className="text-xs text-slate-400">{o.locality}</span>}
                      {o.time_slot && <span className="text-xs text-slate-400">wants {String(o.time_slot).replace(/:00/g, "")}</span>}
                    </div>

                    <Lifecycle steps={steps} />

                    {/* BOTTOM: vendor (number) + customer (number) */}
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
                      <span>
                        Vendor: {v.isUnassigned ? <span className="font-medium text-amber-600">unassigned</span> : <b className="font-medium text-slate-700">{v.vendorName}</b>}
                        {vendorContact && <span className="text-slate-400"> · {vendorContact}</span>}
                      </span>
                      <span>Customer: <b className="font-medium text-slate-700">{o.customer_name}</b>{o.contact ? <span className="text-slate-400"> · {o.contact}</span> : null}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
