// Auth gate for the Transport module. (In Next 16 the `middleware` convention was renamed to
// `proxy`, and Proxy now runs on the Node.js runtime — so node:crypto session verification works
// here.) Unauthenticated page requests are redirected to /login; API requests get a 401.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public: the login page, the auth endpoints, and the booking webhook (secured by its own secret).
  if (pathname === "/login" || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/webhooks/")) return NextResponse.next();

  // Vercel Cron hits GET /api/schedule/generate with no session — allow it via its platform header.
  if (pathname.startsWith("/api/schedule/generate") && request.headers.get("x-vercel-cron")) return NextResponse.next();

  const user = verifySession(request.cookies.get(COOKIE_NAME)?.value);
  if (user) return NextResponse.next();

  // Not authenticated.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals, the logo, and favicon (static assets shouldn't be gated).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|safestorage-logo).*)"],
};
