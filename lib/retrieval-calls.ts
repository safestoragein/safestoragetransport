// Retrieval → Calls: pull Knowlarity's call log for the retrieval SR number, store one row per
// call, and identify the caller from their phone number using the same order history the email
// tickets use. Runs on the same hourly job as the mailboxes.
import { randomUUID } from "node:crypto";
import { db, hasDb } from "./db";
import { fetchCalls, isRetrievalCall, knowlarityConfigured, KCall } from "./knowlarity";

/* eslint-disable @typescript-eslint/no-explicit-any */

const last10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);

// number -> customer, built from our own snapshots, the live feed and months of order history.
async function phoneDirectory(): Promise<Map<string, any>> {
  const byPhone = new Map<string, any>();
  const add = (o: any, phones: unknown[]) => {
    for (const p of phones) {
      const d = last10(p);
      if (d.length === 10 && !byPhone.has(d)) byPhone.set(d, o);
    }
  };
  try {
    const { data } = await db().from("orders").select("customer_unique_id, customer_name, contact, city").limit(20000);
    for (const o of (data ?? []) as any[]) add(o, String(o.contact ?? "").split(/[/,;]+/));
  } catch { /* optional */ }
  try {
    const { allLiveOrders } = await import("./safestorage-api");
    for (const o of await allLiveOrders()) {
      add({ customer_unique_id: o.customer_unique_id, customer_name: o.customer_name, city: String(o.customer_local_city ?? "").toLowerCase() },
        [o.customer_contact1, o.customer_contact2]);
    }
  } catch { /* optional */ }
  try {
    const { feedbackPhoneIndex } = await import("./retrieval-tickets");
    for (const [d, o] of await feedbackPhoneIndex()) if (!byPhone.has(d)) byPhone.set(d, o);
  } catch { /* optional */ }
  return byPhone;
}

export async function syncCalls(): Promise<{ ok: boolean; seen: number; created: number; matched: number; error?: string }> {
  if (!hasDb) return { ok: false, seen: 0, created: 0, matched: 0, error: "db not configured" };
  if (!knowlarityConfigured) return { ok: false, seen: 0, created: 0, matched: 0, error: "Knowlarity is not configured on the server" };
  const c = db();
  const { data: st } = await c.from("ret_call_sync").select("*").eq("id", 1).maybeSingle();
  // small overlap so a call landing mid-run is never missed; call_uuid dedupes
  const since = st?.last_call_at
    ? new Date(new Date(String(st.last_call_at).replace(" ", "T")).getTime() - 30 * 60_000)
    : new Date(Date.now() - 7 * 86_400_000);

  let seen = 0, created = 0, matched = 0, newest = st?.last_call_at ?? null;
  try {
    const calls = (await fetchCalls(since, new Date())).filter(isRetrievalCall);
    const dir = calls.length ? await phoneDirectory() : new Map();
    for (const k of calls as KCall[]) {
      seen++;
      const started = String(k.start_time ?? "").replace("T", " ").slice(0, 19);
      if (started && (!newest || started > newest)) newest = started;
      const { data: dup } = await c.from("ret_calls").select("id").eq("call_uuid", String(k.uuid)).maybeSingle();
      if (dup) continue;

      const who = dir.get(last10(k.customer_number)) ?? null;
      if (who) matched++;
      let row: Record<string, unknown> = {
        id: randomUUID(),
        call_uuid: String(k.uuid),
        sr_number: k.knowlarity_number ?? null,
        extension: String(k.extension ?? "") || null,
        direction: "inbound",
        customer_number: k.customer_number ?? null,
        caller_name: String(k.caller_name ?? "").trim() || null,
        agent_number: k.agent_number ?? null,
        started_at: started || null,
        duration_sec: Number(k.call_duration) || 0,
        answered: Number(k.call_duration) > 0 ? 1 : 0,
        recording_url: k.call_recording ?? null,
        customer_id: who?.customer_id != null ? String(who.customer_id) : null,
        customer_unique_id: who?.customer_unique_id ?? null,
        customer_name: who?.customer_name ?? null,
        city: who?.city ?? null,
        status: "new",
      };
      for (let i = 0; i < 8; i++) {
        const { error } = await c.from("ret_calls").insert(row);
        if (!error) { created++; break; }
        if (/[Dd]uplicate/.test(String(error.message))) break;
        const col = (String(error.message || "").match(/[Uu]nknown column '([a-z_]+)'/) || [])[1];
        if (!col || !(col in row)) break;
        const { [col]: _drop, ...rest } = row; row = rest;
      }
    }
    await c.from("ret_call_sync").upsert({
      id: 1, last_call_at: newest,
      last_synced_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      last_status: "ok", last_error: null,
      calls_seen: (Number(st?.calls_seen) || 0) + seen,
    }, { onConflict: "id" });
    return { ok: true, seen, created, matched };
  } catch (e) {
    const msg = (e as Error).message;
    try {
      await c.from("ret_call_sync").upsert({ id: 1, last_status: "error", last_error: msg.slice(0, 400) }, { onConflict: "id" });
    } catch { /* ignore */ }
    return { ok: false, seen, created, matched, error: msg };
  }
}

