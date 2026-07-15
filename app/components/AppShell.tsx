"use client";

import { useEffect } from "react";
import Sidebar, { NavKey } from "./Sidebar";
import TopBar from "./TopBar";
import { SessionUser } from "@/lib/auth";
import { Country } from "@/lib/country";
import { setActiveCountry, useCountry } from "@/lib/country-store";

// SafeStorage logo orange — the active country tab colour.
const BRAND_ORANGE = "#FF6B35";

const COUNTRIES = [
  { key: "india", label: "India", flag: "🇮🇳", live: true },
  { key: "dubai", label: "Dubai", flag: "🇦🇪", live: true }, // feed pushes city "dubai" — same views as India
  { key: "uk", label: "UK", flag: "🇬🇧", live: false },
] as const;

// The one app frame every signed-in view renders inside: fixed left rail + top bar + content.
// A country switcher sits above the content: all current data is INDIA; Dubai / UK are wired as
// tabs now and light up once their data starts flowing.
export default function AppShell({
  active, user, children,
}: { active: NavKey; user: SessionUser | null; children: React.ReactNode }) {
  const country = useCountry();
  const setCountry = (c: Country) => setActiveCountry(c);
  const sel = COUNTRIES.find((c) => c.key === country) ?? COUNTRIES[0];

  // Session watchdog. The login gate only protects full page loads — once the shell is in the
  // browser, data flows through client fetches, and an EXPIRED session just returns 401s that
  // components swallow (page "loads" but nothing works). Patch fetch once: any 401 from our API
  // → straight to the login page, returning here after sign-in. A focus-time ping catches
  // expiry even on pages that don't poll.
  useEffect(() => {
    const base = location.pathname.startsWith("/safestorage-transport") ? "/safestorage-transport" : "";
    let redirected = false;
    const toLogin = () => {
      if (redirected) return;
      redirected = true;
      const path = location.pathname + location.search;
      const next = base && path.startsWith(base) ? path.slice(base.length) || "/" : path;
      location.href = `${base}/login?next=${encodeURIComponent(next)}`;
    };
    const orig = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await orig(...args);
      try {
        const url = typeof args[0] === "string" ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
        if (res.status === 401 && url.includes("/api/")) toLogin();
      } catch { /* never break the caller */ }
      return res;
    };
    const ping = () => { if (document.visibilityState === "visible") orig(`${base}/api/settings`).then((r) => { if (r.status === 401) toLogin(); }).catch(() => {}); };
    window.addEventListener("focus", ping);
    document.addEventListener("visibilitychange", ping);

    // Usage heartbeat: one beacon per minute while the tab is actually VISIBLE. Powers the
    // admin "Team usage" insights (active time / idle gaps); a hidden tab sends nothing, so
    // leaving the tool open in the background correctly counts as idle.
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      const view = new URLSearchParams(location.search).get("view") || "dashboard";
      orig(`${base}/api/activity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view }), keepalive: true }).catch(() => {});
    };
    beat();
    const beatId = setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", beat);

    return () => {
      window.fetch = orig;
      window.removeEventListener("focus", ping);
      document.removeEventListener("visibilitychange", ping);
      clearInterval(beatId);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar active={active} user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} />
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-white px-4 pb-2.5 pt-2.5 md:px-8">
          {COUNTRIES.map((c) => {
            const on = c.key === country;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCountry(c.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${on ? "text-white shadow-sm" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-orange-50"}`}
                style={on ? { backgroundColor: BRAND_ORANGE } : undefined}
              >
                <span>{c.flag}</span> {c.label}
                {!c.live && <span className={`rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ${on ? "bg-white/25 text-white" : "bg-slate-100 text-slate-400"}`}>soon</span>}
              </button>
            );
          })}
        </div>
        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          {sel.live ? (
            children
          ) : (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
              <div className="text-5xl">{sel.flag}</div>
              <div className="mt-4 text-lg font-bold text-slate-800">{sel.label} — coming soon</div>
              <p className="mt-2 text-sm text-slate-500">
                {sel.label} operations aren&apos;t live yet. Once bookings and vendors for {sel.label} start
                flowing into the system, this tab will show its schedules, day plans and monitoring —
                exactly like India.
              </p>
              <button
                type="button"
                onClick={() => setCountry("india")}
                className="mt-6 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                ← Back to India
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
