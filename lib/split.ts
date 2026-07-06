// Auto-split of oversize bookings.
// A single booking bigger than what ONE team can carry (a 14ft tops out at ~10.95 pallets incl. the
// assumed buffer) is split into N equal loads, each ≤ one team. The optimiser then places each part;
// the sibling-team preference keeps a vendor's 2 teams working the same job. Downstream, the split
// parts share a base order id so live WMS status, the change-diff and notify all still line up.
import { Booking } from "./types";
import { VEHICLE_EFFECTIVE_CAPACITY } from "./config";

// The most one team can carry = the largest vehicle's effective cap (14ft → 10.95).
export const SPLIT_CAP = VEHICLE_EFFECTIVE_CAPACITY["14ft"];

const round1 = (n: number) => Math.round(n * 10) / 10;

// "527051861-p1of2" → "527051861" (base order id, shared by all parts of one booking).
export function baseOrderId(orderId: string | null | undefined): string {
  return String(orderId ?? "").replace(/-p\d+of\d+$/, "");
}
// "527051861-p1of2" → { part: 1, total: 2 }; null when not a split part.
export function splitInfo(orderId: string | null | undefined): { part: number; total: number } | null {
  const m = String(orderId ?? "").match(/-p(\d+)of(\d+)$/);
  return m ? { part: Number(m[1]), total: Number(m[2]) } : null;
}

// A vendor "family" = the company behind its teams. "VMS Packers Team 1/2/3" and "Unnathi Packers"
// (listed twice) collapse to one family so we can send two teams of the SAME vendor to a split job.
export function vendorFamily(name: string | null | undefined): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\s*(team|t)\s*\d+\s*$/i, "") // "… Team 2" / "… T2"
    .replace(/\s+\d+\s*$/, "")             // "… 2"
    .trim();
}

// Split every booking that can't fit one team into N equal parts. Revenue (transport + packing) is
// kept on part 1 only so the day's P&L counts it once; the parts' pallets still sum to the whole.
export function splitOversizeBookings(bookings: Booking[]): Booking[] {
  const out: Booking[] = [];
  for (const b of bookings) {
    const p = b.pallets ?? 0;
    if (p <= SPLIT_CAP + 1e-9) { out.push(b); continue; }
    const n = Math.ceil(p / SPLIT_CAP);
    const each = round1(p / n);
    const eachStated = b.statedPallets != null ? round1(b.statedPallets / n) : undefined;
    for (let i = 1; i <= n; i++) {
      out.push({
        ...b,
        id: `${b.id}::p${i}`,
        orderId: `${b.orderId}-p${i}of${n}`,
        splitGroup: String(b.orderId), // all parts of this booking share a group → same vendor family
        pallets: each,
        statedPallets: eachStated,
        transportCharge: i === 1 ? b.transportCharge : 0, // revenue counted once
        packingCharge: i === 1 ? b.packingCharge : 0,
      });
    }
  }
  return out;
}
