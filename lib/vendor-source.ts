// Build the optimiser's Vendor[] from the Supabase vendor master (real depots, tiers, vehicles).
// Falls back to an empty list if Supabase isn't configured or the city has no master vendors.

import { db, hasDb } from "./db";
import { geocodeAddress } from "./geocode";
import { Vendor, VehicleType } from "./types";
import { VEHICLE_CAPACITY, vendorDailyCap } from "./config";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function masterVendorsForCity(citySlug: string): Promise<Vendor[]> {
  if (!hasDb) return [];
  try {
    const { data, error } = await db().from("vendors").select("*").eq("active", true).ilike("city", citySlug);
    if (error || !data) return [];
    return data.map((r: any) => {
      const vt: VehicleType = r.vehicle_type === "10ft" ? "10ft" : "14ft";
      const g = geocodeAddress(r.starting_point || "", citySlug);
      const tier = r.tier === "non_general" ? "non_general" : "general";
      return {
        id: r.id,
        name: r.name,
        tier,
        city: r.city,
        depot: { lat: r.starting_lat ?? g.lat, lng: r.starting_lng ?? g.lng, label: r.starting_point || r.name },
        vehicle: { id: `${r.id}-VH`, type: vt, palletCapacity: VEHICLE_CAPACITY[vt] },
        palletObligation: 0, // no obligation: a vendor is paid only if used, nothing if idle
        maxPalletsPerDay: vendorDailyCap(vt), // ONE vehicle/day (rated + tolerance): 14ft 9, 10ft 6
        obligated: false,
      } as Vendor;
    });
  } catch {
    return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
