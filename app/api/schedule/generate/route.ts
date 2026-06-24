// Generate (or regenerate) the optimised schedule for a city + date and persist it.
//   POST /api/schedule/generate   body { city, date }     (manual button)
//   GET  /api/schedule/generate?city=&date=&trigger=cron  (Vercel Cron)
import { NextRequest, NextResponse } from "next/server";
import { generateSchedule } from "@/lib/schedule";
import { listLiveCities } from "@/lib/safestorage-api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(city: string | null, date: string, trigger: "cron" | "manual") {
  if (city) return [{ city, ...(await generateSchedule(city, date, trigger)) }];
  // no city -> all cities that have orders that date
  const cities = (await listLiveCities(date)).filter((c) => c.count > 0);
  const out = [];
  for (const c of cities) out.push({ city: c.slug, ...(await generateSchedule(c.slug, date, trigger)) });
  return out;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const date = body.date ?? new Date().toISOString().slice(0, 10);
  try {
    return NextResponse.json({ ok: true, runs: await run(body.city ?? null, date, "manual") });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  // Cron runs at cut-off (night before) and schedules the NEXT day by default.
  const offsetDays = p.get("for") === "today" ? 0 : 1;
  const base = new Date(Date.now() + offsetDays * 86_400_000);
  const date = p.get("date") ?? base.toISOString().slice(0, 10);
  try {
    return NextResponse.json({ ok: true, runs: await run(p.get("city"), date, "cron") });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
