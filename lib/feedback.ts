// Feedback & escalations board: every COMPLETED order (vendor app says delivered, or the WMS
// snapshot says completed/stacking) surfaces here with its feedback row — remarks, source of
// lead, outcome (positive/negative), assigned team and resolved status. A NEGATIVE outcome with
// a team assigned auto-raises an internal complaint ticket (once) via the WMS complaint API.
import { db, hasDb } from "./db";
import { allLiveOrders } from "./safestorage-api";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FeedbackRow {
  id: string; // orders.id (uuid), or "wms:<order_id>" for orders only the WMS knows
  is_intercity: boolean;
  sys_order_id: string | null;   // WMS numeric order_id (for mirroring edits to their store)
  wms_customer_id: string | null;// WMS numeric customer_id (idem)
  customer_unique_id: string;
  customer_name: string | null;
  contact: string | null;
  order_type: string | null;
  order_status: string | null;
  city: string | null;
  schedule_date: string | null;
  completed_at: string | null; // vendor-app 'delivered' tap time, else the schedule date
  remarks: string | null;
  source_of_lead: string | null;
  outcome: string | null;
  assigned_team: string | null;
  resolved_status: string | null;
  complaint_raised_at: string | null;
  complaint_ref: string | null;
}

const doneRe = /complete|stack|inbound|receiv|retrieval_completd/i;
const doneStatus = (o: any) =>
  String(o.live_status ?? "") === "delivered" || doneRe.test(String(o.order_status ?? ""));

// The SAME source the WMS "Feedback Calls" page uses — its own DB via feedback_call_orders. This
// is the truth for "which orders completed on a date": completed orders DROP OUT of the work-order
// feed, so our snapshot alone under-counts (the team saw 5 of 20).
const FEEDBACK_ORDERS_API = "https://safestorage.in/back/transport_controller_Dev0/feedback_call_orders";
async function wmsFeedbackOrders(from: string, to: string): Promise<any[]> {
  try {
    const res = await fetch(`${FEEDBACK_ORDERS_API}?from_date=${from}&to_date=${to}`, { cache: "no-store", headers: { Accept: "application/json" } });
    const j: any = await res.json();
    const arr: any[] = Array.isArray(j) ? j : (j?.data ?? []);
    // Intercity orders are INCLUDED here (team asked) — an Is-Intercity column/filter marks them.
    return arr;
  } catch { return []; }
}

