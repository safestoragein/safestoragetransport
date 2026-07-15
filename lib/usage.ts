// Team usage insights (ADMIN-only view): who logged in when, how long they actually used the
// tool, and where the idle gaps were. Fed by login/logout events plus a 1-minute heartbeat the
// app sends while its tab is visible — so "active time" means the tool was actually on screen.
import { db, hasDb } from "./db";

/* eslint-disable @typescript-eslint/no-explicit-any */

const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

export async function logActivity(user: { id: string; email?: string | null; name?: string | null }, event: "login" | "beat" | "logout", view?: string | null, ip?: string | null): Promise<void> {
  if (!hasDb) return;
  try {
    await db().from("user_activity").insert({
      user_id: String(user.id), email: user.email ?? null, name: user.name ?? null,
      event, view: view ?? null, ip: ip ?? null, at: istNow(),
    });
  } catch { /* table not migrated yet / DB down — tracking is best-effort */ }
}

export interface UsageGap { from: string; to: string; minutes: number }
export interface UserUsage {
  userId: string; email: string | null; name: string | null;
  loginCount: number; firstLogin: string | null; lastLogin: string | null;
  firstSeen: string | null; lastSeen: string | null; windowMin: number;
  activeMin: number; idleTotalMin: number;
  gaps: UsageGap[];              // idle gaps ≥ 15 min inside the activity window (longest first)
  views: Record<string, number>; // ~minutes spent per page
  ips: string[];
  logins: { at: string; ip: string | null }[];
}

const IDLE_GAP_MIN = 15;   // a pause this long counts as an idle gap
const ACTIVE_CAP_MIN = 5;  // gaps up to this long still count as continuous usage

export async function loadUsage(date: string): Promise<{ users: UserUsage[]; tableMissing: boolean }> {
  if (!hasDb) return { users: [], tableMissing: false };
  const from = `${date} 00:00:00`, to = `${date} 23:59:59`;
  let rows: any[] = [];
  try {
    const { data, error } = await db().from("user_activity").select("*").gte("at", from).lte("at", to).order("at", { ascending: true });
    if (error) throw new Error(error.message);
    rows = data ?? [];
  } catch { return { users: [], tableMissing: true }; }

  const byUser = new Map<string, any[]>();
  for (const r of rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id)!.push(r);
  }

  const users: UserUsage[] = [];
  for (const [userId, evs] of byUser) {
    const logins = evs.filter((e) => e.event === "login");
    const acts = evs.filter((e) => e.event !== "logout"); // logins + beats = signs of life
    const t = (s: string) => new Date(String(s).replace(" ", "T")).getTime();
    let activeMin = 0, idleTotalMin = 0;
    const gaps: UsageGap[] = [];
    for (let i = 1; i < acts.length; i++) {
      const gapMin = (t(acts[i].at) - t(acts[i - 1].at)) / 60_000;
      if (gapMin <= ACTIVE_CAP_MIN) activeMin += gapMin;
      else {
        activeMin += 1; // the earlier beat itself still represents ~a minute of use
        idleTotalMin += gapMin;
        if (gapMin >= IDLE_GAP_MIN) gaps.push({ from: String(acts[i - 1].at), to: String(acts[i].at), minutes: Math.round(gapMin) });
      }
    }
    if (acts.length > 0) activeMin += 1; // count the final beat
    const views: Record<string, number> = {};
    for (const e of evs) if (e.event === "beat" && e.view) views[e.view] = (views[e.view] ?? 0) + 1;
    const first = acts[0]?.at ?? null, last = acts[acts.length - 1]?.at ?? null;
    users.push({
      userId,
      email: evs.find((e) => e.email)?.email ?? null,
      name: evs.find((e) => e.name)?.name ?? null,
      loginCount: logins.length,
      firstLogin: logins[0]?.at ?? null,
      lastLogin: logins[logins.length - 1]?.at ?? null,
      firstSeen: first, lastSeen: last,
      windowMin: first && last ? Math.round((t(last) - t(first)) / 60_000) : 0,
      activeMin: Math.round(activeMin),
      idleTotalMin: Math.round(idleTotalMin),
      gaps: gaps.sort((a, b) => b.minutes - a.minutes).slice(0, 5),
      views,
      ips: [...new Set(evs.map((e) => e.ip).filter(Boolean))] as string[],
      logins: logins.map((l) => ({ at: String(l.at), ip: l.ip ?? null })),
    });
  }
  users.sort((a, b) => b.activeMin - a.activeMin);
  return { users, tableMissing: false };
}
