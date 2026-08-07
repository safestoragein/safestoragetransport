// Retrieval module — turns the shared mailboxes into tickets.
//
// Every hour we read what is new in retrieval@ / damages@ and either open a ticket or append the
// mail to the thread it belongs to. Priority rises with how many times the CUSTOMER has written in
// (1st = P4 … 4th+ = P1) — chasing a silent ticket is exactly the signal we want to escalate on.
//
// Threading uses Graph's own conversationId (exact), with a sender+normalised-subject fallback for
// customers who start a fresh mail instead of replying — without it, a chasing customer would open
// a new P4 ticket each time, the opposite of what the team needs.
import { randomUUID } from "node:crypto";
import { db, hasDb } from "./db";
import { fetchInbox, graphConfigured, GraphMessage } from "./ms-graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const MAILBOXES: { key: string; address: string; category: string; prefix: string }[] = [
  { key: "retrieval", address: "retrieval@safestorage.in", category: "retrieval", prefix: "RET" },
  { key: "damages", address: "damages@safestorage.in", category: "damage", prefix: "DMG" },
];

// Mail FROM us (the team replying out of the shared box, or another internal address) must never
// count towards the customer's chase count — otherwise answering a customer escalates their ticket.
const isInternal = (addr: string) => /@safestorage\.in\s*$/i.test(String(addr ?? "").trim());

// Out-of-office / bounces are noise: they neither open tickets nor raise priority.
const AUTO_RE = /^(auto(matic)?[- ]?reply|out of (the )?office|automatic reply|undeliverable|delivery status notification|mail delivery)/i;

const PRIORITY_LADDER = ["P4", "P3", "P2", "P1"];
export const priorityFor = (customerMsgs: number) =>
  PRIORITY_LADDER[Math.min(Math.max(customerMsgs, 1), PRIORITY_LADDER.length) - 1];
const rankOf = (p: string) => Math.max(0, PRIORITY_LADDER.indexOf(String(p || "P4")));
const worseOf = (a: string, b: string) => (rankOf(a) >= rankOf(b) ? a : b);

// ---- severity read from the CONTENT -----------------------------------------------------------
// Rule-based, not AI: each rule is a phrase the team would themselves treat as serious. A mail can
// be a first-time message and still deserve P1 — "I am approaching consumer court" should not wait
// for the customer to chase three more times. Severity only ever RAISES priority, never lowers it,
// and the matched phrase is stored so the team can see why.
const SEVERITY_RULES: { level: string; priority: string; label: string; re: RegExp }[] = [
  { level: "critical", priority: "P1", label: "legal action threatened",
    re: /\b(consumer\s*(court|forum)|legal\s*(action|notice|proceed)|lawyer|advocate|attorney|file\s+(a\s+)?(case|fir|police)|police\s+complaint|sue\s+you|court\s+case)\b/i },
  { level: "critical", priority: "P1", label: "public / media escalation threatened",
    re: /\b(social\s*media|twitter|facebook|instagram|linkedin|google\s*review|media|news\s*channel|consumer\s*complaint\s*(site|forum)|publicly)\b.{0,40}\b(post|share|expose|complain|review|escalate)\b|\b(post|share|expose)\b.{0,40}\b(social\s*media|twitter|google\s*review)\b/i },
  { level: "critical", priority: "P1", label: "fraud / cheating alleged",
    re: /\b(fraud|cheat(ed|ing)?|scam|looting|thief|stolen|theft|misappropriat)/i },
  { level: "high", priority: "P2", label: "goods damaged, lost or missing",
    re: /\b(damag(e|ed|es)|broken|breakage|missing|lost|not\s+(received|delivered)|never\s+(received|delivered)|shortage)\b/i },
  { level: "high", priority: "P2", label: "refund or compensation demanded",
    re: /\b(refund|reimburse|compensat|money\s*back|claim\s+(the\s+)?(amount|money)|charge\s*back)\b/i },
  { level: "medium", priority: "P3", label: "no response / repeated follow-up",
    re: /\b(no\s+(response|reply|update|call)|not\s+(responding|replied)|repeatedly|again\s+and\s+again|third\s+time|many\s+times|still\s+waiting|since\s+(last\s+)?(week|month))\b/i },
  { level: "medium", priority: "P3", label: "marked urgent",
    re: /\b(urgent|asap|immediately|at\s+the\s+earliest|top\s+priority|escalat)/i },
];

