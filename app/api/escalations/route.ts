// Escalations.
//   GET   /api/escalations?from=&to=            -> escalation rows (raised_at range)
//   GET   /api/escalations?keys=k1,k2           -> { keys: { orderKey: {id,status} } } for the Feedback chips
//   POST  /api/escalations { orderKey, issue, escalationType, customer… } -> create (one per order)
//   PATCH /api/escalations { id, ...fields }    -> update ETA / status / fault side / cost / resolution
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { randomUUID } from "node:crypto";
import { listEscalations, escalationKeys, createEscalation, updateEscalation, lookupCustomer } from "@/lib/escalations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const keys = p.get("keys");
  const lookup = p.get("lookup");
  try {
    if (lookup != null) return NextResponse.json({ ok: true, customer: await lookupCustomer(lookup) });
    if (keys != null) {
      const map = await escalationKeys(keys.split(",").map((s) => s.trim()).filter(Boolean));
      return NextResponse.json({ ok: true, keys: map });
    }
    const { rows, tableMissing } = await listEscalations(p.get("from"), p.get("to"));
    return NextResponse.json({ ok: true, rows, tableMissing });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, rows: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  // Manual entries have no order to hang off — they get their own key so several issues can be
  // logged for the same customer (the Feedback route still passes the order's key).
  const orderKey = b?.orderKey || (b?.manual ? `manual:${randomUUID()}` : null);
  if (!orderKey || !String(b.issue ?? "").trim()) {
    return NextResponse.json({ ok: false, error: "orderKey (or manual) and issue are required" }, { status: 400 });
  }
  const user = await getSession();
  const r = await createEscalation({
    orderKey: String(orderKey),
    customerId: b.customerId != null ? String(b.customerId) : null,
    customerUniqueId: b.customerUniqueId ?? null,
    customerName: b.customerName ?? null,
    contact: b.contact ?? null,
    city: b.city ?? null,
    orderType: b.orderType ?? null,
    isIntercity: !!b.isIntercity,
    escalationType: b.escalationType ?? null,
    issue: String(b.issue).trim(),
    raisedBy: user?.name ?? user?.email ?? null,
    vendorName: b.vendorName ?? null,
    eta: b.eta ?? null,
    status: b.status ?? null,
  });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const { id, ...patch } = b;
  const r = await updateEscalation(String(id), patch);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
