// Retrieval calls (Knowlarity).
//   GET   /api/retrieval/calls?status=&answered=&q=   -> list
//   POST  /api/retrieval/calls { action:"sync" }      -> pull new calls
//   PATCH /api/retrieval/calls { id, ...fields }      -> status / owner / notes
import { NextRequest, NextResponse } from "next/server";
import { listCalls, syncCalls, updateCall, pushCallToWms } from "@/lib/retrieval-calls";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    return NextResponse.json({ ok: true, ...(await listCalls({ status: p.get("status"), answered: p.get("answered"), q: p.get("q") })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, calls: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (b?.action === "push") {
    if (!b?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    const user = await getSession();
    const r = await pushCallToWms(String(b.id), user?.name ?? user?.email ?? "team");
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (b?.action !== "sync") return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  const r = await syncCalls();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const { id, ...patch } = b;
  return NextResponse.json(await updateCall(String(id), patch));
}
