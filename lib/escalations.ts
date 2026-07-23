// Escalations: issues reported AFTER completion (damage discovered later, missing item, negative
// review…), raised from the Feedback page and worked to resolution here — with type, ETA, fault
// side (ours / vendor), cost to resolve and how it was resolved.
import { randomUUID } from "node:crypto";
import { db, hasDb } from "./db";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ESCALATION_TYPES = ["damage", "missing_item", "negative_review", "payment", "behaviour", "delay", "other"] as const;
export const RESOLUTION_TYPES = ["refund", "replacement", "repair", "compensation", "apology_call", "waiver", "other"] as const;
export const FAULT_SIDES = ["ours", "vendor", "customer", "unknown"] as const;

const EDITABLE = new Set([
  "vendor_name", "escalation_type", "issue", "eta", "status", "fault_side",
  "resolution_type", "amount_spent", "resolution_notes",
]);

export async function listEscalations(from?: string | null, to?: string | null): Promise<{ rows: any[]; tableMissing: boolean }> {
  if (!hasDb) return { rows: [], tableMissing: false };
  try {
    let q = db().from("order_escalations").select("*").order("raised_at", { ascending: false }).limit(500);
    if (from) q = q.gte("raised_at", `${from} 00:00:00`);
    if (to) q = q.lte("raised_at", `${to} 23:59:59`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: data ?? [], tableMissing: false };
  } catch (e) {
    if (/doesn't exist|no such table|order_escalations/i.test((e as Error).message ?? "")) return { rows: [], tableMissing: true };
    throw e;
  }
}

// Which of the given order keys already have an escalation (for the Feedback page's chips).
export async function escalationKeys(keys: string[]): Promise<Record<string, { id: string; status: string }>> {
  if (!hasDb || !keys.length) return {};
  try {
    const { data } = await db().from("order_escalations").select("id, order_key, status").in("order_key", keys.slice(0, 400));
    const out: Record<string, { id: string; status: string }> = {};
    for (const r of data ?? []) out[(r as any).order_key] = { id: (r as any).id, status: (r as any).status };
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
  const { error } = await db().from("order_escalations").insert({
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
  });
  if (error) {
    const msg = error.message || "insert failed";
    if (/doesn't exist|no such table|order_escalations/i.test(msg)) {
      return { ok: false, error: "Run the 2026-07-22-order-escalations.sql migration first (phpMyAdmin)." };
    }
    if (/[Dd]uplicate/.test(msg)) return { ok: false, error: "This order already has an escalation — manage it on the Escalations page." };
    return { ok: false, error: msg };
  }
  return { ok: true, id };
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
