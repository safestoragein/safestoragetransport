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
        Customer-preference order · starts {fmtClock(plan.steps.find((s: any) => s.kind === "start")?.arrive ?? 540)} · ends ~{fmtClock(plan.end)}
        <span className="ml-2 font-normal text-slate-400">real road travel (OSRM); retrievals collected the evening before</span>
      </div>
      <ol className="space-y-1.5">
        {plan.steps.map((s: any, i: number) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${KIND_DOT[s.kind] ?? "bg-slate-400"}`} />
            <span className="w-28 shrink-0 font-medium text-slate-700">{s.kind === "wh-eve" ? "evening before" : `${fmtClock(s.arrive)}–${fmtClock(s.depart)}`}</span>
            <span className="min-w-0 text-slate-600">
              {s.label}
              {(s.travel > 0 || s.work > 0) && <span className="text-slate-400"> · {s.travel}m travel + {s.work}m work</span>}
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

// ── Route map: depot → stops (visit order) → warehouse on a real street map ─────────────────────
function RouteMapMini({ v }: { v: any }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!elRef.current || mapRef.current) return;
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current) return;
      const map = L.map(elRef.current, { zoomControl: true, attributionControl: false, scrollWheelZoom: false });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc" }).addTo(map);

      const depot = v.depotLat != null && v.depotLng != null ? { lat: Number(v.depotLat), lng: Number(v.depotLng) } : null;
      const whSrc = v.orders.find((o: any) => o.warehouse_lat && o.warehouse_lng);
      const wh = whSrc ? { lat: Number(whSrc.warehouse_lat), lng: Number(whSrc.warehouse_lng), name: whSrc.warehouse_name } : null;
      // stops in visit order (planned arrival)
      const stops = [...v.orders]
        .filter((o: any) => o.lat && o.lng)
        .sort((a: any, b: any) => (v.plan?.byOrder?.[a.customer_unique_id]?.arrive ?? a.stop_seq ?? 0) - (v.plan?.byOrder?.[b.customer_unique_id]?.arrive ?? b.stop_seq ?? 0));

      const bounds: [number, number][] = [];
      const path: [number, number][] = [];
      if (depot) {
        bounds.push([depot.lat, depot.lng]); path.push([depot.lat, depot.lng]);
        L.marker([depot.lat, depot.lng], { icon: L.divIcon({ className: "", html: `<div style="background:#1e293b;color:#fff;font-size:10px;font-weight:700;padding:3px 7px;border-radius:5px;white-space:nowrap;transform:translate(-50%,-130%)">▶ Start</div>`, iconSize: [0, 0] }) }).addTo(map);
      }
      stops.forEach((o: any, i: number) => {
        const lat = Number(o.lat), lng = Number(o.lng);
        bounds.push([lat, lng]); path.push([lat, lng]);
        const color = o.order_type === "pickup" ? "#2563eb" : "#059669";
        L.marker([lat, lng], { icon: L.divIcon({ className: "", html: `<div style="background:${color};color:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${i + 1}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
          .addTo(map).bindPopup(`<b>${o.customer_unique_id}</b> · ${o.order_type === "pickup" ? "Pickup" : "Retrieval"}<br>${o.customer_name}${o.locality ? `<br>${o.locality}` : ""}`);
      });
      if (wh) {
        bounds.push([wh.lat, wh.lng]); path.push([wh.lat, wh.lng]);
        L.marker([wh.lat, wh.lng], { icon: L.divIcon({ className: "", html: `<div style="background:#0f172a;color:#fff;font-size:10px;font-weight:600;padding:3px 7px;border-radius:5px;white-space:nowrap;transform:translate(-50%,-130%)">⌂ ${wh.name ?? "Warehouse"}</div>`, iconSize: [0, 0] }) }).addTo(map);
      }
      if (path.length > 1) L.polyline(path, { color: "#6366f1", weight: 3, opacity: 0.7, dashArray: "6 6" }).addTo(map);
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
      else if (bounds.length === 1) map.setView(bounds[0], 12);
      else map.setView([12.95, 77.6], 11);
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [v]);

  const hasCoords = v.orders.some((o: any) => o.lat && o.lng) || (v.depotLat && v.depotLng);
  if (!hasCoords) return <div className="py-6 text-center text-xs text-slate-400">No map coordinates for this vendor&apos;s stops.</div>;
  return (
    <div>
      <div ref={elRef} className="h-72 w-full overflow-hidden rounded-lg border border-slate-200" />
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> retrieval drop</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-600" /> pickup</span>
        <span>numbers = visit order · dashed line = route · ⌂ warehouse</span>
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
