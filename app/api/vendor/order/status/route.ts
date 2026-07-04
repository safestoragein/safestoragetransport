// POST /api/vendor/order/status  { orderId, status, lat?, lng?, note? }   (Bearer vendor token)
// The vendor taps a button ("started to customer", "started packing", …). We append an event with
// their GPS and advance the order's live status, which Today's schedule then shows.
import { NextRequest, NextResponse } from "next/server";
import { verifyVendor } from "@/lib/vendor-auth";
import { recordOrderEvent, JOB_STATUSES } from "@/lib/vendor-jobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const v = verifyVendor(req);
  if (!v) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b?.orderId || !b?.status) return NextResponse.json({ ok: false, error: "orderId and status are required" }, { status: 400 });
  if (!(JOB_STATUSES as readonly string[]).includes(b.status) && b.status !== "note") {
    return NextResponse.json({ ok: false, error: `unknown status '${b.status}'` }, { status: 400 });
  }
  try {
    await recordOrderEvent({
      vendorId: v.vendorId, orderId: String(b.orderId), event: String(b.status),
      lat: b.lat != null ? Number(b.lat) : null, lng: b.lng != null ? Number(b.lng) : null,
      note: b.note ? String(b.note) : null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
