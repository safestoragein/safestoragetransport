// Load the persisted schedule for a city + date.
//   GET /api/schedule?city=&date=
import { NextRequest, NextResponse } from "next/server";
import { loadSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const city = p.get("city") ?? "bangalore";
  const date = p.get("date") ?? new Date().toISOString().slice(0, 10);
  try {
    return NextResponse.json({ ok: true, schedule: await loadSchedule(city, date) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
