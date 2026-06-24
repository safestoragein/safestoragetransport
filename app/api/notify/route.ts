// Log a notification (vendor or customer). WhatsApp send is stubbed until keys/templates arrive.
//   POST /api/notify  body { runId, kind:'vendor'|'customer', vendorId?, orderId? }
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b?.runId || !b?.kind) return NextResponse.json({ ok: false, error: "runId and kind required" }, { status: 400 });
  try {
    const c = db();
    // TODO: send the WhatsApp message here once keys + templates are provided.
    const { error } = await c.from("notifications").insert({
      run_id: b.runId,
      vendor_id: b.vendorId ?? null,
      order_id: b.orderId ?? null,
      kind: b.kind,
      channel: "whatsapp",
      status: "sent", // becomes the real send result once WhatsApp is wired
      detail: "logged (WhatsApp send pending keys)",
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, sentAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
