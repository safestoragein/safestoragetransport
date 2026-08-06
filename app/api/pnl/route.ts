// Weekly (date-range) P&L: regular schedule margin (from the latest run per city/date) + the
// manually-recorded intercity profit. GET /api/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
import { NextRequest, NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { REGION } from "@/lib/config";

const RESOURCE_COST = REGION.resourceCost;
const EXTRA_TRIP_COST = REGION.extraTripCost;

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
  // REVENUE IS RE-READ, NOT FROZEN. run.total_margin was calculated at 6 AM, when every pickup was
  // still quoted; the amount actually INVOICED is only known once the goods are counted later that
  // day. So we re-total the revenue from the order rows as they stand now (the sync refreshes them
  // from the feed) and recompute margin against the run's vendor cost.
  const revenueByRun = new Map<string, number>();
  const addOnByRun = new Map<string, number>();
  if (runIds.length) {
    const { data: aps } = await c.from("schedule_assignments").select("run_id, order_id, stop_seq, intercity_profit").in("run_id", runIds);
    for (const a of aps ?? []) if (a.intercity_profit != null) profitByRun.set(a.run_id, (profitByRun.get(a.run_id) || 0) + Number(a.intercity_profit));

    // one revenue count per order: skip co-team rows (stop_seq -1) and duplicate assignments
    const seen = new Set<string>();
    const pairs: { run: string; order: string }[] = [];
    for (const a of (aps ?? []) as any[]) {
      if (!a.order_id || a.stop_seq === -1) continue;
      const k = `${a.run_id}|${a.order_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push({ run: a.run_id, order: a.order_id });
    }
    const orderIds = [...new Set(pairs.map((p) => p.order))];
    const chargeById = new Map<string, number>();
    for (let i = 0; i < orderIds.length; i += 500) {
      const { data: ords } = await c.from("orders").select("id, transport_charge").in("id", orderIds.slice(i, i + 500));
      for (const o of (ords ?? []) as any[]) chargeById.set(String(o.id), Number(o.transport_charge) || 0);
    }
    for (const p of pairs) revenueByRun.set(p.run, (revenueByRun.get(p.run) || 0) + (chargeById.get(String(p.order)) || 0));

    // resources / extra trips the team added after the run was generated
    try {
      const { data: addons } = await c.from("schedule_vendor_addons").select("run_id, resources, extra_trips").in("run_id", runIds);
      for (const a of (addons ?? []) as any[]) {
        const extra = (Number(a.resources) || 0) * RESOURCE_COST + (Number(a.extra_trips) || 0) * EXTRA_TRIP_COST;
        if (extra) addOnByRun.set(a.run_id, (addOnByRun.get(a.run_id) || 0) + extra);
      }
    } catch { /* add-ons table missing → cost stays as generated */ }
  }

  const byDate = new Map<string, any>();
  let regularMargin = 0, intercityProfit = 0, regularCost = 0, orders = 0;
  let regularRevenue = 0;
  for (const r of runList) {
    const ip = profitByRun.get(r.id) || 0;
    const cost = (Number(r.total_cost) || 0) + (addOnByRun.get(r.id) || 0);
    const o = Number(r.total_orders) || 0;
    // Fall back to the frozen margin only when a run has no order rows to total (very old runs).
    const rev = revenueByRun.get(r.id);
    const m = rev != null ? rev - cost : (Number(r.total_margin) || 0);
    const revenue = rev ?? (Number(r.total_margin) || 0) + cost;
    regularMargin += m; regularCost += cost; regularRevenue += revenue; intercityProfit += ip; orders += o;
    const d = byDate.get(r.schedule_date) || { date: r.schedule_date, margin: 0, intercityProfit: 0, cost: 0, revenue: 0, orders: 0, cities: 0 };
    d.margin += m; d.intercityProfit += ip; d.cost += cost; d.revenue += revenue; d.orders += o; d.cities += 1;
    byDate.set(r.schedule_date, d);
  }

  return NextResponse.json({
    ok: true, from, to,
    totals: { regularMargin, intercityProfit, total: regularMargin + intercityProfit, regularCost, regularRevenue, orders, days: byDate.size },
    byDate: [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
