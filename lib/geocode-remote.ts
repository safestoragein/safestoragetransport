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

export async function geocodeCached(address: string, citySlug: string): Promise<Geo> {
  const local = geocodeAddress(address || "", citySlug); // approximate fallback (+ city centre)
  const q = (address || "").trim();
  if (!q || !hasDb) return local;
  const key = norm(`${q}|${citySlug}`);

  try {
    const { data } = await db().from("geocode_cache").select("*").eq("q", key).maybeSingle();
    if (data) {
      if (data.lat != null && data.lng != null) return { lat: Number(data.lat), lng: Number(data.lng), precise: !!data.precise, locality: local.locality };
      return local; // cached miss → local fallback
    }
  } catch { /* cache read failed — carry on to live lookup */ }

  const hit = await throttled(() => nominatim(`${q}, ${cap(citySlug)}, India`));
  try {
    await db().from("geocode_cache").upsert(
      { q: key, lat: hit ? hit.lat : null, lng: hit ? hit.lng : null, precise: hit ? 1 : 0, provider: "nominatim" },
      { onConflict: "q" },
    );
  } catch { /* cache write failed — non-fatal */ }
  return hit ? { lat: hit.lat, lng: hit.lng, precise: true, locality: local.locality } : local;
}
