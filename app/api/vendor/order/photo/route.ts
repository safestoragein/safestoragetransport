// Vendor app KYC / pickup / delivery proof photos.
//   POST /api/vendor/order/photo   multipart { orderId, kind, file }   -> store
//   GET  /api/vendor/order/photo?orderId=<uuid>                        -> list (metadata)
import { NextRequest, NextResponse } from "next/server";
import { verifyVendor } from "@/lib/vendor-auth";
import { vendorOwnsOrder, saveOrderPhoto, listOrderPhotos } from "@/lib/vendor-media";

export const dynamic = "force-dynamic";

const KINDS = ["team", "kyc", "pickup", "delivery", "damage"];

export async function POST(req: NextRequest) {
  const v = verifyVendor(req);
  if (!v) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "expected multipart form" }, { status: 400 });
  const orderId = String(form.get("orderId") || "");
  const kind = String(form.get("kind") || "");
  const file = form.get("file");
  if (!orderId || !KINDS.includes(kind)) return NextResponse.json({ ok: false, error: "orderId and a valid kind are required" }, { status: 400 });
  if (!(file instanceof Blob)) return NextResponse.json({ ok: false, error: "file is required" }, { status: 400 });
  if (!(await vendorOwnsOrder(v.vendorId, orderId))) return NextResponse.json({ ok: false, error: "not your order" }, { status: 403 });
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 12 * 1024 * 1024) return NextResponse.json({ ok: false, error: "image too large (max 12MB)" }, { status: 413 });
    await saveOrderPhoto({
      orderUuid: orderId, vendorId: v.vendorId, kind, data: buf,
      filename: (file as any).name || `${kind}.jpg`, contentType: file.type || "image/jpeg",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const v = verifyVendor(req);
  if (!v) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!orderId) return NextResponse.json({ ok: false, error: "orderId required" }, { status: 400 });
  if (!(await vendorOwnsOrder(v.vendorId, orderId))) return NextResponse.json({ ok: false, error: "not your order" }, { status: 403 });
  try {
    return NextResponse.json({ ok: true, photos: await listOrderPhotos(orderId) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, photos: [] }, { status: 500 });
  }
}
