// Upload a vendor document (service agreement / GST) to Vercel Blob and store its URL on the vendor.
//   POST multipart/form-data { file, vendorId, kind: "service_agreement" | "gst" }
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { updateVendor } from "@/lib/vendors";

export const dynamic = "force-dynamic";

const FIELD: Record<string, "serviceAgreementUrl" | "gstDocumentUrl"> = {
  service_agreement: "serviceAgreementUrl",
  gst: "gstDocumentUrl",
};

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const vendorId = String(form.get("vendorId") || "");
  const kind = String(form.get("kind") || "");
  const field = FIELD[kind];

  if (!(file instanceof File) || !vendorId || !field) {
    return NextResponse.json({ ok: false, error: "file, vendorId and a valid kind are required" }, { status: 400 });
  }

  const safeName = (file.name || `${kind}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "_");
  try {
    const blob = await put(`vendor-docs/${vendorId}/${kind}-${safeName}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type || "application/octet-stream",
    });
    await updateVendor(vendorId, { [field]: blob.url });
    return NextResponse.json({ ok: true, url: blob.url, field });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
