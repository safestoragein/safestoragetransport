"use client";

// Retrieval — tickets raised from the retrieval@ / damages@ mailboxes.
// Priority climbs each time the CUSTOMER writes in again (1st mail P4 … 4th+ P1), so a customer
// who keeps chasing rises to the top on its own. Setting a priority by hand pins it.
import { useCallback, useEffect, useState } from "react";
import { SessionUser } from "@/lib/auth";
import AppShell from "./AppShell";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS: [string, string][] = [
  ["new", "New"], ["in_progress", "In Progress"], ["waiting_customer", "Waiting on customer"],
  ["resolved", "Resolved"], ["closed", "Closed"],
];
const STATUS_LABEL = Object.fromEntries(STATUS);
const PRIORITIES = ["P1", "P2", "P3", "P4"];
// The team's own categories for what a mail is asking for.
const ISSUE: [string, string][] = [
  ["missing_damaged", "Missing / damaged"],
  ["retrieval_slot", "Retrieval / slot"],
  ["media_request", "Photos / video call"],
  ["other", "Others"],
];
// Same rules as the server. Used when the stored tag is still empty, so the board is useful
// straight away instead of showing everything as "Others".
const REQ_RULES: [string, RegExp][] = [
  ["missing_damaged", /\b(missing|lost|damag(e|ed|es)|broken|breakage|scratch|dent|not\s+(received|delivered)|never\s+(received|delivered)|shortage|claim\s+for|wrong\s+(item|delivery)|incorrect\s+inventory)\b/i],
  ["media_request", /\b(video\s*(call|conference)?|photo(graph)?s?|pic(ture)?s?|image(s)?|show\s+me|see\s+my\s+(items|goods|stuff)|visual|inspect(ion)?|live\s+(view|video)|whatsapp\s+(photo|video|pic))\b/i],
  ["retrieval_slot", /\b(retriev(e|al)|partial\s*retrieval|self[- ]?(retrieval|pickup)|pick\s*up|slot|schedule|book(ing)?\s+(a\s+)?(date|slot|visit)|deliver(y)?\s+(date|request)|want\s+(my|the)\s+(goods|items)|return\s+of\s+goods|quotation)\b/i],
];
function requestTypeOf(t: any): { key: string; derived: boolean } {
  const stored = String(t.issue_type ?? "").trim();
  if (stored) return { key: stored, derived: false };
  const text = `${t.subject ?? ""} ${t.snippet ?? ""}`;
  for (const [key, re] of REQ_RULES) if (re.test(text)) return { key, derived: true };
  if (String(t.mailbox ?? "") === "damages") return { key: "missing_damaged", derived: true };
  return { key: "other", derived: true };
}
const ISSUE_LABEL = Object.fromEntries(ISSUE);
const ISSUE_CLS: Record<string, string> = {
  missing_damaged: "bg-red-50 text-red-700 ring-red-200",
  retrieval_slot: "bg-blue-50 text-blue-700 ring-blue-200",
  media_request: "bg-violet-50 text-violet-700 ring-violet-200",
  other: "bg-slate-50 text-slate-600 ring-slate-200",
};
const SEV_CLS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-amber-50 text-amber-700",
};
const SEV_LABEL: Record<string, string> = { critical: "⚠ critical", high: "serious", medium: "urgent" };
const PRI_CLS: Record<string, string> = {
  P1: "bg-red-100 text-red-700 ring-red-200",
  P2: "bg-orange-100 text-orange-700 ring-orange-200",
  P3: "bg-amber-100 text-amber-800 ring-amber-200",
  P4: "bg-slate-100 text-slate-600 ring-slate-200",
};
const fmt = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? String(s).slice(0, 16)
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};
// Every reply carries the whole conversation quoted underneath, so the same text appears again in
// each message. Cut at the first quote marker and show only what THIS message actually adds — the
// full text stays one click away, and is kept intact in the database.
const QUOTE_MARKERS: RegExp[] = [
  /^-{2,}\s*original message\s*-{2,}/im,
  /^_{10,}\s*$/m,                                  // Outlook's divider line
  /^\s*from:\s*.+\r?\n\s*sent:\s*/im,            // Outlook quoted header block
  /^\s*from:\s*.+<[^>]+>\s*\r?\n/im,
  /^on\s.{5,120}\bwrote:\s*$/im,                   // Gmail / Apple Mail
  /^\s*sent from my /im,
];
function stripQuoted(raw: string): { text: string; trimmed: boolean } {
  let t = String(raw ?? "").replace(/\[cid:[^\]]+\]/gi, "");   // inline-image placeholders
  let cut = t.length;
  for (const re of QUOTE_MARKERS) {
    const m = t.match(re);
    if (m && m.index != null && m.index < cut) cut = m.index;
  }
  let body = t.slice(0, cut);
  body = body.split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join("\n");  // drop "> " quoted lines
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  // If stripping left almost nothing, the markers were part of the real message — keep it whole.
  if (body.length < 15) return { text: t.replace(/\n{3,}/g, "\n\n").trim(), trimmed: false };
  return { text: body, trimmed: body.length < t.trim().length - 20 };
}