export async function loadFeedbackBoard(from: string, to: string, city?: string | null): Promise<{ rows: FeedbackRow[]; feedbackTableMissing: boolean }> {
  if (!hasDb) return { rows: [], feedbackTableMissing: false };
  const c = db();

  let q = c.from("orders")
    .select("id, order_id, customer_unique_id, customer_name, contact, order_type, order_status, live_status, city, schedule_date")
    .gte("schedule_date", from).lte("schedule_date", to);
  if (city && city !== "All") q = q.eq("city", city);
  const { data: orders } = await q;
  const ours = orders ?? [];
  const oursBySys = new Map(ours.map((o: any) => [String(o.order_id ?? ""), o]));

  // Union: every completed order the WMS lists for the range + any our app marked delivered that
  // the WMS list is missing. City filter still applies via our snapshot when we know the order.
  const wms = await wmsFeedbackOrders(from, to);
  const entries: { o: any | null; w: any | null }[] = [];
  const seenSys = new Set<string>();
  for (const w of wms) {
    const sys = String(w.order_id ?? "");
    const o = (oursBySys.get(sys) ?? null) as any;
    if (city && city !== "All" && o && o.city !== city) continue;
    if (city && city !== "All" && !o) continue; // unknown city → only show under "All cities"
    const done = doneRe.test(String(w.order_status ?? "")) || (o && String(o.live_status ?? "") === "delivered");
    if (!done) continue;
    seenSys.add(sys);
    entries.push({ o, w });
  }
  for (const o of ours) {
    if (seenSys.has(String(o.order_id ?? ""))) continue;
    if (doneStatus(o)) entries.push({ o, w: null });
  }
  if (!entries.length) return { rows: [], feedbackTableMissing: false };

  const rowIdOf = (e: { o: any | null; w: any | null }) => e.o?.id ?? `wms:${String(e.w?.order_id ?? "")}`;
  const ids = entries.map(rowIdOf);

  // Vendor-app 'delivered' tap → the real completion moment.
  const deliveredAt = new Map<string, string>();
  try {
    const { data: ev } = await c.from("order_events").select("order_id, event, created_at").in("order_id", ids).eq("event", "delivered");
    for (const e of ev ?? []) {
      const cur = deliveredAt.get(e.order_id);
      if (!cur || String(e.created_at) > cur) deliveredAt.set(e.order_id, String(e.created_at));
    }
  } catch { /* events table optional */ }

  // Existing feedback rows.
  const fb = new Map<string, any>();
  let feedbackTableMissing = false;
  try {
    const { data: rows, error } = await c.from("order_feedback").select("*").in("order_id", ids);
    if (error) throw new Error(error.message);
    for (const r of rows ?? []) fb.set(r.order_id, r);
  } catch { feedbackTableMissing = true; }

  const rows: FeedbackRow[] = entries.map((e) => {
    const { o, w } = e;
    const id = rowIdOf(e);
    const f = fb.get(id) ?? {};
    return {
      id,
      is_intercity: /^(1|true|yes|y)$/i.test(String(w?.is_intercity ?? "").trim()) || /^(1|true|yes|y)$/i.test(String(o?.is_intercity ?? "").trim()),
      sys_order_id: w?.order_id != null ? String(w.order_id) : (o?.order_id != null ? String(o.order_id) : null),
      wms_customer_id: w?.customer_id != null ? String(w.customer_id) : null,
      customer_unique_id: o?.customer_unique_id ?? w?.customer_unique_id ?? String(w?.order_id ?? ""),
      customer_name: o?.customer_name ?? w?.customer_name ?? null,
      contact: o?.contact ?? w?.customer_contact1 ?? null,
      order_type: o?.order_type ?? w?.order_type ?? null,
      order_status: w?.order_status ?? (o?.live_status === "delivered" ? "completed" : (o?.order_status ?? null)),
      city: o?.city ?? null,
      schedule_date: o?.schedule_date ? String(o.schedule_date).slice(0, 10) : null,
      completed_at: deliveredAt.get(id) ?? (o?.schedule_date ? String(o.schedule_date).slice(0, 10) : (from === to ? from : null)),
      // Our edits win; the WMS page's entries show through when we have none (both teams call).
      remarks: f.remarks ?? (w?.remarks || null),
      source_of_lead: f.source_of_lead ?? (w?.source_of_lead || null),
      outcome: f.outcome ?? (String(w?.call_outcome ?? "").toLowerCase() || null),
      assigned_team: f.assigned_team ?? (w?.assigned_team || null),
      resolved_status: f.resolved_status ?? (String(w?.resolved_status ?? "").toLowerCase() || null),
      complaint_raised_at: f.complaint_raised_at ?? null,
      complaint_ref: f.complaint_ref ?? null,
    };
  });
  // Sync escalation status from the WMS: a ticket resolved on their side flips to Resolved here
  // automatically on the next page load. Best-effort — a down endpoint changes nothing.
  const toCheck = rows.filter((r) => r.complaint_raised_at && r.resolved_status !== "resolved" && /ticket\s+([A-Za-z0-9]+)/.test(r.complaint_ref ?? "")).slice(0, 20);
  await Promise.all(toCheck.map(async (r) => {
    const tid = (r.complaint_ref as string).match(/ticket\s+([A-Za-z0-9]+)/)![1];
    if (await wmsTicketResolved(tid)) {
      r.resolved_status = "resolved";
      try { await c.from("order_feedback").update({ resolved_status: "resolved" }).eq("order_id", r.id); } catch { /* best-effort */ }
    }
  }));

  // Newest first, negatives on top within a day (they need action).
  rows.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "") || (a.outcome === "negative" ? -1 : 1));
  return { rows, feedbackTableMissing };
}

// Latest ticket status from the WMS (get_internal_complaint_status_api). Returns true only when
// the WMS clearly says resolved/closed. Tries the controller spelling from the team's message
// first, then the standard one.
const COMPLAINT_STATUS_APIS = [
  "https://safestorage.in/back/transport_controller_Dev0e/get_internal_complaint_status_api",
  "https://safestorage.in/back/transport_controller_Dev0/get_internal_complaint_status_api",
];

