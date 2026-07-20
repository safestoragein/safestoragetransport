"use client";

// WMS-style reports for Feedback & escalations — the exact format the team uses on their
// feedback-calls page: a stat-card row (Total / Positive / Negative / Active / Working / Resolved)
// plus four report modals (full table, overall, assigned-team, source-of-lead), each with
// 📷 Screenshot (downloads a PNG) and 📋 Copy Image (PNG on the clipboard — pastes into WhatsApp
// exactly as shown). Rendering uses the proven data-URL SVG→canvas pipeline from VendorReport.
import { useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cap = (s: string) => s.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

// HTML → PNG blob (data: URL keeps the canvas untainted in Chrome; blob: URLs would not).
async function htmlToPng(html: string, width: number): Promise<Blob | null> {
  const holder = document.createElement("div");
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${width - 24}px;background:#fff`;
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const height = Math.ceil(holder.getBoundingClientRect().height) + 24;
  document.body.removeChild(holder);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="background:#ffffff;padding:12px;width:${width - 24}px">${html}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width * 2; canvas.height = height * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return await new Promise((res) => canvas.toBlob(res, "image/png"));
}

const th = "padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;font-weight:700;background:#f8fafc;text-align:left;color:#0f172a;";
const td = "padding:7px 10px;border:1px solid #e2e8f0;font-size:12px;vertical-align:top;color:#0f172a;";

function titleHtml(title: string, sub: string): string {
  return `<div style="font-family:system-ui,sans-serif">
    <div style="font-weight:800;font-size:16px;color:#0f172a;margin-bottom:4px">${esc(title)}</div>
    <div style="font-size:12px;color:#2563eb;margin-bottom:10px">${esc(sub)}</div>`;
}

function metricTable(rows: [string, number | string, boolean?][]): string {
  return `<table style="border-collapse:collapse;width:100%">
    <tr><th style="${th}">Metric</th><th style="${th}text-align:right">Count</th></tr>
    ${rows.map(([label, v, dim]) => `<tr>
      <td style="${td}${dim ? "color:#94a3b8;" : ""}font-weight:${dim ? 400 : 600}">${esc(label)}</td>
      <td style="${td}text-align:right;font-weight:700;${dim ? "color:#94a3b8;" : ""}">${esc(v)}</td>
    </tr>`).join("")}
  </table></div>`;
}

export default function FeedbackReports({ rows, from, to }: { rows: any[]; from: string; to: string }) {
  const [modal, setModal] = useState<null | "report" | "overall" | "team" | "lead">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const neg = rows.filter((r) => r.outcome === "negative");
  const stats = {
    total: rows.length,
    positive: rows.filter((r) => r.outcome === "positive").length,
    negative: neg.length,
    active: neg.filter((r) => (r.resolved_status ?? "active") === "active").length,
    working: neg.filter((r) => r.resolved_status === "working").length,
    resolved: neg.filter((r) => r.resolved_status === "resolved").length,
  };
  const range = `${from} → ${to}`;

  const fullReportHtml = () => {
    const cols = ["Customer Unique ID", "Customer Name", "Contact", "Order Type", "Order Status", "Remarks", "Source of Lead", "Assigned Team", "Resolved Status", "Outcome"];
    const body = rows.map((r) => {
      const negRow = r.outcome === "negative";
      const cell = `${td}${negRow ? "background:#f87171;" : ""}`;
      const vals = [
        r.customer_unique_id, r.customer_name, String(r.contact ?? "").split(/[/,]/)[0].trim(),
        String(r.order_type ?? "").replace("_", " "), r.order_status, r.remarks,
        r.source_of_lead ? cap(String(r.source_of_lead)) : "", r.assigned_team,
        negRow ? cap(String(r.resolved_status ?? "active")) : "", r.outcome ? cap(String(r.outcome)) : "",
      ];
      return `<tr>${vals.map((v) => `<td style="${cell}">${esc(v ?? "")}</td>`).join("")}</tr>`;
    }).join("");
    return `${titleHtml(`Feedback Calls Report — ${range}`, `Feedback Calls · ${range}`)}
      <div style="font-size:12px;color:#475467;margin-bottom:6px">${rows.length} orders</div>
      <table style="border-collapse:collapse;width:100%">
        <tr>${cols.map((c) => `<th style="${th}">${esc(c)}</th>`).join("")}</tr>
        ${body}
      </table></div>`;
  };

  const overallHtml = () => `${titleHtml(`Overall Report — ${range}`, `Feedback Calls · ${range}`)}${metricTable([
    ["Total customers", stats.total],
    ["Positive Feedback", stats.positive],
    ["Negative Feedback", stats.negative],
    ["Active", stats.active],
    ["Working on it", stats.working],
    ["Resolved", stats.resolved],
  ])}`;

  const teamHtml = () => {
    const byTeam = new Map<string, number>();
    for (const r of rows) { if (r.assigned_team) byTeam.set(r.assigned_team, (byTeam.get(r.assigned_team) ?? 0) + 1); }
    const assigned = [...byTeam.values()].reduce((s, n) => s + n, 0);
    const items: [string, number, boolean?][] = [["Total Assigned", assigned]];
    for (const [t, n] of [...byTeam.entries()].sort((a, b) => b[1] - a[1])) items.push([t, n]);
    items.push(["Unassigned", rows.length - assigned, true]);
    return `${titleHtml(`Assigned Team Status — ${range}`, `Feedback Calls · Assigned Team · ${range}`)}${metricTable(items)}`;
  };

  const leadHtml = () => {
    const pickups = rows.filter((r) => /pickup/i.test(String(r.order_type ?? "")));
    const bySrc = new Map<string, number>();
    let notSet = 0;
    for (const r of pickups) {
      const s = String(r.source_of_lead ?? "").trim();
      if (!s) { notSet++; continue; }
      const k = cap(s.toLowerCase());
      bySrc.set(k, (bySrc.get(k) ?? 0) + 1);
    }
    const items: [string, number, boolean?][] = [["Total Pickup Orders", pickups.length]];
    for (const [s, n] of [...bySrc.entries()].sort((a, b) => b[1] - a[1])) items.push([s, n]);
    items.push(["Not set", notSet, true]);
    return `${titleHtml(`Source of Lead (Pickup) — ${range}`, `Feedback Calls · Source of Lead · Pickup · ${range}`)}${metricTable(items)}`;
  };

  const htmlFor = (m: string) => m === "report" ? fullReportHtml() : m === "overall" ? overallHtml() : m === "team" ? teamHtml() : leadHtml();
  const widthFor = (m: string) => (m === "report" ? 1050 : 480);

  const doScreenshot = async () => {
    if (!modal) return;
    setBusy("shot");
    try {
      const blob = await htmlToPng(htmlFor(modal), widthFor(modal));
      if (blob) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `feedback-${modal}-${from}-${to}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } finally { setBusy(null); }
  };

  const doCopy = async () => {
    if (!modal) return;
    setBusy("copy");
    try {
      const blob = await htmlToPng(htmlFor(modal), widthFor(modal));
      if (blob) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch { alert("Copy failed — use Screenshot instead."); } finally { setBusy(null); }
  };

  const statCards = [
    { label: "Total customers", value: stats.total, cls: "border-slate-200 bg-white text-slate-900" },
    { label: "Positive Feedback", value: stats.positive, cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
    { label: "Negative Feedback", value: stats.negative, cls: "border-red-200 bg-red-50 text-red-600" },
    { label: "Active", value: stats.active, cls: "border-blue-200 bg-blue-50 text-blue-700" },
    { label: "Working on it", value: stats.working, cls: "border-amber-200 bg-amber-50 text-amber-700" },
    { label: "Resolved", value: stats.resolved, cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  ];
  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50";

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {statCards.map((s) => (
          <div key={s.label} className={`rounded-xl border p-3 ${s.cls}`}>
            <div className="text-xl font-extrabold">{s.value}</div>
            <div className="text-[11px] font-medium opacity-80">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <button onClick={() => setModal("report")} className={btn}>🗒 Copy Report</button>
        <button onClick={() => setModal("overall")} className={btn}>🗒 Copy Overall Report</button>
        <button onClick={() => setModal("team")} className={btn}>🗒 Copy Assigned Team status</button>
        <button onClick={() => setModal("lead")} className={btn}>🗒 Copy Source of Lead data</button>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={() => setModal(null)}>
          <div className={`my-4 w-full rounded-xl bg-white shadow-2xl ${modal === "report" ? "max-w-5xl" : "max-w-md"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-bold text-slate-800">Report preview</span>
              <button onClick={doScreenshot} disabled={busy != null} className="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
                {busy === "shot" ? "…" : "📷 Screenshot"}
              </button>
              <button onClick={doCopy} disabled={busy != null} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${copied ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-900 text-white hover:bg-slate-700"} disabled:opacity-50`}>
                {copied ? "✓ Copied" : busy === "copy" ? "…" : "📋 Copy Image"}
              </button>
              <button onClick={() => setModal(null)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50">✕</button>
            </div>
            <div className="max-h-[75vh] overflow-auto p-4">
              <div dangerouslySetInnerHTML={{ __html: htmlFor(modal) }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
