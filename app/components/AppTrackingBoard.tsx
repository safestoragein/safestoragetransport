"use client";

// App tracking — the vendor APP's activity report in one place (team request: "vendor apk
// tracking report in a separate tab"). Per vendor: the day's team photo, supervisor, and each
// order's start photo (with an On-Time check against the customer slot), timeline of app taps
// (Started → Reached → Loaded → Done) and the KYC / delivery / damage photo trail.
import { useCallback, useEffect, useMemo, useState } from "react";
import { SessionUser } from "@/lib/auth";
import { ScheduleData } from "@/lib/schedule";
import { countryOfCity } from "@/lib/country";
import { useCountry } from "@/lib/country-store";
import AppShell from "./AppShell";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Photo = { id: string; kind: string; createdAt: string };

const cityName = (slug: string) => String(slug ?? "").replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  pickup: { label: "Pickup", cls: "bg-blue-600" },
  full_retrieval: { label: "Retrieval", cls: "bg-emerald-600" },
  partial_retrieval: { label: "Partial", cls: "bg-amber-500" },
};
const PHOTO_KIND: Record<string, string> = { team: "👥 Team", kyc: "🪪 KYC", delivery: "📦 Delivery", damage: "⚠️ Damage" };
// App tap flow per order type (same steps the monitoring stepper uses).
const PICKUP_FLOW: [string, string][] = [["en_route", "Started"], ["arrived", "Reached"], ["loaded", "Loaded"], ["delivered", "At WH"]];
const RETR_FLOW: [string, string][] = [["collected", "Collected"], ["en_route", "Started"], ["arrived", "Reached"], ["loaded", "Unloaded"], ["delivered", "Done"]];

