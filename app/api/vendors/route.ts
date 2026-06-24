// Vendor master API — backs the Vendor Panel.
//   GET                      -> list all vendors (seed + persisted additions/edits)
//   POST  { ...newVendor }   -> add a vendor (persisted to Blob)
//   PATCH { id, ...patch }   -> edit a vendor (e.g. toggle isIntercityVendor)

import { NextRequest, NextResponse } from "next/server";
import { listVendors, addVendor, updateVendor, diagnose } from "@/lib/vendors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("debug") === "1") {
    return NextResponse.json(await diagnose());
  }
  const { vendors, source } = await listVendors();
  return NextResponse.json({ vendors, source });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.name || !body?.city || !body?.vehicleType) {
    return NextResponse.json({ error: "name, city and vehicleType are required" }, { status: 400 });
  }
  const vendor = await addVendor({
    city: body.city,
    name: body.name,
    vehicleType: body.vehicleType,
    startingPoint: body.startingPoint ?? "",
    dailyPrice: body.dailyPrice != null && body.dailyPrice !== "" ? Number(body.dailyPrice) : null,
    pricingNote: body.pricingNote || null,
    isIntercityVendor: !!body.isIntercityVendor,
    tier: body.tier === "non_general" ? "non_general" : "general",
    supervisorName: body.supervisorName || null,
    supervisorContact: body.supervisorContact || null,
    driverName: body.driverName || null,
    driverContact: body.driverContact || null,
    packerNames: body.packerNames || null,
    vehicleNo: body.vehicleNo || null,
    vehicleName: body.vehicleName || null,
    systemTeamNo: body.systemTeamNo || null,
    remarks: body.remarks || null,
  });
  return NextResponse.json({ vendor });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { id, ...patch } = body;
  await updateVendor(id, patch);
  return NextResponse.json({ ok: true });
}
