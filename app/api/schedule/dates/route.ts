// List the dates that have persisted schedule runs (for the Old-schedules date picker).
//   GET /api/schedule/dates -> { dates: [{ date, runs, orders }] }
import { NextResponse } from "next/server";
import { loadScheduleDates } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, dates: await loadScheduleDates() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
