// Feedback & escalations board: every COMPLETED order (vendor app says delivered, or the WMS
// snapshot says completed/stacking) surfaces here with its feedback row — remarks, source of
// lead, outcome (positive/negative), assigned team and resolved status. A NEGATIVE outcome with
// a team assigned auto-raises an internal complaint ticket (once) via the WMS complaint API.
import { db, hasDb } from "./db";
import { allLiveOrders } from "./safestorage-api";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FeedbackRow {
  id: string; // orders.id (uuid)
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

const doneStatus = (o: any) =>
  String(o.live_status ?? "") === "delivered" || /complete|stack|inbound|receiv/i.test(String(o.order_status ?? ""));

export async function loadFeedbackBoard(from: string, to: string, city?: string | null): Promise<{ rows: FeedbackRow[]; feedbackTableMissing: boolean }> {
  if (!hasDb) return { rows: [], feedbackTableMissing: false };
  const c = db();

  let q = c.from("orders")
    .select("id, customer_unique_id, customer_name, contact, order_type, order_status, live_status, city, schedule_date")
    .gte("schedule_date", from).lte("schedule_date", to);
  if (city && city !== "All") q = q.eq("city", city);
  const { data: orders } = await q;
  const done = (orders ?? []).filter(doneStatus);
  if (!done.length) return { rows: [], feedbackTableMissing: false };

  const ids = done.map((o: any) => o.id);

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

  const rows: FeedbackRow[] = done.map((o: any) => {
    const f = fb.get(o.id) ?? {};
    return {
      id: o.id,
      customer_unique_id: o.customer_unique_id,
      customer_name: o.customer_name ?? null,
      contact: o.contact ?? null,
      order_type: o.order_type ?? null,
      order_status: o.live_status === "delivered" ? "completed" : (o.order_status ?? null),
      city: o.city ?? null,
      schedule_date: o.schedule_date ? String(o.schedule_date).slice(0, 10) : null,
      completed_at: deliveredAt.get(o.id) ?? (o.schedule_date ? String(o.schedule_date).slice(0, 10) : null),
      remarks: f.remarks ?? null,
      source_of_lead: f.source_of_lead ?? null,
      outcome: f.outcome ?? null,
      assigned_team: f.assigned_team ?? null,
      resolved_status: f.resolved_status ?? null,
      complaint_raised_at: f.complaint_raised_at ?? null,
      complaint_ref: f.complaint_ref ?? null,
    };
  });
  // Newest first, negatives on top within a day (they need action).
  rows.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "") || (a.outcome === "negative" ? -1 : 1));
  return { rows, feedbackTableMissing };
}

const EDITABLE = new Set(["remarks", "source_of_lead", "outcome", "assigned_team", "resolved_status"]);

export async function saveFeedback(orderId: string, patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string; ticketRaised?: boolean; ticketError?: string; complaintRaisedAt?: string }> {
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
  // NEGATIVE outcome + a team assigned = escalation → raise the internal complaint (once).
  const t = await maybeRaiseComplaint(orderId);
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
    const { error: upErr } = await c.from("order_feedback").update({ complaint_raised_at: now, complaint_ref: ref }).eq("order_id", orderUuid);
    if (upErr && /complaint_raised_at|complaint_ref/i.test(upErr.message || "")) {
      return { raised: true, raisedAt: now, error: `Ticket ${j.ticket_id ?? ""} raised, but run 2026-07-15-feedback-complaint.sql so it isn't raised again on the next edit.` };
    }
    return { raised: true, raisedAt: now };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
