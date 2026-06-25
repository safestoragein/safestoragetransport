"use client";

import { ScheduleData } from "@/lib/schedule";
import Lifecycle, { LifeStep } from "./Lifecycle";

const cityName = (slug: string) => slug.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

const TYPE: Record<string, { label: string; cls: string }> = {
  pickup: { label: "Pickup", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  full_retrieval: { label: "Retrieval", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  partial_retrieval: { label: "Partial", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
};

function fmt(iso?: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch { return null; }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Best-effort lifecycle from data we already have. Steps 3–7 (started / done / payment / notes /
// closed) light up once the live pickup & retrieval status endpoints are wired in.
function buildSteps(o: any, assignedAt: string | null, assigned: boolean): { steps: LifeStep[]; current: number } {
  const pickup = o.order_type === "pickup";
  const steps: LifeStep[] = [
    { label: "Booking Received", at: fmt(o.created_at ?? o.booking_date) },
    { label: "Vendor Assigned", at: assigned ? fmt(assignedAt) : null },
    { label: pickup ? "Pickup Started" : "Retrieval Started" },
    { label: pickup ? "Picked Up" : "Delivered" },
    { label: "Payment Received" },
    { label: "Notes Updated" },
    { label: "Closed" },
  ];
  let current = assigned ? 2 : 1;
  const st = String(o.order_status ?? "").toLowerCase();
  if (st === "completed") current = 5; // job done → awaiting payment (refined once live status is wired)
  return { steps, current };
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
                const { steps, current } = buildSteps(o, v.vendorNotifiedAt ?? null, !v.isUnassigned);
                return (
                  <div key={(o.customer_unique_id ?? o.id ?? i) + "-" + i} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-semibold text-slate-800">{o.customer_unique_id ?? o.customer_name}</span>
                      <span className="text-slate-600">{o.customer_name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${t.cls}`}>{t.label}</span>
                      {o.locality && <span className="text-xs text-slate-400">{o.locality}</span>}
                      {o.time_slot && <span className="text-xs text-slate-400">wants {String(o.time_slot).replace(/:00/g, "")}</span>}
                      <span className="ml-auto text-xs font-medium text-slate-500">
                        {v.isUnassigned ? <span className="text-amber-600">Unassigned</span> : v.vendorName}
                      </span>
                    </div>
                    <Lifecycle steps={steps} current={current} />
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
