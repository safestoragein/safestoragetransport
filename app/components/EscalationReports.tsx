"use client";

// Escalation reports in the EXACT format the team uses today (their WMS screenshots):
//   1. "Escalation Report"           — status × Damages/Missing pivot with a green Total row.
//   2. "Customers Escalation Report" — MISSING (orange band) then DAMAGES (blue band), one row per
//      customer with the warehouse columns (compensation, carpenter, deduction, follow-up…).
// Both offer 📷 Screenshot, 📋 Copy Image (PNG on the clipboard — pastes into WhatsApp) and CSV.
// Rendering uses the same data-URL SVG→canvas pipeline as the feedback reports (blob: URLs taint
// the canvas in Chrome).
import { useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dash = (v: unknown) => { const s = String(v ?? "").trim(); return s === "" || s === "0" || s === "null" ? "-" : s; };
const dateOnly = (v: unknown) => { const s = String(v ?? "").trim(); return s ? s.slice(0, 10) : "-"; };

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

// Their sheet groups everything under two headings; anything else lands in DAMAGES.
const isMissing = (r: any) => r.escalation_type === "missing_item" || /missing/i.test(String(r.wms_data?.type ?? ""));

// Both reports cover only the escalations still being WORKED — the team's reporting statuses, in
// their order. Rows are always printed (a "-" when the count is zero), and closed states
// (Resolved / Not Accepted / Open / Hold / …) are left out entirely, so the Total is the live
// workload rather than an all-time tally.
const STATUS_ROWS: [string, string][] = [
  ["in_progress", "In Progress"], ["outsource", "Outsource"], ["yet_to_repair", "Yet to Repair"],
  ["insurance_raised", "Insurance Raised"], ["vendor_transport", "Vendor Transport"],
  ["arrange_transport", "Arrange Transport"],
];
const REPORT_STATUSES = new Set(STATUS_ROWS.map(([k]) => k));

const DETAIL_COLS = [
  "Customer ID", "Name", "Email", "Description", "Type", "Status", "Compensation", "Resolved Date",
  "Carpenter", "Carpenter Amount", "Deduction", "Deduction Amount", "City", "Warehouse Location",
  "Reported Date", "Priority", "Remarks", "Followup Date", "Followup Notes", "TAT (days)",
];

// TAT = days from the day the issue was reported to its follow-up date (still running when the
// follow-up date is in the future / not set yet).
function tatDays(reported: unknown, followup: unknown): string {
  const a = new Date(String(reported ?? "").replace(" ", "T").slice(0, 10)).getTime();
  if (isNaN(a)) return "-";
  const fu = String(followup ?? "").trim().slice(0, 10);
  const b = fu ? new Date(fu).getTime() : Date.now();
  if (isNaN(b)) return "-";
  return String(Math.max(0, Math.floor((b - a) / 86_400_000)));
}

export default function EscalationReports({ rows, from, to, statusLabel }: { rows: any[]; from: string; to: string; statusLabel: Record<string, string> }) {
  const [modal, setModal] = useState<null | "summary" | "customers">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const range = `${from} → ${to}`;

  const inReport = rows.filter((r) => REPORT_STATUSES.has(String(r.status ?? "open")));
  const missing = inReport.filter(isMissing);
  const damages = inReport.filter((r) => !isMissing(r));

  // ---- 1. summary pivot (status × damages/missing) -------------------------------------------
  const summaryRows = () =>
    STATUS_ROWS.map(([k, label]) => ({
      key: k,
      label: statusLabel[k] ?? label,
      dmg: damages.filter((r) => String(r.status ?? "open") === k).length,
      mis: missing.filter((r) => String(r.status ?? "open") === k).length,
    }));

  const summaryHtml = () => {
    const rs = summaryRows();
    const hd = "padding:10px 14px;border:1px solid #cbd5e1;font-size:13px;font-weight:700;background:#2f80ed;color:#fff;text-align:left;";
    const cell = "padding:10px 14px;border:1px solid #e2e8f0;font-size:13px;color:#0f172a;";
    const tot = "padding:10px 14px;border:1px solid #34d399;font-size:13px;font-weight:800;background:#2ecc8f;color:#fff;";
    return `<div style="font-family:system-ui,sans-serif">
      <div style="font-weight:800;font-size:16px;margin-bottom:8px;color:#0f172a">Escalation Report</div>
      <div style="font-size:12px;color:#2563eb;margin-bottom:10px">${esc(range)} · escalations still being worked</div>
      <table style="border-collapse:collapse;width:100%">
        <tr><th style="${hd}">Escalation</th><th style="${hd}text-align:center">Damages</th><th style="${hd}text-align:center">Missing</th></tr>
        ${rs.map((r) => `<tr>
          <td style="${cell}">${esc(r.label)}</td>
          <td style="${cell}text-align:center">${r.dmg || "-"}</td>
          <td style="${cell}text-align:center">${r.mis || "-"}</td>
        </tr>`).join("")}
        <tr><td style="${tot}">Total</td><td style="${tot}text-align:center">${damages.length}</td><td style="${tot}text-align:center">${missing.length}</td></tr>
      </table></div>`;
  };

  // ---- 2. per-customer detail (MISSING band, then DAMAGES band) -------------------------------
  const detailCells = (r: any) => {
    const w = r.wms_data ?? {};
    const label = r.customer_name ? `${r.customer_unique_id ?? r.customer_id ?? ""}(${r.customer_name})` : String(r.customer_unique_id ?? r.customer_id ?? "");
    return [
      label, r.customer_name, w.email ?? "", r.issue, isMissing(r) ? "missing" : "damage",
      statusLabel[String(r.status ?? "open")] ?? r.status,
      r.amount_spent ? `₹ ${Number(r.amount_spent).toFixed(2)}` : dash(w.Compensation_Amount),
      dateOnly(r.resolved_at ?? w.Resolved_Timestamp),
      dash(w.carpenter), dash(w.carpenter_amount), dash(w.deduction_team), dash(w.deduction_amount),
      r.city ?? w.customer_local_city ?? "", dash(w.warehouse_location),
      dateOnly(r.raised_at ?? w.reported_date), dash(w.priority), dash(w.remarks ?? r.resolution_notes),
      dateOnly(r.followup_date ?? w.followup_date),
      dash(r.followup_notes ?? w.followup_description),
      tatDays(r.raised_at ?? w.reported_date, r.followup_date ?? w.followup_date),
    ];
  };

  const section = (title: string, band: string, list: any[], totalLabel: string) => {
    const hd = "padding:7px 9px;border:1px solid #94a3b8;font-size:11px;font-weight:700;background:#334155;color:#fff;text-align:left;white-space:nowrap;";
    const cell = "padding:7px 9px;border:1px solid #cbd5e1;font-size:11px;color:#0f172a;vertical-align:top;";
    const tint = title === "MISSING" ? "#fdf6e3" : "#fde8e8";
    return `<tr><td colspan="${DETAIL_COLS.length}" style="background:${band};color:#fff;font-weight:800;font-size:13px;padding:8px 10px;border:1px solid ${band}">${esc(title)}</td></tr>
      <tr>${DETAIL_COLS.map((c) => `<th style="${hd}">${esc(c)}</th>`).join("")}</tr>
      ${list.length
        ? list.map((r) => `<tr>${detailCells(r).map((v) => `<td style="${cell}background:${tint}">${esc(v ?? "")}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${DETAIL_COLS.length}" style="${cell}color:#94a3b8">No ${esc(title.toLowerCase())} escalations in this range</td></tr>`}
      <tr><td colspan="${DETAIL_COLS.length}" style="background:#2ecc8f;color:#fff;font-weight:800;font-size:12px;padding:7px 10px;border:1px solid #2ecc8f;text-align:right">${esc(totalLabel)}: ${list.length}</td></tr>`;
  };

  const customersHtml = () => `<div style="font-family:system-ui,sans-serif">
      <div style="font-weight:800;font-size:16px;margin-bottom:4px;color:#0f172a">Customers Escalation Report</div>
      <div style="font-size:12px;color:#2563eb;margin-bottom:10px">${esc(range)} · ${inReport.length} escalation${inReport.length === 1 ? "" : "s"} still being worked</div>
      <table style="border-collapse:collapse;width:100%">
        ${section("MISSING", "#e8891a", missing, "Total MISSING")}
        <tr><td colspan="${DETAIL_COLS.length}" style="height:10px;border:none"></td></tr>
        ${section("DAMAGES", "#2f80ed", damages, "Total DAMAGES")}
      </table></div>`;

  const htmlFor = (m: string) => (m === "summary" ? summaryHtml() : customersHtml());
  const widthFor = (m: string) => (m === "summary" ? 560 : 1980);

  const csvFor = (m: string) => {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    if (m === "summary") {
      return [["Escalation", "Damages", "Missing"], ...summaryRows().map((r) => [r.label, r.dmg, r.mis]), ["Total", damages.length, missing.length]]
        .map((r) => r.map(q).join(",")).join("\n");
    }
    const body = [...missing.map((r) => ["MISSING", ...detailCells(r)]), ...damages.map((r) => ["DAMAGES", ...detailCells(r)])];
    return [["Section", ...DETAIL_COLS], ...body].map((r) => r.map(q).join(",")).join("\n");
  };

  const download = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const doScreenshot = async () => {
    if (!modal) return;
    setBusy("shot");
    try {
      const blob = await htmlToPng(htmlFor(modal), widthFor(modal));
      if (blob) download(blob, `escalation-${modal}-${from}-${to}.png`);
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

  const doCsv = () => {
    if (!modal) return;
    download(new Blob([csvFor(modal)], { type: "text/csv;charset=utf-8" }), `escalation-${modal}-${from}-${to}.csv`);
  };

  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50";
  return (
    <>
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        <button onClick={() => setModal("summary")} className={btn}>🗒 Escalation Report</button>
        <button onClick={() => setModal("customers")} className={btn}>🗒 Customers Escalation Report</button>
      </div>

      {modal && (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={() => setModal(null)}>
          <div className={`my-4 w-full rounded-xl bg-white shadow-2xl ${modal === "customers" ? "max-w-[95vw]" : "max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <span className="text-sm font-bold text-slate-800">{modal === "summary" ? "Escalation Report" : "Customers Escalation Report"}</span>
              <button onClick={doScreenshot} disabled={busy != null} className="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
                {busy === "shot" ? "…" : "📷 Screenshot"}
              </button>
              <button onClick={doCsv} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">⬇ Export CSV</button>
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
