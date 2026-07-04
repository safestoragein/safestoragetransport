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
    return data
      // Intercity vendors are NEVER auto-assigned to general pickup/retrieval work. Intercity orders
      // go to the manual "team to assign" bucket where the team picks an intercity vendor by hand.
      .filter((r: any) => !flag(r.is_intercity_vendor))
      .map((r: any) => {
        // Assign by the vehicle's real size: a 10ft van is capped at its own (smaller) pallet
        // capacity, a 14ft at its larger one. Never treat a 10ft as a 14ft.
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
          priorityGroup: r.priority_group ?? null,
        } as Vendor;
      });
  } catch {
    return [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
