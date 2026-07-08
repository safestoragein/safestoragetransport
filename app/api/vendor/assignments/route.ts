// GET /api/vendor/assignments?date=YYYY-MM-DD   (Bearer vendor token)
// Returns this vendor's ordered stops for the day — the same jobs the web Today's schedule shows.
import { NextRequest, NextResponse } from "next/server";
import { verifyVendor } from "@/lib/vendor-auth";
import { vendorJobs } from "@/lib/vendor-jobs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const v = verifyVendor(req);
  if (!v) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  // No date → the vendor's current (latest notified) schedule. A date → that day's schedule (history).
  const date = req.nextUrl.searchParams.get("date");
  try {
    const r = await vendorJobs(v.vendorId, date);
    return NextResponse.json({ ok: true, published: r.published, tentative: r.tentative, notifiedAt: r.notifiedAt, date: r.date, vendor: { id: v.vendorId, name: v.name }, jobs: r.jobs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
