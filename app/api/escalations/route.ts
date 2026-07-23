// Escalations.
//   GET   /api/escalations?from=&to=            -> escalation rows (raised_at range)
//   GET   /api/escalations?keys=k1,k2           -> { keys: { orderKey: {id,status} } } for the Feedback chips
//   POST  /api/escalations { orderKey, issue, escalationType, customer… } -> create (one per order)
//   PATCH /api/escalations { id, ...fields }    -> update ETA / status / fault side / cost / resolution
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listEscalations, escalationKeys, createEscalation, updateEscalation } from "@/lib/escalations";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const keys = p.get("keys");
  try {
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
  if (!b?.orderKey || !String(b.issue ?? "").trim()) {
    return NextResponse.json({ ok: false, error: "orderKey and issue are required" }, { status: 400 });
  }
  const user = await getSession();
  const r = await createEscalation({
    orderKey: String(b.orderKey),
    customerUniqueId: b.customerUniqueId ?? null,
    customerName: b.customerName ?? null,
    contact: b.contact ?? null,
    city: b.city ?? null,
    orderType: b.orderType ?? null,
    isIntercity: !!b.isIntercity,
    escalationType: b.escalationType ?? null,
    issue: String(b.issue).trim(),
    raisedBy: user?.name ?? user?.email ?? null,
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
