// Escalations: issues reported AFTER completion (damage discovered later, missing item, negative
// review…), raised from the Feedback page and worked to resolution here — with type, ETA, fault
// side (ours / vendor), cost to resolve and how it was resolved.
import { randomUUID } from "node:crypto";
import { db, hasDb } from "./db";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ESCALATION_TYPES = ["damage", "missing_item", "negative_review", "payment", "behaviour", "delay", "other"] as const;
export const RESOLUTION_TYPES = ["refund", "replacement", "repair", "compensation", "apology_call", "waiver", "other"] as const;
export const FAULT_SIDES = ["ours", "vendor", "customer", "unknown"] as const;

// The warehouse team raises missing/damage issues in THEIR system — surfaced here so an
// escalation for the same customer is auto-marked "WMS reported" instead of double-worked.
const WMS_ISSUES_API = "https://safestorage.in/back/transport_controller_Dev0/get_wms_reported_issues";
let wmsIssuesCache: { at: number; map: Map<string, any[]> } | null = null;
export async function wmsIssuesByCustomer(): Promise<Map<string, any[]>> {
  if (wmsIssuesCache && Date.now() - wmsIssuesCache.at < 120_000) return wmsIssuesCache.map;
  try {
    const res = await fetch(WMS_ISSUES_API, { cache: "no-store", headers: { Accept: "application/json" } });
    let raw = await res.text();
    const cut = raw.lastIndexOf("]");
    if (cut > 0) raw = raw.slice(0, cut + 1); // the WMS appends a stray '1' after the JSON
    const arr = JSON.parse(raw);
    const map = new Map<string, any[]>();
    for (const it of Array.isArray(arr) ? arr : []) {
      const k = String(it.customer_unique_id ?? "").trim();
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    wmsIssuesCache = { at: Date.now(), map };
    return map;
  } catch { return wmsIssuesCache?.map ?? new Map(); }
}
const wmsRefOf = (issues: any[]) =>
  issues.map((it) => `${it.type}: ${it.description} (${it.status}${it.reported_date ? `, ${it.reported_date}` : ""})`).join(" | ").slice(0, 800);

const EDITABLE = new Set([
  "vendor_name", "escalation_type", "issue", "eta", "status", "fault_side",
  "resolution_type", "amount_spent", "resolution_notes",
]);

// AUTO-IMPORT: every issue the WAREHOUSE team raises in their system becomes an escalation row
// here — no manual step. Deduped by their issue id (order_key "wmsissue:<id>"); runs on every
// Escalations page load, so new WMS reports appear on the next refresh.
const WMS_TYPE_MAP: Record<string, string> = { damage: "damage", missing: "missing_item" };
function wmsStatusToOurs(s: unknown): string {
  const k = String(s ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const known = ["open", "in_progress", "outsource", "vendor_transport", "arrange_transport", "yet_to_repair", "insurance_raised", "hold", "wms_reported", "refund_initiated", "resolved"];
  return known.includes(k) ? k : "wms_reported";
}
async function importWmsIssues(): Promise<void> {
  const wms = await wmsIssuesByCustomer();
  const issues: any[] = [...wms.values()].flat();
  if (!issues.length) return;
  const c = db();
  const { data: existing } = await c.from("order_escalations").select("order_key").ilike("order_key", "wmsissue:%");
  const have = new Set((existing ?? []).map((r: any) => String(r.order_key)));
  for (const it of issues) {
    const key = `wmsissue:${it.id}`;
    if (!it.id || have.has(key)) continue;
    let row: Record<string, unknown> = {
      id: randomUUID(),
      order_key: key,
      customer_unique_id: it.customer_unique_id ?? null,
      customer_name: it.name ?? null,
      contact: null,
      city: String(it.customer_local_city ?? "").toLowerCase() || null,
      order_type: null,
      is_intercity: 0,
      escalation_type: WMS_TYPE_MAP[String(it.type ?? "").toLowerCase()] ?? "other",
      issue: `${it.description ?? ""}${it.warehouse_location ? ` — ${it.warehouse_location}` : ""}${it.priority ? ` (priority: ${it.priority})` : ""}`,
      raised_by: "WMS team",
      ...(it.reported_date ? { raised_at: `${String(it.reported_date).slice(0, 10)} 00:00:00` } : {}),
      status: wmsStatusToOurs(it.status),
      fault_side: "ours",
      ...(Number(it.Compensation_Amount) > 0 ? { amount_spent: Number(it.Compensation_Amount) } : {}),
      wms_reported: 1,
      wms_ref: wmsRefOf([it]),
    };
    for (let i = 0; i < 6; i++) {
      const { error } = await c.from("order_escalations").insert(row);
      if (!error) break;
      const col = (String(error.message || "").match(/[Uu]nknown column '([a-z_]+)'/) || [])[1];
      if (!col || !(col in row)) break; // duplicate/table-missing → skip silently
      const { [col]: _drop, ...rest } = row; row = rest;
    }
  }
}

export async function listEscalations(from?: string | null, to?: string | null): Promise<{ rows: any[]; tableMissing: boolean }> {
  if (!hasDb) return { rows: [], tableMissing: false };
  try {
    try { await importWmsIssues(); } catch { /* import is best-effort — the list still loads */ }
    let q = db().from("order_escalations").select("*").order("raised_at", { ascending: false }).limit(500);
    if (from) q = q.gte("raised_at", `${from} 00:00:00`);
    if (to) q = q.lte("raised_at", `${to} 23:59:59`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    // Live WMS-issue match per row (their statuses move — compensation, resolved…).
    const rows = data ?? [];
    try {
      const wms = await wmsIssuesByCustomer();
      for (const r of rows as any[]) {
        const hits = wms.get(String(r.customer_unique_id ?? "").trim());
        if (hits?.length) { r.wms_live = wmsRefOf(hits); r.wms_reported = 1; }
      }
    } catch { /* enrichment only */ }
    return { rows, tableMissing: false };
  } catch (e) {
    if (/doesn't exist|no such table|order_escalations/i.test((e as Error).message ?? "")) return { rows: [], tableMissing: true };
    throw e;
  }
}

// Which of the given order keys already have an escalation (for the Feedback page's chips).
export async function escalationKeys(keys: string[]): Promise<Record<string, { id: string; status: string; type: string | null }>> {
  if (!hasDb || !keys.length) return {};
  try {
    const { data } = await db().from("order_escalations").select("id, order_key, status, escalation_type").in("order_key", keys.slice(0, 400));
    const out: Record<string, { id: string; status: string; type: string | null }> = {};
    for (const r of data ?? []) out[(r as any).order_key] = { id: (r as any).id, status: (r as any).status, type: (r as any).escalation_type ?? null };
    return out;
  } catch { return {}; }
}

export async function createEscalation(input: {
  orderKey: string; customerUniqueId?: string | null; customerName?: string | null; contact?: string | null;
  city?: string | null; orderType?: string | null; isIntercity?: boolean; escalationType?: string | null;
  issue: string; raisedBy?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!hasDb) return { ok: false, error: "db not configured" };
  const id = randomUUID();
  // Already raised by the WAREHOUSE team? Mark it, so the team sees it's a WMS issue.
  let wmsHits: any[] = [];
  try { wmsHits = (await wmsIssuesByCustomer()).get(String(input.customerUniqueId ?? "").trim()) ?? []; } catch { /* best-effort */ }
  let row: Record<string, unknown> = {
    id,
    order_key: input.orderKey,
    customer_unique_id: input.customerUniqueId ?? null,
    customer_name: input.customerName ?? null,
    contact: input.contact ?? null,
    city: input.city ?? null,
    order_type: input.orderType ?? null,
    is_intercity: input.isIntercity ? 1 : 0,
    escalation_type: input.escalationType ?? null,
    issue: input.issue,
    raised_by: input.raisedBy ?? null,
    status: "open",
    wms_reported: wmsHits.length ? 1 : 0,
    wms_ref: wmsHits.length ? wmsRefOf(wmsHits) : null,
  };
  let error: any = null;
  for (let i = 0; i < 4; i++) {
    ({ error } = await db().from("order_escalations").insert(row));
    if (!error) break;
    const col = (String(error.message || "").match(/[Uu]nknown column '([a-z_]+)'/) || [])[1];
    if (!col || !(col in row)) break;
    const { [col]: _drop, ...rest } = row; row = rest; // pre-migration column → retry without it
  }
  if (error) {
    const msg = error.message || "insert failed";
    if (/doesn't exist|no such table|order_escalations/i.test(msg)) {
      return { ok: false, error: "Run the 2026-07-22-order-escalations.sql migration first (phpMyAdmin)." };
    }
    if (/[Dd]uplicate/.test(msg)) return { ok: false, error: "This order already has an escalation — manage it on the Escalations page." };
    return { ok: false, error: msg };
  }
  return { ok: true, id, wmsReported: wmsHits.length > 0 } as any;
}

export async function updateEscalation(id: string, patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  if (!hasDb) return { ok: false, error: "db not configured" };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (EDITABLE.has(k)) clean[k] = v === "" ? null : v;
  }
  if (!Object.keys(clean).length) return { ok: false, error: "nothing to save" };
  // Resolving stamps the resolution date (and re-opening clears it).
  if ("status" in clean) {
    clean.resolved_at = clean.status === "resolved" ? new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ") : null;
  }
  const { error } = await db().from("order_escalations").update(clean).eq("id", id);
  if (error) return { ok: false, error: error.message || "update failed" };
  return { ok: true };
}
