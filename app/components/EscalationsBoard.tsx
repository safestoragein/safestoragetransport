"use client";

// Escalations — issues reported after completion (damage discovered later, missing item, negative
// review…). Raised from the Feedback page ("＋ Escalate"); worked to resolution here: type, ETA,
// fault side (ours / vendor), cost to resolve, and how it was resolved.
import { useCallback, useEffect, useState } from "react";
import { SessionUser } from "@/lib/auth";
import { countryOfCity } from "@/lib/country";
import { useCountry } from "@/lib/country-store";
import AppShell from "./AppShell";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const cityName = (slug: string) => slug.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
const fmtDT = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};
const daysOpen = (raised: string | null, resolved: string | null) => {
  if (!raised) return null;
  const a = new Date(String(raised).replace(" ", "T")).getTime();
  const b = resolved ? new Date(String(resolved).replace(" ", "T")).getTime() : Date.now();
  return isNaN(a) ? null : Math.max(0, Math.floor((b - a) / 86_400_000));
};

const TYPE_LABEL: Record<string, string> = {
  damage: "Damaged item", missing_item: "Missing item", negative_review: "Negative review",
  payment: "Payment issue", behaviour: "Team behaviour", delay: "Delay", other: "Other",
};
const RES_LABEL: Record<string, string> = {
  refund: "Refund", replacement: "Replacement", repair: "Repair", compensation: "Compensation",
  apology_call: "Apology call", waiver: "Charge waiver", other: "Other",
};
const FAULT_LABEL: Record<string, string> = { ours: "Our side", vendor: "Vendor side", customer: "Customer side", unknown: "Unknown" };

