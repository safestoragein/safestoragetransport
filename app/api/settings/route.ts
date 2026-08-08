// Editable settings. Currently exposes the packing-material cost per pallet.
//   GET  /api/settings                 -> { packingPerPallet }
//   POST /api/settings { packingPerPallet }
import { NextRequest, NextResponse } from "next/server";
import { getPackingPerPallet, setPackingPerPallet, getPackagePerPallet, setPackagePerPallet } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, packingPerPallet: await getPackingPerPallet(), packagePerPallet: await getPackagePerPallet() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  // The P&L's package rate is a separate setting from the scheduler's packing cost.
  if (b?.packagePerPallet != null) {
    const p = Number(b.packagePerPallet);
    if (!Number.isFinite(p) || p < 0) return NextResponse.json({ ok: false, error: "packagePerPallet must be a non-negative number" }, { status: 400 });
    try {
      await setPackagePerPallet(Math.round(p));
      return NextResponse.json({ ok: true, packagePerPallet: Math.round(p) });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }
  const v = Number(b?.packingPerPallet);
  if (!Number.isFinite(v) || v < 0) return NextResponse.json({ ok: false, error: "packingPerPallet must be a non-negative number" }, { status: 400 });
  try {
    await setPackingPerPallet(Math.round(v));
    return NextResponse.json({ ok: true, packingPerPallet: Math.round(v) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
