// Build the optimiser's Vendor[] from the Supabase vendor master (real depots, tiers, vehicles).
// Falls back to an empty list if Supabase isn't configured or the city has no master vendors.

import { db, hasDb } from "./db";
import { geocodeAddress } from "./geocode";
import { Vendor, VehicleType } from "./types";
import { VEHICLE_CAPACITY, vendorDailyCap } from "./config";
import { flag } from "./format";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function masterVendorsForCity(citySlug: string): Promise<Vendor[]> {
  if (!hasDb) return [];
  try {
    const { data, error } = await db().from("vendors").select("*").eq("active", true).ilike("city", citySlug);
    if (error || !data) return [];
    // Self-heal panel-added vendors that have a starting point but no coordinates (the panel saves
    // text only): geocode once (cached) and persist, so day plans get real km and allocation gets a
    // real depot instead of the city centre.
    for (const r of data as any[]) {
      if ((r.starting_lat == null || r.starting_lng == null) && r.starting_point) {
        try {
          const { geocodeCached } = await import("./geocode-remote");
          const remote = await geocodeCached(r.starting_point, citySlug);
          if (remote.precise) {
            r.starting_lat = remote.lat; r.starting_lng = remote.lng;
            await db().from("vendors").update({ starting_lat: remote.lat, starting_lng: remote.lng }).eq("id", r.id);
          }
        } catch { /* offline fallback below still applies */ }
      }
    }
    return data
      // The optimiser pool = every vendor that does LOCAL pickup/retrieval — including an intercity
      // vendor that also runs local. A vendor is excluded only if it does NOT do local work.
      // (Before the does_local migration runs the column is absent, so fall back to the old rule:
      // exclude intercity vendors.)
      .filter((r: any) => (r.does_local != null ? flag(r.does_local) : !flag(r.is_intercity_vendor)))
      .map((r: any) => {
        // Assign by the vehicle's real size: a 10ft van is capped at its own (smaller) pallet
        // capacity, a 14ft at its larger one. Never treat a 10ft as a 14ft. For an "others"/unknown
        // vehicle type (no 10ft/14ft label) fall back to the vendor's declared RATED pallet capacity:
        // the small (~4-pallet) class behaves like a 10ft, the large (~7-pallet) class like a 14ft.
        const rated = Number(r.pallet_capacity) || 0;
        const vt: VehicleType =
          r.vehicle_type === "10ft" ? "10ft"
          : r.vehicle_type === "14ft" ? "14ft"
          : (rated > 0 && rated <= 5.5 ? "10ft" : "14ft");
        const g = geocodeAddress(r.starting_point || "", citySlug);
        const tier = r.tier === "non_general" ? "non_general" : "general";
        // Bulk non-generals (e.g. Daksh Cargo "6 transactions / ₹15,000") work per-transaction with a
        // bigger day: N transactions (from the pricing note, default 6) across 2 trips — up to
        // 2 × rated pallets (Daksh: 2 × 7 = 14). Generals stay at the standard 3-orders/vehicle-cap day.
        const txn = tier === "non_general" ? (String(r.pricing_note || "").match(/(\d+)\s*transaction/i)?.[1] ?? "6") : null;
        return {
          id: r.id,
          name: r.name,
          tier,
          city: r.city,
          depot: { lat: r.starting_lat ?? g.lat, lng: r.starting_lng ?? g.lng, label: r.starting_point || r.name },
          vehicle: { id: `${r.id}-VH`, type: vt, palletCapacity: VEHICLE_CAPACITY[vt] },
          palletObligation: 0, // no obligation: a vendor is paid only if used, nothing if idle
          maxPalletsPerDay: tier === "non_general" ? 2 * (rated > 0 ? rated : 7) : vendorDailyCap(vt),
          maxOrdersPerDay: txn != null ? Number(txn) : undefined,
          dailyPrice: r.daily_price != null ? Number(r.daily_price) : null,
          obligated: false,
          priorityGroup: r.priority_group ?? null,
        } as Vendor;
      });
  } catch {
    return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
