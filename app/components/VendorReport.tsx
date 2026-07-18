"use client";

// Per-vendor supervisor report card — the exact format the ops team used in the old tool:
// "Supervisor: X (N orders)" header, then one green "Booking i" block per order with the
// C ID / CN / P H / L C / PL / P T / F L / CN rows. Opens from the 📄 Report button on a vendor
// card; the full customer address comes from /api/schedule/report (live feed — the schedule
// snapshot only keeps a short locality).
import { useEffect, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

// "9am_11am" -> "9:00 AM - 11:00 AM"
function fmtSlot(s: string | null | undefined): string {
  if (!s) return "N/A";
  const one = (p: string) => {
    const m = p.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    return m ? `${m[1]}:${m[2] ?? "00"} ${m[3].toUpperCase()}` : p;
  };
  return String(s).split("_").map(one).join(" - ");
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Row { label: string; value: string; right: string; valueHl?: string; rightHl?: string }

function bookingRows(o: any, v: any, address: string | null): Row[] {
  const sup = v.supervisorName || "N/A";
  const floorLift = [o.floor != null && String(o.floor).trim() !== "" ? String(o.floor).trim() : null, o.lift ? String(o.lift) : null].filter(Boolean).join(" / ") || "N/A";
  return [
    { label: "C ID", value: o.customer_unique_id, valueHl: "#fdba74", right: sup },
    { label: "CN", value: o.customer_name || "N/A", right: v.driverName || "N/A", rightHl: "#fed7aa" },
    { label: "P H", value: o.contact || "N/A", right: v.vehicleNo || "N/A" },
    { label: "L C", value: address || o.locality || "N/A", right: sup, rightHl: "#fef08a" },
    { label: "PL", value: o.pallets != null ? String(o.pallets) : "N/A", right: "Pallets" },
    { label: "P T", value: fmtSlot(o.time_slot), valueHl: "#fef9c3", right: o.required_time || "N/A" },
    { label: "F L", value: floorLift, right: "Floor / Lift" },
    { label: "CN", value: o.team_notes || "—", right: "Customer Notes" },
  ];
}

// Inline-styled HTML (shared by the modal preview and the print window, so what you print is
// exactly what you see).
function reportHtml(v: any, addresses: Record<string, string>): string {
  const orders = (v.orders ?? []).filter((o: any) => o.stop_seq !== -1);
  const cell = "padding:8px 10px;border:1px solid #e2e8f0;font-size:13px;vertical-align:top;";
  const blocks = orders.map((o: any, i: number) => {
    const rows = bookingRows(o, v, addresses[o.customer_unique_id] ?? null)
      .map((r) => `<tr>
        <td style="${cell}font-weight:700;white-space:nowrap;width:52px">${esc(r.label)}</td>
        <td style="${cell}${r.valueHl ? `background:${r.valueHl};` : ""}max-width:220px">${esc(r.value)}</td>
        <td style="${cell}${r.rightHl ? `background:${r.rightHl};` : ""}color:#334155">${esc(r.right)}</td>
      </tr>`).join("");
    return `<table style="border-collapse:collapse;width:100%;margin-bottom:16px">
      <tr><td colspan="3" style="background:#22c55e;color:#fff;font-weight:800;text-align:center;padding:8px;font-size:14px;border:1px solid #16a34a">Booking ${i + 1}</td></tr>
      ${rows}
    </table>`;
  }).join("");
  return `<div style="font-family:system-ui,sans-serif;max-width:420px">
    <div style="border-left:4px solid #2563eb;padding:6px 10px;font-weight:800;font-size:15px;margin-bottom:10px">Supervisor: ${v.supervisorName || v.vendorName} (${orders.length} order${orders.length === 1 ? "" : "s"})</div>
    ${blocks}
  </div>`;
}

export default function VendorReport({ vendor, city, date, onClose }: { vendor: any; city: string; date: string; onClose: () => void }) {
  const [addresses, setAddresses] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    fetch(`/api/schedule/report?city=${city}&date=${date}`)
      .then((r) => r.json())
      .then((j) => setAddresses(j?.addresses ?? {}))
      .catch(() => setAddresses({}));
  }, [city, date]);

  const print = () => {
    const w = window.open("", "_blank", "width=480,height=700");
    if (!w) return;
    w.document.write(`<html><head><title>${vendor.vendorName} — ${date}</title></head><body>${reportHtml(vendor, addresses ?? {})}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={onClose}>
      <div className="my-4 w-full max-w-md rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <span className="text-sm font-bold text-slate-800">📄 {vendor.vendorName} — {date}</span>
          <button onClick={print} disabled={!addresses} className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">🖨 Print / PDF</button>
          <button onClick={onClose} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">✕</button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4">
          {addresses == null
            ? <div className="py-8 text-center text-sm text-slate-500">Loading report…</div>
            : <div dangerouslySetInnerHTML={{ __html: reportHtml(vendor, addresses) }} />}
        </div>
      </div>
    </div>
  );
}
