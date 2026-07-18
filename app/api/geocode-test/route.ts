// Diagnostic: is GOOGLE_MAPS_API_KEY loaded, and does Google accept it?
//   GET /api/geocode-test?q=<address>   (session-protected by the proxy)
// Returns the key presence + Google's raw status/error so env-vs-key problems are distinguishable.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(req: NextRequest) {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? "";
  const q = req.nextUrl.searchParams.get("q") || "Prestige Tranquility, Budigere Road, Bangalore";
  if (!key) return NextResponse.json({ ok: false, keyPresent: false, hint: "GOOGLE_MAPS_API_KEY is NOT in the app environment — check the variable name and that it's on the right Node.js app, then restart." });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=in&components=country:IN&key=${key}`;
    const r = await fetch(url);
    const j: any = await r.json();
    const res = j?.results?.[0];
    return NextResponse.json({
      ok: j?.status === "OK",
      keyPresent: true,
      keyTail: key.slice(-6),
      googleStatus: j?.status ?? null,
      errorMessage: j?.error_message ?? null,
      location: res?.geometry?.location ?? null,
      formatted: res?.formatted_address ?? null,
      types: res?.types ?? null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, keyPresent: true, fetchError: (e as Error).message });
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
