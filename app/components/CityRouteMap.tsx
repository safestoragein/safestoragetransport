"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Distinct colours per vendor (repeats after 12 — fine, a city rarely runs more).
const PALETTE = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5", "#0d9488", "#b91c1c"];

// Same approximation the optimiser uses: haversine × 1.3 road factor.
function legKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 1.3 * 10) / 10;
}

/// City-level overview: every vendor's day route in its own colour, numbered stops, and the km of
/// each leg written on the line. Rendered only when a single city is selected.
export default function CityRouteMap({ city, vendors }: { city: string; vendors: any[] }) {
  const elRef = useRef<HTMLDivElement>(null);
  // Click a vendor in the legend to spotlight ONLY their route; click again (or another) to switch.
  const [sel, setSel] = useState<string | null>(null);

  // A stop belongs on the CITY map only if it's actually near the city — an intercity order's
  // far-away destination pin (e.g. a Noida retrieval on the Bangalore board) must not stretch
  // the zoom to all of India. ~1.3° ≈ 145 km box around the median of the city's own pins.
  const allPts = (vendors ?? []).flatMap((v) => (v.orders ?? []).filter((o: any) => o.lat != null && o.lng != null));
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const cLat = med(allPts.map((o: any) => Number(o.lat))), cLng = med(allPts.map((o: any) => Number(o.lng)));
  const nearCity = (o: any) => Math.abs(Number(o.lat) - cLat) < 1.3 && Math.abs(Number(o.lng) - cLng) < 1.3;

  // Assigned, real (non co-team) vendors that have at least one located stop.
  const usable = (vendors ?? [])
    .filter((v) => !v.isUnassigned && !v.isCoTeam)
    .map((v) => {
      const hasManual = (v.orders ?? []).some((o: any) => o.manual_seq != null);
      const stops = [...(v.orders ?? [])]
        .filter((o: any) => o.lat != null && o.lng != null && nearCity(o))
        .sort((a: any, b: any) =>
          hasManual
            ? (a.manual_seq ?? 1e9) - (b.manual_seq ?? 1e9)
            : (v.plan?.byOrder?.[a.customer_unique_id]?.arrive ?? a.stop_seq ?? 1e9) - (v.plan?.byOrder?.[b.customer_unique_id]?.arrive ?? b.stop_seq ?? 1e9));
      return { v, stops };
    })
    .filter((x) => x.stops.length > 0);

  // Unassigned orders with coordinates — shown in grey so the map still tells the story when a
  // city's orders are all (or partly) in the "team to assign" bucket.
  const unassignedStops = (vendors ?? [])
    .filter((v) => v.isUnassigned)
    .flatMap((v) => (v.orders ?? []).filter((o: any) => o.lat != null && o.lng != null && nearCity(o)));
  // Orders with NO coordinates at all (not yet geocoded — needs a Generate).
  const unlocated = (vendors ?? []).flatMap((v) => (v.orders ?? []).filter((o: any) => o.lat == null || o.lng == null)).length;

  useEffect(() => {
    let map: any;
    let disposed = false;
    (async () => {
      if (!elRef.current || (usable.length === 0 && unassignedStops.length === 0)) return;
      const L = (await import("leaflet")).default;
      if (disposed || !elRef.current) return;
      map = L.map(elRef.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc" }).addTo(map);

      const all: [number, number][] = [];
      const kmLabel = (mid: [number, number], km: number, color: string) =>
        L.marker(mid, {
          // Floated ABOVE the line (not on it) and forced on top of every marker, so a chip is never
          // hidden behind the start pill / stop circles or clipped by them.
          icon: L.divIcon({ className: "", html: `<div style="background:#ffffff;color:#0f172a;font-size:13px;font-weight:800;padding:3px 10px;border-radius:8px;border:2px solid ${color};white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.45);transform:translate(-50%,-170%)">${km} km</div>`, iconSize: [0, 0] }),
          interactive: false,
          zIndexOffset: 2000,
        }).addTo(map);

      usable.forEach(({ v, stops }, vi) => {
        const color = PALETTE[vi % PALETTE.length];
        const key = String(v.vendorId ?? v.vendorName);
        const dim = sel != null && sel !== key; // spotlight mode: everyone else fades
        const alpha = dim ? 0.15 : 1;
        const pts: [number, number][] = [];
        // Depot start.
        if (v.depotLat != null && v.depotLng != null) {
          const d: [number, number] = [Number(v.depotLat), Number(v.depotLng)];
          pts.push(d);
          L.marker(d, {
            icon: L.divIcon({ className: "", html: `<div style="opacity:${alpha};background:${color};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;white-space:nowrap;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);transform:translate(-50%,-140%)">▶ ${v.vendorName}</div>`, iconSize: [0, 0] }),
          }).addTo(map).bindPopup(`<b>${v.vendorName}</b><br>starts: ${v.startingPoint ?? ""}`);
        }
        // Numbered stops.
        stops.forEach((o: any, i: number) => {
          const p: [number, number] = [Number(o.lat), Number(o.lng)];
          pts.push(p);
          L.marker(p, {
            icon: L.divIcon({ className: "", html: `<div style="opacity:${alpha};background:${color};color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
          }).addTo(map).bindPopup(`<b>${o.customer_unique_id}</b> — ${v.vendorName}<br>${o.locality ?? ""} · ${o.order_type ?? ""}${o.pallets != null ? ` · ${o.stated_pallets ?? o.pallets}p` : ""}`);
        });
        // Route line + leg distances.
        if (pts.length >= 2) {
          L.polyline(pts, { color, weight: dim ? 2 : 4, opacity: dim ? 0.15 : 0.85 }).addTo(map);
          if (!dim) {
            for (let i = 0; i < pts.length - 1; i++) {
              const a = { lat: pts[i][0], lng: pts[i][1] }, b = { lat: pts[i + 1][0], lng: pts[i + 1][1] };
              const km = legKm(a, b);
              if (km >= 0.5) kmLabel([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], km, color);
            }
          }
        }
        if (!dim) all.push(...pts);
      });

      // Grey pins for unassigned orders — visible on every city, routes or not.
      unassignedStops.forEach((o: any) => {
        const p: [number, number] = [Number(o.lat), Number(o.lng)];
        L.marker(p, {
          icon: L.divIcon({ className: "", html: `<div style="background:#64748b;color:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">?</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
        }).addTo(map).bindPopup(`<b>${o.customer_unique_id}</b> — team to assign<br>${o.locality ?? ""} · ${o.order_type ?? ""}`);
        all.push(p);
      });

      if (all.length) map.fitBounds(L.latLngBounds(all).pad(0.15));
    })();
    return () => { disposed = true; try { map?.remove(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, vendors, sel]);

  if (usable.length === 0 && unassignedStops.length === 0) {
    return (
      <Card className="mb-5 p-4 text-sm text-slate-500">
        <b className="text-slate-700">Route map — {city}:</b>{" "}
        {unlocated > 0
          ? `${unlocated} order${unlocated > 1 ? "s" : ""} have no map coordinates yet — press Generate / refresh so their addresses get geocoded, then the map will appear.`
          : "no orders to map for this day."}
      </Card>
    );
  }

  return (
    <Card className="mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-700">Route map — {city}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {unassignedStops.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" />
              <span className="text-slate-600">Team to assign</span>
              <span className="text-slate-400">({unassignedStops.length})</span>
            </span>
          )}
          {usable.map(({ v, stops }, vi) => {
            const color = PALETTE[vi % PALETTE.length];
            // Total = depot→stop1→…→stopN.
            const pts = [
              ...(v.depotLat != null && v.depotLng != null ? [{ lat: Number(v.depotLat), lng: Number(v.depotLng) }] : []),
              ...stops.map((o: any) => ({ lat: Number(o.lat), lng: Number(o.lng) })),
            ];
            let tot = 0;
            for (let i = 0; i < pts.length - 1; i++) tot += legKm(pts[i], pts[i + 1]);
            const key = String(v.vendorId ?? v.vendorName);
            const active = sel === key;
            return (
              <button
                key={key}
                onClick={() => setSel(active ? null : key)}
                title={active ? "Show all vendors" : "Show only this vendor"}
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors ${active ? "ring-2 ring-offset-1" : sel != null ? "opacity-40 hover:opacity-80" : "hover:bg-slate-50"}`}
                style={active ? ({ ["--tw-ring-color" as any]: color } as any) : undefined}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                <span className="text-slate-600">{v.vendorName}</span>
                <span className="text-slate-400">({stops.length} stops · ~{Math.round(tot)} km)</span>
              </button>
            );
          })}
        </div>
      </div>
      <div ref={elRef} style={{ height: 420, width: "100%" }} />
    </Card>
  );
}
