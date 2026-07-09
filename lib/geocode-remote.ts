// Real geocoding for order addresses, cached in MySQL (sst_geocode_cache) so each address is
// looked up once. Uses OSM Nominatim (free, no key) over node:https; falls back to the local
// approximate geocoder on any miss/failure. Nominatim asks for <=1 request/second, so live
// calls are serialized + throttled. Cached addresses return instantly.
import https from "node:https";
import { db, hasDb } from "./db";
import { geocodeAddress } from "./geocode";

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 255);

let chain: Promise<unknown> = Promise.resolve();
let lastAt = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = 1100 - (Date.now() - lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run as Promise<T>;
}

function nominatim(query: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const path = `/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(query)}`;
    const req = https.request(
      { hostname: "nominatim.openstreetmap.org", path, method: "GET", headers: { "User-Agent": "SafeStorageTransport/1.0 (admin@safestorage.in)", Accept: "application/json" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          try {
            const arr = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (Array.isArray(arr) && arr[0]?.lat && arr[0]?.lon) resolve({ lat: Number(arr[0].lat), lng: Number(arr[0].lon) });
            else resolve(null);
          } catch { resolve(null); }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.setTimeout(6000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

export interface Geo { lat: number; lng: number; precise: boolean; locality?: string | null }

// Bump this when the query strategy changes so already-cached results get re-validated once.
const GEOCODE_PROVIDER = "nominatim-v3";

// A candidate hit must land within this distance of the address's PINCODE centroid — otherwise it's
// a wrong match (e.g. "Jain International Residential School" fuzzy-matching a city campus 35km from
// the real Kanakapura Rd one). If nothing passes, the pincode centroid itself is used (~2km accuracy).
const PIN_SANITY_KM = 25;
function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Nominatim can't parse full Indian apartment strings ("Eden Park @ The Prestige City, …"), so it
// used to miss ~70% of orders → they all fell back to the city centre and the optimiser couldn't
// cluster them. We now try progressively simpler queries and take the first that resolves:
//   1. the full address           (most specific; often fails for apartments)
//   2. locality + city            (e.g. "Sarjapura, Bengaluru" — usually resolves)
//   3. the 6-digit PINCODE        (very reliable, ~2 km accuracy — best for clustering)
//   4. just the locality
function geocodeQueries(address: string, citySlug: string): string[] {
  const a = address.trim();
  const city = cap(citySlug);
  const out: string[] = [`${a}, ${city}, India`];
  const parts = a.split(",").map((s) => s.trim()).filter(Boolean);
  const named = parts.filter((p) => /[a-z]/i.test(p) && !/^\d/.test(p) && !/karnataka|tamil ?nadu|telangana|maharashtra|delhi|india|bengaluru|bangalore/i.test(p));
  const locality = named[named.length - 1]; // last named segment before city/state = the area
  if (locality) out.push(`${locality}, ${city}, India`);
  const pin = a.match(/\b(\d{6})\b/);
  if (pin) out.push(`${pin[1]}, India`);
  if (locality) out.push(`${locality}, India`);
  return [...new Set(out)].slice(0, 4);
}

export async function geocodeCached(address: string, citySlug: string): Promise<Geo> {
  const local = geocodeAddress(address || "", citySlug); // approximate fallback (+ city centre)
  const q = (address || "").trim();
  if (!q || !hasDb) return local;
  const key = norm(`${q}|${citySlug}`);

  try {
    const { data } = await db().from("geocode_cache").select("*").eq("q", key).maybeSingle();
    if (data && data.provider === GEOCODE_PROVIDER) {
      // Only trust entries from the CURRENT strategy — older hits may be pre-pincode-validation
      // mismatches (35km off), so anything older is re-looked-up once and re-cached.
      if (data.lat != null && data.lng != null) return { lat: Number(data.lat), lng: Number(data.lng), precise: !!data.precise, locality: local.locality };
      return local; // cached miss under the current strategy
    }
  } catch { /* cache read failed — carry on to live lookup */ }

  // The pincode centroid anchors the search: any candidate landing far from it is a wrong match.
  const pinM = q.match(/\b(\d{6})\b/);
  const pinPt = pinM ? await throttled(() => nominatim(`${pinM[1]}, India`)) : null;

  // Try the queries in order; first hit that agrees with the pincode wins.
  let hit: { lat: number; lng: number } | null = null;
  for (const cand of geocodeQueries(q, citySlug)) {
    const h = await throttled(() => nominatim(cand));
    if (h && (!pinPt || kmBetween(h, pinPt) <= PIN_SANITY_KM)) { hit = h; break; }
  }
  if (!hit && pinPt) hit = pinPt; // nothing sane matched → the pincode area is still ~2km accurate
  try {
    await db().from("geocode_cache").upsert(
      { q: key, lat: hit ? hit.lat : null, lng: hit ? hit.lng : null, precise: hit ? 1 : 0, provider: GEOCODE_PROVIDER },
      { onConflict: "q" },
    );
  } catch { /* cache write failed — non-fatal */ }
  return hit ? { lat: hit.lat, lng: hit.lng, precise: true, locality: local.locality } : local;
}
