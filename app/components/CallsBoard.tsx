"use client";

// Retrieval → Calls. Every call to the retrieval SR number, pulled from Knowlarity on the same
// hourly job as the mailboxes and matched to a customer by the caller's number.
import { useCallback, useEffect, useRef, useState } from "react";
import { SessionUser } from "@/lib/auth";
import AppShell from "./AppShell";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS: [string, string][] = [["new", "New"], ["in_progress", "In Progress"], ["resolved", "Resolved"]];
const REQ: [string, string][] = [
  ["missing_damaged", "Missing / damaged"], ["retrieval_slot", "Retrieval / slot"],
  ["media_request", "Photos / video call"], ["other", "Others"],
];
const mmss = (s: number) => `${Math.floor((Number(s) || 0) / 60)}m ${String((Number(s) || 0) % 60).padStart(2, "0")}s`;
const fmt = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? String(s).slice(0, 16)
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};

export default function CallsBoard({ user }: { user: SessionUser | null }) {
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [fStatus, setFStatus] = useState("All");
  const [fAns, setFAns] = useState("All");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const seenIds = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/retrieval/calls?status=${fStatus}&answered=${fAns}&q=${encodeURIComponent(q)}`)
      .then((x) => x.json()).catch(() => null);
    const list = r?.calls ?? [];
    if (seenIds.current) {
      const added = list.filter((x: any) => !seenIds.current!.has(String(x.id))).length;
      if (added) setFresh((n) => n + added);
    }
    seenIds.current = new Set(list.map((x: any) => String(x.id)));
    setCalls(list);
    setTableMissing(!!r?.tableMissing);
    setLoading(false);
  }, [fStatus, fAns, q]);
  useEffect(() => { seenIds.current = null; setFresh(0); }, [fStatus, fAns, q]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function save(id: string, field: string, value: string) {
    setBusy(`${id}:${field}`);
    const r = await fetch("/api/retrieval/calls", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [field]: value }),
    }).then((x) => x.json()).catch(() => null);
    if (r && r.ok === false) alert(r.error || "Could not save.");
    else setCalls((cs) => cs.map((x) => (x.id === id ? { ...x, [field]: value } : x)));
    setBusy(null);
  }

  async function raise(id: string) {
    setBusy(`${id}:push`);
    const r = await fetch("/api/retrieval/calls", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "push" }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(null);
    if (r?.ok) { alert(`Raised in the ticket system — ticket ${r.ticketId ?? ""}`); load(); }
    else alert(r?.error || "Could not raise the ticket.");
  }

  async function syncNow() {
    setBusy("sync");
    const r = await fetch("/api/retrieval/calls", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sync" }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(null);
    if (r?.ok) { alert(`Calls synced — ${r.seen} seen, ${r.created} new, ${r.matched} matched to a customer.`); load(); }
    else alert(r?.error || "Sync failed.");
  }

  const missed = calls.filter((c) => !c.answered).length;
  const openCount = calls.filter((c) => c.status !== "resolved").length;
  const totalMin = Math.round(calls.reduce((s, c) => s + (Number(c.duration_sec) || 0), 0) / 60);
  const sel = "rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm";

  return (
    <AppShell active="calls" user={user}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Calls</h1>
          <p className="text-xs text-slate-500">retrieval calls on the SR number · pulled from Knowlarity, matched to the customer by their number</p>
        </div>
        <button onClick={syncNow} disabled={busy === "sync"} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {busy === "sync" ? "Syncing…" : "⟳ Sync calls now"}
        </button>
      </header>

      {fresh > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
          <span className="font-semibold">🔔 {fresh} new call{fresh > 1 ? "s" : ""} since you opened this page</span>
          <button onClick={() => setFresh(0)} className="ml-auto rounded px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">dismiss</button>
        </div>
      )}

      {tableMissing && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          ⚠ Run <code>2026-08-07-retrieval-calls.sql</code> in phpMyAdmin — until then calls can&apos;t be stored.
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Calls", value: calls.length },
          { label: "Open", value: openCount },
          { label: "Missed", value: missed, warn: missed > 0 },
          { label: "Talk time", value: `${totalMin} min` },
        ].map((s: any) => (
          <div key={s.label} className={`rounded-xl border p-3 ${s.warn ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
            <div className={`text-xl font-extrabold ${s.warn ? "text-red-700" : "text-slate-900"}`}>{s.value}</div>
            <div className="text-[11px] font-medium text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 number, booking id, customer, agent…" className={`${sel} w-64`} />
        <select value={fAns} onChange={(e) => setFAns(e.target.value)} className={sel}>
          <option value="All">Answered &amp; missed</option>
          <option value="answered">Answered only</option>
          <option value="missed">Missed only</option>
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={sel}>
          <option value="All">All statuses</option>
          {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading calls…</Card>
      ) : calls.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No calls yet. Press <b>⟳ Sync calls now</b>.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-[11px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="w-[12%] px-2 py-1.5">When</th>
                <th className="w-[13%] px-2 py-1.5">Caller</th>
                <th className="w-[15%] px-2 py-1.5">Customer</th>
                <th className="w-[7%] px-2 py-1.5">Ext</th>
                <th className="w-[9%] px-2 py-1.5">Duration</th>
                <th className="w-[11%] px-2 py-1.5">Agent</th>
                <th className="w-[10%] px-2 py-1.5">Recording</th>
                <th className="w-[11%] px-2 py-1.5">Request type</th>
                <th className="w-[10%] px-2 py-1.5">Status</th>
                <th className="w-[12%] px-2 py-1.5">Notes</th>
                <th className="w-[10%] px-2 py-1.5">WMS ticket</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className={`border-b border-slate-50 align-top ${c.answered ? "" : "bg-red-50/50"}`}>
                  <td className="px-2 py-1.5 text-slate-600">{fmt(c.started_at)}</td>
                  <td className="px-2 py-1.5">
                    <a href={`tel:${c.customer_number}`} className="font-medium text-blue-600 hover:underline">{c.customer_number}</a>
                    {c.caller_name && <div className="text-[10px] text-slate-400">{c.caller_name}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">
                    {c.customer_unique_id
                      ? <><span className="font-semibold text-slate-800">{c.customer_unique_id}</span> {c.customer_name ?? ""}</>
                      : <input key={`${c.id}:bk`} defaultValue="" placeholder="booking id…"
                          onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (v) save(c.id, "customer_unique_id", v); }}
                          className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-[11px]" />}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500">{c.extension ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    {c.answered
                      ? <span className="text-slate-700">{mmss(c.duration_sec)}</span>
                      : <span className="font-bold text-red-600">missed</span>}
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{c.agent_number ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    {c.recording_url
                      ? <a href={c.recording_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">▶ listen</a>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={String(c.request_type ?? "other")} disabled={busy === `${c.id}:request_type`}
                      onChange={(e) => save(c.id, "request_type", e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-[11px]">
                      {REQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select value={String(c.status ?? "new")} disabled={busy === `${c.id}:status`}
                      onChange={(e) => save(c.id, "status", e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-[11px]">
                      {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input key={`${c.id}:${c.notes ?? ""}`} defaultValue={c.notes ?? ""} placeholder="notes…"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(c.notes ?? "")) save(c.id, "notes", v); }}
                      className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-[11px]" />
                  </td>
                  <td className="px-2 py-1.5">
                    {c.external_ticket_id
                      ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">#{c.external_ticket_id}</span>
                      : <button onClick={() => raise(c.id)} disabled={busy === `${c.id}:push`}
                          title={c.customer_unique_id ? "Raise this call in the WMS ticket system" : "Add the booking id first — the ticket system needs it"}
                          className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                          {busy === `${c.id}:push` ? "…" : "＋ Raise"}
                        </button>}
                    {c.external_error && <div className="text-[9px] text-red-500" title={c.external_error}>failed</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </AppShell>
  );
}