const ageDays = (s: string | null) => {
  if (!s) return null;
  const t = new Date(String(s).replace(" ", "T")).getTime();
  return isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
};

export default function RetrievalBoard({ user }: { user: SessionUser | null }) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [fStatus, setFStatus] = useState("All");
  const [fPriority, setFPriority] = useState("All");
  const [fBox, setFBox] = useState("All");
  const [fIssue, setFIssue] = useState("All");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<any | null>(null);
  const [thread, setThread] = useState<any[]>([]);
  const [showFull, setShowFull] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Sortable columns — chases first, since that is the queue the team works.
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "created_at", dir: -1 });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/retrieval/tickets?status=${fStatus}&priority=${fPriority}&mailbox=${fBox}&q=${encodeURIComponent(q)}`)
      .then((x) => x.json()).catch(() => null);
    setTickets(r?.tickets ?? []);
    setTableMissing(!!r?.tableMissing);
    setLoading(false);
  }, [fStatus, fPriority, fBox, q]);
  useEffect(() => { load(); }, [load]);

  async function openTicket(t: any) {
    setOpen(t); setThread([]); setShowFull({});
    const r = await fetch(`/api/retrieval/tickets?id=${t.id}`).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setOpen(r.ticket ?? t); setThread(r.messages ?? []); }
  }

  async function save(id: string, field: string, value: string) {
    setBusy(`${id}:${field}`);
    const r = await fetch("/api/retrieval/tickets", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [field]: value }),
    }).then((x) => x.json()).catch(() => null);
    if (r && r.ok === false) alert(r.error || "Could not save.");
    else {
      setTickets((ts) => ts.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
      setOpen((o: any) => (o && o.id === id ? { ...o, [field]: value } : o));
    }
    setBusy(null);
  }

  async function raise(id: string) {
    setBusy(`${id}:push`);
    const r = await fetch("/api/retrieval/tickets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "push" }),
    }).then((x) => x.json()).catch(() => null);
    setBusy(null);
    if (r?.ok) { alert(`Raised in the ticket system — ticket ${r.ticketId ?? ""}`); load(); openTicket({ id }); }
    else alert(r?.error || "Could not raise the ticket.");
  }

  async function backfill() {
    setBusy("backfill");
    const r = await fetch("/api/retrieval/sync?backfillOnly=1", { method: "POST" }).then((x) => x.json()).catch(() => null);
    setBusy(null);
    const b = r?.backfill;
    if (b?.ok) { alert(`Rescored ${b.scanned} ticket(s) · booking id found for ${b.matched}.`); load(); }
    else alert(b?.error || r?.error || "Could not run the match.");
  }

  async function syncNow() {
    setBusy("sync");
    const r = await fetch("/api/retrieval/sync", { method: "POST" }).then((x) => x.json()).catch(() => null);
    setBusy(null);
    if (r?.ok) {
      const s = (r.results ?? []).map((x: any) => `${x.mailbox}: ${x.created} new, ${x.appended} replies${x.error ? ` (${x.error})` : ""}`).join(" · ");
      const b = r.backfill?.matched ? ` · booking id found for ${r.backfill.matched}` : "";
      alert(`Mail synced — ${s}${b}`);
      load();
    } else alert(r?.error || "Sync failed.");
  }

  const PRI_RANK: Record<string, number> = { P1: 4, P2: 3, P3: 2, P4: 1 };
  const sortVal = (t: any, key: string) => {
    if (key === "customer_msg_count") return Number(t.customer_msg_count) || 0;
    if (key === "priority") return PRI_RANK[String(t.priority)] ?? 0;
    if (key === "last_customer_at" || key === "created_at") {
      const v = new Date(String(t[key] ?? "").replace(" ", "T")).getTime();
      return isNaN(v) ? 0 : v;
    }
    return String(t[key] ?? "").toLowerCase();
  };
  const shown = [...tickets]
    .filter((t) => fIssue === "All" || requestTypeOf(t).key === fIssue)
    .sort((a, b) => {
    const x = sortVal(a, sort.key), y = sortVal(b, sort.key);
    if (x < y) return -sort.dir;
    if (x > y) return sort.dir;
    return 0;
  });
  const toggle = (key: string) => setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: -1 }));
  const arrow = (key: string) => (sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  const counts = PRIORITIES.map((p) => [p, tickets.filter((t) => t.priority === p).length] as const);
  const openCount = tickets.filter((t) => !["resolved", "closed"].includes(String(t.status))).length;
  const sel = "rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm";

  return (
    <AppShell active="retrieval" user={user}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Retrieval</h1>
          <p className="text-xs text-slate-500">
            tickets from retrieval@ and damages@ · priority rises with each customer follow-up and with how serious the mail reads
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={backfill} disabled={busy === "backfill"}
            title="Search every message, our order history and the live feed for a booking id on tickets that don't have one"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
            {busy === "backfill" ? "Matching…" : "🔎 Find booking ids"}
          </button>
          <button onClick={syncNow} disabled={busy === "sync"} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            {busy === "sync" ? "Syncing…" : "⟳ Sync mail now"}
          </button>
        </div>
      </header>

      {tableMissing && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          ⚠ Run <code>2026-08-06-retrieval-tickets.sql</code> in phpMyAdmin — until then tickets can&apos;t be stored.
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-xl font-extrabold text-slate-900">{openCount}</div>
          <div className="text-[11px] font-medium text-slate-500">Open tickets</div>
        </div>
        {counts.map(([p, n]) => (
          <div key={p} className={`rounded-xl border p-3 ${p === "P1" ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
            <div className={`text-xl font-extrabold ${p === "P1" ? "text-red-700" : "text-slate-900"}`}>{n}</div>
            <div className="text-[11px] font-medium text-slate-500">{p}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2 text-xs">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ticket, booking id, email, customer…" className={`${sel} w-64`} />
        <select value={fBox} onChange={(e) => setFBox(e.target.value)} className={sel}>
          <option value="All">Both mailboxes</option>
          <option value="retrieval">retrieval@</option>
          <option value="damages">damages@</option>
        </select>
        <select value={fIssue} onChange={(e) => setFIssue(e.target.value)} className={sel} title="What the customer is asking for">
          <option value="All">All request types</option>
          {ISSUE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={sel}>
          <option value="All">All statuses</option>
          {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className={sel}>
          <option value="All">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading tickets…</Card>
      ) : tickets.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          No tickets yet. Press <b>⟳ Sync mail now</b> to read the mailboxes.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-[11px]">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                <th className="w-[9%] px-2 py-1.5">Ticket</th>
                <th className="w-[5%] cursor-pointer select-none px-2 py-1.5 hover:text-slate-600" onClick={() => toggle("priority")} title="Sort by priority">Pri{arrow("priority")}</th>
                <th className="w-[10%] px-2 py-1.5">Request type</th>
                <th className="w-[19%] px-2 py-1.5">Subject</th>
                <th className="w-[15%] px-2 py-1.5">Customer</th>
                <th className="w-[6%] cursor-pointer select-none px-2 py-1.5 hover:text-slate-600" onClick={() => toggle("customer_msg_count")} title="Times the customer has written in — click to sort">Chases{arrow("customer_msg_count")}</th>
                <th className="w-[11%] px-2 py-1.5">Status</th>
                <th className="w-[10%] px-2 py-1.5">Owner</th>
                <th className="w-[10%] cursor-pointer select-none px-2 py-1.5 hover:text-slate-600" onClick={() => toggle("last_customer_at")} title="Sort by when the customer last wrote">Last customer{arrow("last_customer_at")}</th>
                <th className="w-[12%] px-2 py-1.5">WMS ticket</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const age = ageDays(t.last_customer_at);
                return (
                  <tr key={t.id} className="cursor-pointer border-b border-slate-50 align-top hover:bg-slate-50" onClick={() => openTicket(t)}>
                    <td className="px-2 py-1.5 font-semibold text-slate-800">
                      {t.ticket_no}
                      <div className="text-[10px] font-normal text-slate-400">{t.mailbox}@</div>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ring-1 ${PRI_CLS[t.priority] ?? PRI_CLS.P4}`}>{t.priority}</span>
                      {!!t.priority_locked && <div className="text-[9px] text-slate-400" title="Set by the team — automatic bumps are off">pinned</div>}
                      {t.severity && (
                        <div className={`mt-0.5 rounded px-1 py-0.5 text-center text-[9px] font-bold ${SEV_CLS[t.severity] ?? ""}`}
                          title={t.severity_reason ?? "raised from the message content"}>
                          {SEV_LABEL[t.severity] ?? t.severity}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {(() => {
                        const rt = requestTypeOf(t);
                        return (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${ISSUE_CLS[rt.key] ?? ISSUE_CLS.other}`}
                            title={rt.derived ? "read from the subject — run the pending migration to store it" : undefined}>
                            {ISSUE_LABEL[rt.key] ?? "Others"}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">{t.subject}</td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {t.customer_unique_id && <span className="font-semibold text-slate-800">{t.customer_unique_id} </span>}
                      {t.customer_name ?? ""}
                      <div className="truncate text-[10px] text-slate-400">{t.from_email}</div>
                    </td>
                    <td className="px-2 py-1.5 text-center font-bold text-slate-700">{t.customer_msg_count}</td>
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <select value={String(t.status ?? "new")} disabled={busy === `${t.id}:status`}
                        onChange={(e) => save(t.id, "status", e.target.value)}
                        className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-[11px]">
                        {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <input key={`${t.id}:${t.assigned_to ?? ""}`} defaultValue={t.assigned_to ?? ""} placeholder="owner"
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(t.assigned_to ?? "")) save(t.id, "assigned_to", v); }}
                        className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-[11px]" />
                    </td>
                    <td className="px-2 py-1.5 text-slate-600">
                      {fmt(t.last_customer_at)}
                      {age != null && <div className={`text-[10px] ${age >= 2 ? "font-bold text-red-600" : "text-slate-400"}`}>{age}d ago</div>}
                    </td>
                    <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                      {t.external_ticket_id
                        ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">#{t.external_ticket_id}</span>
                        : <button onClick={() => raise(t.id)} disabled={busy === `${t.id}:push`}
                            className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                            {busy === `${t.id}:push` ? "…" : "＋ Raise"}
                          </button>}
                      {t.external_error && <div className="text-[9px] text-red-500" title={t.external_error}>failed</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {open && (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={() => setOpen(null)}>
          <div className="my-6 w-full max-w-3xl rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${ISSUE_CLS[requestTypeOf(open).key] ?? ISSUE_CLS.other}`}>
                    {ISSUE_LABEL[requestTypeOf(open).key] ?? "Others"}
                  </span>
                  <span className="text-sm font-bold text-slate-800">{open.ticket_no} · {open.subject}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {open.from_email} · {open.customer_unique_id ?? "no booking id"} · {open.customer_msg_count} customer mail(s) · {open.mailbox}@
                </div>
                {open.severity_reason && (
                  <div className="mt-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                    Priority raised by content: {open.severity_reason}
                  </div>
                )}
              </div>
              <button onClick={() => setOpen(null)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">✕</button>
            </div>
            <div className="max-h-[70vh] space-y-2 overflow-auto p-4">
              {thread.length === 0 && <div className="text-xs text-slate-400">Loading the conversation…</div>}
              {[...thread]
                .sort((a, b) => {
                  const t = (x: any) => {
                    const v = new Date(String(x.sent_at ?? x.created_at ?? "").replace(" ", "T")).getTime();
                    return isNaN(v) ? 0 : v;
                  };
                  return t(a) - t(b); // oldest at the top, latest at the bottom
                })
                .map((m) => (
                <div key={m.id} className={`rounded-lg border p-3 ${m.direction === "inbound" ? "border-slate-200 bg-white" : "border-blue-100 bg-blue-50/60"}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${m.direction === "inbound" ? "bg-slate-100 text-slate-700" : "bg-blue-100 text-blue-700"}`}>
                      {m.direction === "inbound" ? "Customer" : "Us"}
                    </span>
                    <span className="font-medium text-slate-700">{m.from_email}</span>
                    <span className="text-slate-400">{fmt(m.sent_at)}</span>
                    {!!m.is_auto_reply && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">auto-reply</span>}
                    {!!m.has_attach && <span className="text-slate-400">📎</span>}
                  </div>
                  {(() => {
                    const raw = String(m.body_text ?? m.snippet ?? "");
                    const { text, trimmed } = stripQuoted(raw);
                    const full = showFull[m.id];
                    return (
                      <>
                        <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700">
                          {(full ? raw : text).slice(0, 8000)}
                        </div>
                        {trimmed && (
                          <button
                            onClick={() => setShowFull((f) => ({ ...f, [m.id]: !f[m.id] }))}
                            className="mt-1 text-[10px] font-medium text-blue-600 hover:underline">
                            {full ? "hide quoted history" : "show quoted history"}
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 px-4 py-3 text-xs">
              <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">Priority
                <select value={open.priority ?? "P4"} onChange={(e) => save(open.id, "priority", e.target.value)} className={sel}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">Status
                <select value={open.status ?? "new"} onChange={(e) => save(open.id, "status", e.target.value)} className={sel}>
                  {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">Request type
                <select value={requestTypeOf(open).key} onChange={(e) => save(open.id, "issue_type", e.target.value)} className={sel}>
                  {ISSUE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">Booking id
                <input key={`${open.id}:${open.customer_unique_id ?? ""}`} defaultValue={open.customer_unique_id ?? ""}
                  placeholder="e.g. BH32865"
                  onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (v !== String(open.customer_unique_id ?? "")) save(open.id, "customer_unique_id", v); }}
                  className={`${sel} w-32`} />
              </label>
              <label className="flex flex-1 flex-col gap-0.5 text-[11px] text-slate-500">Resolution notes
                <input key={`${open.id}:${open.resolution_notes ?? ""}`} defaultValue={open.resolution_notes ?? ""}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v !== String(open.resolution_notes ?? "")) save(open.id, "resolution_notes", v); }}
                  className={sel} placeholder="how it was resolved…" />
              </label>
              {!open.external_ticket_id && (
                <button onClick={() => raise(open.id)} disabled={busy === `${open.id}:push`}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                  ＋ Raise in ticket system
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
