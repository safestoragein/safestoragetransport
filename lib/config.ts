// Region / cost configuration. Swap this object to run the same engine in any country.
//
// Cost model (SafeStorage, confirmed):
//   - Work is measured and priced in PALLETS, in blocks of 7.
//   - Type A (general): obligation = 7 pallets/day = ₹6,500 (paid regardless -> fill first).
//       Some A vendors can take more, charged ₹7,000 per extra 7-pallet block, up to their max.
//   - Type B (non-general): no obligation, ₹8,000 per 7-pallet block. Used only after A is exhausted
//       (it is the most expensive capacity).
//   Distance is NOT a cost lever (A is a fixed daily price however far they drive).

import { VehicleType, VendorTier } from "./types";

export interface RegionConfig {
  region: string;
  currency: string;
  currencySymbol: string;
  distanceUnit: "km" | "mi";

  blockPallets: number; // pricing/obligation block size (7)
  generalObligationPallets: number; // A daily obligation (7)
  generalBaseBlockCost: number; // A: first 7 pallets (₹6,500), paid whether filled or not
  generalExtraBlockCost: number; // A: each extra 7-pallet block (₹7,000)
  nonGeneralBlockCost: number; // B: each 7-pallet block (₹8,000)

  perKmCost: number; // operational display only; NOT used in cost
  defaultMaxPallets: Record<VendorTier, number>; // default daily capacity ceiling per vendor

  // Profit / loss model (confirmed with SafeStorage):
  //   our cost  = transportPerBlock x (number of 7-pallet trips) + packingPerPallet x pallets (PICKUPS only)
  //   revenue   = transport_cost + item_packing_charges (from the customer)
  //   margin    = revenue - cost.  Combining 1 pickup + 1 drop shares one transport block.
  transportPerBlock: number; // 7000 paid to the vendor per 7-pallet trip/block
  packingPerPallet: number; // 2000 packing-material cost per pallet (pickups only; drops have none)

  // Pickup pallet rule (team practice): customers under-state pallets. For PICKUPS we bump the
  // stated count — +1 below the threshold, +2 at/above it — and size the vehicle off the STATED
  // count. Retrievals are exact (from the warehouse) so neither applies to them.
  largeVehicleThreshold: number; // stated >= this -> +2 pallets & 14ft, otherwise +1 & 10ft (e.g. 5)

  // A trip of <=7 pallets costs one transport block. When a load is heavier the team adds a manual
  // labour resource (a helper) rather than a second vehicle — this is its cost, added per resource.
  resourceCost: number; // 800 per added resource (manual, per order, decided by the team)
  extraTripCost: number; // 1500 for an optional, feasible 3rd trip on a vendor (manual)
}

// Max pallets ONE vendor team can be allocated (team rule, incl. the assumed buffer):
//   14ft → 10 pallets, 10ft → 5 pallets.
export const VEHICLE_CAPACITY: Record<VehicleType, number> = {
  "14ft": 10,
  "10ft": 5,
};

// Effective cap with the accepted floor-tolerance: a load still fits ONE team while it floors to the
// rated max — 10.95 → 10 (ok on a 14ft), 11 → split; 5.9 → 5 (ok on a 10ft), 6 → split. Used for the
// fit check, trip packing and "overload" detection.
export const VEHICLE_EFFECTIVE_CAPACITY: Record<VehicleType, number> = {
  "14ft": 10.95,
  "10ft": 5.9,
};

export function effectiveCapacity(type: VehicleType): number {
  return VEHICLE_EFFECTIVE_CAPACITY[type];
}

// One team = one vehicle. Its whole-day pallet ceiling IS the effective cap above (a 14ft team tops
// out at ~10, a 10ft at ~5, buffer included). A load above that must go to a SECOND team — ideally a
// second team of the same vendor (see optimizer sibling-team preference).
export const TRIPS_PER_DAY = 2;
export function vendorDailyCap(type: VehicleType): number {
  return VEHICLE_EFFECTIVE_CAPACITY[type]; // 14ft -> 10.95, 10ft -> 5.9
}

export const REGION: RegionConfig = {
  region: "India",
  currency: "INR",
  currencySymbol: "₹",
  distanceUnit: "km",

  blockPallets: 7,
  generalObligationPallets: 7,
  generalBaseBlockCost: 7000, // no obligation now: a <=7-pallet block is ₹7,000 (no discounted base)
  generalExtraBlockCost: 7000,
  nonGeneralBlockCost: 8000,

  perKmCost: 22,
  defaultMaxPallets: { general: 21, non_general: 21 },

  transportPerBlock: 7000,
  packingPerPallet: 2000,

  largeVehicleThreshold: 5,
  resourceCost: 800,
  extraTripCost: 1500,
};

// Pickup-only: bump the stated pallet count — +2 at/above the threshold, +1 below it.
export function bufferedPickupPallets(stated: number): number {
  const add = stated >= REGION.largeVehicleThreshold ? 2 : 1;
  return Math.round((stated + add) * 10) / 10;
}

// Vehicle sizing off the STATED count: >= threshold means a 14ft, otherwise a 10ft.
export function requiredVehicleFor(stated: number): VehicleType {
  return stated >= REGION.largeVehicleThreshold ? "14ft" : "10ft";
}

export const TIER_LABEL: Record<VendorTier, string> = {
  general: "General (A)",
  non_general: "Non-general (B)",
};

export const TIER_DESCRIPTION: Record<VendorTier, string> = {
  general: "Obligation 7 pallets/day · ₹6,500 base · fill first",
  non_general: "No obligation · ₹8,000 / 7 pallets · overflow only",
};

// Cost of assigning `pallets` to a vendor (the marginal/used cost, blocks of 7).
export function palletCost(tier: VendorTier, pallets: number): number {
  if (pallets <= 0) return 0;
  const blocks = Math.ceil(pallets / REGION.blockPallets - 1e-9);
  if (tier === "general") {
    return REGION.generalBaseBlockCost + Math.max(0, blocks - 1) * REGION.generalExtraBlockCost;
  }
  return blocks * REGION.nonGeneralBlockCost;
}
