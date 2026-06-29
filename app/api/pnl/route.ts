// Weekly (date-range) P&L: regular schedule margin (from the latest run per city/date) + the
// manually-recorded intercity profit. GET /api/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
import { NextRequest, NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(req: NextRequest) {
  if (!hasDb) return NextResponse.json({ ok: false, error: "database not configured" }, { status: 500 });
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ ok: false, error: "from and to dates required" }, { status: 400 });

  const c = db();
  const { data: runs } = await c.from("schedule_runs")
    .select("id, schedule_date, city, total_cost, total_margin, total_orders, generated_at")
    .gte("schedule_date", from).lte("schedule_date", to)
    .order("generated_at", { ascending: false });

  // keep only the latest run per (date, city) — matches what the schedule shows
  const latest = new Map<string, any>();
  for (const r of runs ?? []) { const k = `${r.schedule_date}|${r.city}`; if (!latest.has(k)) latest.set(k, r); }
  const runList = [...latest.values()];
  const runIds = runList.map((r) => r.id);

  const profitByRun = new Map<string, number>();
  if (runIds.length) {
    const { data: aps } = await c.from("schedule_assignments").select("run_id, intercity_profit").in("run_id", runIds);
    for (const a of aps ?? []) if (a.intercity_profit != null) profitByRun.set(a.run_id, (profitByRun.get(a.run_id) || 0) + Number(a.intercity_profit));
  }

  const byDate = new Map<string, any>();
  let regularMargin = 0, intercityProfit = 0, regularCost = 0, orders = 0;
  for (const r of runList) {
    const ip = profitByRun.get(r.id) || 0;
    const m = Number(r.total_margin) || 0, cost = Number(r.total_cost) || 0, o = Number(r.total_orders) || 0;
    regularMargin += m; regularCost += cost; intercityProfit += ip; orders += o;
    const d = byDate.get(r.schedule_date) || { date: r.schedule_date, margin: 0, intercityProfit: 0, cost: 0, orders: 0, cities: 0 };
    d.margin += m; d.intercityProfit += ip; d.cost += cost; d.orders += o; d.cities += 1;
    byDate.set(r.schedule_date, d);
  }

  return NextResponse.json({
    ok: true, from, to,
    totals: { regularMargin, intercityProfit, total: regularMargin + intercityProfit, regularCost, orders, days: byDate.size },
    byDate: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