// "2026-07-30 11:50:59" → "11:50 AM"
function clock(raw?: string | null): string {
  const m = String(raw ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return "";
  let h = Number(m[1]); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${h}:${m[2]} ${ap}`;
}
// minutes-of-day from a timestamp ("2026-07-30 14:05:00" → 845)
function minOf(raw?: string | null): number | null {
  const m = String(raw ?? "").match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
// Slot text ("9am-11am", "2:00 PM - 3:00 PM", "wants 1pm_2pm") → [startMin, endMin] or null.
function slotRange(slot?: string | null): [number, number] | null {
  const s = String(slot ?? "").toLowerCase();
  const times: number[] = [];
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let h = Number(m[1]) % 12;
    if (m[3] === "pm") h += 12;
    times.push(h * 60 + Number(m[2] ?? 0));
  }
  if (times.length < 2) return null;
  return [Math.min(times[0], times[1]), Math.max(times[0], times[1])];
}

export default function AppTrackingBoard({ user }: { user: SessionUser | null }) {
  const todayIst = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const [date, setDate] = useState(todayIst);
  const [cities, setCities] = useState<ScheduleData[]>([]);
  const [cityFilter, setCityFilter] = useState("All");
  const [photos, setPhotos] = useState<Record<string, Photo[]>>({});
  const [loading, setLoading] = useState(true);
  const [viewPhoto, setViewPhoto] = useState<{ id: string; label: string } | null>(null);
  const country = useCountry();

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/schedule/all?date=${date}`).then((x) => x.json()).catch(() => null);
    const cs: ScheduleData[] = r?.cities ?? [];
    setCities(cs);
    // photo index for every order on the date (batched — the API caps at 300 ids per call)
    const ids = cs.flatMap((c: any) => c.vendors.flatMap((v: any) => v.orders.map((o: any) => o.id))).filter(Boolean);
    const merged: Record<string, Photo[]> = {};
    for (let i = 0; i < ids.length; i += 300) {
      const batch = ids.slice(i, i + 300);
      const p = await fetch(`/api/schedule/order-photos?ids=${batch.join(",")}`).then((x) => x.json()).catch(() => null);
      if (p?.ok) Object.assign(merged, p.photos ?? {});
    }
    setPhotos(merged);
    setLoading(false);
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() =>
    cities
      .filter((c) => countryOfCity(c.city) === country)
      .filter((c) => cityFilter === "All" || c.city === cityFilter)
      .map((c) => ({
        ...c,
        vendors: c.vendors.filter((v: any) => !v.isUnassigned && !v.isCoTeam && v.orders.length > 0),
      }))
      .filter((c) => c.vendors.length > 0),
    [cities, cityFilter, country]);

  const cityOpts = useMemo(() => [...new Set(cities.filter((c) => countryOfCity(c.city) === country).map((c) => c.city))], [cities, country]);
  const stats = useMemo(() => {
    const vs = shown.flatMap((c) => c.vendors);
    const os = vs.flatMap((v: any) => v.orders);
    const started = os.filter((o: any) => o.app_events && Object.keys(o.app_events).length > 0);
    const done = os.filter((o: any) => o.live_status === "delivered");
    const withPhotos = os.filter((o: any) => (photos[o.id] ?? []).length > 0);
    return { vendors: vs.length, orders: os.length, started: started.length, done: done.length, withPhotos: withPhotos.length };
  }, [shown, photos]);

  const thumb = (p: Photo, label: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={p.id}
      src={`/api/schedule/order-photos?img=${p.id}`}
      alt={label}
      loading="lazy"
      onClick={() => setViewPhoto({ id: p.id, label })}
      className="h-14 w-20 cursor-pointer rounded-md border border-slate-200 object-cover hover:ring-2 hover:ring-blue-400"
    />
  );

  return (
    <AppShell active="tracking" user={user}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">App tracking</h1>
          <p className="text-xs text-slate-500">what each vendor team did in the app — start photos, on-time check, step timeline and the photo trail</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
            <option value="All">All cities</option>
            {cityOpts.map((c) => <option key={c} value={c}>{cityName(c)}</option>)}
          </select>
          <button onClick={load} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">⟳ Refresh</button>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Teams on the road", value: stats.vendors },
          { label: "Orders", value: stats.orders },
          { label: "Started in app", value: stats.started },
          { label: "Completed in app", value: stats.done },
          { label: "With photos", value: stats.withPhotos },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xl font-extrabold text-slate-900">{s.value}</div>
            <div className="text-[11px] font-medium text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {loading && <Card className="p-6 text-sm text-slate-500">Loading app activity…</Card>}
      {!loading && shown.length === 0 && <Card className="p-6 text-sm text-slate-500">No schedules (or no assigned vendors) for this date.</Card>}

      {!loading && shown.map((c) => (
        <div key={c.city} className="mb-6">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{cityName(c.city)}</h2>
          {c.vendors.map((v: any) => {
            const allPhotos: Photo[] = v.orders.flatMap((o: any) => photos[o.id] ?? []);
            const groupPhoto = allPhotos.find((p) => p.kind === "team") ?? null;
            return (
              <Card key={v.vendorId ?? v.vendorName} className="mb-3 overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 bg-blue-50/60 px-4 py-2.5">
                  {groupPhoto ? thumb(groupPhoto, `👥 Team photo · ${v.vendorName}`) : <span className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-slate-300 text-[10px] text-slate-400">No team photo</span>}
                  <div>
                    <div className="text-sm font-bold text-slate-900">{v.vendorName}</div>
                    <div className="text-[11px] text-slate-500">{v.supervisorName ? `Supervisor: ${v.supervisorName}` : ""}{v.supervisorContact ? ` ${v.supervisorContact}` : ""}</div>
                  </div>
                  <div className="ml-auto text-right text-[11px] text-slate-500">
                    <div>{date.split("-").reverse().join("/")}</div>
                    <div>{v.orders.length} order{v.orders.length > 1 ? "s" : ""}</div>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {v.orders.map((o: any) => {
                    const ph = photos[o.id] ?? [];
                    const startPhoto = ph.find((p) => p.kind === "team") ?? null;
                    const flow = /retriev/.test(String(o.order_type)) ? RETR_FLOW : PICKUP_FLOW;
                    const ev: Record<string, string> = o.app_events ?? {};
                    // On-time check: first app activity (start photo or first tap) vs the slot END.
                    const firstAct = [startPhoto?.createdAt, ...Object.values(ev)].filter(Boolean).map(minOf).filter((x): x is number => x != null).sort((a, b) => a - b)[0];
                    const range = slotRange(o.time_slot);
                    const onTime = firstAct != null && range ? firstAct <= range[1] : null;
                    const t = TYPE_BADGE[o.order_type] ?? TYPE_BADGE.pickup;
                    let stepNo = 0;
                    return (
                      <div key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                        <div className="flex w-24 flex-col items-center gap-1">
                          {startPhoto ? thumb(startPhoto, `Start photo · ${o.customer_unique_id}`) : <span className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-slate-300 text-[10px] text-slate-400">No photo</span>}
                          {onTime != null && (
                            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${onTime ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{onTime ? "✓ On Time" : "✗ Late"}</span>
                          )}
                          {startPhoto && <span className="text-[9px] text-slate-400">at {clock(startPhoto.createdAt)}</span>}
                        </div>
                        <div className="w-32">
                          <div className="text-[13px] font-bold text-slate-900">{o.customer_unique_id}</div>
                          <div className="text-[10px] text-slate-400">{o.order_id}</div>
                          <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${t.cls}`}>{t.label}</span>
                        </div>
                        <div className="w-40">
                          <div className="text-xs font-medium text-slate-700">{o.customer_name}</div>
                          {o.contact && <div className="text-[11px] text-slate-500">{String(o.contact).split(/[/,]/)[0].trim()}</div>}
                          {o.time_slot && <div className="text-[10px] text-slate-400">slot: {o.time_slot}</div>}
                        </div>
                        {/* timeline of app taps */}
                        <div className="flex flex-1 flex-wrap items-center gap-x-1 gap-y-2">
                          {flow.map(([key, label], i) => {
                            const at = ev[key];
                            if (at) stepNo += 1;
                            return (
                              <span key={key} className="flex items-center">
                                {i > 0 && <span className="mx-0.5 h-px w-4 bg-slate-200" />}
                                <span className="flex flex-col items-center">
                                  <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${at ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"}`} title={at ? `${label} · ${clock(at)}` : `${label} — not yet`}>
                                    {at ? stepNo : "·"}
                                  </span>
                                  <span className="mt-0.5 text-[9px] font-medium text-slate-500">{label}</span>
                                  <span className="text-[9px] text-slate-400">{at ? clock(at) : ""}</span>
                                </span>
                              </span>
                            );
                          })}
                        </div>
                        {/* photo trail (beyond the start photo) */}
                        <div className="flex flex-wrap items-center gap-1">
                          {ph.filter((p) => p !== startPhoto).map((p) => (
                            <span key={p.id} className="flex flex-col items-center">
                              {thumb(p, `${PHOTO_KIND[p.kind] ?? p.kind} · ${o.customer_unique_id}`)}
                              <span className="text-[9px] text-slate-400">{PHOTO_KIND[p.kind] ?? p.kind} {clock(p.createdAt)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      ))}

      {viewPhoto && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-6" onClick={() => setViewPhoto(null)}>
          <div className="max-h-full max-w-3xl overflow-auto rounded-xl bg-white p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-4">
              <span className="text-sm font-semibold text-slate-800">{viewPhoto.label}</span>
              <button onClick={() => setViewPhoto(null)} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">✕ Close</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/schedule/order-photos?img=${viewPhoto.id}`} alt={viewPhoto.label} className="max-h-[75vh] w-auto rounded-lg" />
          </div>
        </div>
      )}
    </AppShell>
  );
}
