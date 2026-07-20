// Photos the vendor app captured for orders (team / KYC / delivery / damage), for the office UI.
//   GET /api/schedule/order-photos?ids=<uuid,uuid,…> -> { ok, photos: { [orderUuid]: [{id, kind, createdAt}] } }
//   GET /api/schedule/order-photos?img=<photoId>     -> the image bytes
// Session-protected by the proxy (office logins only).
import { NextRequest, NextResponse } from "next/server";
import { db, hasDb } from "@/lib/db";
import { getOrderPhoto } from "@/lib/vendor-media";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(req: NextRequest) {
  if (!hasDb) return NextResponse.json({ ok: false, error: "db not configured" }, { status: 500 });
  const img = req.nextUrl.searchParams.get("img");
  try {
    if (img) {
      const photo = await getOrderPhoto(img);
      if (!photo) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
      return new NextResponse(new Uint8Array(photo.data), {
        headers: { "Content-Type": photo.contentType, "Cache-Control": "private, max-age=3600" },
      });
    }
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 300);
    if (!ids.length) return NextResponse.json({ ok: true, photos: {} });
    const { data } = await db().from("order_photos").select("id, order_id, kind, created_at").in("order_id", ids).order("created_at", { ascending: true });
    const photos: Record<string, { id: string; kind: string; createdAt: string }[]> = {};
    for (const p of (data ?? []) as any[]) {
      (photos[p.order_id] ??= []).push({ id: p.id, kind: p.kind, createdAt: p.created_at });
    }
    return NextResponse.json({ ok: true, photos });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
