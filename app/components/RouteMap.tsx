"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { OptimizationResult, Booking } from "@/lib/types";
import { haversineKm, roadKm, round1 } from "@/lib/geo";
import { km as fmtKm } from "@/lib/format";
import { vendorColor, Card } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Real street map. To stay readable it shows ONE vehicle's route at a time with numbered
// stops (visit order) + distance + estimated duration; a route list on the side lets you
// switch. "All" gives the overview. Long-haul stops >45km from the warehouse are hidden.
const LOCAL_RADIUS_KM = 45;
const SPEED_KMPH = 24;
const SERVICE_MIN = 20;

interface RouteInfo {
  vendorId: string;
  name: string;
  color: string;
  stops: Booking[]; // local stops in visit order
  km: number;
  minutes: number;
}

export default function RouteMap({ result }: { result: OptimizationResult }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const drawRef = useRef<() => void>(() => {});

  const routes = useMemo<RouteInfo[]>(() => {
    const anchor = result.bookings[0]?.warehouse;
    const local = (b: Booking) => !anchor || haversineKm(anchor, b.location) <= LOCAL_RADIUS_KM;
    const byId = new Map(result.bookings.map((b) => [b.id, b]));
    return result.assignments
      .map((a) => {
        const idx = result.vendors.findIndex((x) => x.id === a.vendorId);
        const v = result.vendors.find((x) => x.id === a.vendorId);
        const stops: Booking[] = [];
        a.trips.forEach((t) => t.bookingIds.forEach((id) => { const b = byId.get(id); if (b && local(b)) stops.push(b); }));
        // distance over the LOCAL stops only (consistent with what's drawn; excludes far outliers)
        let km = 0;
        if (v && stops.length) {
          const pts = [v.depot, ...stops.map((s) => s.location), stops[0].warehouse];
          for (let i = 0; i < pts.length - 1; i++) km += roadKm(pts[i], pts[i + 1]);
        }
        km = round1(km);
        const minutes = Math.round((km / SPEED_KMPH) * 60 + stops.length * SERVICE_MIN);
        return { vendorId: a.vendorId, name: v?.name ?? a.vendorId, color: vendorColor(idx), stops, km, minutes };
      })
      .filter((r) => r.stops.length > 0)
      .sort((a, b) => b.stops.length - a.stops.length);
  }, [result]);

  const [selected, setSelected] = useState<string>("all");
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; drawRef.current(); }, [selected]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current) return;
      LRef.current = L;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const map = L.map(elRef.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc" }).addTo(map);

      // warehouse marker(s)
      const whSeen = new Set<string>();
      result.bookings.forEach((b) => {
        const key = `${b.warehouse.lat},${b.warehouse.lng}`;
        if (whSeen.has(key)) return;
        whSeen.add(key);
        L.marker([b.warehouse.lat, b.warehouse.lng], {
          icon: L.divIcon({ className: "", html: `<div style="background:#0f172a;color:#fff;font-size:10px;font-weight:600;padding:3px 7px;border-radius:5px;white-space:nowrap;transform:translate(-50%,-130%)">⌂ ${b.warehouse.label ?? "Warehouse"}</div>`, iconSize: [0, 0] }),
        }).addTo(map);
      });

      layerRef.current = L.layerGroup().addTo(map);

      drawRef.current = () => {
        const lay = layerRef.current;
        lay.clearLayers();
        const sel = selectedRef.current;
        const wh = result.bookings[0]?.warehouse;
        const depotOf = (vId: string) => result.vendors.find((v) => v.id === vId)?.depot ?? wh;
        const bounds: [number, number][] = wh ? [[wh.lat, wh.lng]] : [];
        const shown = sel === "all" ? routes : routes.filter((r) => r.vendorId === sel);
        const single = sel !== "all";

        shown.forEach((r) => {
          const depot = depotOf(r.vendorId);
          const path: [number, number][] = [[depot.lat, depot.lng], ...r.stops.map((s) => [s.location.lat, s.location.lng] as [number, number]), [r.stops[0].warehouse.lat, r.stops[0].warehouse.lng]];
          L.polyline(path, { color: r.color, weight: single ? 4 : 2.5, opacity: single ? 0.9 : 0.55 }).addTo(lay);
          r.stops.forEach((s, i) => {
            bounds.push([s.location.lat, s.location.lng]);
            if (single) {
              const m = L.marker([s.location.lat, s.location.lng], {
                icon: L.divIcon({ className: "", html: `<div style="background:${r.color};color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
              }).addTo(lay);
              m.bindTooltip(`<b>Stop ${i + 1}</b> · ${s.refNo}<br>${s.location.label} · ${s.pallets}p<br>${s.customerName}`, { direction: "top", offset: [0, -10] });
            } else {
              L.circleMarker([s.location.lat, s.location.lng], { radius: 6, color: "#fff", weight: 1.5, fillColor: r.color, fillOpacity: 0.9 }).addTo(lay)
                .bindTooltip(`${s.refNo} · ${s.pallets}p · ${r.name}`, { direction: "top" });
            }
          });
        });
        if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        else if (wh) map.setView([wh.lat, wh.lng], 11);
      };

      drawRef.current();
      setTimeout(() => { map.invalidateSize(); drawRef.current(); }, 250);
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [result, routes]);

  const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div ref={elRef} className="h-[360px] w-full overflow-hidden rounded-lg border border-slate-200 z-0 sm:h-[520px]" />

      <div className="flex max-h-[360px] flex-col sm:max-h-[520px]">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Routes ({routes.length})</span>
          <button
            onClick={() => setSelected("all")}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${selected === "all" ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200"}`}
          >
            Show all
          </button>
        </div>
        <div className="space-y-1.5 overflow-y-auto pr-1">
          {routes.map((r, i) => (
            <button
              key={r.vendorId}
              onClick={() => setSelected(r.vendorId)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${selected === r.vendorId ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: r.color }}>{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{r.name}</span>
              </div>
              <div className="mt-1 pl-7 text-xs text-slate-500">
                {r.stops.length} stop{r.stops.length > 1 ? "s" : ""} · {fmtKm(r.km)} · ~{dur(r.minutes)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {selected !== "all" && (() => {
        const r = routes.find((x) => x.vendorId === selected);
        if (!r) return null;
        return (
          <Card className="p-4 lg:col-span-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="flex items-center gap-2 font-semibold text-slate-800">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: r.color }} />{r.name}
              </span>
              <span className="text-slate-500">{r.stops.length} stops · {fmtKm(r.km)} · ~{dur(r.minutes)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              <span className="rounded bg-slate-900 px-1.5 py-0.5 text-white">⌂ WH</span>
              {r.stops.map((s, i) => (
                <span key={s.id} className="flex items-center gap-1">
                  <span className="text-slate-300">→</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5"><b>{i + 1}</b> {s.location.label} ({s.pallets}p)</span>
                </span>
              ))}
              <span className="text-slate-300">→</span>
              <span className="rounded bg-slate-900 px-1.5 py-0.5 text-white">⌂ WH</span>
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
