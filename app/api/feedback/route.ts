// Feedback & escalations.
//   GET   /api/feedback?from=YYYY-MM-DD&to=YYYY-MM-DD&city=   -> completed orders + feedback rows
//   PATCH /api/feedback { orderUuid, remarks?, source_of_lead?, outcome?, assigned_team?, resolved_status? }
import { NextRequest, NextResponse } from "next/server";
import { loadFeedbackBoard, saveFeedback } from "@/lib/feedback";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const from = p.get("from") || weekAgo;
  const to = p.get("to") || today;
  try {
    const { rows, feedbackTableMissing } = await loadFeedbackBoard(from, to, p.get("city"));
    return NextResponse.json({ ok: true, from, to, rows, feedbackTableMissing });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, rows: [] }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b?.orderUuid) return NextResponse.json({ ok: false, error: "orderUuid required" }, { status: 400 });
  const { orderUuid, sysOrderId, wmsCustomerId, ...patch } = b;
  const r = await saveFeedback(String(orderUuid), patch, { sysOrderId, wmsCustomerId });
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