async function wmsTicketResolved(ticketId: string): Promise<boolean> {
  for (const base of COMPLAINT_STATUS_APIS) {
    try {
      const res = await fetch(`${base}?ticket_id=${encodeURIComponent(ticketId)}`, { cache: "no-store" });
      const text = await res.text();
      let j: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      try { j = JSON.parse(text); } catch { continue; }
      if (!j || j.status !== true) continue; // envelope false / ticket unknown → no information
      const d = j.data ?? j;
      const s = String(d?.ticket_status ?? d?.complaint_status ?? d?.current_status ?? d?.status ?? d?.resolved ?? "").toLowerCase();
      return /resolv|clos|complete|done/.test(s) || s === "1";
    } catch { /* try the next base */ }
  }
  return false;
}

const EDITABLE = new Set(["remarks", "source_of_lead", "outcome", "assigned_team", "resolved_status"]);

// Mirror an edit to the WMS feedback store (save_feedback_call) so their Feedback Calls page and
// our module always show the same data. Best-effort — their side being down never blocks our save.
const SAVE_FEEDBACK_CALL_API = "https://safestorage.in/back/transport_controller_Dev0/save_feedback_call";
const WMS_FIELD: Record<string, string> = { remarks: "remarks", source_of_lead: "source_of_lead", outcome: "call_outcome", assigned_team: "assigned_team", resolved_status: "resolved_status" };
async function mirrorToWms(sysOrderId: string, wmsCustomerId: string, patch: Record<string, unknown>): Promise<void> {
  for (const [k, v] of Object.entries(patch)) {
    const wk = WMS_FIELD[k];
    if (!wk) continue;
    try {
      await fetch(SAVE_FEEDBACK_CALL_API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: wmsCustomerId, order_id: sysOrderId, [wk]: v ?? "", user_id: "transport-module" }),
      });
    } catch { /* best-effort */ }
  }
}

export async function saveFeedback(orderId: string, patch: Record<string, unknown>, mirror?: { sysOrderId?: string | null; wmsCustomerId?: string | null }): Promise<{ ok: boolean; error?: string; ticketRaised?: boolean; ticketError?: string; complaintRaisedAt?: string }> {
  if (!hasDb) return { ok: false, error: "db not configured" };
  const clean: Record<string, unknown> = { order_id: orderId };
  for (const [k, v] of Object.entries(patch)) {
    if (EDITABLE.has(k)) clean[k] = v === "" ? null : v;
  }
  if (Object.keys(clean).length === 1) return { ok: false, error: "nothing to save" };
  const { error } = await db().from("order_feedback").upsert(clean, { onConflict: "order_id" });
  if (error) {
    const msg = error.message || "save failed";
    if (/doesn't exist|no such table|order_feedback/i.test(msg)) {
      return { ok: false, error: "Run the 2026-07-14-order-feedback.sql migration first (phpMyAdmin)." };
    }
    return { ok: false, error: msg };
  }
  // Keep the WMS Feedback Calls page in sync (both teams see the same remarks/outcome/etc.).
  if (mirror?.sysOrderId && mirror?.wmsCustomerId) {
    const { order_id: _drop, ...fields } = clean; // eslint-disable-line @typescript-eslint/no-unused-vars
    await mirrorToWms(mirror.sysOrderId, mirror.wmsCustomerId, fields);
  }
  // NEGATIVE outcome + a team assigned = escalation → raise the internal complaint (once).
  // "wms:" rows exist only in the WMS store (never scheduled by us) — no order record to ticket from.
  const t = orderId.startsWith("wms:") ? {} as { raised?: boolean; raisedAt?: string; error?: string } : await maybeRaiseComplaint(orderId);
  return { ok: true, ticketRaised: !!t.raised, ticketError: t.error, complaintRaisedAt: t.raisedAt };
}

// ---- internal complaint ticket (WMS add_internal_complaint_api) ----
const COMPLAINT_API = "https://safestorage.in/back/transport_controller_Dev0/add_internal_complaint_api";

// complaint_id derived from the ASSIGNED TEAM — the WMS added dedicated task ids for each team:
// 1 Payment issue · 15 Transport Team · 16 Retrieval Team · 17 CRM Team · 18 Escalation Team ·
// 19 Instant Payment Team · 20 Warehouse team. (Older saved rows may still carry legacy labels —
// they map to the closest id; unknown labels fall back to 9 "Others".)
const TEAM_COMPLAINT_ID: Record<string, string> = {
  "Payment issue": "1",
  "Transport Team": "15",
  "Retrieval Team": "16",
  "CRM Team": "17",
  "CRM": "17",                 // legacy label
  "Escalation Team": "18",
  "Instant Payment Team": "19",
  "Warehouse Team": "20",
  "Warehouse team": "20",
  "Intercity retrieval team": "21",
  "Other": "9",                // legacy label
};

