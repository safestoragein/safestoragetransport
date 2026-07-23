// NIGHTLY RATE SYNC — pickups get REPRICED during the day (vendor confirms lift/floor/loading
// distance in the app, extra items added on the ground), so the amounts frozen in the schedule
// snapshot go stale. This endpoint re-pulls every order of the day's runs from the live feed and
// updates the stored rates, so Old Schedules show the FINAL revised amounts (and revenue totals
// follow automatically, since they are computed from the stored charges).
//
//   GET /api/schedule/rate-sync            -> sync TODAY's runs (IST), all cities
//   GET /api/schedule/rate-sync?date=YYYY-MM-DD
//
// Meant for a daily cPanel cron (~23:30 IST — completed orders drop out of the feed soon after the
// day ends, so the sweep must run before midnight):
//   curl -s -H "x-vercel-cron: 1" "https://safestorage.in/safestorage-transport/api/schedule/rate-sync"
// Assignments are NEVER touched — only the order snapshots (charges, lift/floor, RM, …) refresh.
import { NextRequest, NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { syncNewOrders } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(req: NextRequest) {
  if (!hasDb) return NextResponse.json({ ok: false, error: "db not configured" }, { status: 500 });
  // Default to TODAY in IST (the server clock may be UTC).
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  const date = req.nextUrl.searchParams.get("date") || istNow.toISOString().slice(0, 10);
  try {
    const { data: runs } = await db().from("schedule_runs").select("city").eq("schedule_date", date);
    const cities: string[] = [...new Set<string>((runs ?? []).map((r: any) => String(r.city)))];
    const results: any[] = [];
    for (const city of cities) {
      try {
        const r = await syncNewOrders(city, date); // refreshes ALL order snapshots + adds net-new as unassigned
        results.push({ city, ok: true, added: r.added, error: r.error });
      } catch (e) {
        results.push({ city, ok: false, error: (e as Error).message });
      }
    }
    return NextResponse.json({ ok: true, date, cities: cities.length, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
