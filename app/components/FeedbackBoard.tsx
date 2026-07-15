"use client";

// Feedback & escalations — one row per COMPLETED order (mirrors the team's manual excel):
// booking, customer, contact, type, status, completion date, then the editable feedback fields.
// Negative-outcome rows go red and carry the escalation fields (assigned team / resolved status).
import { useCallback, useEffect, useState } from "react";
import { SessionUser } from "@/lib/auth";
import { countryOfCity } from "@/lib/country";
import { useCountry } from "@/lib/country-store";
import AppShell from "./AppShell";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Exactly the WMS complaint-task options the team mandated for assignment (ids 1, 15-20).
const TEAMS = ["Payment issue", "Transport Team", "Retrieval Team", "CRM Team", "Escalation Team", "Instant Payment Team", "Warehouse Team"];
const LEADS = ["google", "friend", "family", "reference", "returning customer", "walk-in", "other"];

const cityName = (slug: string) => slug.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
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
    const r = await fetch("/api/feedback", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderUuid, [field]: value }),
    }).then((x) => x.json()).catch(() => null);
    if (r && r.ok === false) alert(r.error || "Could not save.");
    setRows((rs) => rs.map((x) => (x.id === orderUuid ? { ...x, [field]: value || null, ...(r?.ticketRaised ? { complaint_raised_at: r.complaintRaisedAt ?? new Date().toISOString() } : {}) } : x)));
    if (r?.ticketRaised) alert("🎫 Internal complaint ticket raised for this order ✓" + (r.ticketError ? `\n\nNote: ${r.ticketError}` : ""));
    else if (r?.ticketError) alert(`Ticket could not be raised: ${r.ticketError}`);
    setPending(null);
  }

  const countryRows = rows.filter((r) => countryOfCity(r.city) === country);
  const cities = [...new Set(countryRows.map((r) => String(r.city ?? "")))].filter(Boolean).sort();
  const shown = countryRows.filter((r) => cityFilter === "All" || r.city === cityFilter);
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
          <label className="flex items-center gap-1 text-slate-500">From
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex items-center gap-1 text-slate-500">To
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
            <option value="All">All cities</option>
            {cities.map((c) => <option key={c} value={c}>{cityName(c)}</option>)}
          </select>
        </div>
      </header>

      {tableMissing && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          ⚠ Run the <code>2026-07-14-order-feedback.sql</code> migration (phpMyAdmin) — until then edits can&apos;t be saved.
        </div>
      )}

      {!loading && shown.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">{shown.length} completed order{shown.length > 1 ? "s" : ""}</span>
          <span className={`rounded-full px-2.5 py-1 font-medium ${neg.length ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{neg.length} negative</span>
          {open.length > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">{open.length} escalation{open.length > 1 ? "s" : ""} still active</span>}
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
