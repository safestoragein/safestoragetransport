// Vendor master API — backs the Vendor Panel.
//   GET                          -> list all vendors (active + inactive)
//   POST  { cities:[...], ... }  -> add a vendor PER city (independent records)
//   PATCH { id, ...patch }       -> edit a vendor (toggle active/intercity, notes, priority, …)
//   DELETE ?id= | { id }         -> delete a vendor

import { NextRequest, NextResponse } from "next/server";
import { listVendors, addVendor, updateVendor, deleteVendor, diagnose } from "@/lib/vendors";
import { normCity } from "@/lib/safestorage-api";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("debug") === "1") {
    return NextResponse.json(await diagnose());
  }
  const { vendors, source } = await listVendors();
  return NextResponse.json({ vendors, source });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(req: NextRequest) {
  const body = await req.json();
  // accept a single `city` or a list of `cities` — one independent record is created per city
  // City names normalise to canonical slugs (lowercase + alias fixes like "Luknow"→"lucknow") —
  // a misspelt city would silently hide the vendor from that city's schedule.
  const rawCities: string[] = Array.isArray(body?.cities) && body.cities.length ? body.cities : (body?.city ? [body.city] : []);
  const cities: string[] = [...new Set(rawCities.map((c) => normCity(c)).filter(Boolean))];
  if (!body?.name || cities.length === 0 || !body?.vehicleType) {
    return NextResponse.json({ error: "name, at least one city, and vehicleType are required" }, { status: 400 });
  }
  const common = {
    name: body.name,
    vehicleType: body.vehicleType,
    palletCapacity: body.palletCapacity != null && body.palletCapacity !== "" ? Number(body.palletCapacity) : null,
    startingPoint: body.startingPoint ?? "",
    dailyPrice: body.dailyPrice != null && body.dailyPrice !== "" ? Number(body.dailyPrice) : null,
    pricingNote: body.pricingNote || null,
    isIntercityVendor: !!body.isIntercityVendor,
    // default: a vendor does local unless it's explicitly intercity-only
    doesLocal: body.doesLocal != null ? !!body.doesLocal : !body.isIntercityVendor,
    appPin: body.appPin != null && body.appPin !== "" ? String(body.appPin).trim() : null,
    tier: body.tier === "non_general" ? ("non_general" as const) : ("general" as const),
    driverName: body.driverName || null,
    driverContact: body.driverContact || null,
    packerNames: body.packerNames || null,
    vehicleNo: body.vehicleNo || null,
    vehicleName: body.vehicleName || null,
    systemTeamNo: body.systemTeamNo || null,
    remarks: body.remarks || null,
    securityDeposit: body.securityDeposit != null && body.securityDeposit !== "" ? Number(body.securityDeposit) : null,
    notes: body.notes || null,
    priorityGroup: body.priorityGroup || null,
    billingCycle: body.billingCycle || null,
    supervisors: Array.isArray(body.supervisors) ? body.supervisors : null,
  };
  try {
    const created = [];
    for (const city of cities) created.push(await addVendor({ city, ...common }));
    return NextResponse.json({ vendors: created, vendor: created[0] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Could not add vendor" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { id, ...patch } = body;
  if (patch.city != null) patch.city = normCity(patch.city); // canonical slug — see POST
  try {
    await updateVendor(id, patch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || (await req.json().catch(() => ({})))?.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteVendor(id);
  return NextResponse.json({ ok: true });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