// Each complaint task lands with its OWNER in the WMS (assigned_user_id, provided by the team).
const COMPLAINT_ASSIGNEE: Record<string, string> = {
  "1": "23167", "15": "2907", "16": "25213", "17": "7594",
  "18": "36476", "19": "36827", "20": "27749", "21": "37112",
};

async function maybeRaiseComplaint(orderUuid: string): Promise<{ raised?: boolean; raisedAt?: string; error?: string }> {
  const c = db();
  const { data: fb } = await c.from("order_feedback").select("*").eq("order_id", orderUuid).maybeSingle();
  if (!fb || fb.outcome !== "negative" || !fb.assigned_team) return {};
  if (fb.complaint_raised_at) return {}; // already ticketed — never raise duplicates
  const { data: o } = await c.from("orders").select("order_id, customer_unique_id, customer_name, contact").eq("id", orderUuid).maybeSingle();
  if (!o) return { error: "order not found" };

  // customer_id / email live only in the WMS feed — look the order up there.
  let f: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { f = (await allLiveOrders()).find((x: any) => String(x.order_id ?? "") === String(o.order_id ?? "")); } catch { /* feed down → best-effort payload */ } // eslint-disable-line @typescript-eslint/no-explicit-any

  const follow = new Date(Date.now() + 86_400_000); // follow up tomorrow
  const dd = String(follow.getDate()).padStart(2, "0"), mm = String(follow.getMonth() + 1).padStart(2, "0");
  const complaintId = TEAM_COMPLAINT_ID[String(fb.assigned_team)] ?? "9"; // task derived from the assigned team
  const assignee = COMPLAINT_ASSIGNEE[complaintId];
  const payload = {
    // The API resolves the customer by the UNIQUE id (BH…): the numeric customer_id is rejected
    // with "No active customer found for this Customer Unique ID".
    customer_id: String(o.customer_unique_id ?? f?.customer_unique_id ?? ""),
    customer_contact: String(f?.customer_contact1 ?? String(o.contact ?? "").split(/[/,]/)[0].trim()),
    customer_email: String(f?.customer_email ?? ""),
    follow_up_date: `${dd}/${mm}/${follow.getFullYear()}`,
    complaint_id: complaintId,
    // The owner id, under every plausible field name (unknown extras are ignored by the API) and
    // both as number and string — their side was receiving null with assigned_user_id alone.
    ...(assignee ? {
      assigned_user_id: Number(assignee),
      assign_user_id: assignee,
      assigned_to: assignee,
      assign_to: assignee,
      user_id: assignee,
    } : {}),
    is_internal: "1", // ALWAYS internal — raised by the transport module, not the customer
    message: `[${o.customer_unique_id ?? o.order_id}] ${fb.remarks || "Negative transport feedback"} — assigned to ${fb.assigned_team} (transport module)`,
  };
  try {
    const res = await fetch(COMPLAINT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const text = await res.text().catch(() => "");
    let j: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try { j = JSON.parse(text); } catch { /* non-JSON reply */ }
    // The API answers HTTP 200 even on failure — success is ONLY {"status":true,"ticket_id":…}.
    const success = res.ok && j && (j.status === true || j.status === "true");
    if (!success) return { error: j?.message || `complaint API ${res.status}: ${text.slice(0, 120)}` };
    const ref = j.ticket_id ? `ticket ${j.ticket_id}` : text.slice(0, 180);
    const now = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "); // IST
    // A freshly raised ticket is an ACTIVE escalation by definition (until the WMS side resolves it).
    const { error: upErr } = await c.from("order_feedback").update({ complaint_raised_at: now, complaint_ref: ref, resolved_status: fb.resolved_status ?? "active" }).eq("order_id", orderUuid);
    if (upErr && /complaint_raised_at|complaint_ref/i.test(upErr.message || "")) {
      return { raised: true, raisedAt: now, error: `Ticket ${j.ticket_id ?? ""} raised, but run 2026-07-15-feedback-complaint.sql so it isn't raised again on the next edit.` };
    }
    return { raised: true, raisedAt: now };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
