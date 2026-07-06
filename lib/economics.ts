// Profit / loss per the confirmed SafeStorage model.
//   cost   = transportPerBlock x (number of trips) + packingPerPallet x pallets  (PICKUPS only)
//   revenue = transport_cost + item_packing_charges  (from the customer)
//   margin  = revenue - cost
// Drops (retrievals) have no packing cost, so combining a pickup + a drop in one trip shares the
// single transport block and adds the drop's revenue with almost no extra cost.

import { OptimizationResult, Booking } from "./types";
import { REGION, teamsNeeded } from "./config";
import { round1 } from "./geo";

export interface VendorPnL {
  vendorId: string;
  name: string;
  trips: number;
  pickups: number;
  drops: number;
  pallets: number;
  revenue: number;
  transportCost: number;
  packingCost: number;
  cost: number;
  margin: number;
}

export interface DayPnL {
  revenue: number;
  transportCost: number;
  packingCost: number;
  cost: number;
  margin: number;
  marginPct: number; // margin / revenue
  lossVendors: number;
  combinedPickupDrop: number; // trips that pair a pickup with a drop
  vendors: VendorPnL[];
}

// Revenue = the team-confirmed charge field (pickup total-with-GST already includes packing;
// retrieval transport charge). We do NOT add packingCharge again — it's a component of the total.
const rev = (b?: Booking) => (b ? b.transportCharge ?? 0 : 0);

export function computePnL(result: OptimizationResult, opts?: { packingPerPallet?: number }): DayPnL {
  const packingPerPallet = opts?.packingPerPallet ?? REGION.packingPerPallet;
  const byId = new Map(result.bookings.map((b) => [b.id, b]));
  const vendors: VendorPnL[] = [];
  let combinedPickupDrop = 0;

  for (const a of result.assignments) {
    const name = result.vendors.find((v) => v.id === a.vendorId)?.name ?? a.vendorId;
    let revenue = 0, packingCost = 0, pickups = 0, drops = 0, pallets = 0, extraTeams = 0;
    for (const t of a.trips) {
      const bs = t.bookingIds.map((id) => byId.get(id)).filter(Boolean) as Booking[];
      const hasPickup = bs.some((b) => b.type === "pickup");
      const hasDrop = bs.some((b) => b.type === "retrieval");
      if (hasPickup && hasDrop) combinedPickupDrop++;
      for (const b of bs) {
        revenue += rev(b);
        pallets += b.pallets;
        extraTeams += Math.max(0, teamsNeeded(b.pallets) - 1); // a big order runs 2 (or more) teams
        if (b.type === "pickup") { pickups++; packingCost += b.pallets * packingPerPallet; }
        else drops++;
      }
    }
    // One vendor = one vehicle for the day = one flat block (₹7,000). A big order that runs 2+ teams
    // of the vendor pays a block per extra team.
    const transportCost = (a.trips.length ? REGION.transportPerBlock : 0) + extraTeams * REGION.transportPerBlock;
    const cost = transportCost + packingCost;
    vendors.push({
      vendorId: a.vendorId, name, trips: a.trips.length, pickups, drops,
      pallets: round1(pallets), revenue: Math.round(revenue),
      transportCost, packingCost: Math.round(packingCost), cost: Math.round(transportCost + packingCost),
      margin: Math.round(revenue - cost),
    });
  }

  const sum = (k: keyof VendorPnL) => vendors.reduce((s, v) => s + (v[k] as number), 0);
  const revenue = sum("revenue"), transportCost = sum("transportCost"), packingCost = sum("packingCost");
  const cost = transportCost + packingCost;
  const margin = revenue - cost;
  return {
    revenue, transportCost, packingCost, cost, margin,
    marginPct: revenue ? margin / revenue : 0,
    lossVendors: vendors.filter((v) => v.margin < 0).length,
    combinedPickupDrop,
    vendors: vendors.sort((a, b) => a.margin - b.margin), // worst margin first
  };
}
