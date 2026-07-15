// Usage tracking.
//   POST /api/activity { view }   -> heartbeat from the signed-in user's visible tab (1/min)
//   GET  /api/activity?date=      -> ADMIN-only aggregated usage insights for that day
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logActivity, loadUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string | null {
  const f = req.headers.get("x-forwarded-for");
  return f ? f.split(",")[0].trim() : null;
}

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  await logActivity(user, "beat", typeof b?.view === "string" ? b.view.slice(0, 50) : null, clientIp(req));
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ ok: false, error: "admins only" }, { status: 403 });
  const date = req.nextUrl.searchParams.get("date") || new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const r = await loadUsage(date);
  return NextResponse.json({ ok: true, date, ...r });
}
