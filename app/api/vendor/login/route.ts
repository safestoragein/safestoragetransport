// POST /api/vendor/login  { phone, pin }  ->  { ok, token, vendor:{id,name,city} }
// Used by the Flutter vendor app. Public route (see proxy.ts); the returned token authorises
// every other /api/vendor/* call as a Bearer token.
import { NextRequest, NextResponse } from "next/server";
import { vendorLogin, issueVendorToken } from "@/lib/vendor-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { phone, pin } = await req.json().catch(() => ({}));
  if (!phone || !pin) return NextResponse.json({ ok: false, error: "phone and pin are required" }, { status: 400 });
  try {
    const id = await vendorLogin(String(phone), String(pin));
    if (!id) return NextResponse.json({ ok: false, error: "Invalid phone or PIN" }, { status: 401 });
    const token = issueVendorToken(id);
    return NextResponse.json({ ok: true, token, vendor: { id: id.vendorId, name: id.name, city: id.city } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
