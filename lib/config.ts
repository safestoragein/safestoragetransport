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

// Rated capacity (what we quote): 14ft = 7 pallets, 10ft = 4.
export const VEHICLE_CAPACITY: Record<VehicleType, number> = {
  "14ft": 7,
  "10ft": 4,
};

// Effective capacity with the accepted overage tolerance — a 14ft may take up to 7.5 and a
// 10ft up to 4.2 pallets in practice. Used for trip packing and for "overload" detection so
// within-tolerance loads (e.g. 7.2 on a 14ft) are NOT flagged as problems.
export const VEHICLE_EFFECTIVE_CAPACITY: Record<VehicleType, number> = {
  "14ft": 7.5,
  "10ft": 4.2,
};

export function effectiveCapacity(type: VehicleType): number {
  return VEHICLE_EFFECTIVE_CAPACITY[type];
}

// A vendor's WHOLE DAY totals ~7 pallets (±2) — one vehicle, ₹7,000. Those pallets are picked up
// across up to 2 trips/stops (a pickup is heavy: packing ~4-5h + traffic); a rare 3rd stop only if
// it's small and in the same direction. The total still stays within 7±2 either way. So the daily
// cap is the rated load + 2 tolerance (NOT two vehicle loads).
export const TRIPS_PER_DAY = 2;
export function vendorDailyCap(type: VehicleType): number {
  return VEHICLE_CAPACITY[type] + 2; // 14ft -> 9, 10ft -> 6
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
