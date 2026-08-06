// Hourly mailbox → ticket sync. Cron-friendly (the proxy allows the x-vercel-cron header),
// and the Retrieval board's "Sync now" button calls the same thing.
//   GET/POST /api/retrieval/sync
import { NextResponse } from "next/server";
import { syncMailboxes } from "@/lib/retrieval-tickets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run() {
  try {
    return NextResponse.json(await syncMailboxes());
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
