// Real road travel via OSRM (free public server) with an in-memory cache + haversine fallback. One
// `table` request returns all pairwise durations AND distances. Successful results are cached for
// the process lifetime; failures are cached briefly so we don't hammer OSRM but still retry.

type Pt = { lat: number; lng: number };
export interface RoadMatrix { dur: (number | null)[][]; dist: (number | null)[][] } // minutes, km

const cache = new Map<string, { m: RoadMatrix; ok: boolean; ts: number }>();
const FAIL_TTL = 120_000;
const OSRM_TIMEOUT = 3000;

// OSRM returns FREE-FLOW driving times; Indian metro traffic runs ~1.7x that (Google: Yeshwanthapur ->
// Kanakapura Rd 53km in ~80min ~= 40km/h average). Applied to every duration we plan/show with.
export const TRAFFIC_FACTOR = 1.7;

function haversineKm(a: Pt, b: Pt): number {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Returns N×N matrices of driving minutes and road km between the given points.
export async function roadMatrix(points: Pt[]): Promise<RoadMatrix> {
  if (points.length < 2) return { dur: [[0]], dist: [[0]] };
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(";");
  const c = cache.get(key);
  if (c && (c.ok || Date.now() - c.ts < FAIL_TTL)) return c.m;

  const fallback = (): RoadMatrix => ({
    dur: points.map((a) => points.map((b) => Math.max(10, Math.round((haversineKm(a, b) / 18) * 60)))),
    dist: points.map((a) => points.map((b) => Math.round(haversineKm(a, b) * 1.3 * 10) / 10)), // ~1.3× crow-fly
  });
  try {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration,distance`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), OSRM_TIMEOUT);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    const j: any = await r.json(); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (j?.code === "Ok" && Array.isArray(j.durations) && Array.isArray(j.distances)) {
      const m: RoadMatrix = {
        dur: j.durations.map((row: number[]) => row.map((s) => (s == null ? null : Math.max(5, Math.round((s / 60) * TRAFFIC_FACTOR))))),
        dist: j.distances.map((row: number[]) => row.map((d) => (d == null ? null : Math.round((d / 1000) * 10) / 10))),
      };
      cache.set(key, { m, ok: true, ts: Date.now() });
      return m;
    }
  } catch {
    /* fall through */
  }
  const fb = fallback();
  cache.set(key, { m: fb, ok: false, ts: Date.now() });
  return fb;
}
