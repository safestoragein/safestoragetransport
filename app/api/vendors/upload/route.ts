// Upload a vendor document (service agreement / GST). The file BYTES are stored in MySQL
// (sst_vendor_documents.data LONGBLOB); the vendor row keeps a URL pointing at the serving
// route below, so the existing UI (<a href={url}>) keeps working.
//   POST multipart/form-data { file, vendorId, kind: "service_agreement" | "gst" }
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { updateVendor } from "@/lib/vendors";
import { withBase } from "@/lib/base";

export const dynamic = "force-dynamic";

const FIELD: Record<string, "serviceAgreementUrl" | "gstDocumentUrl"> = {
  service_agreement: "serviceAgreementUrl",
  gst: "gstDocumentUrl",
};

// Guard against oversized blobs (MySQL max_allowed_packet, and it's a single INSERT).
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const vendorId = String(form.get("vendorId") || "");
  const kind = String(form.get("kind") || "");
  const field = FIELD[kind];

  if (!(file instanceof File) || !vendorId || !field) {
    return NextResponse.json({ ok: false, error: "file, vendorId and a valid kind are required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 413 });
  }

  const safeName = (file.name || `${kind}`).replace(/[^a-zA-Z0-9._-]/g, "_");
  try {
    const data = Buffer.from(await file.arrayBuffer());
    const { error } = await db().from("vendor_documents").upsert(
      {
        vendor_id: vendorId,
        kind,
        filename: safeName,
        content_type: file.type || "application/octet-stream",
        byte_size: data.length,
        data,
      },
      { onConflict: "vendor_id,kind" },
    );
    if (error) throw new Error(error.message);

    // Point the vendor's URL at the serving route; ?v busts the browser cache on replace.
    const url = `${withBase(`/api/vendors/doc/${vendorId}/${kind}`)}?v=${Date.now()}`;
    await updateVendor(vendorId, { [field]: url });
    return NextResponse.json({ ok: true, url, field });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
