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

  // Vendor mobile app: its own Bearer-token auth (see lib/vendor-auth). Not gated by the admin cookie.
  if (pathname.startsWith("/api/vendor/")) return NextResponse.next();

  // Customer live-tracking page + its data: PUBLIC by design (the link is shared with customers).
  // The order UUID in the URL is the unguessable token; the endpoint returns only that order's
  // minimal tracking data.
  if (pathname.startsWith("/track/") || pathname.startsWith("/api/track/")) return NextResponse.next();

  // Vercel Cron hits GET /api/schedule/generate with no session — allow it via its platform header.
  // /api/schedule/diff gets the same bypass so ops can force a snapshot resync (e.g. repairing a
  // bad geocode pin in place) without a browser session.
  if ((pathname.startsWith("/api/schedule/generate") || pathname.startsWith("/api/schedule/diff") || pathname.startsWith("/api/schedule/rate-sync")) && request.headers.get("x-vercel-cron")) return NextResponse.next();

  const user = verifySession(request.cookies.get(COOKIE_NAME)?.value);
  if (user) {
    // Read-only enforcement: only admins may change data. Non-admins (role !== 'admin')
    // can view everything (GET) but any write to an API route is rejected. Public API
    // routes (/api/auth/*, /api/webhooks/*) already returned above.
    const isWrite = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (isWrite && pathname.startsWith("/api/") && user.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Read-only account — admin access required to make changes." }, { status: 403 });
    }
    return NextResponse.next();
  }

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
