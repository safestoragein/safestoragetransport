// POST /api/auth/logout → clear the session cookie (and record the session end).
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { logActivity } from "@/lib/usage";

export async function POST(req: NextRequest) {
  const user = await getSession();
  if (user) {
    const fwd = req.headers.get("x-forwarded-for");
    await logActivity(user, "logout", null, fwd ? fwd.split(",")[0].trim() : null);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
