// Real geocoding for order addresses, cached in MySQL (sst_geocode_cache) so each address is
// looked up once. Uses OSM Nominatim (free, no key) over node:https; falls back to the local
// approximate geocoder on any miss/failure. Nominatim asks for <=1 request/second, so live
// calls are serialized + throttled. Cached addresses return instantly.
import https from "node:https";
import { db, hasDb } from "./db";
import { geocodeAddress, CITY_CENTER } from "./geocode";
import { countryOfCity, COUNTRY_GEO } from "./country";

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

function nominatim(query: string, cc = "in"): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const path = `/search?format=json&limit=1&countrycodes=${cc}&q=${encodeURIComponent(query)}`;
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
const GEOCODE_PROVIDER = "nominatim-v4";

// Cached MISSES are retryable. A transient Nominatim failure (timeout / rate-limit) used to be
// frozen into the cache forever — the order silently kept the city-centre pin, and every distance
// computed from it was fiction (a Budigere apartment "16.9 km / 35 min" from Electronic City when
// the real drive is 44 km). We re-attempt a missed address at most once per MISS_RETRY_MS per
// process; a success overwrites the cached miss for good.
const missRetryAt = new Map<string, number>();
const MISS_RETRY_MS = 30 * 60_000;

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
const NON_LOCALITY = /karnataka|tamil ?nadu|telangana|maharashtra|west bengal|uttar pradesh|haryana|delhi|india|bengaluru|bangalore|hyderabad|chennai|mumbai|pune|kolkata|noida|gurgaon|coimbatore|ahmedabad|dubai|sharjah|abu ?dhabi|u\.?a\.?e\.?|united arab emirates/i;
const ENDS_WITH_COUNTRY = /(?:india|u\.?a\.?e\.?|united arab emirates|uk|united kingdom)\s*$/i;

function geocodeQueries(address: string, citySlug: string): string[] {
  // Parentheticals — "(JIRS)", "(opp. temple)" — break Nominatim matching outright. Strip them.
  const a = address.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").replace(/\s,/g, ",").trim().replace(/,$/, "");
  const city = cap(citySlug);
  const ctry = COUNTRY_GEO[countryOfCity(citySlug)].name; // "India" / "UAE" / "UK"
  const out: string[] = [];
  // 1. The address AS-IS (most already end "…, Karnataka, India" — appending the city CORRUPTS them:
  //    "…, Karnataka, India, Bangalore, India" misses where the raw string hits).
  out.push(ENDS_WITH_COUNTRY.test(a) ? a : `${a}, ${ctry}`);
  // 2. With the city, only when the address doesn't mention it.
  const cityRe = new RegExp(citySlug === "bangalore" ? "bangalore|bengaluru" : citySlug, "i");
  if (!cityRe.test(a)) out.push(`${a}, ${city}, ${ctry}`);
  const parts = a.split(",").map((s) => s.trim()).filter(Boolean);
  const named = parts.filter((p) => /[a-z]/i.test(p) && !/^\d+$/.test(p) && !NON_LOCALITY.test(p));
  // 3. The POI by NAME (first segment — school/society/building): Nominatim knows many of these
  //    even when the full string misses. Guarded downstream by the pincode/city sanity checks.
  const poi = named[0];
  // City-scoped first (avoids same-named POIs in other districts), then country-wide.
  if (poi && poi.length > 8) { out.push(`${poi}, ${city}, ${ctry}`); out.push(`${poi}, ${ctry}`); }
  // 4. Locality (+city), 5. pincode (INDIA only — 6-digit PINs don't exist in the UAE/UK),
  // 6. bare locality.
  const locality = named[named.length - 1];
  if (locality && locality !== poi) out.push(`${locality}, ${city}, ${ctry}`);
  const pin = ctry === "India" ? a.match(/\b(\d{6})\b/) : null;
  if (pin) out.push(`${pin[1]}, India`);
  if (locality && locality !== poi) out.push(`${locality}, ${ctry}`);
  return [...new Set(out)].slice(0, 7);
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
      // Cached miss: retry live (throttled to once per MISS_RETRY_MS per address per process).
      const last = missRetryAt.get(key) ?? 0;
      if (Date.now() - last < MISS_RETRY_MS) return local;
    }
  } catch { /* cache read failed — carry on to live lookup */ }
  missRetryAt.set(key, Date.now());

  const geo = COUNTRY_GEO[countryOfCity(citySlug)];
  // The pincode centroid anchors the search (INDIA only): any candidate far from it is a wrong match.
  const pinM = geo.name === "India" ? q.match(/\b(\d{6})\b/) : null;
  const pinPt = pinM ? await throttled(() => nominatim(`${pinM[1]}, India`, geo.code)) : null;
  // Second anchor: the CITY. Our orders are city-local, so a hit 100+ km away (a same-named
  // building/locality in another district) is always wrong.
  const centre = CITY_CENTER[citySlug] ?? null;

  // Try the queries in order; first hit that agrees with the pincode AND the city wins.
  let hit: { lat: number; lng: number } | null = null;
  for (const cand of geocodeQueries(q, citySlug)) {
    const h = await throttled(() => nominatim(cand, geo.code));
    if (!h) continue;
    if (pinPt && kmBetween(h, pinPt) > PIN_SANITY_KM) continue;
    if (centre && kmBetween(h, centre) > geo.maxKmFromCentre) continue;
    hit = h; break;
  }
  if (!hit && pinPt && (!centre || kmBetween(pinPt, centre) <= geo.maxKmFromCentre)) hit = pinPt; // pincode area ≈ 2km accurate
  try {
    await db().from("geocode_cache").upsert(
      { q: key, lat: hit ? hit.lat : null, lng: hit ? hit.lng : null, precise: hit ? 1 : 0, provider: GEOCODE_PROVIDER },
      { onConflict: "q" },
    );
  } catch { /* cache write failed — non-fatal */ }
  return hit ? { lat: hit.lat, lng: hit.lng, precise: true, locality: local.locality } : local;
}
