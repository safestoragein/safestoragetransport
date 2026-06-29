// Post-cutoff booking changes (from the webhook) for the team to action manually.
//   GET  /api/schedule/changes?date=YYYY-MM-DD          -> unhandled changes for that day
//   POST { action: "handle", id }                       -> dismiss one change
//   POST { action: "sync", date }                       -> pull net-new orders into each city's run
//                                                          (to-assign bucket) and mark changes handled
import { NextRequest, NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { syncNewOrders } from "@/lib/schedule";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(req: NextRequest) {
  if (!hasDb) return NextResponse.json({ ok: false, error: "db not configured", changes: [] });
  const date = req.nextUrl.searchParams.get("date");
  let q = db().from("schedule_changes").select("*").eq("handled", false).order("received_at", { ascending: false }).limit(200);
  if (date) q = q.eq("service_date", date);
  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message, changes: [] });
  return NextResponse.json({ ok: true, changes: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!hasDb) return NextResponse.json({ ok: false, error: "db not configured" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const c = db();
  try {
    if (b.action === "handle") {
      if (!b.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const { error } = await c.from("schedule_changes").update({ handled: true }).eq("id", b.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "sync") {
      if (!b.date) return NextResponse.json({ ok: false, error: "date required" }, { status: 400 });
      const { data: ch } = await c.from("schedule_changes").select("city").eq("service_date", b.date).eq("handled", false);
      const cities = [...new Set((ch ?? []).map((x: any) => (x.city ? String(x.city).toLowerCase() : null)).filter(Boolean))] as string[];
      let added = 0; const results: any[] = [];
      for (const city of cities) { const r = await syncNewOrders(city, b.date); added += r.added; results.push({ city, ...r }); }
      await c.from("schedule_changes").update({ handled: true }).eq("service_date", b.date).eq("handled", false);
      return NextResponse.json({ ok: true, added, results });
    }
    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
