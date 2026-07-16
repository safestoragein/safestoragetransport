// PUBLIC per-order tracking data (the customer's share link). The order UUID is the token —
// unguessable, and the response carries only what a customer may see about THEIR order:
// booking ref, step status, vendor team name, destination area, and the truck's live position
// (only while the job is actively running).
import { NextRequest, NextResponse } from "next/server";
import { db, hasDb, isUuid } from "@/lib/db";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STEPS_PICKUP = [["en_route", "Team on the way"], ["arrived", "Team at your location"], ["loaded", "Goods loaded"], ["delivered", "Stored at warehouse"]];
const STEPS_RETR = [["collected", "Goods collected from warehouse"], ["en_route", "Team on the way"], ["arrived", "Team at your location"], ["loaded", "Goods delivered"], ["delivered", "Completed"]];
const ORDER = ["assigned", "collected", "en_route", "arrived", "packing", "loaded", "delivered"];

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasDb || !isUuid(id)) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const c = db();
  const { data: o } = await c.from("orders").select("id, customer_unique_id, order_type, live_status, locality, lat, lng, city, schedule_date").eq("id", id).maybeSingle();
  if (!o) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // The assigned vendor (latest assignment row for this order).
  const { data: assigns } = await c.from("schedule_assignments").select("vendor_id, vendor_name, id").eq("order_id", id).order("id", { ascending: false }).limit(5);
  const a = (assigns ?? []).find((x: any) => x.vendor_id || x.vendor_name);

  // Live truck position — only meaningful while the job is running and the ping is fresh (<3h).
  let live: { lat: number; lng: number; ageMin: number } | null = null;
  const status = String(o.live_status ?? "assigned");
  if (a?.vendor_id && status !== "delivered" && status !== "assigned") {
    const { data: locs } = await c.from("vendor_locations").select("lat, lng, recorded_at").eq("vendor_id", a.vendor_id).order("recorded_at", { ascending: false }).limit(1);
    const l = locs?.[0];
    if (l) {
      const t = new Date(String(l.recorded_at).replace(" ", "T") + (String(l.recorded_at).includes("Z") ? "" : "Z")).getTime();
      const age = Math.round((Date.now() - t) / 60_000);
      if (!isNaN(age) && age <= 180) live = { lat: Number(l.lat), lng: Number(l.lng), ageMin: Math.max(0, age) };
    }
  }

  const isRet = /retriev/i.test(String(o.order_type ?? ""));
  const steps = (isRet ? STEPS_RETR : STEPS_PICKUP).map(([key, label]) => ({
    key, label,
    done: ORDER.indexOf(status === "packing" ? "arrived" : status) >= ORDER.indexOf(key),
  }));

  return NextResponse.json({
    ok: true,
    ref: o.customer_unique_id,
    type: isRet ? "retrieval" : "pickup",
    status,
    delivered: status === "delivered",
    steps,
    vendor: a?.vendor_name ?? null,
    destination: o.lat != null && o.lng != null ? { lat: Number(o.lat), lng: Number(o.lng), label: o.locality ?? null } : null,
    live,
  });
}
