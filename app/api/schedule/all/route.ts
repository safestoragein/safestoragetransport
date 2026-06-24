// Load every city's persisted schedule for a date (defaults to TOMORROW, matching the cron).
//   GET /api/schedule/all?date=
import { NextRequest, NextResponse } from "next/server";
import { loadAllSchedules } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export function tomorrow() {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? tomorrow();
  try {
    return NextResponse.json({ ok: true, ...(await loadAllSchedules(date)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
