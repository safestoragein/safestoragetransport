// Admin-only, one-off: pull existing vendor documents (external Supabase/Blob URLs stored on
// sst_vendors) INTO MySQL blobs (sst_vendor_documents), then repoint the vendor URL at the
// in-app serving route. Runs inside the app (node:https, no fetch/undici). Safe to re-run.
//
//   Hit /safestorage-transport/api/admin/migrate-vendor-docs while logged in as ADMIN.
import { NextResponse } from "next/server";
import https from "node:https";
import http from "node:http";
import { db, hasDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { withBase } from "@/lib/base";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
function httpGetBinary(url: string): Promise<{ status: number; body: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      { hostname: u.hostname, port: u.port || (u.protocol === "http:" ? 80 : 443), path: u.pathname + u.search, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks), contentType: String(res.headers["content-type"] || "application/octet-stream") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const KINDS: { kind: string; col: string }[] = [
  { kind: "service_agreement", col: "service_agreement_url" },
  { kind: "gst", col: "gst_document_url" },
];

export async function GET() {
  const session = await getSession();
  if (session?.role !== "admin") return NextResponse.json({ ok: false, error: "admin only" }, { status: 403 });
  if (!hasDb) return NextResponse.json({ ok: false, error: "MySQL not configured" }, { status: 500 });

  const results: any[] = [];
  let migrated = 0, skipped = 0, failed = 0;
  try {
    const { data: vendors } = await db().from("vendors").select("id, service_agreement_url, gst_document_url");
    for (const v of (vendors ?? []) as any[]) {
      for (const { kind, col } of KINDS) {
        const url: string | null = v[col];
        if (!url || !/^https?:\/\//i.test(url)) { skipped++; continue; } // empty or already in-app
        try {
          const res = await httpGetBinary(url);
          if (res.status < 200 || res.status >= 300) { failed++; results.push({ id: v.id, kind, error: `HTTP ${res.status}` }); continue; }
          const filename = (url.split("/").pop() || kind).split("?")[0].replace(/[^a-zA-Z0-9._-]/g, "_");
          const { error } = await db().from("vendor_documents").upsert(
            { vendor_id: v.id, kind, filename, content_type: res.contentType, byte_size: res.body.length, data: res.body },
            { onConflict: "vendor_id,kind" },
          );
          if (error) throw new Error(error.message);
          const newUrl = `${withBase(`/api/vendors/doc/${v.id}/${kind}`)}?v=${Date.now()}`;
          await db().from("vendors").update({ [col]: newUrl }).eq("id", v.id);
          migrated++; results.push({ id: v.id, kind, bytes: res.body.length });
        } catch (e) {
          failed++; results.push({ id: v.id, kind, error: (e as Error).message });
        }
      }
    }
    return NextResponse.json({ ok: true, migrated, skipped, failed, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, migrated, skipped, failed }, { status: 500 });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
