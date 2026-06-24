// Editable settings. Currently exposes the packing-material cost per pallet.
//   GET  /api/settings                 -> { packingPerPallet }
//   POST /api/settings { packingPerPallet }
import { NextRequest, NextResponse } from "next/server";
import { getPackingPerPallet, setPackingPerPallet } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, packingPerPallet: await getPackingPerPallet() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const v = Number(b?.packingPerPallet);
  if (!Number.isFinite(v) || v < 0) return NextResponse.json({ ok: false, error: "packingPerPallet must be a non-negative number" }, { status: 400 });
  try {
    await setPackingPerPallet(Math.round(v));
    return NextResponse.json({ ok: true, packingPerPallet: Math.round(v) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
