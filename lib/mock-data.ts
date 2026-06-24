// Sample dataset modelled on a real SafeStorage Hyderabad operating day.
// In production these come from the existing-system adapter (safestorage-api.ts).

import { Booking, Vendor, VendorTier, VehicleType } from "./types";
import { REGION, VEHICLE_CAPACITY } from "./config";

const WAREHOUSES = {
  west: { lat: 17.455, lng: 78.366, label: "WH West · Kondapur" },
  north: { lat: 17.495, lng: 78.399, label: "WH North · Kukatpally" },
  central: { lat: 17.437, lng: 78.448, label: "WH Central · Ameerpet" },
};

// Five Type A (general) vendors — obligation 7 pallets/day; some can take more.
// Two Type B (non-general) vendors — no obligation, expensive overflow.
export const VENDORS: Vendor[] = [
  mkVendor("V-A1", "Ravi Movers", "general", { lat: 17.4615, lng: 78.364, label: "Kondapur depot" }, "14ft", 21),
  mkVendor("V-A2", "Sai Logistics", "general", { lat: 17.4948, lng: 78.3996, label: "Kukatpally depot" }, "10ft", 7),
  mkVendor("V-A3", "Hari Transport", "general", { lat: 17.3457, lng: 78.5522, label: "LB Nagar depot" }, "14ft", 14),
  mkVendor("V-A4", "Krishna Packers", "general", { lat: 17.4483, lng: 78.3915, label: "Madhapur depot" }, "14ft", 21),
  mkVendor("V-A5", "Teja Movers", "general", { lat: 17.4968, lng: 78.3585, label: "Miyapur depot" }, "14ft", 14),
  mkVendor("V-B1", "Quick Shift", "non_general", { lat: 17.4156, lng: 78.4347, label: "Banjara Hills depot" }, "14ft", 21),
  mkVendor("V-B2", "City Haul", "non_general", { lat: 17.4058, lng: 78.559, label: "Uppal depot" }, "14ft", 21),
];

function mkVendor(
  id: string,
  name: string,
  tier: VendorTier,
  depot: Vendor["depot"],
  vehicleType: VehicleType,
  maxPallets: number,
): Vendor {
  return {
    id,
    name,
    tier,
    city: "Hyderabad",
    depot,
    vehicle: { id: `${id}-VH`, type: vehicleType, palletCapacity: VEHICLE_CAPACITY[vehicleType] },
    palletObligation: tier === "general" ? REGION.generalObligationPallets : 0,
    maxPalletsPerDay: maxPallets,
    obligated: tier === "general",
  };
}

// `currentVendorId` is a deliberately sub-optimal manual plan: it leans on expensive Type B
// vendors and leaves Type A obligations unfilled — so the optimiser's savings are visible.
interface Seed {
  refNo: string;
  type: Booking["type"];
  customerName: string;
  area: string;
  lat: number;
  lng: number;
  pallets: number;
  wh: keyof typeof WAREHOUSES;
  currentVendorId: string | null;
}

