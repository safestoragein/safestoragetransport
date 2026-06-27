"use client";

import { useState } from "react";
import { SessionUser } from "@/lib/auth";

export type NavKey = "dashboard" | "today" | "schedule" | "history" | "vendors" | "rules";

// Items inside the "Pickup & Retrieval" module group (expand/collapse in the rail).
const ITEMS: { key: NavKey; label: string; href: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", href: "/?view=dashboard", icon: "M3 13h8V3H3zm10 8h8V3h-8zM3 21h8v-6H3z" },
  { key: "today", label: "Today's schedule", href: "/?view=today", icon: "M12 8v4l3 2 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" },
  { key: "schedule", label: "Tomorrow's schedule", href: "/?view=schedule", icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" },
  { key: "history", label: "Old schedules", href: "/?view=history", icon: "M3 3v5h5M3.05 13A9 9 0 1 0 6 5.3L3 8m9-1v5l4 2" },
  { key: "vendors", label: "Vendor panel", href: "/?view=vendors", icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  { key: "rules", label: "Scheduling rules", href: "/?view=rules", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2zM9 7h7M9 11h7" },
];

export default function Sidebar({ active, user }: { active: NavKey; user: SessionUser | null }) {
  const [open, setOpen] = useState(true);
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
  const initials = (user?.name || "?").trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <aside className="flex shrink-0 flex-col border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:border-b-0 lg:border-r">
      {/* logo */}
      <div className="px-5 pt-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/safestorage-logo.png" alt="SafeStorage" className="h-12 w-auto" />
        <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Smart Transport · Ops</div>
      </div>

      {/* nav */}
      <nav className="flex-1 px-3 py-4">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0">
            <path d="M1 3h13v10H1zM14 8h4l3 3v2h-7zM5.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
          </svg>
          <span className="flex-1 text-left">Pickup &amp; Retrieval</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {open && (
          <div className="mt-1 space-y-0.5 border-l border-slate-100 pl-2">
            {ITEMS.map((n) => {
              const on = active === n.key;
              return (
                <a
                  key={n.key}
                  href={n.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    on ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0">
                    <path d={n.icon} />
                  </svg>
                  {n.label}
                </a>
              );
            })}
          </div>
        )}

        <div className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="flex-1">More modules</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">soon</span>
        </div>
      </nav>

      {/* signed-in user + logout */}
      <div className="border-t border-slate-100 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-800">{user?.name || "Signed in"}</div>
            <div className="truncate text-xs text-slate-400">{user?.email || ""}</div>
          </div>
          <button onClick={logout} title="Log out" aria-label="Log out" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
