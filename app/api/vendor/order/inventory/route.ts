// GET /api/vendor/order/inventory?orderId=<uuid>   (Bearer vendor token)
// Read-only item list for a job (proxied to the WMS quotation inventory).
import { NextRequest, NextResponse } from "next/server";
import { verifyVendor } from "@/lib/vendor-auth";
import { vendorOwnsOrder, orderInventory } from "@/lib/vendor-media";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const v = verifyVendor(req);
  if (!v) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ ok: false, error: "orderId required" }, { status: 400 });
  if (!(await vendorOwnsOrder(v.vendorId, orderId))) return NextResponse.json({ ok: false, error: "not your order" }, { status: 403 });
  try {
    const { items } = await orderInventory(orderId);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, items: [] }, { status: 500 });
  }
}