const SEEDS: Seed[] = [
  { refNo: "SS-10421", type: "pickup", customerName: "Aarav Sharma", area: "Gachibowli", lat: 17.4401, lng: 78.3489, pallets: 3.5, wh: "west", currentVendorId: "V-B1" },
  { refNo: "SS-10422", type: "pickup", customerName: "Priya Nair", area: "Kondapur", lat: 17.4615, lng: 78.364, pallets: 3.5, wh: "west", currentVendorId: "V-B1" },
  { refNo: "SS-10423", type: "pickup", customerName: "Imran Khan", area: "Madhapur", lat: 17.4483, lng: 78.3915, pallets: 2, wh: "west", currentVendorId: "V-B2" },
  { refNo: "SS-10424", type: "retrieval", customerName: "Sneha Reddy", area: "Hitec City", lat: 17.4474, lng: 78.3762, pallets: 2, wh: "west", currentVendorId: "V-B2" },
  { refNo: "SS-10425", type: "pickup", customerName: "Rahul Verma", area: "Kukatpally", lat: 17.4948, lng: 78.3996, pallets: 4, wh: "north", currentVendorId: "V-A2" },
  { refNo: "SS-10426", type: "pickup", customerName: "Ananya Iyer", area: "Miyapur", lat: 17.4968, lng: 78.3585, pallets: 3.5, wh: "north", currentVendorId: "V-B2" },
  { refNo: "SS-10427", type: "retrieval", customerName: "Vikram Singh", area: "Nizampet", lat: 17.5093, lng: 78.3866, pallets: 2, wh: "north", currentVendorId: "V-B1" },
  { refNo: "SS-10428", type: "pickup", customerName: "Meera Joshi", area: "Kompally", lat: 17.5366, lng: 78.4869, pallets: 3.5, wh: "north", currentVendorId: "V-B2" },
  { refNo: "SS-10429", type: "pickup", customerName: "Karthik Rao", area: "Banjara Hills", lat: 17.4156, lng: 78.4347, pallets: 2, wh: "central", currentVendorId: "V-B1" },
  { refNo: "SS-10430", type: "pickup", customerName: "Divya Menon", area: "Ameerpet", lat: 17.4374, lng: 78.4487, pallets: 2, wh: "central", currentVendorId: "V-B1" },
  { refNo: "SS-10431", type: "retrieval", customerName: "Suresh Babu", area: "Begumpet", lat: 17.4443, lng: 78.4699, pallets: 3, wh: "central", currentVendorId: "V-B2" },
  { refNo: "SS-10432", type: "pickup", customerName: "Pooja Gupta", area: "Jubilee Hills", lat: 17.4313, lng: 78.407, pallets: 3.5, wh: "central", currentVendorId: "V-A4" },
  { refNo: "SS-10433", type: "pickup", customerName: "Nikhil Jain", area: "LB Nagar", lat: 17.3457, lng: 78.5522, pallets: 4, wh: "central", currentVendorId: "V-B2" },
  { refNo: "SS-10434", type: "retrieval", customerName: "Lakshmi Devi", area: "Uppal", lat: 17.4058, lng: 78.559, pallets: 2, wh: "central", currentVendorId: "V-B2" },
  { refNo: "SS-10435", type: "pickup", customerName: "Arjun Pillai", area: "Manikonda", lat: 17.4036, lng: 78.3829, pallets: 3.5, wh: "west", currentVendorId: "V-A4" },
  { refNo: "SS-10436", type: "pickup", customerName: "Fatima Begum", area: "Mehdipatnam", lat: 17.3961, lng: 78.4385, pallets: 2, wh: "central", currentVendorId: "V-B1" },
];

const SLOTS = ["9:00 AM - 10:00 AM", "10:00 AM - 11:00 AM", "11:00 AM - 12:00 PM", "12:00 PM - 1:00 PM", "1:00 PM - 2:00 PM", "2:00 PM - 3:00 PM", "3:00 PM - 4:00 PM"];
const STATUSES = ["scheduled", "scheduled", "pending", "scheduled", "pending", "reschedule", "scheduled", "request_raise"];

export function getBookings(date: string): Booking[] {
  return SEEDS.map((s, i) => ({
    id: `BK-${date}-${i + 1}`,
    refNo: s.refNo,
    date,
    type: s.type,
    category: s.type === "retrieval" ? "full_retrieval" : "pickup",
    customerName: s.customerName,
    location: { lat: s.lat, lng: s.lng, label: s.area },
    warehouse: WAREHOUSES[s.wh],
    pallets: s.pallets,
    city: "Hyderabad",
    timeSlot: SLOTS[i % SLOTS.length],
    orderStatus: STATUSES[i % STATUSES.length],
    transportCharge: 3000 + Math.round(s.pallets * 600),
    packingCharge: s.type === "pickup" ? Math.round(s.pallets * 1100) : 0,
    currentVendorId: s.currentVendorId,
  }));
}

export function getVendors(): Vendor[] {
  return VENDORS;
}
