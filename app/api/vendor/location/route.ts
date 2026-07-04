// POST /api/vendor/location  { lat, lng, accuracy? }   (Bearer vendor token)
// The app posts this every ~45s while a job is active. Latest row per vendor = current position,
// which Today's schedule pins on the map.
import { NextRequest, NextResponse } from "next/server";
import { verifyVendor } from "@/lib/vendor-auth";
import { recordVendorLocation } from "@/lib/vendor-jobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const v = verifyVendor(req);
  if (!v) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const lat = Number(b?.lat), lng = Number(b?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ ok: false, error: "lat and lng are required" }, { status: 400 });
  try {
    await recordVendorLocation(v.vendorId, lat, lng, b?.accuracy != null ? Number(b.accuracy) : null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
