"use client";

// Team usage insights (ADMIN only) — mirrors the collections-team dashboard style: per user per
// day, logins & timings, active time on the tool, and the idle gaps in red.
import { useCallback, useEffect, useState } from "react";
import { SessionUser } from "@/lib/auth";
import AppShell from "./AppShell";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const clock = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? String(s).slice(11, 16) : d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${Math.round(min % 60)}m` : `${Math.round(min)}m`);
const VIEW_LABEL: Record<string, string> = {
  dashboard: "Dashboard", today: "Today's schedule", schedule: "Tomorrow's schedule",
  history: "Old schedules", vendors: "Vendor panel", feedback: "Feedback", rules: "Rules", usage: "Team usage",
};

export default function UsageBoard({ user }: { user: SessionUser | null }) {
  const [date, setDate] = useState(istToday());
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const isAdmin = user?.role === "admin";

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/activity?date=${date}`).then((x) => x.json()).catch(() => null);
    setUsers(r?.users ?? []);
    setTableMissing(!!r?.tableMissing);
    setLoading(false);
  }, [date]);
  useEffect(() => { if (isAdmin) load(); }, [load, isAdmin]);

  if (!isAdmin) {
    return (
      <AppShell active="usage" user={user}>
        <Card className="p-8 text-center text-sm text-slate-500">Team usage insights are visible to admin logins only.</Card>
      </AppShell>
    );
  }

  return (
    <AppShell active="usage" user={user}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Team usage</h1>
          <p className="text-xs text-slate-500">logins · time on the tool · idle gaps — measured only while the tab is on screen</p>
        </div>
        <input type="date" value={date} max={istToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium" />
      </header>

      {tableMissing && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          ⚠ Run the <code>2026-07-16-user-activity.sql</code> migration (phpMyAdmin) — tracking starts once the table exists.
        </div>
      )}

      {loading ? (
        <Card className="p-8 text-center text-sm text-slate-500">Loading usage…</Card>
      ) : users.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">No activity recorded on {date}.</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {users.map((u, i) => {
            const initial = String(u.name ?? u.email ?? "?").trim().charAt(0).toUpperCase();
            const gapsOpen = open === u.userId;
            return (
              <Card key={u.userId} className={`p-5 ${u.gaps.length ? "ring-1 ring-red-100" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{i + 1}</span>
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-lg font-bold text-amber-700">{initial}</span>
                    <div>
                      <div className="text-base font-bold text-slate-900">{u.name ?? u.email ?? u.userId}</div>
                      <div className="text-xs text-slate-400">{u.email ?? ""}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-extrabold text-slate-900">{dur(u.activeMin)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Active on tool</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                  <div><div className="text-xs text-slate-400">Logins</div><div className="font-bold text-slate-800">{u.loginCount}</div></div>
                  <div><div className="text-xs text-slate-400">First login</div><div className="font-bold text-slate-800">{clock(u.firstLogin ?? u.firstSeen)}</div></div>
                  <div><div className="text-xs text-slate-400">Last seen</div><div className="font-bold text-slate-800">{clock(u.lastSeen)}</div></div>
                  <div><div className="text-xs text-slate-400">Usage window</div><div className="font-bold text-slate-800">{clock(u.firstSeen)}–{clock(u.lastSeen)}</div></div>
                </div>

                {/* idle gaps — red banner, expandable, like the reference dashboard */}
                {u.gaps.length > 0 ? (
                  <button
                    onClick={() => setOpen(gapsOpen ? null : u.userId)}
                    className="mt-4 flex w-full items-center justify-between rounded-xl bg-red-600 px-4 py-2.5 text-left text-sm font-bold text-white hover:bg-red-700"
                  >
                    <span>🕐 {u.gaps.length} idle gap{u.gaps.length > 1 ? "s" : ""} · {dur(u.idleTotalMin)} total</span>
                    <span>{gapsOpen ? "Hide ▲" : "Show ▼"}</span>
                  </button>
                ) : (
                  <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">✓ no idle gaps</div>
                )}
                {gapsOpen && (
                  <div className="mt-2 space-y-1.5 rounded-xl bg-red-50 p-3">
                    {u.gaps.map((g: any, gi: number) => (
                      <div key={gi} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">{gi + 1}</span>
                        <span className="font-semibold text-slate-800">{clock(g.from)} – {clock(g.to)}</span>
                        <span className="ml-auto rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{dur(g.minutes)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* where the time went + login sessions + IPs */}
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  {Object.entries(u.views as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([v, m]) => (
                    <span key={v} className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">{VIEW_LABEL[v] ?? v} · {dur(m)}</span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  {u.logins.map((l: any, li: number) => <span key={li}>→ login {clock(l.at)}{l.ip ? ` · ${l.ip}` : ""}</span>)}
                  {u.logins.length === 0 && u.ips.length > 0 && <span>IP {u.ips.join(", ")}</span>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