// ---- what is this mail ABOUT? -----------------------------------------------------------------
// The team's own categories. Checked most-specific first: a mail that reports damage AND asks for a
// slot is a damage report, because that is what needs handling.
export const ISSUE_TYPES: [string, string][] = [
  ["missing_damaged", "Missing / damaged"],
  ["media_request", "Photos / video call"],
  ["retrieval_slot", "Retrieval / slot request"],
  ["other", "Others"],
];
const ISSUE_RULES: { key: string; re: RegExp }[] = [
  { key: "missing_damaged",
    re: /\b(missing|lost|damag(e|ed|es)|broken|breakage|scratch|dent|not\s+(received|delivered)|never\s+(received|delivered)|shortage|claim\s+for|wrong\s+(item|delivery)|incorrect\s+inventory)\b/i },
  { key: "media_request",
    re: /\b(video\s*(call|conference)?|photo(graph)?s?|pic(ture)?s?|image(s)?|show\s+me|see\s+my\s+(items|goods|stuff)|visual|inspect(ion)?|live\s+(view|video)|whatsapp\s+(photo|video|pic))\b/i },
  { key: "retrieval_slot",
    re: /\b(retriev(e|al)|partial\s*retrieval|self[- ]?(retrieval|pickup)|pick\s*up|slot|schedule|book(ing)?\s+(a\s+)?(date|slot|visit)|deliver(y)?\s+(date|request)|want\s+(my|the)\s+(goods|items)|return\s+of\s+goods)\b/i },
];

export function classifyIssue(text: string, mailbox?: string): { key: string; label: string } {
  const t = String(text ?? "").slice(0, 20000);
  for (const r of ISSUE_RULES) {
    if (r.re.test(t)) {
      const label = ISSUE_TYPES.find(([k]) => k === r.key)?.[1] ?? r.key;
      return { key: r.key, label };
    }
  }
  // Nothing matched, but the damages@ box exists for exactly one purpose — treat it as the default
  // there rather than burying a damage report under "Others".
  if (String(mailbox ?? "") === "damages") return { key: "missing_damaged", label: "Missing / damaged" };
  return { key: "other", label: "Others" };
}

export function scoreSeverity(text: string): { level: string; priority: string; reason: string } | null {
  const t = String(text ?? "").slice(0, 20000);
  if (!t.trim()) return null;
  for (const r of SEVERITY_RULES) {
    const m = t.match(r.re);
    if (m) return { level: r.level, priority: r.priority, reason: `${r.label} — “${String(m[0]).trim().slice(0, 60)}”` };
  }
  // Shouting: several ALL-CAPS words, or a pile of exclamation marks.
  const caps = (t.match(/\b[A-Z]{4,}\b/g) ?? []).filter((w) => !/^(FYI|ASAP|PFA|FWD|RE)$/.test(w));
  if (caps.length >= 6 || /!{3,}/.test(t)) return { level: "medium", priority: "P3", reason: "written in capitals / emphatic" };
  return null;
}

