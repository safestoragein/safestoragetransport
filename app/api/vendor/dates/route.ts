// GET /api/vendor/dates   (Bearer vendor token)
// The service dates this vendor has (notified) schedules for — powers the app's history date filter.
import { NextRequest, NextResponse } from "next/server";
import { verifyVendor } from "@/lib/vendor-auth";
import { vendorDates } from "@/lib/vendor-jobs";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const v = verifyVendor(req);
  if (!v) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ ok: true, dates: await vendorDates(v.vendorId) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
