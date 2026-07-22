"use client";

// Feedback & escalations — one row per COMPLETED order (mirrors the team's manual excel):
// booking, customer, contact, type, status, completion date, then the editable feedback fields.
// Negative-outcome rows go red and carry the escalation fields (assigned team / resolved status).
import { useCallback, useEffect, useState } from "react";
import { SessionUser } from "@/lib/auth";
import { countryOfCity } from "@/lib/country";
import { useCountry } from "@/lib/country-store";
import AppShell from "./AppShell";
import FeedbackReports from "./FeedbackReports";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Exactly the WMS complaint-task options the team mandated for assignment (ids 1, 15-21).
const TEAMS = ["Payment issue", "Transport Team", "Retrieval Team", "CRM Team", "Escalation Team", "Instant Payment Team", "Warehouse Team", "Intercity retrieval team"];
const LEADS = ["google", "friend", "family", "reference", "returning customer", "walk-in", "other"];

const cityName = (slug: string) => slug.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

// ---- WMS-style date-range picker: one field, preset menu + custom range ----
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmtRangeDate = (s: string) => {
  const d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
function presetRange(key: string): { from: string; to: string } {
  const now = new Date();
  const today = iso(now);
  const dayShift = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
  switch (key) {
    case "Today": return { from: today, to: today };
    case "Yesterday": return { from: dayShift(-1), to: dayShift(-1) };
    case "Last 7 Days": return { from: dayShift(-6), to: today };
    case "Last 30 Days": return { from: dayShift(-29), to: today };
    case "This Month": {
      const y = now.getUTCFullYear(), m = now.getUTCMonth();
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) };
    }
    case "Last Month": {
      const y = now.getUTCFullYear(), m = now.getUTCMonth();
      return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
    }
    default: return { from: dayShift(-6), to: today };
  }
}
const RANGE_PRESETS = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "This Month", "Last Month"];

function DateRangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const active = RANGE_PRESETS.find((p) => { const r = presetRange(p); return r.from === from && r.to === to; }) ?? "Custom Range";
  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); setCustom(false); }}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
      >
        {fmtRangeDate(from)} - {fmtRangeDate(to)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
            {RANGE_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => { const r = presetRange(p); onChange(r.from, r.to); setOpen(false); }}
                className={`block w-full px-4 py-2.5 text-left text-sm ${active === p ? "bg-sky-500 font-medium text-white" : "text-slate-700 hover:bg-slate-50"}`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setCustom((c) => !c)}
              className={`block w-full px-4 py-2.5 text-left text-sm ${active === "Custom Range" || custom ? "bg-sky-500 font-medium text-white" : "text-slate-700 hover:bg-slate-50"}`}
            >
              Custom Range
            </button>
            {custom && (
              <div className="space-y-2 border-t border-slate-100 px-4 py-3">
                <label className="flex items-center justify-between gap-2 text-xs text-slate-500">From
                  <input type="date" value={from} max={to} onChange={(e) => e.target.value && onChange(e.target.value, to)} className="rounded border border-slate-200 px-2 py-1 text-xs" />
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-slate-500">To
                  <input type="date" value={to} min={from} onChange={(e) => e.target.value && onChange(from, e.target.value)} className="rounded border border-slate-200 px-2 py-1 text-xs" />
                </label>
                <button onClick={() => setOpen(false)} className="w-full rounded-lg bg-slate-900 py-1.5 text-xs font-semibold text-white">Apply</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
const fmtDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? String(s).slice(0, 10) : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + (String(s).length > 10 ? " " + d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "");
};

export default function FeedbackBoard({ user }: { user: SessionUser | null }) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [cityFilter, setCityFilter] = useState("All");
  // WMS-page-style filters (team request): assigned team / order status / order type / outcome / resolved.
  const [fTeam, setFTeam] = useState("All");
  const [fStatus, setFStatus] = useState("All");
  const [fType, setFType] = useState("All");
  const [fOutcome, setFOutcome] = useState("All");
  const [fResolved, setFResolved] = useState("All");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const country = useCountry();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/feedback?from=${from}&to=${to}`).then((x) => x.json()).catch(() => null);
    setRows(r?.rows ?? []);
    setTableMissing(!!r?.feedbackTableMissing);
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  async function save(orderUuid: string, field: string, value: string) {
    setPending(`${orderUuid}:${field}`);
    const row = rows.find((x) => x.id === orderUuid);
    const r = await fetch("/api/feedback", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      // sys/customer ids let the server MIRROR the edit into the WMS Feedback Calls store too.
      body: JSON.stringify({ orderUuid, [field]: value, sysOrderId: row?.sys_order_id ?? null, wmsCustomerId: row?.wms_customer_id ?? null }),
    }).then((x) => x.json()).catch(() => null);
    if (r && r.ok === false) alert(r.error || "Could not save.");
    setRows((rs) => rs.map((x) => (x.id === orderUuid
      ? { ...x, [field]: value || null, ...(r?.ticketRaised ? { complaint_raised_at: r.complaintRaisedAt ?? new Date().toISOString(), resolved_status: x.resolved_status ?? "active" } : {}) }
      : x)));
    if (r?.ticketRaised) alert("🎫 Internal complaint ticket raised for this order ✓" + (r.ticketError ? `\n\nNote: ${r.ticketError}` : ""));
    else if (r?.ticketError) alert(`Ticket could not be raised: ${r.ticketError}`);
    setPending(null);
  }

  const countryRows = rows.filter((r) => countryOfCity(r.city) === country);
  const cities = [...new Set(countryRows.map((r) => String(r.city ?? "")))].filter(Boolean).sort();
  const statuses = [...new Set(countryRows.map((r) => String(r.order_status ?? "")))].filter(Boolean).sort();
  const types = [...new Set(countryRows.map((r) => String(r.order_type ?? "")))].filter(Boolean).sort();
  const shown = countryRows
    .filter((r) => cityFilter === "All" || r.city === cityFilter)
    .filter((r) => fTeam === "All" || (fTeam === "Unassigned" ? !r.assigned_team : r.assigned_team === fTeam))
    .filter((r) => fStatus === "All" || String(r.order_status ?? "") === fStatus)
    .filter((r) => fType === "All" || String(r.order_type ?? "") === fType)
    .filter((r) => fOutcome === "All" || (fOutcome === "notset" ? !r.outcome : r.outcome === fOutcome))
    .filter((r) => fResolved === "All" || (fResolved === "notset" ? !r.resolved_status : (r.resolved_status ?? "") === fResolved));
  const neg = shown.filter((r) => r.outcome === "negative");
  const open = neg.filter((r) => (r.resolved_status ?? "active") !== "resolved");

  const sel = "w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 disabled:opacity-50";

  return (
    <AppShell active="feedback" user={user}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Feedback &amp; escalations</h1>
          <p className="text-xs text-slate-500">every completed order · edit remarks &amp; source of lead · negative outcomes escalate in red</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
            <option value="All">All cities</option>
            {cities.map((c) => <option key={c} value={c}>{cityName(c)}</option>)}
          </select>
        </div>
      </header>

      {/* WMS-style filters — every stat card, report and table row below follows them. */}
      <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
        {[
          { label: "Assigned Team", v: fTeam, set: setFTeam, opts: [["All", "All Teams"], ...TEAMS.map((t) => [t, t] as [string, string]), ["Unassigned", "Unassigned"]] },
          { label: "Order Status", v: fStatus, set: setFStatus, opts: [["All", "All Statuses"], ...statuses.map((s) => [s, s] as [string, string])] },
          { label: "Order Type", v: fType, set: setFType, opts: [["All", "All Types"], ...types.map((t) => [t, t.replace("_", " ")] as [string, string])] },
          { label: "Outcome", v: fOutcome, set: setFOutcome, opts: [["All", "All Outcomes"], ["positive", "Positive"], ["negative", "Negative"], ["notset", "Not set"]] },
          { label: "Resolved Status", v: fResolved, set: setFResolved, opts: [["All", "All Statuses"], ["active", "Active"], ["working", "Working on it"], ["resolved", "Resolved"], ["notset", "Not set"]] },
        ].map((f) => (
          <label key={f.label} className="flex flex-col gap-0.5 text-[11px] font-medium text-slate-500">
            {f.label}
            <select value={f.v} onChange={(e) => f.set(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">
              {f.opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
        {(fTeam !== "All" || fStatus !== "All" || fType !== "All" || fOutcome !== "All" || fResolved !== "All") && (
          <button
            onClick={() => { setFTeam("All"); setFStatus("All"); setFType("All"); setFOutcome("All"); setFResolved("All"); }}
            className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-blue-600 hover:underline"
          >
            ✕ clear filters
          </button>
        )}
      </div>

      {tableMissing && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          ⚠ Run the <code>2026-07-14-order-feedback.sql</code> migration (phpMyAdmin) — until then edits can&apos;t be saved.
        </div>
      )}

      {/* WMS-style stat cards + the four copyable reports (full / overall / team / lead). */}
      {!loading && shown.length > 0 && <FeedbackReports rows={shown} from={from} to={to} />}
      {!loading && open.length > 0 && (
        <div className="mb-3 text-xs">
          <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">{open.length} escalation{open.length > 1 ? "s" : ""} still active</span>
        </div>
      )}

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading feedback…</Card>
      ) : shown.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No completed orders between {from} and {to}.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Booking</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Contact</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Completed on</th>
                <th className="w-[24%] px-3 py-2">Remarks (feedback)</th>
                <th className="px-3 py-2">Source of lead</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Assigned team</th>
                <th className="px-3 py-2">Resolved</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const negRow = r.outcome === "negative";
                return (
                  <tr key={r.id} className={`border-b border-slate-50 align-top ${negRow ? "bg-red-50" : ""}`}>
                    <td className="px-3 py-2 font-semibold text-slate-800">{r.customer_unique_id}<div className="text-[10px] font-normal text-slate-400">{cityName(String(r.city ?? ""))}</div></td>
                    <td className="px-3 py-2 text-slate-700">{r.customer_name ?? "—"}</td>
                    <td className="px-3 py-2">{r.contact ? <a className="text-blue-600 hover:underline" href={`tel:${String(r.contact).split(/[/,]/)[0].trim()}`}>{String(r.contact).split(/[/,]/)[0].trim()}</a> : "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{String(r.order_type ?? "—").replace("_", " ")}</td>
                    <td className="px-3 py-2 text-slate-600">{r.order_status ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{fmtDate(r.completed_at)}</td>
                    <td className="px-3 py-2">
                      <textarea
                        key={`${r.id}:${r.remarks ?? ""}`}
                        defaultValue={r.remarks ?? ""}
                        rows={r.remarks && r.remarks.length > 60 ? 3 : 1}
                        placeholder="type the customer's feedback…"
                        disabled={pending === `${r.id}:remarks`}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(r.remarks ?? "")) save(r.id, "remarks", v); }}
                        className="w-full resize-y rounded border border-slate-200 bg-white px-2 py-1 text-[11.5px] text-slate-800 disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        key={`${r.id}:${r.source_of_lead ?? ""}`}
                        list="lead-sources"
                        defaultValue={r.source_of_lead ?? ""}
                        placeholder="e.g. google"
                        disabled={pending === `${r.id}:source_of_lead`}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(r.source_of_lead ?? "")) save(r.id, "source_of_lead", v); }}
                        className="w-24 rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 disabled:opacity-50"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={r.outcome ?? ""}
                        disabled={pending === `${r.id}:outcome`}
                        onChange={(e) => save(r.id, "outcome", e.target.value)}
                        className={`${sel} font-semibold ${r.outcome === "positive" ? "text-emerald-600" : r.outcome === "negative" ? "text-red-600" : ""}`}
                      >
                        <option value="">—</option>
                        <option value="positive">Positive</option>
                        <option value="negative">Negative</option>
                      </select>
                    </td>
                    {/* Escalation fields appear ONLY on negative outcomes. Picking a team on a
                        negative row auto-raises the internal complaint ticket (once). */}
                    <td className="px-3 py-2">
                      {negRow ? (
                        <>
                          <select value={r.assigned_team ?? ""} disabled={pending === `${r.id}:assigned_team`} onChange={(e) => save(r.id, "assigned_team", e.target.value)} className={sel} title="Selecting a team raises the internal complaint ticket">
                            <option value="">— pick team (raises ticket) —</option>
                            {TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                          {r.complaint_raised_at && (
                            <div className="mt-1 text-[10px] font-semibold text-red-600" title={r.complaint_ref ?? ""}>🎫 ticket raised · {fmtDate(r.complaint_raised_at)}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {negRow ? (
                        <select value={r.resolved_status ?? ""} disabled={pending === `${r.id}:resolved_status`} onChange={(e) => save(r.id, "resolved_status", e.target.value)} className={sel}>
                          <option value="">—</option>
                          <option value="active">Active</option>
                          <option value="working">Working on it</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="lead-sources">{LEADS.map((l) => <option key={l} value={l} />)}</datalist>
        </Card>
      )}
    </AppShell>
  );
}
