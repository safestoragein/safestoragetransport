// Live WMS / transport status per order (for the monitoring view). Reads the same work-order feed
// the booking system updates as a vendor picks retrieval goods from the warehouse (GATE_PASS) and
// completes / brings pickups back. Returns a map keyed by system order_id.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API_BASE = process.env.SAFESTORAGE_API_BASE || "https://safestorage.in/back";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/transport_controller_Dev0/get_work_order_list_api_new`, { next: { revalidate: 60 } });
    const j: any = await res.json();
    const arr: any[] = j?.data || (Array.isArray(j) ? j : []);
    const map: Record<string, { wms: string | null; wmsCode: number | null; status: string | null; transport: number | null }> = {};
    for (const o of arr) {
      const id = String(o.order_id ?? "");
      if (!id) continue;
      map[id] = {
        wms: o.wms_track_status_name ?? null,
        wmsCode: o.wms_track_status != null ? Number(o.wms_track_status) : null,
        status: o.order_status ?? null,
        transport: o.transport_status != null ? Number(o.transport_status) : null,
      };
    }
    return NextResponse.json({ ok: true, map, count: Object.keys(map).length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, map: {} });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
