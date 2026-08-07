// Hourly mailbox → ticket sync. Cron-friendly (the proxy allows the x-vercel-cron header),
// and the Retrieval board's "Sync now" button calls the same thing.
//   GET/POST /api/retrieval/sync
import { NextResponse } from "next/server";
import { syncMailboxes, backfillCustomers } from "@/lib/retrieval-tickets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(req: Request) {
  try {
    const sync = await syncMailboxes();
    // After every sync (and on demand) try to put a booking id on tickets that still lack one.
    const backfill = await backfillCustomers().catch(() => null);
    if (new URL(req.url).searchParams.get("backfillOnly") === "1") {
      return NextResponse.json({ ok: true, backfill });
    }
    return NextResponse.json({ ...sync, backfill });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
