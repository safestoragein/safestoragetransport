"use client";

// Customer-facing live tracking (public link, mobile-first). Truck + destination on a map,
// simple step progress, auto-refresh every 30s.
import { useCallback, useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { BASE_PATH } from "@/lib/base";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function TrackClient({ orderId }: { orderId: string }) {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState(false);
  const elRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${BASE_PATH}/api/track/${orderId}`).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setD(r); setErr(false); } else setErr(true);
  }, [orderId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // (Re)draw the map whenever fresh data lands.
  useEffect(() => {
    let map: any, disposed = false;
    (async () => {
      if (!elRef.current || !d || (!d.live && !d.destination)) return;
      const L = (await import("leaflet")).default;
      if (disposed || !elRef.current) return;
      map = L.map(elRef.current, { zoomControl: false, attributionControl: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc" }).addTo(map);
      const pts: [number, number][] = [];
      if (d.destination) {
        const p: [number, number] = [d.destination.lat, d.destination.lng];
        L.marker(p, { icon: L.divIcon({ className: "", html: `<div style="background:#0f172a;color:#fff;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);transform:translate(-50%,-130%)">📍 ${d.type === "pickup" ? "Pickup point" : "Delivery point"}</div>`, iconSize: [0, 0] }) }).addTo(map);
        pts.push(p);
      }
      if (d.live) {
        const p: [number, number] = [d.live.lat, d.live.lng];
        L.marker(p, { icon: L.divIcon({ className: "", html: `<div style="background:#16a34a;color:#fff;font-size:12px;font-weight:800;padding:4px 10px;border-radius:14px;white-space:nowrap;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);transform:translate(-50%,-130%)">🚚 Your team${d.live.ageMin != null ? ` · ${d.live.ageMin}m ago` : ""}</div>`, iconSize: [0, 0] }), zIndexOffset: 1000 }).addTo(map);
        pts.push(p);
        if (d.destination) L.polyline(pts, { color: "#16a34a", weight: 3, opacity: 0.7, dashArray: "6 8" }).addTo(map);
      }
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.3));
    })();
    return () => { disposed = true; try { map?.remove(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  if (err && !d) {
    return <div style={{ padding: 32, textAlign: "center", color: "#64748b", fontFamily: "system-ui" }}>Tracking link not found or expired.</div>;
  }
  if (!d) {
    return <div style={{ padding: 32, textAlign: "center", color: "#64748b", fontFamily: "system-ui" }}>Loading live tracking…</div>;
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", fontFamily: "system-ui", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 4px" }}>
        <span style={{ fontWeight: 800, fontSize: 18, color: "#0f172a" }}>SafeStorage</span>
        <span style={{ fontSize: 13, color: "#64748b" }}>{d.type === "pickup" ? "Pickup" : "Delivery"} · <b>{d.ref}</b></span>
        {d.vendor && <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>team: {d.vendor}</span>}
      </div>

      {d.delivered ? (
        <div style={{ background: "#dcfce7", color: "#166534", borderRadius: 12, padding: "14px 16px", fontWeight: 700, fontSize: 15 }}>
          ✅ {d.type === "pickup" ? "Your goods are safely stored in our warehouse." : "Your goods have been delivered. Thank you!"}
        </div>
      ) : d.live ? (
        <div ref={elRef} style={{ height: 380, borderRadius: 14, overflow: "hidden", border: "1px solid #e2e8f0" }} />
      ) : (
        <div style={{ background: "#f1f5f9", color: "#475569", borderRadius: 12, padding: "14px 16px", fontSize: 14 }}>
          🚚 Live location appears here once the team starts the trip. This page refreshes automatically.
        </div>
      )}

      {/* step progress */}
      <div style={{ marginTop: 14, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14 }}>
        {d.steps.map((s: any, i: number) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: i < d.steps.length - 1 ? "1px solid #f1f5f9" : "none" }}>
            <span style={{
              width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 800, color: s.done ? "#fff" : "#94a3b8",
              background: s.done ? "#16a34a" : "#f1f5f9", border: s.done ? "none" : "1.5px solid #cbd5e1",
            }}>{s.done ? "✓" : i + 1}</span>
            <span style={{ fontSize: 14, fontWeight: s.done ? 700 : 500, color: s.done ? "#0f172a" : "#94a3b8" }}>{s.label}</span>
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center", marginTop: 10, fontSize: 11, color: "#94a3b8" }}>updates every 30 seconds · SafeStorage transport</div>
    </div>
  );
}
