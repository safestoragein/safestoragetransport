"use client";

import { OptimizationResult, Booking } from "@/lib/types";
import { Card } from "./ui";

const COLUMNS: { key: string; label: string; head: string; chip: string }[] = [
  { key: "request_raise", label: "Request raised", head: "bg-slate-100 text-slate-700", chip: "ring-slate-200" },
  { key: "pending", label: "Pending confirmation", head: "bg-amber-100 text-amber-800", chip: "ring-amber-200" },
  { key: "scheduled", label: "Scheduled", head: "bg-blue-100 text-blue-800", chip: "ring-blue-200" },
  { key: "reschedule", label: "Reschedule", head: "bg-red-100 text-red-800", chip: "ring-red-200" },
  { key: "completed", label: "Completed", head: "bg-emerald-100 text-emerald-800", chip: "ring-emerald-200" },
];

export default function StatusBoard({ result }: { result: OptimizationResult }) {
  const teamByBooking = new Map<string, string>();
  result.assignments.forEach((a) => {
    const name = result.vendors.find((v) => v.id === a.vendorId)?.name ?? "";
    a.bookingIds.forEach((id) => teamByBooking.set(id, name));
  });

  const grouped = new Map<string, Booking[]>();
  for (const b of result.bookings) {
    const k = (b.orderStatus || "other").toLowerCase();
    (grouped.get(k) ?? grouped.set(k, []).get(k)!).push(b);
  }
  const known = new Set(COLUMNS.map((c) => c.key));
  const other = [...grouped.entries()].filter(([k]) => !known.has(k)).flatMap(([, v]) => v);
  const cols = [...COLUMNS];
  if (other.length) cols.push({ key: "other", label: "Other", head: "bg-slate-100 text-slate-600", chip: "ring-slate-200" });

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Confirmation pipeline</h3>
        <span className="text-xs text-slate-500">{result.bookings.length} orders · from order status + WhatsApp confirmation</span>
      </div>
      <p className="mb-4 text-xs text-slate-500">Where each order sits in the customer-confirmation flow. Anything in Pending / Reschedule needs a call or WhatsApp before the day.</p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cols.map((c) => {
          const items = c.key === "other" ? other : grouped.get(c.key) ?? [];
          return (
            <div key={c.key} className="flex flex-col">
              <div className={`mb-2 flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-semibold ${c.head}`}>
                <span>{c.label}</span>
                <span>{items.length}</span>
              </div>
              <div className="space-y-1.5">
                {items.length === 0 && <div className="rounded-md border border-dashed border-slate-200 py-3 text-center text-[11px] text-slate-400">—</div>}
                {items.map((b) => (
                  <div key={b.id} className={`rounded-md bg-white p-2 text-xs ring-1 ${c.chip}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700">{b.refNo}</span>
                      <span className="text-slate-400">{b.pallets}p</span>
                    </div>
                    <div className="truncate text-[11px] text-slate-500">{b.location.label} · {b.customerName}</div>
                    <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
                      <span>{b.timeSlot ? b.timeSlot.replace(/:00/g, "") : "no slot"}</span>
                      <span className="truncate pl-1 text-slate-500">{teamByBooking.get(b.id) ?? "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
