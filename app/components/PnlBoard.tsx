"use client";

// Weekly / Monthly P&L — the team's "Daily Schedules Transport Charges" workbook, live.
// Same 17 columns in the same order, a Weekly or Monthly range, a vendor filter, and a Download
// Excel that produces the identical sheet. Charges follow the invoicing rule: a pickup counts at
// its QUOTATION until the goods are counted, at the INVENTORY figures afterwards.
import { useCallback, useEffect, useState } from "react";
import { SessionUser } from "@/lib/auth";
import { money } from "@/lib/format";
import { withBase } from "@/lib/base";
import AppShell from "./AppShell";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const HEADERS = [
  "Date", "City", "Cust id", "Cust Name", "Teams", "Team Names", "Pallets", "Order Type",
  "Vehicle", "Porter/Vendor Charges", "Storage Charges", "Transport Charges", "Shifting Charges",
  "Payment", "Google Reviews", "Comment", "Remarks",
];
const NUMERIC = new Set([6, 9, 10, 11, 12]); // right-aligned columns

const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};

// Monday→Sunday of the week containing `d`; and the calendar month.
function weekOf(d: Date): [string, string] {
  const s = new Date(d);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return [iso(s), iso(e)];
}
function monthOf(d: Date): [string, string] {
  return [iso(new Date(d.getFullYear(), d.getMonth(), 1)), iso(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
}

export default function PnlBoard({ user }: { user: SessionUser | null }) {
  const today = new Date();
  const [mode, setMode] = useState<"week" | "month" | "custom">("month");
  const [[from, to], setRange] = useState<[string, string]>(monthOf(today));
  const [vendor, setVendor] = useState("All");
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/pnl/rows?from=${from}&to=${to}&vendor=${encodeURIComponent(vendor)}`)
      .then((x) => x.json()).catch(() => null);
    setData(r);
    setLoading(false);
  }, [from, to, vendor]);
  useEffect(() => { load(); }, [load]);

  const setWeek = () => { setMode("week"); setRange(weekOf(new Date())); };
  const setMonth = () => { setMode("month"); setRange(monthOf(new Date())); };
  const shift = (dir: -1 | 1) => {
    const base = new Date(`${from}T00:00:00`);
    if (mode === "month") { base.setMonth(base.getMonth() + dir); setRange(monthOf(base)); }
    else { base.setDate(base.getDate() + dir * 7); setRange(weekOf(base)); }
  };

  const rows: any[] = data?.rows ?? [];
  const t = data?.totals ?? { orders: 0, pallets: 0, storage: 0, transport: 0, shifting: 0 };
  const btn = "rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-slate-200 hover:bg-slate-50";

  return (
    <AppShell active="pnl" user={user}>
      <header className="mb-4">
        <h1 className="text-lg font-bold text-slate-900">Weekly / Monthly P&amp;L</h1>
        <p className="text-xs text-slate-500">
          the team&apos;s daily-schedules sheet, live · pickups count at their quotation until the goods are
          counted, at the invoiced figures afterwards
        </p>
      </header>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <button onClick={setWeek} className={mode === "week" ? "rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white" : btn}>📅 Weekly P&amp;L</button>
          <button onClick={setMonth} className={mode === "month" ? "rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white" : btn}>🗓 Monthly P&amp;L</button>
          {mode !== "custom" && (
            <span className="flex items-center gap-1">
              <button onClick={() => shift(-1)} title="Previous" className="rounded-lg px-2 py-1.5 text-sm ring-1 ring-slate-200 hover:bg-slate-50">‹</button>
              <button onClick={() => shift(1)} title="Next" className="rounded-lg px-2 py-1.5 text-sm ring-1 ring-slate-200 hover:bg-slate-50">›</button>
            </span>
          )}
          <label className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">From
            <input type="date" value={from} max={to} onChange={(e) => { setMode("custom"); setRange([e.target.value, to]); }}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">To
            <input type="date" value={to} min={from} onChange={(e) => { setMode("custom"); setRange([from, e.target.value]); }}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">Vendor
            <select value={vendor} onChange={(e) => setVendor(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
              <option value="All">All vendors</option>
              {(data?.vendors ?? []).map((v: string) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <a
            href={withBase(`/api/pnl/rows?from=${from}&to=${to}&vendor=${encodeURIComponent(vendor)}&format=xlsx`)}
            className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >⬇ Download Excel</a>
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          {fmtDate(from)} → {fmtDate(to)}{vendor !== "All" ? ` · ${vendor}` : ""}
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Orders", value: t.orders },
          { label: "Pallets", value: t.pallets },
          { label: "Transport charges", value: money(t.transport) },
          { label: "Storage charges", value: money(t.storage) },
          { label: "Shifting charges", value: money(t.shifting) },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xl font-extrabold text-slate-900">{s.value}</div>
            <div className="text-[11px] font-medium text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading…</Card>
      ) : !data?.ok ? (
        <Card className="p-8 text-center text-sm text-red-600">{data?.error ?? "Could not load"}</Card>
      ) : rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No scheduled orders between {fmtDate(from)} and {fmtDate(to)}.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-[11px] whitespace-nowrap">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wide text-slate-500">
                {HEADERS.map((h, i) => <th key={h} className={`px-2 py-2 font-semibold ${NUMERIC.has(i) ? "text-right" : ""}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/70">
                  <td className="px-2 py-1.5 text-slate-600">{fmtDate(r.date)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.city}</td>
                  <td className="px-2 py-1.5 font-semibold text-slate-800">{r.custId}</td>
                  <td className="px-2 py-1.5 text-slate-700">{r.custName}</td>
                  <td className="px-2 py-1.5 text-slate-700">{r.teams}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.teamNames}</td>
                  <td className="px-2 py-1.5 text-right text-slate-700">{r.pallets ?? ""}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.orderType}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.vehicle}</td>
                  <td className="px-2 py-1.5 text-right text-slate-600">{r.porterCharges || ""}</td>
                  <td className="px-2 py-1.5 text-right text-slate-700">{r.storageCharges ? money(r.storageCharges) : ""}</td>
                  <td className="px-2 py-1.5 text-right font-semibold text-slate-800">{r.transportCharges ? money(r.transportCharges) : ""}</td>
                  <td className="px-2 py-1.5 text-right text-slate-700">{r.shiftingCharges ? money(r.shiftingCharges) : ""}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.payment}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.googleReviews}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.comment}</td>
                  <td className="px-2 py-1.5 text-slate-500">{r.remarks}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900">
                <td className="px-2 py-2" colSpan={6}>Total · {t.orders} orders</td>
                <td className="px-2 py-2 text-right">{t.pallets}</td>
                <td className="px-2 py-2" colSpan={2}></td>
                <td className="px-2 py-2 text-right">{t.porter ? money(t.porter) : ""}</td>
                <td className="px-2 py-2 text-right">{money(t.storage)}</td>
                <td className="px-2 py-2 text-right">{money(t.transport)}</td>
                <td className="px-2 py-2 text-right">{money(t.shifting)}</td>
                <td className="px-2 py-2" colSpan={4}></td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}
    </AppShell>
  );
}
