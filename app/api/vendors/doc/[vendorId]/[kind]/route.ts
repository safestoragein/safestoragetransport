// Stream a vendor document stored in MySQL (sst_vendor_documents.data LONGBLOB).
//   GET /api/vendors/doc/<vendorId>/<kind>
// Behind the auth gate (proxy.ts), so compliance docs stay private. Read-only users can view.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ vendorId: string; kind: string }> }) {
  const { vendorId, kind } = await ctx.params;
  try {
    const { data, error } = await db()
      .from("vendor_documents")
      .select("*")
      .eq("vendor_id", vendorId)
      .eq("kind", kind)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || !data.data) {
      return NextResponse.json({ ok: false, error: "document not found" }, { status: 404 });
    }
    // mysql2 returns LONGBLOB as a Buffer (a Uint8Array), which is a valid response body.
    const bytes: Buffer = data.data;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": data.content_type || "application/octet-stream",
        "Content-Disposition": `inline; filename="${(data.filename || kind).replace(/"/g, "")}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