export async function listCalls(opts: { status?: string | null; answered?: string | null; q?: string | null }) {
  if (!hasDb) return { calls: [], tableMissing: false };
  try {
    let q = db().from("ret_calls").select("*").order("started_at", { ascending: false }).limit(500);
    if (opts.status && opts.status !== "All") q = q.eq("status", opts.status);
    if (opts.answered === "answered") q = q.eq("answered", 1);
    if (opts.answered === "missed") q = q.eq("answered", 0);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    let calls = data ?? [];
    const needle = String(opts.q ?? "").trim().toLowerCase();
    if (needle) {
      calls = calls.filter((x: any) => [x.customer_number, x.customer_unique_id, x.customer_name, x.agent_number]
        .some((v) => String(v ?? "").toLowerCase().includes(needle)));
    }
    return { calls, tableMissing: false };
  } catch (e) {
    if (/doesn't exist|no such table|ret_calls/i.test((e as Error).message ?? "")) return { calls: [], tableMissing: true };
    throw e;
  }
}

// --- raise a call into the WMS ticket system ----------------------------------------------------
const COMPLAINT_API = "https://safestorage.in/back/transport_controller_Dev0/add_internal_complaint_api";
const TASK = { id: "16", assignee: "25213" }; // Retrieval Team + its owner, as used elsewhere

export async function pushCallToWms(id: string, actor: string): Promise<{ ok: boolean; ticketId?: string; error?: string }> {
  if (!hasDb) return { ok: false, error: "db not configured" };
  const c = db();
  const { data: call } = await c.from("ret_calls").select("*").eq("id", id).maybeSingle();
  if (!call) return { ok: false, error: "call not found" };
  if (call.external_ticket_id) return { ok: true, ticketId: String(call.external_ticket_id) };
  // Their API resolves the customer by the BOOKING code (BH…) — the numeric id is rejected.
  if (!call.customer_unique_id) {
    return { ok: false, error: "no booking id on this call — add one first (the ticket system needs it)" };
  }
  const follow = new Date(Date.now() + 86_400_000);
  const dd = String(follow.getDate()).padStart(2, "0"), mm = String(follow.getMonth() + 1).padStart(2, "0");
  const when = String(call.started_at ?? "").slice(0, 16);
  const mins = Math.round((Number(call.duration_sec) || 0) / 60);
  const payload = {
    customer_id: String(call.customer_unique_id),
    customer_contact: String(call.customer_number ?? "").replace(/^\+91/, ""),
    customer_email: "",
    follow_up_date: `${dd}/${mm}/${follow.getFullYear()}`,
    complaint_id: TASK.id,
    assigned_user_id: Number(TASK.assignee),
    assign_user_id: TASK.assignee,
    assigned_to: TASK.assignee,
    user_id: TASK.assignee,
    is_internal: "1",
    from_feedback_calls: "0",
    message: `[Call ${when}] ${call.answered ? `${mins} min call` : "missed call"} from ${call.customer_number ?? ""}`
      + `${call.notes ? ` — ${String(call.notes).slice(0, 200)}` : ""}`
      + `${call.recording_url ? ` · recording: ${call.recording_url}` : ""} (transport module)`,
  };
  try {
    const res = await fetch(COMPLAINT_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const text = await res.text().catch(() => "");
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* non-JSON */ }
    // The API answers HTTP 200 even on failure — success is ONLY {"status":true,…}.
    const ok = res.ok && j && (j.status === true || j.status === "true");
    if (!ok) {
      const err = j?.message || `complaint API ${res.status}: ${text.slice(0, 140)}`;
      try { await c.from("ret_calls").update({ external_error: err }).eq("id", id); } catch { /* column pending */ }
      return { ok: false, error: err };
    }
    const ext = String(j.ticket_id ?? "");
    try {
      await c.from("ret_calls").update({
        external_ticket_id: ext || null, external_error: null,
        external_synced_at: new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "),
        status: call.status === "new" ? "in_progress" : call.status,
      }).eq("id", id);
    } catch { /* run 2026-08-07-retrieval-call-tickets.sql to store the link */ }
    return { ok: true, ticketId: ext };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const EDITABLE = new Set(["status", "assigned_to", "notes", "request_type", "customer_unique_id"]);
export async function updateCall(id: string, patch: Record<string, unknown>) {
  if (!hasDb) return { ok: false, error: "db not configured" };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (EDITABLE.has(k)) clean[k] = v === "" ? null : v;
  if (!Object.keys(clean).length) return { ok: false, error: "nothing to save" };
  const { error } = await db().from("ret_calls").update(clean).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
