"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Same palette as the route map so a vendor keeps its colour across views.
const PALETTE = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#b91c1c"];

const minsAgo = (at: string | null | undefined): number | null => {
  if (!at) return null;
  const t = new Date(String(at).replace(" ", "T") + (String(at).includes("Z") ? "" : "Z")).getTime();
  return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60_000));
};
// "3m", "1h 5m" — and pings older than 3h don't count as a live position at all (yesterday's
// parking spot is not tracking).
const LIVE_CUTOFF_MIN = 180;
const fmtAge = (m: number | null): string => {
  if (m == null) return "?";
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

/// LIVE tracking map for TODAY: each vendor's truck at its last GPS ping (from the vendor app,
/// one ping / 45s while a job is running), their stops (done ✓ / pending), and a dashed line to
/// the next pending stop. The Today view reloads every 45s, so the map keeps itself fresh.
export default function LiveTrackMap({ city, vendors }: { city: string; vendors: any[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<string | null>(null);

  const tracked = (vendors ?? [])
    .filter((v) => !v.isUnassigned && !v.isCoTeam)
    .map((v, vi) => {
      const age = minsAgo(v.liveLocationAt);
      return { v, color: PALETTE[vi % PALETTE.length], age, hasGps: v.liveLat != null && v.liveLng != null && age != null && age <= LIVE_CUTOFF_MIN };
    });
  const withGps = tracked.filter((t) => t.hasGps);

  useEffect(() => {
    let map: any;
    let disposed = false;
    (async () => {
      if (!elRef.current || tracked.length === 0) return;
      const L = (await import("leaflet")).default;
      if (disposed || !elRef.current) return;
      map = L.map(elRef.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc" }).addTo(map);
      const all: [number, number][] = [];

      for (const { v, color, age, hasGps } of tracked) {
        const key = String(v.vendorId ?? v.vendorName);
        const dim = sel != null && sel !== key;
        const alpha = dim ? 0.15 : 1;
        // Stops: done = solid green ✓, pending = vendor-coloured ring.
        const stops = (v.orders ?? []).filter((o: any) => o.lat != null && o.lng != null);
        for (const o of stops) {
          const done = o.live_status === "delivered";
          const p: [number, number] = [Number(o.lat), Number(o.lng)];
          L.marker(p, {
            icon: L.divIcon({
              className: "",
              html: done
                ? `<div style="opacity:${alpha};background:#10b981;color:#fff;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">✓</div>`
                : `<div style="opacity:${alpha};background:#fff;color:${color};width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;border:2.5px solid ${color};box-shadow:0 1px 3px rgba(0,0,0,.3)">●</div>`,
              iconSize: [20, 20], iconAnchor: [10, 10],
            }),
          }).addTo(map).bindPopup(`<b>${o.customer_unique_id}</b> — ${v.vendorName}<br>${o.locality ?? ""} · ${done ? "delivered ✓" : (o.live_status ?? "pending")}`);
          if (!dim) all.push(p);
        }
        // The truck: live GPS pin with name + freshness. Stale (>30m) fades to grey.
        if (hasGps) {
          const stale = age != null && age > 30;
          const pinColor = stale ? "#94a3b8" : color;
          const pos: [number, number] = [Number(v.liveLat), Number(v.liveLng)];
          L.marker(pos, {
            icon: L.divIcon({
              className: "",
              html: `<div style="opacity:${alpha};background:${pinColor};color:#fff;font-size:11px;font-weight:800;padding:3px 9px;border-radius:14px;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);transform:translate(-50%,-130%)">🚚 ${v.vendorName} · ${fmtAge(age)}</div>`,
              iconSize: [0, 0],
            }),
            zIndexOffset: 3000,
          }).addTo(map).bindPopup(`<b>${v.vendorName}</b><br>last ping ${fmtAge(age)} ago${stale ? " — STALE" : ""}`);
          if (!dim) all.push(pos);
          // Dashed line to the NEXT pending stop.
          const next = stops.find((o: any) => o.live_status !== "delivered");
          if (next && !dim) {
            L.polyline([pos, [Number(next.lat), Number(next.lng)]], { color: pinColor, weight: 3, opacity: 0.7, dashArray: "6 8" }).addTo(map);
          }
        }
      }
      if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.2));
    })();
    return () => { disposed = true; try { map?.remove(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, vendors, sel]);

  if (tracked.length === 0) return null;

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2.5">
        <span className="text-sm font-semibold text-slate-800">🔴 Live tracking — {city.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase())}</span>
        <span className="text-[11px] text-slate-400">truck = last GPS from the vendor app (updates ~45s while a job is running) · grey = no ping for 30+ min</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {tracked.map(({ v, color, age, hasGps }) => {
            const key = String(v.vendorId ?? v.vendorName);
            const on = sel === key;
            return (
              <button
                key={key}
                onClick={() => setSel(on ? null : key)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 transition ${on ? "text-white" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
                style={on ? { backgroundColor: color, borderColor: color } : { borderColor: color }}
                title={hasGps ? `last ping ${fmtAge(age)} ago — click to spotlight` : "no GPS in the last 3h (job not started in the app)"}
              >
                <span style={{ color: on ? "#fff" : color }}>●</span> {v.vendorName}{hasGps ? ` · ${fmtAge(age)}` : " · no signal"}
              </button>
            );
          })}
        </span>
      </div>
      {withGps.length === 0 ? (
        <div className="px-4 py-6 text-sm text-slate-500">
          No live GPS yet — trucks appear here the moment a vendor presses <b>Start to customer</b> in the app.
        </div>
      ) : (
        <div ref={elRef} style={{ height: 460 }} />
      )}
    </Card>
  );
}
