// GET /api/schedule/inventory?orderUuid=<uuid>   (admin, cookie-authed like the other schedule APIs)
// Lazily fetch a booking's inventory item list from the WMS (pickups → quotation inventory,
// retrievals → goods list). Only called when the office expands "Inventory" on a schedule card.
import { NextRequest, NextResponse } from "next/server";
import { orderInventory } from "@/lib/vendor-media";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const orderUuid = req.nextUrl.searchParams.get("orderUuid");
  if (!orderUuid) return NextResponse.json({ ok: false, error: "orderUuid required" }, { status: 400 });
  try {
    const { items } = await orderInventory(orderUuid);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, items: [] }, { status: 500 });
  }
}
