"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

/* eslint-disable @typescript-eslint/no-explicit-any */
function fmtClock(min: number) {
  const h = Math.floor(min / 60) % 24, m = Math.round(min % 60);
  const ap = h >= 12 ? "PM" : "AM"; let hh = h % 12; if (hh === 0) hh = 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
}
const KIND_DOT: Record<string, string> = { start: "bg-slate-300", "wh-eve": "bg-violet-500", wh: "bg-slate-400", deliver: "bg-emerald-500", pickup: "bg-blue-500" };
const KIND_BAR: Record<string, string> = { "wh-eve": "bg-violet-400", wh: "bg-slate-400", deliver: "bg-emerald-500", pickup: "bg-blue-500", start: "bg-slate-300" };
function liftBadge(raw: any) {
  if (raw == null || String(raw).trim() === "") return null;
  const v = String(raw).trim().toLowerCase();
  if (/^(n|no|false|0|not available|na)$/.test(v)) return false;
  return true;
}

export default function VendorDetails({ v }: { v: any }) {
  const plan = v.plan;
  const [tab, setTab] = useState<"plan" | "timeline" | "map">("plan");
  if (!plan) return null;

  const TABS: { id: "plan" | "timeline" | "map"; label: string }[] = [
    { id: "plan", label: "Day plan" },
    { id: "timeline", label: "Timeline" },
    { id: "map", label: "Route map" },
  ];

  return (
    <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
      <div className="mb-3 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "plan" && <PlanList plan={plan} />}
      {tab === "timeline" && <TimelineBar plan={plan} />}
      {tab === "map" && <RouteMapMini v={v} />}
    </div>
  );
}

