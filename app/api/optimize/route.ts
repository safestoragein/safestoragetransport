// Real-time / programmatic optimisation endpoint.
//   GET /api/optimize?city=bangalore&date=YYYY-MM-DD   -> live optimisation result as JSON
//   GET /api/optimize?src=sample                       -> synthetic demo result
// This is what a real-time front-end (or the existing system) polls during the day.

import { NextRequest, NextResponse } from "next/server";
import { loadSample, loadLive } from "@/lib/safestorage-api";
import { optimize } from "@/lib/optimizer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("src") === "sample") {
    const snap = await loadSample(new Date().toISOString().slice(0, 10));
    return NextResponse.json(optimize(snap.date, snap.city, snap.bookings, snap.vendors));
  }
  const city = p.get("city") ?? "bangalore";
  const date = p.get("date") ?? new Date().toISOString().slice(0, 10);
  const snap = await loadLive(city, date);
  const result = optimize(snap.date, snap.city, snap.bookings, snap.vendors);
  return NextResponse.json({ source: snap.source, meta: snap.meta, ...result });
}