const normSubject = (s: string) =>
  String(s ?? "").replace(/^((re|fw|fwd|aw|antwort)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();

const BOOKING_RE = /\b([A-Z]{2,3}\d{4,6})\b/;
// Mail often quotes the work-order number instead ("[WO527063574] Reporting of Damages").
const WO_RE = /\b(?:WO[- ]?)?(\d{9})\b/;
// Addresses that are NOT a customer: our own domain, and the shared gmail the booking system uses
// as a placeholder when a customer has no email of their own. Three live orders carry that gmail,
// so matching on it attached forwarded mail to whichever of those customers came first.
const GENERIC_SENDER = /@safestorage\.in$|^safestorage\.in@gmail\.com$|^info@|^support@|^noreply@|^no-reply@/i;
const addrOf = (r: any) => String(r?.emailAddress?.address ?? "").trim();

// --- ticket numbering -------------------------------------------------------------------------
async function nextTicketNo(prefix: string): Promise<string> {
  const c = db();
  const { data } = await c.from("ret_ticket_seq").select("last_no").eq("prefix", prefix).maybeSingle();
  const next = (Number(data?.last_no) || 0) + 1;
  await c.from("ret_ticket_seq").upsert({ prefix, last_no: next }, { onConflict: "prefix" });
  return `${prefix}-${String(next).padStart(6, "0")}`;
}

// --- who is this? -----------------------------------------------------------------------------
// A booking code in the subject/body is the strongest signal; otherwise match the sender's address
// against the live feed. Best-effort: an unmatched ticket is still perfectly usable.
async function resolveCustomer(text: string, senderEmail: string): Promise<any> {
  const code = (text.match(BOOKING_RE) ?? [])[1];
  const wo = (text.match(WO_RE) ?? [])[1];
  try {
    const { allLiveOrders } = await import("./safestorage-api");
    const feed = await allLiveOrders();
    let hit = code ? feed.find((o: any) => String(o.customer_unique_id ?? "").toUpperCase() === code) : null;
    if (!hit && wo) hit = feed.find((o: any) => String(o.order_id ?? "") === wo);
    // Only trust the sender's address when it actually belongs to a customer.
    if (!hit && senderEmail && !GENERIC_SENDER.test(senderEmail.trim())) {
      const s = senderEmail.toLowerCase();
      hit = feed.find((o: any) => String(o.customer_email ?? "").toLowerCase().trim() === s);
    }
    if (hit) {
      return {
        customer_id: hit.customer_id != null ? String(hit.customer_id) : null,
        customer_unique_id: hit.customer_unique_id ?? code ?? null,
        customer_name: hit.customer_name ?? null,
        contact: [hit.customer_contact1, hit.customer_contact2].filter(Boolean).join(" / ") || null,
        city: String(hit.customer_local_city ?? "").toLowerCase() || null,
        order_id: hit.order_id != null ? String(hit.order_id) : null,
      };
    }
  } catch { /* feed down — keep whatever the code gave us */ }
  return { customer_unique_id: code ?? null };
}

// --- ingest -----------------------------------------------------------------------------------
async function ingestMessage(box: typeof MAILBOXES[number], m: GraphMessage): Promise<"new" | "appended" | "skipped"> {
  const c = db();
  const msgId = String(m.internetMessageId || m.id);
  const { data: dup } = await c.from("ret_ticket_messages").select("id").eq("message_id", msgId).maybeSingle();
  if (dup) return "skipped"; // already ingested — the cursor overlaps deliberately

  const fromAddr = addrOf(m.from);
  const fromName = String(m.from?.emailAddress?.name ?? "");
  const subject = String(m.subject ?? "").slice(0, 480);
  const auto = AUTO_RE.test(subject);
  const inbound = !isInternal(fromAddr);
  const body = String(m.body?.content ?? m.bodyPreview ?? "");

  // find the ticket: conversationId first, then sender + normalised subject within 30 days
  const thread = normSubject(subject);
  let ticket: any = null;
  const { data: byConv } = await c.from("ret_tickets").select("*").eq("root_message_id", m.conversationId).maybeSingle();
  ticket = byConv;
  if (!ticket && thread) {
    const { data: cands } = await c.from("ret_tickets").select("*").eq("thread_key", `${fromAddr}|${thread}`).limit(1);
    const cand = cands?.[0];
    if (cand) {
      const age = Date.now() - new Date(String(cand.created_at).replace(" ", "T")).getTime();
      if (!Number.isFinite(age) || age < 30 * 86_400_000) ticket = cand;
    }
  }

  const receivedIso = String(m.receivedDateTime ?? "").replace("T", " ").replace(/\.\d+Z?$/, "").slice(0, 19);

  if (!ticket) {
    // Our own outbound mail never opens a ticket on its own, and neither does an auto-reply.
    if (!inbound || auto) return "skipped";
    const who = await resolveCustomer(`${subject} ${body}`, fromAddr);
    const id = randomUUID();
    let row: Record<string, unknown> = {
      id,
      ticket_no: await nextTicketNo(box.prefix),
      mailbox: box.key,
      category: box.category,
      subject,
      root_message_id: m.conversationId ?? null,
      thread_key: `${fromAddr}|${thread}`.slice(0, 250),
      from_email: fromAddr, from_name: fromName,
      ...who,
      status: "new",
      priority: priorityFor(1),
      customer_msg_count: 1,
      last_customer_at: receivedIso,
    };
    for (let i = 0; i < 8; i++) {
      const { error } = await c.from("ret_tickets").insert(row);
      if (!error) break;
      const col = (String(error.message || "").match(/[Uu]nknown column '([a-z_]+)'/) || [])[1];
      if (!col || !(col in row)) throw new Error(error.message || "ticket insert failed");
      const { [col]: _drop, ...rest } = row; row = rest;
    }
    ticket = { id, priority: priorityFor(1), customer_msg_count: 1, status: "new" };
    const issue0 = classifyIssue(`${subject}\n${body}`, box.key);
    try { await c.from("ret_tickets").update({ issue_type: issue0.key }).eq("id", id); } catch { /* column pending */ }
    const sev0 = scoreSeverity(`${subject}\n${body}`);
    if (sev0) {
      const p = worseOf(priorityFor(1), sev0.priority);
      try {
        await c.from("ret_tickets").update({ severity: sev0.level, severity_reason: sev0.reason, priority: p }).eq("id", id);
        ticket.priority = p;
      } catch { /* severity columns predate their migration */ }
      if (p !== priorityFor(1)) await logEvent(id, "priority", priorityFor(1), p, "system", sev0.reason);
    }
    await insertMessage(ticket.id, box, m, { inbound, auto, msgId, fromAddr, fromName, subject, body, receivedIso });
    await logEvent(ticket.id, "mail_in", null, subject.slice(0, 180), "system");
    return "new";
  }

  await insertMessage(ticket.id, box, m, { inbound, auto, msgId, fromAddr, fromName, subject, body, receivedIso });

  // A customer who re-sends the SAME mail a few minutes later (common when they get no
  // acknowledgement) is not chasing — count it once so priority isn't inflated by a resend.
  let resend = false;
  if (inbound && !auto) {
    try {
      const key = body.replace(/\s+/g, " ").trim().slice(0, 400);
      const { data: prev } = await c.from("ret_ticket_messages")
        .select("body_text, direction").eq("ticket_id", ticket.id).limit(50);
      resend = (prev ?? []).some((x: any) =>
        x.direction === "inbound" && String(x.body_text ?? "").replace(/\s+/g, " ").trim().slice(0, 400) === key);
    } catch { /* best-effort */ }
  }

  // Priority only moves on a genuine customer follow-up, and only upwards.
  const patch: Record<string, unknown> = {};
  if (inbound && !auto && !resend) {
    const count = (Number(ticket.customer_msg_count) || 0) + 1;
    patch.customer_msg_count = count;
    patch.last_customer_at = receivedIso;
    const sev = scoreSeverity(`${subject}\n${body}`);
    // the worse of "how often they've written" and "how serious this mail reads"
    let next = priorityFor(count);
    if (sev) {
      next = worseOf(next, sev.priority);
      patch.severity = sev.level;
      patch.severity_reason = sev.reason;
    }
    const cur = String(ticket.priority ?? "P4");
    if (!ticket.priority_locked && rankOf(next) > rankOf(cur)) {
      patch.priority = next;
      await logEvent(ticket.id, "priority", cur, next, "system", sev?.reason);
    }
    // A customer writing again re-opens a ticket the team had closed.
    if (["resolved", "closed"].includes(String(ticket.status))) patch.status = "in_progress";
  } else if (inbound && resend) {
    patch.last_customer_at = receivedIso; // still the latest contact, just not a new chase
  } else if (!inbound) {
    patch.last_agent_at = receivedIso;
    if (!ticket.first_response_at) patch.first_response_at = receivedIso;
    if (String(ticket.status) === "new") patch.status = "in_progress";
  }
  if (Object.keys(patch).length) {
    try { await db().from("ret_tickets").update(patch).eq("id", ticket.id); } catch { /* column may predate a migration */ }
  }
  await logEvent(ticket.id, inbound ? "mail_in" : "mail_out", null, subject.slice(0, 180), "system");
  return "appended";
}

async function insertMessage(ticketId: string, box: typeof MAILBOXES[number], m: GraphMessage, x: any) {
  let row: Record<string, unknown> = {
    id: randomUUID(),
    ticket_id: ticketId,
    direction: x.inbound ? "inbound" : "outbound",
    mailbox: box.key,
    message_id: x.msgId,
    remote_id: m.id,
    from_email: x.fromAddr, from_name: x.fromName,
    to_emails: (m.toRecipients ?? []).map(addrOf).filter(Boolean).join(", ") || null,
    cc_emails: (m.ccRecipients ?? []).map(addrOf).filter(Boolean).join(", ") || null,
    subject: x.subject,
    body_text: String(x.body).slice(0, 60000),
    snippet: String(m.bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    is_auto_reply: x.auto ? 1 : 0,
    has_attach: m.hasAttachments ? 1 : 0,
    sent_at: x.receivedIso,
  };
  for (let i = 0; i < 8; i++) {
    const { error } = await db().from("ret_ticket_messages").insert(row);
    if (!error) return;
    const msg = String(error.message || "");
    if (/[Dd]uplicate/.test(msg)) return; // raced with another sync
    const col = (msg.match(/[Uu]nknown column '([a-z_]+)'/) || [])[1];
    if (!col || !(col in row)) return;
    const { [col]: _drop, ...rest } = row; row = rest;
  }
}

export async function logEvent(ticketId: string, kind: string, from: string | null, to: string | null, actor: string, note?: string) {
  try {
    await db().from("ret_ticket_events").insert({
      id: randomUUID(), ticket_id: ticketId, kind, from_value: from, to_value: to, actor, note: note ?? null,
    });
  } catch { /* audit only */ }
}

// --- the hourly job ---------------------------------------------------------------------------
export async function syncMailboxes(): Promise<{ ok: boolean; results: any[]; error?: string }> {
  if (!hasDb) return { ok: false, results: [], error: "db not configured" };
  if (!graphConfigured) return { ok: false, results: [], error: "Microsoft Graph is not configured on the server" };
  const c = db();
  const results: any[] = [];

  for (const box of MAILBOXES) {
    let seen = 0, created = 0, appended = 0;
    try {
      const { data: st } = await c.from("ret_mail_sync").select("*").eq("mailbox", box.key).maybeSingle();
      // Re-read a small overlap so a mail that arrived mid-run is never missed; message_id dedupes.
      const cursor = st?.last_message_at
        ? new Date(new Date(String(st.last_message_at).replace(" ", "T") + "Z").getTime() - 30 * 60_000)
        : new Date(Date.now() - 7 * 86_400_000);
      const since = cursor.toISOString().replace(/\.\d+Z$/, "Z");

      const msgs = await fetchInbox(box.address, since);
      let newest = st?.last_message_at ?? null;
      for (const m of msgs) {
        seen++;
        const r = await ingestMessage(box, m);
        if (r === "new") created++;
        else if (r === "appended") appended++;
        const iso = String(m.receivedDateTime ?? "").replace("T", " ").replace(/\.\d+Z?$/, "").slice(0, 19);
        if (iso && (!newest || iso > newest)) newest = iso;
      }
      await c.from("ret_mail_sync").upsert({
        mailbox: box.key, address: box.address,
        last_message_at: newest, last_synced_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        last_status: "ok", last_error: null,
        messages_seen: (Number(st?.messages_seen) || 0) + seen,
        tickets_created: (Number(st?.tickets_created) || 0) + created,
      }, { onConflict: "mailbox" });
      results.push({ mailbox: box.key, seen, created, appended });
    } catch (e) {
      const msg = (e as Error).message;
      try {
        await c.from("ret_mail_sync").upsert({
          mailbox: box.key, address: box.address, last_status: "error", last_error: msg.slice(0, 400),
          last_synced_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        }, { onConflict: "mailbox" });
      } catch { /* ignore */ }
      results.push({ mailbox: box.key, seen, created, appended, error: msg });
    }
  }
  return { ok: true, results };
}

// --- backfill the booking id on tickets that never matched ------------------------------------
// The live feed only holds TODAY and future orders, so a customer writing about a past booking
// can't be matched from it. This digs through everything else we hold:
//   1. every message in the thread (a reply often quotes the booking id the first mail didn't),
//   2. the work-order number quoted in any message,
//   3. our own order snapshots — matched on the sender's email, then on a phone number in the mail,
//   4. the live feed, same two ways.
// The work-order feed only holds today+future, but feedback_call_orders serves MONTHS of history
// with the booking id, customer id, name and PHONE for every order (no email, unfortunately). It is
// the only wide source we have, so the backfill leans on it for phone and work-order matching.
// Pulled a month at a time — a 3-month request makes their PHP blow up with a regex-size error.
async function feedbackHistory(months = 6): Promise<any[]> {
  const out: any[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    try {
      const res = await fetch(
        `https://safestorage.in/back/transport_controller_Dev0/feedback_call_orders?from_date=${iso(start)}&to_date=${iso(end)}`,
        { cache: "no-store", headers: { Accept: "application/json" } },
      );
      const raw = await res.text();
      // their response can carry a PHP warning block before the JSON
      const from = raw.indexOf("[{");
      const to = raw.lastIndexOf("]");
      if (from < 0 || to <= from) continue;
      const arr = JSON.parse(raw.slice(from, to + 1));
      if (Array.isArray(arr)) out.push(...arr);
    } catch { /* one bad month shouldn't stop the rest */ }
  }
  return out;
}

// Phone -> customer, from months of order history. Shared with the Calls sync.
export async function feedbackPhoneIndex(): Promise<Map<string, any>> {
  const m = new Map<string, any>();
  for (const o of await feedbackHistory()) {
    for (const p of String(o.customer_contact1 ?? "").split(/[/,;]+/)) {
      const d = p.replace(/\D/g, "").slice(-10);
      if (d.length === 10 && !m.has(d)) m.set(d, o);
    }
  }
  return m;
}

export async function backfillCustomers(): Promise<{ ok: boolean; scanned: number; matched: number; historyRows?: number; phones?: number; emails?: number; error?: string }> {
  if (!hasDb) return { ok: false, scanned: 0, matched: 0, error: "db not configured" };
  const c = db();
  // Filter in JS: a booking id can be NULL *or* an empty string, and "IS NULL" alone skipped ~30.
  // Every ticket is rescored for severity; the booking-id lookup only runs on those still missing one.
  // The severity columns may not exist yet — selecting them would fail the WHOLE query and silently
  // scan nothing, so fall back to the columns that certainly exist.
  let all: any[] | null = null;
  let hasSeverity = true, hasIssue = true;
  {
    const r = await c.from("ret_tickets")
      .select("id, from_email, subject, mailbox, customer_unique_id, priority, priority_locked, severity, issue_type").limit(2000);
    if (r.error) {
      hasSeverity = false; hasIssue = false;
      const r2 = await c.from("ret_tickets")
        .select("id, from_email, subject, mailbox, customer_unique_id, priority, priority_locked").limit(2000);
      all = r2.data ?? [];
    } else all = r.data ?? [];
  }
  const tickets = all ?? [];
  if (!tickets.length) return { ok: true, scanned: 0, matched: 0 };

  // our own snapshots first — they cover every customer we've ever scheduled
  const byEmail = new Map<string, any>();
  const byPhone = new Map<string, any>();
  const remember = (o: any) => {
    const em = String(o.customer_email ?? "").toLowerCase().trim();
    if (em && !GENERIC_SENDER.test(em) && !byEmail.has(em)) byEmail.set(em, o);
    for (const p of String(o.contact ?? o.customer_contact1 ?? "").split(/[/,;]+/)) {
      const d = p.replace(/\D/g, "").slice(-10);
      if (d.length === 10 && !byPhone.has(d)) byPhone.set(d, o);
    }
  };
  try {
    const { data: ours } = await c.from("orders").select("customer_unique_id, customer_name, customer_email, contact, city").limit(20000);
    for (const o of (ours ?? []) as any[]) remember(o);
  } catch { /* the email column may predate its migration */ }
  try {
    const { allLiveOrders } = await import("./safestorage-api");
    for (const o of await allLiveOrders()) {
      remember({ ...o, contact: o.customer_contact1, customer_email: o.customer_email });
    }
  } catch { /* feed down — our own snapshots still help */ }

  // …and months of history, which is where most of these customers actually live.
  const byWo = new Map<string, any>();
  const history = await feedbackHistory();
  for (const o of history) {
    remember({ ...o, contact: o.customer_contact1 });
    const wo = String(o.order_id ?? "").trim();
    if (wo && !byWo.has(wo)) byWo.set(wo, o);
  }

  let matched = 0;
  for (const t of tickets as any[]) {
    const { data: msgs } = await c.from("ret_ticket_messages").select("body_text, subject").eq("ticket_id", t.id);
    const text = [t.subject, ...(msgs ?? []).map((m: any) => `${m.subject ?? ""} ${m.body_text ?? ""}`)].join(" \n ");
    const patch: Record<string, unknown> = {};

    // Re-read the issue type and severity from everything the customer has written on this ticket.
    if (hasIssue) patch.issue_type = classifyIssue(text, String(t.mailbox ?? "")).key;
    const sev = scoreSeverity(text);
    if (sev) {
      if (hasSeverity) { patch.severity = sev.level; patch.severity_reason = sev.reason; }
      const cur = String(t.priority ?? "P4");
      if (!t.priority_locked && rankOf(sev.priority) > rankOf(cur)) patch.priority = sev.priority;
    }

    const needsId = !String(t.customer_unique_id ?? "").trim();
    const code = needsId ? (text.match(BOOKING_RE) ?? [])[1] : null;
    if (code) patch.customer_unique_id = code;

    // a quoted work-order number ("[WO527063574]") resolves through the history
    if (needsId && !patch.customer_unique_id) {
      const wo = (text.match(WO_RE) ?? [])[1];
      const h = wo ? byWo.get(wo) : null;
      if (h?.customer_unique_id) {
        patch.customer_unique_id = h.customer_unique_id;
        if (h.customer_name) patch.customer_name = h.customer_name;
        if (h.customer_contact1) patch.contact = h.customer_contact1;
      }
    }

    if (needsId && !patch.customer_unique_id) {
      const em = String(t.from_email ?? "").toLowerCase().trim();
      const hit = (em && !GENERIC_SENDER.test(em) ? byEmail.get(em) : null)
        // a phone number in the signature is the next best clue
        ?? (() => {
          for (const m of text.match(/\b[6-9]\d{9}\b/g) ?? []) { const h = byPhone.get(m); if (h) return h; }
          return null;
        })();
      if (hit?.customer_unique_id) {
        patch.customer_unique_id = hit.customer_unique_id;
        if (hit.customer_name) patch.customer_name = hit.customer_name;
        if (hit.contact ?? hit.customer_contact1) patch.contact = hit.contact ?? hit.customer_contact1;
        if (hit.city ?? hit.customer_local_city) patch.city = String(hit.city ?? hit.customer_local_city).toLowerCase();
      }
    }
    if (!Object.keys(patch).length) continue;
    try {
      await c.from("ret_tickets").update(patch).eq("id", t.id);
      if (patch.customer_unique_id) {
        await logEvent(t.id, "backfill", null, String(patch.customer_unique_id), "system");
        matched++;
      }
      if (patch.priority) await logEvent(t.id, "priority", String(t.priority ?? ""), String(patch.priority), "system", String(patch.severity_reason ?? ""));
    } catch { /* skip this one */ }
  }
  return {
    ok: true, scanned: tickets.length, matched, historyRows: history.length,
    phones: byPhone.size, emails: byEmail.size,
    ...(hasSeverity ? {} : { error: "severity columns missing — run 2026-08-07-retrieval-severity.sql (priorities still updated)" }),
  };
}

// --- reading for the UI -------------------------------------------------------------------------
export async function listTickets(opts: { status?: string | null; priority?: string | null; mailbox?: string | null; q?: string | null }) {
  if (!hasDb) return { tickets: [], tableMissing: false };
  try {
    let q = db().from("ret_tickets").select("*").order("created_at", { ascending: false }).limit(400);
    if (opts.status && opts.status !== "All") q = q.eq("status", opts.status);
    if (opts.priority && opts.priority !== "All") q = q.eq("priority", opts.priority);
    if (opts.mailbox && opts.mailbox !== "All") q = q.eq("mailbox", opts.mailbox);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    let tickets = data ?? [];
    const needle = String(opts.q ?? "").trim().toLowerCase();
    if (needle) {
      tickets = tickets.filter((t: any) => [t.ticket_no, t.subject, t.from_email, t.customer_unique_id, t.customer_id, t.customer_name]
        .some((v) => String(v ?? "").toLowerCase().includes(needle)));
    }
    return { tickets, tableMissing: false };
  } catch (e) {
    if (/doesn't exist|no such table|ret_tickets/i.test((e as Error).message ?? "")) return { tickets: [], tableMissing: true };
    throw e;
  }
}

export async function ticketThread(id: string) {
  if (!hasDb) return { ticket: null, messages: [] };
  const c = db();
  const { data: t } = await c.from("ret_tickets").select("*").eq("id", id).maybeSingle();
  const { data: ms } = await c.from("ret_ticket_messages").select("*").eq("ticket_id", id).order("sent_at", { ascending: true });
  return { ticket: t ?? null, messages: ms ?? [] };
}

const EDITABLE = new Set([
  "status", "priority", "assigned_to", "followup_date", "followup_notes", "resolution_notes",
  "category", "issue_type", "customer_unique_id", "customer_id", "contact",
]);

export async function updateTicket(id: string, patch: Record<string, unknown>, actor: string) {
  if (!hasDb) return { ok: false, error: "db not configured" };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (EDITABLE.has(k)) clean[k] = v === "" ? null : v;
  if (!Object.keys(clean).length) return { ok: false, error: "nothing to save" };
  // A hand-set priority pins the ticket: the automatic chase-bump stops fighting the team.
  if ("priority" in clean) clean.priority_locked = 1;
  if ("status" in clean && clean.status === "resolved") {
    clean.resolved_at = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  }
  const { error } = await db().from("ret_tickets").update(clean).eq("id", id);
  if (error) return { ok: false, error: error.message };
  for (const [k, v] of Object.entries(clean)) {
    if (k === "priority_locked" || k === "resolved_at") continue;
    await logEvent(id, k, null, String(v ?? ""), actor);
  }
  return { ok: true };
}

// --- push to the WMS ticket system ---------------------------------------------------------------
const COMPLAINT_API = "https://safestorage.in/back/transport_controller_Dev0/add_internal_complaint_api";
// Retrieval Team / Escalation Team task ids + their owners, as used by the feedback module.
const TASK = { retrieval: { id: "16", assignee: "25213" }, damage: { id: "18", assignee: "36476" } };

export async function pushTicketToWms(id: string, actor: string): Promise<{ ok: boolean; ticketId?: string; error?: string }> {
  if (!hasDb) return { ok: false, error: "db not configured" };
  const c = db();
  const { data: t } = await c.from("ret_tickets").select("*").eq("id", id).maybeSingle();
  if (!t) return { ok: false, error: "ticket not found" };
  if (t.external_ticket_id) return { ok: true, ticketId: String(t.external_ticket_id) };
  // Their API resolves the customer by the UNIQUE id (BH…) — the numeric customer_id is rejected
  // with "No active customer found for this Customer Unique ID" (learned in the feedback module).
  if (!t.customer_unique_id) return { ok: false, error: "no booking id on this ticket — add one before raising it in the WMS" };

  const task = TASK[String(t.category) as keyof typeof TASK] ?? TASK.retrieval;
  const follow = new Date(Date.now() + 86_400_000);
  const dd = String(follow.getDate()).padStart(2, "0"), mm = String(follow.getMonth() + 1).padStart(2, "0");
  const payload = {
    customer_id: String(t.customer_unique_id),
    customer_contact: String(t.contact ?? "").split(/[/,]/)[0].trim(),
    customer_email: String(t.from_email ?? ""),
    follow_up_date: `${dd}/${mm}/${follow.getFullYear()}`,
    complaint_id: task.id,
    assigned_user_id: Number(task.assignee),
    assign_user_id: task.assignee,
    assigned_to: task.assignee,
    user_id: task.assignee,
    is_internal: "1",
    from_feedback_calls: "0",
    message: `[${t.ticket_no}] ${String(t.subject ?? "").slice(0, 200)} — from ${t.mailbox}@safestorage.in (transport module)`,
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
      await c.from("ret_tickets").update({ external_error: err }).eq("id", id);
      return { ok: false, error: err };
    }
    const ext = String(j.ticket_id ?? "");
    await c.from("ret_tickets").update({
      external_ticket_id: ext || null, external_error: null,
      external_synced_at: new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "),
    }).eq("id", id);
    await logEvent(id, "external_sync", null, ext, actor);
    return { ok: true, ticketId: ext };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