// ── Day plan: the ordered step list ─────────────────────────────────────────────────────────────
function PlanList({ plan }: { plan: any }) {
  return (
    <>
      <div className="mb-2 text-xs font-semibold text-slate-700">
        Retrievals first, then pickups · starts {fmtClock(plan.steps.find((s: any) => s.kind === "start")?.arrive ?? 540)} · ends ~{fmtClock(plan.end)}
        {plan.totalKm != null && <span className="ml-1 text-blue-600">· {plan.totalKm} km total</span>}
        <span className="ml-2 font-normal text-slate-400">back-to-back from 9 AM; a stop waits only if the customer asked for a window</span>
      </div>
      <ol className="space-y-1.5">
        {plan.steps.map((s: any, i: number) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[s.kind] ?? "bg-slate-400"}`} />
            <span className="w-28 shrink-0 font-medium text-slate-700">{s.kind === "wh-eve" ? "evening before" : `${fmtClock(s.arrive)}–${fmtClock(s.depart)}`}</span>
            <span className="min-w-0 text-slate-600">
              {s.label}
              {(s.travel > 0 || s.work > 0 || (s.km ?? 0) > 0) && <span className="text-slate-400"> · {(s.km ?? 0) > 0 ? <b className="font-semibold text-blue-600">{s.km} km</b> : null}{(s.km ?? 0) > 0 && (s.travel > 0 || s.work > 0) ? " · " : ""}{s.travel > 0 ? `${s.travel}m travel` : ""}{s.travel > 0 && s.work > 0 ? " + " : ""}{s.work > 0 ? `${s.work}m work` : ""}</span>}
              {s.slot && <span className={`ml-1 rounded px-1 text-[10px] ring-1 ${s.late ? "bg-red-50 text-red-600 ring-red-200" : "bg-white text-slate-500 ring-slate-200"}`}>customer wants {String(s.slot).replace(/:00/g, "")}{s.late ? " · LATE" : ""}</span>}
              {liftBadge(s.lift) === false && <span className="ml-1 rounded bg-orange-100 px-1 text-[10px] font-medium text-orange-700">⚠ no lift</span>}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

// ── Timeline: single-lane Gantt over the working day ────────────────────────────────────────────
function TimelineBar({ plan }: { plan: any }) {
  const blocks = plan.steps.filter((s: any) => s.kind !== "wh-eve" && s.kind !== "start" && s.depart > s.arrive);
  const start = Math.min(540, ...plan.steps.filter((s: any) => s.kind === "start").map((s: any) => s.arrive));
  const end = Math.max(plan.end, start + 60);
  const span = end - start || 1;
  const pos = (m: number) => `${((m - start) / span) * 100}%`;
  const hours: number[] = [];
  for (let h = Math.floor(start / 60); h <= Math.ceil(end / 60); h++) hours.push(h * 60);

  return (
    <div className="pt-1">
      {/* hour axis */}
      <div className="relative mb-1 h-4">
        {hours.map((h) => (
          <span key={h} className="absolute -translate-x-1/2 text-[10px] text-slate-400" style={{ left: pos(h) }}>{fmtClock(h)}</span>
        ))}
      </div>
      <div className="relative rounded-lg border border-slate-200 bg-white" style={{ height: `${blocks.length * 26 + 8}px` }}>
        {/* hour gridlines */}
        {hours.map((h) => (
          <div key={h} className="absolute top-0 bottom-0 w-px bg-slate-100" style={{ left: pos(h) }} />
        ))}
        {blocks.map((s: any, i: number) => (
          <div key={i} className="absolute flex items-center" style={{ top: `${i * 26 + 4}px`, left: pos(s.arrive), width: pos(s.depart - start + start) === pos(s.arrive) ? "2px" : `calc(${pos(s.depart)} - ${pos(s.arrive)})`, minWidth: "6px", height: "20px" }}>
            <div className={`h-full w-full overflow-hidden rounded px-1.5 text-[10px] font-medium leading-5 text-white ${KIND_BAR[s.kind] ?? "bg-slate-400"} ${s.late ? "ring-2 ring-red-500" : ""}`} title={`${s.label} · ${fmtClock(s.arrive)}–${fmtClock(s.depart)}`}>
              <span className="whitespace-nowrap">{s.label.replace(/^(Deliver to|Pick up & pack at)\s*/i, "")}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Deliver (retrieval)</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-blue-500" /> Pickup &amp; pack</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-400" /> Warehouse</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm ring-2 ring-red-500" /> late vs customer window</span>
      </div>
    </div>
  );
}

// ── Route map: depot → stops (visit order) → warehouse, following real roads ────────────────────
function shortWh(name: any) { return name ? String(name).split(/[·,]/)[0].trim() : "Warehouse"; }

// The booking feed has no coordinates, so addresses are geocoded and many fall back to the
// same city-centre point — stacking stops on one pixel so they hide each other (retrievals
// vanish under pickups). Spread any stops that share a point into a small ring so all show.
function spreadStacked(stops: any[]): { lat: number; lng: number }[] {
  const pos = stops.map((o) => ({ lat: Number(o.lat), lng: Number(o.lng) }));
  const groups = new Map<string, number[]>();
  pos.forEach((p, i) => {
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    const g = groups.get(key); if (g) g.push(i); else groups.set(key, [i]);
  });
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    const R = 0.0016; // ~170 m
    idxs.forEach((idx, k) => {
      const ang = (2 * Math.PI * k) / idxs.length;
      pos[idx] = { lat: pos[idx].lat + R * Math.cos(ang), lng: pos[idx].lng + R * Math.sin(ang) };
    });
  }
  return pos;
}

// Straight-line km between two points (fallback when OSRM legs aren't available).
function havKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function RouteMapMini({ v }: { v: any }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [legsKm, setLegsKm] = useState<number[]>([]); // road km per leg: [start→#1, #1→#2, …]

  const depot = v.depotLat != null && v.depotLng != null ? { lat: Number(v.depotLat), lng: Number(v.depotLng), label: v.startingPoint || "Depot" } : null;
  const whSrc = v.orders.find((o: any) => o.warehouse_lat && o.warehouse_lng);
  const wh = whSrc ? { lat: Number(whSrc.warehouse_lat), lng: Number(whSrc.warehouse_lng), name: shortWh(whSrc.warehouse_name) } : null;
  const stops = [...v.orders]
    .filter((o: any) => o.lat && o.lng)
    .sort((a: any, b: any) => (v.plan?.byOrder?.[a.customer_unique_id]?.arrive ?? a.stop_seq ?? 0) - (v.plan?.byOrder?.[b.customer_unique_id]?.arrive ?? b.stop_seq ?? 0));
  const hasPick = stops.some((o: any) => o.order_type === "pickup");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!elRef.current || mapRef.current) return;
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current) return;
      const map = L.map(elRef.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc" }).addTo(map);

      // Spread stops that geocoded to the same point so every marker is visible.
      const disp = spreadStacked(stops);

      // ordered waypoints: depot → stops → warehouse (drop pickups at the end)
      const wps: { lat: number; lng: number }[] = [];
      if (depot) wps.push(depot);
      stops.forEach((_o: any, i: number) => wps.push(disp[i]));
      if (wh && hasPick) wps.push(wh);

      const pill = (bg: string, text: string) => L.divIcon({ className: "", html: `<div style="background:${bg};color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35);transform:translate(-50%,-140%)">${text}</div>`, iconSize: [0, 0] });

      if (depot) L.marker([depot.lat, depot.lng], { icon: pill("#16a34a", "▶ START") }).addTo(map).bindPopup(`<b>Start</b><br>${depot.label}`);
      stops.forEach((o: any, i: number) => {
        const color = o.order_type === "pickup" ? "#2563eb" : "#059669";
        const t = v.plan?.byOrder?.[o.customer_unique_id]?.arrive;
        L.marker([disp[i].lat, disp[i].lng], { icon: L.divIcon({ className: "", html: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)">${i + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
          .addTo(map).bindPopup(`<b>${i + 1}. ${o.customer_unique_id}</b> — ${o.order_type === "pickup" ? "Pickup" : "Retrieval"}<br>${o.customer_name}${o.locality ? `<br>${o.locality}` : ""}${t != null ? `<br>~${fmtClock(t)}` : ""}`);
      });
      if (wh) L.marker([wh.lat, wh.lng], { icon: pill("#0f172a", `⌂ ${wh.name}`) }).addTo(map).bindPopup(`<b>Warehouse</b><br>${wh.name}`);

      // LIVE vendor pin — where the vendor is right now (from the app's GPS pings).
      const hasLive = v.liveLat != null && v.liveLng != null;
      if (hasLive) {
        const liveIcon = L.divIcon({ className: "", html: `<div style="background:#e11d48;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid #fff;box-shadow:0 0 0 5px rgba(225,29,72,.22),0 1px 6px rgba(0,0,0,.5)">🚚</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
        L.marker([Number(v.liveLat), Number(v.liveLng)], { icon: liveIcon, zIndexOffset: 1000 }).addTo(map).bindPopup(`<b>Vendor is here now</b>${v.liveLocationAt ? `<br>updated ${v.liveLocationAt}` : ""}`);
      }

      // draw the ACTUAL road route (OSRM geometry); fall back to a straight dashed line.
      let drew = false;
      let osrmLegs: number[] | null = null;
      if (wps.length > 1) {
        try {
          const coordStr = wps.map((p) => `${p.lng},${p.lat}`).join(";");
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 4000);
          const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`, { signal: ctrl.signal });
          clearTimeout(to);
          const j: any = await res.json();
          if (!cancelled && j?.code === "Ok" && j.routes?.[0]?.geometry?.coordinates) {
            const line = j.routes[0].geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
            L.polyline(line, { color: "#4f46e5", weight: 5, opacity: 0.85 }).addTo(map);
            // real road km per leg (waypoints: depot → stops → wh)
            const legs = (j.routes[0].legs || []).map((l: any) => (l.distance || 0) / 1000);
            if (legs.length) osrmLegs = legs;
            drew = true;
          }
        } catch { /* fall back below */ }
      }
      // legs shown to the user: OSRM road km if we got them, else straight-line km.
      if (!cancelled) setLegsKm(osrmLegs ?? wps.slice(1).map((p, i) => havKm(wps[i], p)));
      if (!cancelled && !drew && wps.length > 1) {
        L.polyline(wps.map((p) => [p.lat, p.lng] as [number, number]), { color: "#94a3b8", weight: 3, opacity: 0.7, dashArray: "6 6" }).addTo(map);
      }

      const bounds = wps.map((p) => [p.lat, p.lng] as [number, number]);
      if (hasLive) bounds.push([Number(v.liveLat), Number(v.liveLng)]); // keep the live pin in view
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      else if (bounds.length === 1) map.setView(bounds[0], 12);
      else map.setView([12.95, 77.6], 11);
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasCoords = stops.length > 0 || depot;
  if (!hasCoords) return <div className="py-6 text-center text-xs text-slate-400">No map coordinates for this vendor&apos;s stops.</div>;

  return (
    <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
      <div>
        <div ref={elRef} className="h-72 w-full overflow-hidden rounded-lg border border-slate-200" />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-600" /> start</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> retrieval drop</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> pickup</span>
          <span className="flex items-center gap-1"><span className="h-1 w-4 rounded bg-indigo-600" /> driving route</span>
          {v.liveLat != null && v.liveLng != null && <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-rose-600" /> 🚚 vendor now (live)</span>}
        </div>
      </div>
      {/* readable itinerary so the order is obvious without reading the map */}
      <ol className="space-y-1 text-xs">
        <li className="flex items-center gap-2 rounded-md bg-green-50 px-2 py-1.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-[10px] font-bold text-white">▶</span>
          <span className="font-medium text-slate-700">Start · {depot?.label ?? "depot"}</span>
        </li>
        {stops.map((o: any, i: number) => {
          const t = v.plan?.byOrder?.[o.customer_unique_id]?.arrive;
          const late = v.plan?.byOrder?.[o.customer_unique_id]?.late;
          const color = o.order_type === "pickup" ? "bg-blue-600" : "bg-emerald-600";
          return (
            <li key={o.customer_unique_id + i} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${color}`}>{i + 1}</span>
              <span className="min-w-0">
                <span className="font-semibold text-slate-800">{o.customer_unique_id}</span> <span className="text-slate-600">{o.customer_name}</span>
                <span className="ml-1 text-slate-400">{o.order_type === "pickup" ? "pickup" : "retrieval"}</span>
                <div className="text-[11px] text-slate-400">{o.locality || ""}{t != null ? ` · ~${fmtClock(t)}` : ""}{late ? <span className="ml-1 font-medium text-red-500">LATE</span> : null}</div>
                {legsKm[i] != null && <div className="text-[11px] font-medium text-indigo-500">↳ {legsKm[i].toFixed(1)} km from {i === 0 ? "start" : `stop ${i}`}</div>}
              </span>
            </li>
          );
        })}
        {wh && hasPick && (
          <li className="flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white">⌂</span>
            <span className="font-medium text-slate-700">Drop pickups · {wh.name}</span>
          </li>
        )}
      </ol>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
