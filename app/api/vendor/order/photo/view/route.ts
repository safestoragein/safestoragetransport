// GET /api/vendor/order/photo/view?id=<photoId>   (Bearer vendor token) → the image bytes.
// Lets the app SHOW captured photos (damage / delivery / KYC / team) back to the vendor.
import { NextRequest, NextResponse } from "next/server";
import { verifyVendor } from "@/lib/vendor-auth";
import { vendorOwnsOrder, getOrderPhoto } from "@/lib/vendor-media";
import { db, hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const v = verifyVendor(req);
  if (!v) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !hasDb) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    // Ownership: the photo's order must belong to this vendor.
    const { data } = await db().from("order_photos").select("order_id").eq("id", id).limit(1);
    const orderId = (data?.[0] as { order_id?: string } | undefined)?.order_id;
    if (!orderId || !(await vendorOwnsOrder(v.vendorId, orderId))) {
      return NextResponse.json({ ok: false, error: "not your photo" }, { status: 403 });
    }
    const photo = await getOrderPhoto(id);
    if (!photo) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(photo.data), {
      headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
