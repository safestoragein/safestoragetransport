// Hourly mailbox → ticket sync. Cron-friendly (the proxy allows the x-vercel-cron header),
// and the Retrieval board's "Sync now" button calls the same thing.
//   GET/POST /api/retrieval/sync
import { NextResponse } from "next/server";
import { syncMailboxes, backfillCustomers } from "@/lib/retrieval-tickets";
import { syncCalls } from "@/lib/retrieval-calls";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(req: Request) {
  try {
    // ?days=N re-reads that many days of mail instead of resuming from the cursor — used to pick up
    // messages an earlier version of the filter skipped. message_id dedupes, so it is safe to re-run.
    const days = Number(new URL(req.url).searchParams.get("days")) || 0;
    const sync = await syncMailboxes(days > 0 ? { sinceDays: days } : undefined);
    // After every sync (and on demand) try to put a booking id on tickets that still lack one.
    const backfill = await backfillCustomers().catch(() => null);
    if (new URL(req.url).searchParams.get("backfillOnly") === "1") {
      return NextResponse.json({ ok: true, backfill });
    }
    const calls = await syncCalls().catch((e) => ({ ok: false, error: (e as Error).message }));
    return NextResponse.json({ ...sync, backfill, calls });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
export const GET = run;
export const POST = run;
