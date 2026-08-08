// Retrieval tickets.
//   GET   /api/retrieval/tickets?status=&priority=&mailbox=&q=  -> list
//   GET   /api/retrieval/tickets?id=<uuid>                      -> one ticket + its mail thread
//   PATCH /api/retrieval/tickets { id, ...fields }              -> edit (status/priority/owner/follow-up)
//   POST  /api/retrieval/tickets { id, action:"push" }          -> raise it in the WMS ticket system
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listTickets, ticketThread, updateTicket, pushTicketToWms } from "@/lib/retrieval-tickets";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const id = p.get("id");
    if (id) return NextResponse.json({ ok: true, ...(await ticketThread(id)) });
    return NextResponse.json({
      ok: true,
      ...(await listTickets({ status: p.get("status"), priority: p.get("priority"), mailbox: p.get("mailbox"), q: p.get("q") })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, tickets: [] }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const user = await getSession();
  const { id, ...patch } = b;
  return NextResponse.json(await updateTicket(String(id), patch, user?.name ?? user?.email ?? "team"));
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b?.id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const user = await getSession();
  if (b.action === "push") {
    const r = await pushTicketToWms(String(b.id), user?.name ?? user?.email ?? "team", b.team);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
