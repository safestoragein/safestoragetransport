// Full customer addresses for the per-vendor supervisor report (the schedule snapshot only keeps
// a short locality — the report card needs the complete address the way the old tool showed it).
//   GET /api/schedule/report?city=<slug>&date=YYYY-MM-DD -> { ok, addresses: { <ref>: <full address> } }
import { NextRequest, NextResponse } from "next/server";
import { loadLiveRaw } from "@/lib/safestorage-api";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(req: NextRequest) {
  const city = req.nextUrl.searchParams.get("city");
  const date = req.nextUrl.searchParams.get("date");
  if (!city || !date) return NextResponse.json({ ok: false, error: "city and date required" }, { status: 400 });
  try {
    const rows = await loadLiveRaw(city, date);
    const addresses: Record<string, string> = {};
    for (const o of rows as any[]) {
      const ref = o.customer_unique_id || `SH-${String(o.order_id ?? "").slice(-6)}`;
      if (ref && o.order_address) addresses[ref] = String(o.order_address);
    }
    return NextResponse.json({ ok: true, addresses });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, addresses: {} });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
