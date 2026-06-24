import { GeoPoint } from "./types";

const EARTH_KM = 6371;

const toRad = (d: number) => (d * Math.PI) / 180;

// Great-circle distance in km. We multiply by a small road factor so straight-line
// distances better approximate real driving distance (a real deployment swaps this for
// an OSRM/Google distance-matrix call behind the same function signature).
const ROAD_FACTOR = 1.3;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.asin(Math.sqrt(h));
}

export function roadKm(a: GeoPoint, b: GeoPoint): number {
  return round1(haversineKm(a, b) * ROAD_FACTOR);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Project a set of geo points into 0..1 x/y space for the schematic map (no tiles/keys).
// Web-mercator-ish: lng -> x linear, lat -> mercator y, then normalise to the bounds.
export function projectPoints(points: GeoPoint[]): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const mercY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + toRad(lat) / 2));

  const xs = points.map((p) => p.lng);
  const ys = points.map((p) => mercY(p.lat));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  return points.map((p) => ({
    x: (p.lng - minX) / spanX,
    y: 1 - (mercY(p.lat) - minY) / spanY, // invert: north at top
  }));
}
