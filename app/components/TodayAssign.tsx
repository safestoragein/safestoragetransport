"use client";

// Manual assignment for TODAY. Orders that land after the morning run sit in the run's
// "team to assign" bucket — today is NEVER re-optimised automatically, so the office picks a
// vendor by hand here and the order immediately joins that vendor's monitoring card below.
import { useState } from "react";
import { ScheduleData } from "@/lib/schedule";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  pickup: { label: "Pickup", cls: "bg-blue-600" },
  full_retrieval: { label: "Retrieval", cls: "bg-emerald-600" },
  partial_retrieval: { label: "Partial", cls: "bg-amber-500" },
};

export default function TodayAssign({ city, onChanged }: { city: ScheduleData; onChanged: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const un = city.vendors.find((v) => v.isUnassigned);
  const orders = (un?.orders ?? []) as any[];
  if (orders.length === 0) return null;

  async function assign(orderUuid: string, vendorId: string) {
    if (!vendorId) return;
    const av = (city.availableVendors ?? []).find((x: any) => x.id === vendorId);
    setPending(orderUuid);
    await fetch("/api/schedule/assignment", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: city.runId, orderUuid, action: "reassign", vendorId, vendorName: av?.name ?? null }),
    }).catch(() => {});
    setPending(null);
    onChanged();
  }

  const cityLabel = city.city.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
  return (
    <Card className="mb-4 overflow-hidden ring-1 ring-amber-300">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2.5">
        <span className="text-sm font-semibold text-amber-800">
          ⚠️ {cityLabel} — {orders.length} order{orders.length > 1 ? "s" : ""} for TODAY need a team (assign manually)
        </span>
        <span className="text-[11px] text-amber-700">Today is never re-optimised — pick the vendor yourself; the order joins their live card below.</span>
      </div>
      <div className="divide-y divide-slate-100">
        {orders.map((o) => {
          const t = TYPE_BADGE[o.order_type] ?? TYPE_BADGE.pickup;
          return (
            <div key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-xs">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${t.cls}`}>{t.label}</span>
              <span className="text-[13px] font-bold text-slate-900">{o.customer_unique_id}</span>
              {(o.stated_pallets ?? o.pallets) != null && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{o.stated_pallets ?? o.pallets}p</span>
              )}
              <span className="text-slate-600">{o.customer_name}</span>
              {o.contact && <a className="font-medium text-blue-600 hover:underline" href={`tel:${String(o.contact).split(/[/,]/)[0].trim()}`}>📞 {String(o.contact).split(/[/,]/)[0].trim()}</a>}
              {o.locality && <span className="text-slate-400">📍 {o.locality}</span>}
              {o.time_slot && <span className="text-slate-400">wants {String(o.time_slot).replace(/:00/g, "")}</span>}
              {o.transport_charge != null && Number(o.transport_charge) > 0 && <span className="text-slate-500">₹{Number(o.transport_charge).toLocaleString("en-IN")}</span>}
              <select
                disabled={pending === o.id}
                defaultValue=""
                onChange={(e) => assign(o.id, e.target.value)}
                className="ml-auto rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-50"
              >
                <option value="" disabled>{pending === o.id ? "Assigning…" : "— assign a vendor —"}</option>
                {(city.availableVendors ?? []).map((v: any) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
