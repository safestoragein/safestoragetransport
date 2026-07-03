// Detect + pull booking changes that happened AFTER the schedule was generated.
//   GET  /api/schedule/diff?date=YYYY-MM-DD   -> { total, cities:[{city,newOrders,removed,rescheduled}] }
//   POST /api/schedule/diff { date }          -> pull new orders + refresh reschedules into each run
import { NextRequest, NextResponse } from "next/server";
import { hasDb } from "@/lib/db";
import { diffSchedule, syncNewOrders, removeStaleFromRun } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!hasDb) return NextResponse.json({ ok: true, total: 0, cities: [] });
  const date = req.nextUrl.searchParams.get("date");
  if (!date) return NextResponse.json({ ok: false, error: "date required" }, { status: 400 });
  try {
    const d = await diffSchedule(date);
    return NextResponse.json({ ok: true, ...d });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, total: 0, cities: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!hasDb) return NextResponse.json({ ok: false, error: "db not configured" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  if (!b?.date) return NextResponse.json({ ok: false, error: "date required" }, { status: 400 });
  try {
    // Only the cities that actually changed need a resync (adds new orders to the "to assign"
    // bucket + refreshes reschedules; existing manual assignments are preserved).
    const d = await diffSchedule(b.date);
    let added = 0, removed = 0;
    const results = [];
    for (const c of d.cities) {
      const rem = await removeStaleFromRun(c.city, b.date); // drop cancelled / moved-out orders
      const r = await syncNewOrders(c.city, b.date);        // pull new + refresh reschedules
      added += r.added; removed += rem.removed;
      results.push({ city: c.city, added: r.added, removed: rem.removed });
    }
    return NextResponse.json({ ok: true, added, removed, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
