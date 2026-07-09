// Core domain model for the SafeStorage smart transport / vendor-allocation module.
// Country-agnostic: all money, distance and rule values come from RegionConfig (see config.ts),
// never hard-coded into the engine.

export type VehicleType = "14ft" | "10ft";

// Vendor tiers, as defined by SafeStorage operations (two types only):
//  - general     (Type A): obligation = 7 pallets/day at ₹6,500 (paid regardless). Extra capacity
//                          charged ₹7,000 per 7-pallet block up to the vendor's max. Fill first.
//  - non_general (Type B): no obligation, ₹8,000 per 7-pallet block. The most expensive capacity;
//                          used only once all Type A capacity is exhausted.
export type VendorTier = "general" | "non_general";

export type OrderType = "pickup" | "retrieval";
// Finer category used for the in-module filter (a partial retrieval is still a "retrieval"
// for packing/economics, but shown separately in the UI).
export type OrderCategory = "pickup" | "full_retrieval" | "partial_retrieval";

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string;
}

export interface Vehicle {
  id: string;
  type: VehicleType;
  palletCapacity: number; // 14ft -> 7, 10ft -> 4
}

export interface Vendor {
  id: string;
  name: string;
  tier: VendorTier;
  city: string;
  depot: GeoPoint; // fixed daily start location
  vehicle: Vehicle;
  palletObligation: number; // A: 7 (paid regardless); B: 0
  maxPalletsPerDay: number; // daily capacity ceiling (some A vendors can take more than 7)
  obligated: boolean; // A under contract -> base block is paid even if left idle
  phone?: string;
  priorityGroup?: string | null; // 'A' | 'B' | 'C' allocation preference (A preferred)
  // Per-vendor daily transaction cap. Generals default to the global 3; a bulk non-general like
  // Daksh Cargo ("6 transactions / ₹15,000", 14 pallets) carries 6 here.
  maxOrdersPerDay?: number;
  // Flat daily price (generals). Used as the LAST allocation tiebreak: among near-equal choices the
  // cheaper vehicle is opened first (₹5k 10ft over ₹7.5k 14ft for a small load).
  dailyPrice?: number | null;
}

export interface Booking {
  id: string;
  refNo: string;
  date: string; // ISO yyyy-mm-dd (the scheduled service day)
  type: OrderType;
  category?: OrderCategory; // pickup | full_retrieval | partial_retrieval (for the in-module filter)
  orderId?: string; // system order id (for persistence)
  isIntercity?: boolean;
  isShifting?: boolean; // house-shifting booking (rare) — shown on its own tab
  customerName: string;
  location: GeoPoint; // customer pickup / delivery address
  warehouse: GeoPoint; // destination/origin warehouse
  pallets: number; // pallets we SCHEDULE for (pickups: stated + buffer; retrievals: exact)
  statedPallets?: number; // the count the customer stated (pickups), before the buffer — for display
  requiredVehicle?: VehicleType; // vehicle sized off the stated count (pickups): 14ft (>=5) or 10ft
  lift?: string | null; // lift available at the pickup/drop site? raw value (yes/no/NA) — drives a resource
  floor?: string | null; // which floor the goods are on (raw value from the feed: "1", "9", "NA" …)
  city: string;
  timeSlot?: string; // raw slot text from the order, e.g. "10:00 AM - 11:00 AM" / "9am_11am"
  orderStatus?: string; // pending | scheduled | reschedule | request_raise | completed
  bookingDate?: string; // order_created_at from the live feed — when the customer booked (e.g. "2026-01-04 09:31:29")
  contact?: string;
  transportCharge?: number; // revenue charged to the customer (pickup_charges_with_gst / retrieval_transport_charges)
  packingCharge?: number; // packing charge (item_packing_charges) — kept for reference
  storageCharges?: number | null; // customer's storage fee (storage_charges) — populated for pickups
  teamNotes?: string; // customer_notes — operator notes incl. customer time requests
  requiredTimeText?: string; // a customer-requested time pulled from the notes, if any (e.g. "morning slot")
  requiredSlot?: { start: number; end: number }; // parsed required window (minutes from midnight) — schedule here
  coTeams?: string[]; // for a big order: the reserved 2nd/3rd team vendor ids (same family) working it
  // Existing-system manual assignment, used ONLY for the savings comparison. Never written back.
  currentVendorId?: string | null;
}

export interface CitySummary {
  slug: string;
  name: string;
  orders: number;
  pallets: number;
  vehicles: number; // teams deployed
  trips: number;
  cost: number;
  utilization: number; // 0..1
  overloads: number; // oversize / capacity issues
  unassigned: number;
}

// A single physical trip a vendor's vehicle makes. May carry 1 or 2 customers' goods
// (combined load) as long as total pallets <= vehicle capacity.
export interface Trip {
  bookingIds: string[];
  legs: TripLeg[];
  distanceKm: number;
  palletsUsed: number;
  palletCapacity: number;
}

export interface TripLeg {
  fromLabel: string;
  toLabel: string;
  km: number;
}

export interface Assignment {
  vendorId: string;
  bookingIds: string[];
  trips: Trip[];
  ordersCount: number;
  palletsAssigned: number;
  distanceKm: number;
  cost: number;
  reasoning: string[]; // human-readable "why" for each decision
}

export interface ObligationStatus {
  vendorId: string;
  vendorName: string;
  tier: VendorTier;
  required: number; // pallets required for the day (A: 7)
  assigned: number; // pallets actually assigned
  met: boolean;
  shortBy: number; // pallets short
  severity: "ok" | "at_risk" | "breach";
}

export interface PlanComparison {
  optimizedCost: number;
  manualCost: number;
  costSaved: number;
  optimizedKm: number;
  manualKm: number;
  kmSaved: number;
  optimizedVendorsUsed: number;
  manualVendorsUsed: number;
  generalTotal: number; // how many Type A vendors exist
  manualGeneralFilled: number; // A vendors that reached their 7-pallet obligation in the manual plan
  optimizedGeneralFilled: number; // A vendors that reached obligation in the optimised plan
  manualNonGenPallets: number; // pallets sent to expensive Type B in the manual plan
  optimizedNonGenPallets: number; // pallets sent to Type B in the optimised plan
}

export interface OptimizationResult {
  date: string;
  city: string;
  bookings: Booking[];
  vendors: Vendor[];
  assignments: Assignment[];
  unassigned: string[]; // booking ids with no feasible vendor (needs attention)
  obligations: ObligationStatus[];
  comparison: PlanComparison;
  kpis: {
    totalBookings: number;
    totalPallets: number;
    vendorsActive: number; // distinct vehicles/teams deployed
    totalTrips: number; // total trips run across all teams
    palletUtilization: number; // 0..1 across active vehicles
    avgCostPerBooking: number;
    consolidatedTrips: number; // trips carrying 2 customers
  };
}
