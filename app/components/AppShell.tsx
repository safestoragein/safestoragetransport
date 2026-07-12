"use client";

import { useState } from "react";
import Sidebar, { NavKey } from "./Sidebar";
import TopBar from "./TopBar";
import { SessionUser } from "@/lib/auth";

// SafeStorage logo orange — the active country tab colour.
const BRAND_ORANGE = "#FF6B35";

const COUNTRIES = [
  { key: "india", label: "India", flag: "🇮🇳", live: true },
  { key: "dubai", label: "Dubai", flag: "🇦🇪", live: false },
  { key: "uk", label: "UK", flag: "🇬🇧", live: false },
] as const;
type CountryKey = (typeof COUNTRIES)[number]["key"];

// The one app frame every signed-in view renders inside: fixed left rail + top bar + content.
// A country switcher sits above the content: all current data is INDIA; Dubai / UK are wired as
// tabs now and light up once their data starts flowing.
export default function AppShell({
  active, user, children,
}: { active: NavKey; user: SessionUser | null; children: React.ReactNode }) {
  const [country, setCountry] = useState<CountryKey>("india");
  const sel = COUNTRIES.find((c) => c.key === country)!;
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
