// GET /api/vendor/assignments?date=YYYY-MM-DD   (Bearer vendor token)
// Returns this vendor's ordered stops for the day — the same jobs the web Today's schedule shows.
import { NextRequest, NextResponse } from "next/server";
import { verifyVendor } from "@/lib/vendor-auth";
import { vendorJobs } from "@/lib/vendor-jobs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const v = verifyVendor(req);
  if (!v) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  try {
    const { published, notifiedAt, jobs } = await vendorJobs(v.vendorId, date);
    return NextResponse.json({ ok: true, date, published, notifiedAt, vendor: { id: v.vendorId, name: v.name }, jobs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