export default function EscalationsBoard({ user }: { user: SessionUser | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState("All");
  const [fType, setFType] = useState("All");
  const [fFault, setFFault] = useState("All");
  const country = useCountry();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/escalations?from=${from}&to=${to}`).then((x) => x.json()).catch(() => null);
    setRows(r?.rows ?? []);
    setTableMissing(!!r?.tableMissing);
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  async function save(id: string, field: string, value: string) {
    setPending(`${id}:${field}`);
    const r = await fetch("/api/escalations", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [field]: value }),
    }).then((x) => x.json()).catch(() => null);
    if (r && r.ok === false) alert(r.error || "Could not save.");
    else setRows((rs) => rs.map((x) => (x.id === id
      ? { ...x, [field]: value || null, ...(field === "status" ? { resolved_at: value === "resolved" ? new Date().toISOString() : null } : {}) }
      : x)));
    setPending(null);
  }

  const countryRows = rows.filter((r) => !r.city || countryOfCity(r.city) === country);
  const shown = countryRows
    .filter((r) => fStatus === "All" || (r.status ?? "open") === fStatus)
    .filter((r) => fType === "All" || r.escalation_type === fType)
    .filter((r) => fFault === "All" || r.fault_side === fFault);

  const open = countryRows.filter((r) => (r.status ?? "open") === "open").length;
  const working = countryRows.filter((r) => r.status === "working").length;
  const resolved = countryRows.filter((r) => r.status === "resolved").length;
  const spent = countryRows.reduce((s, r) => s + (Number(r.amount_spent) || 0), 0);
  const vendorFault = countryRows.filter((r) => r.fault_side === "vendor").length;

  const sel = "w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 disabled:opacity-50";

  return (
    <AppShell active="escalations" user={user}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Escalations</h1>
          <p className="text-xs text-slate-500">issues reported after completion — raised from the Feedback page, worked to resolution here</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1 text-slate-500">From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex items-center gap-1 text-slate-500">To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
        </div>
      </header>

      {tableMissing && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          ⚠ Run the <code>2026-07-22-order-escalations.sql</code> migration (phpMyAdmin) — until then escalations can&apos;t be saved.
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Open", value: open, cls: "border-red-200 bg-red-50 text-red-600" },
          { label: "Working on it", value: working, cls: "border-amber-200 bg-amber-50 text-amber-700" },
          { label: "Resolved", value: resolved, cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
          { label: "Vendor-side issues", value: vendorFault, cls: "border-violet-200 bg-violet-50 text-violet-700" },
          { label: "Spent to resolve", value: `₹${spent.toLocaleString("en-IN")}`, cls: "border-slate-200 bg-white text-slate-900" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border p-3 ${s.cls}`}>
            <div className="text-xl font-extrabold">{s.value}</div>
            <div className="text-[11px] font-medium opacity-80">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
        {[
          { label: "Status", v: fStatus, set: setFStatus, opts: [["All", "All Statuses"], ["open", "Open"], ["working", "Working on it"], ["resolved", "Resolved"]] },
          { label: "Escalation Type", v: fType, set: setFType, opts: [["All", "All Types"], ...Object.entries(TYPE_LABEL)] },
          { label: "Issue side", v: fFault, set: setFFault, opts: [["All", "All"], ...Object.entries(FAULT_LABEL)] },
        ].map((f) => (
          <label key={f.label} className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">
            {f.label}
            <select value={f.v} onChange={(e) => f.set(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
              {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading escalations…</Card>
      ) : shown.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          No escalations between {from} and {to}. Raise one from the <b>Feedback</b> page (＋ Escalate on any order).
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Booking</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Raised</th>
                <th className="px-3 py-2">Type</th>
                <th className="w-[16%] px-3 py-2">Issue</th>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">ETA</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Issue side</th>
                <th className="px-3 py-2">Resolution</th>
                <th className="px-3 py-2">₹ Spent</th>
                <th className="w-[16%] px-3 py-2">How resolved</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = r.status ?? "open";
                const age = daysOpen(r.raised_at, r.resolved_at);
                const late = st !== "resolved" && r.eta && String(r.eta).slice(0, 10) < today;
                return (
                  <tr key={r.id} className={`border-b border-slate-50 align-top ${st === "resolved" ? "" : st === "working" ? "bg-amber-50/60" : "bg-red-50/60"}`}>
                    <td className="px-3 py-2 font-semibold text-slate-800">
                      {r.customer_unique_id ?? "—"}
                      <div className="text-[10px] font-normal text-slate-400">{cityName(String(r.city ?? ""))}{r.is_intercity ? " · intercity" : ""}</div>
                      {!!r.wms_reported && (
                        <span className="mt-0.5 inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700" title={r.wms_live ?? r.wms_ref ?? "The warehouse team has reported an issue for this customer in the WMS"}>
                          🏭 WMS reported
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {r.customer_name ?? "—"}
                      {r.contact && <div className="text-[10px]"><a className="text-blue-600 hover:underline" href={`tel:${String(r.contact).split(/[/,]/)[0].trim()}`}>{String(r.contact).split(/[/,]/)[0].trim()}</a></div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                      {fmtDT(r.raised_at)}
                      {r.raised_by && <div className="text-[10px] text-slate-400">by {r.raised_by}</div>}
                      {age != null && <div className={`text-[10px] font-semibold ${st === "resolved" ? "text-emerald-600" : age > 3 ? "text-red-600" : "text-slate-400"}`}>{st === "resolved" ? `closed in ${age}d` : `${age}d open`}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <select value={r.escalation_type ?? ""} disabled={pending === `${r.id}:escalation_type`} onChange={(e) => save(r.id, "escalation_type", e.target.value)} className={sel}>
                        <option value="">—</option>
                        {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <textarea key={`${r.id}:i:${r.issue ?? ""}`} defaultValue={r.issue ?? ""} rows={2} disabled={pending === `${r.id}:issue`}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(r.issue ?? "")) save(r.id, "issue", v); }}
                        className="w-full resize-y rounded border border-slate-200 bg-white px-2 py-1 text-[11.5px]" />
                    </td>
                    <td className="px-3 py-2">
                      <input key={`${r.id}:v:${r.vendor_name ?? ""}`} defaultValue={r.vendor_name ?? ""} placeholder="vendor" disabled={pending === `${r.id}:vendor_name`}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(r.vendor_name ?? "")) save(r.id, "vendor_name", v); }}
                        className="w-24 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="date" value={r.eta ? String(r.eta).slice(0, 10) : ""} disabled={pending === `${r.id}:eta`}
                        onChange={(e) => save(r.id, "eta", e.target.value)}
                        className={`rounded border px-1.5 py-1 text-[11px] ${late ? "border-red-300 bg-red-50 text-red-700 font-semibold" : "border-slate-200 bg-white text-slate-700"}`} />
                      {late && <div className="text-[10px] font-bold text-red-600">past ETA</div>}
                    </td>
                    <td className="px-3 py-2">
                      <select value={st} disabled={pending === `${r.id}:status`} onChange={(e) => save(r.id, "status", e.target.value)}
                        className={`${sel} font-semibold ${st === "resolved" ? "text-emerald-600" : st === "working" ? "text-amber-700" : "text-red-600"}`}>
                        <option value="open">Open</option>
                        <option value="working">Working on it</option>
                        <option value="resolved">Resolved</option>
                      </select>
                      {r.resolved_at && <div className="text-[10px] text-emerald-600">on {fmtDT(r.resolved_at)}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <select value={r.fault_side ?? ""} disabled={pending === `${r.id}:fault_side`} onChange={(e) => save(r.id, "fault_side", e.target.value)} className={sel}>
                        <option value="">—</option>
                        {Object.entries(FAULT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select value={r.resolution_type ?? ""} disabled={pending === `${r.id}:resolution_type`} onChange={(e) => save(r.id, "resolution_type", e.target.value)} className={sel}>
                        <option value="">—</option>
                        {Object.entries(RES_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input key={`${r.id}:a:${r.amount_spent ?? ""}`} type="number" min="0" defaultValue={r.amount_spent ?? ""} placeholder="0" disabled={pending === `${r.id}:amount_spent`}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(r.amount_spent ?? "")) save(r.id, "amount_spent", v); }}
                        className="w-20 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px]" />
                    </td>
                    <td className="px-3 py-2">
                      <textarea key={`${r.id}:n:${r.resolution_notes ?? ""}`} defaultValue={r.resolution_notes ?? ""} rows={2} placeholder="how we resolved it…" disabled={pending === `${r.id}:resolution_notes`}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(r.resolution_notes ?? "")) save(r.id, "resolution_notes", v); }}
                        className="w-full resize-y rounded border border-slate-200 bg-white px-2 py-1 text-[11.5px]" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </AppShell>
  );
}
