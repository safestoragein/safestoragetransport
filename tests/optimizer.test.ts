import { describe, it, expect } from "vitest";
import { optimize } from "../lib/optimizer";
import { getBookings, getVendors } from "../lib/mock-data";

const date = "2026-07-05";
const bookings = getBookings(date);
const vendors = getVendors();
const res = optimize(date, "Bangalore", bookings, vendors);
const vById = new Map(vendors.map((v) => [v.id, v]));
const assignedIds = res.assignments.flatMap((a) => a.bookingIds);

describe("optimize()", () => {
  it("returns a well-formed result", () => {
    expect(Array.isArray(res.assignments)).toBe(true);
    expect(Array.isArray(res.unassigned)).toBe(true);
    expect(res.kpis.totalBookings).toBe(bookings.length);
  });

  it("partitions every booking into exactly one of assigned/unassigned (no loss, no duplicate)", () => {
    const union = [...assignedIds, ...res.unassigned];
    expect(new Set(union).size).toBe(union.length); // no booking counted twice
    expect([...union].sort()).toEqual(bookings.map((b) => b.id).sort()); // every booking accounted for
  });

  it("only assigns to real vendor ids", () => {
    for (const a of res.assignments) expect(vById.has(a.vendorId)).toBe(true);
  });

  it("never auto-assigns intercity bookings (they go to the manual bucket)", () => {
    const assigned = new Set(assignedIds);
    for (const b of bookings) if (b.isIntercity) expect(assigned.has(b.id)).toBe(false);
  });

  it("each assignment's bookingIds match the sum of its trips", () => {
    for (const a of res.assignments) {
      const fromTrips = a.trips.flatMap((t) => t.bookingIds).sort();
      expect(a.bookingIds.slice().sort()).toEqual(fromTrips);
    }
  });

  it("keeps a vendor within its daily pallet capacity per trip", () => {
    for (const a of res.assignments) {
      const v = vById.get(a.vendorId)!;
      for (const t of a.trips) {
        const tripPallets = t.bookingIds.reduce((s, id) => s + (bookings.find((b) => b.id === id)?.pallets ?? 0), 0);
        expect(tripPallets).toBeLessThanOrEqual(v.vehicle.palletCapacity + 1); // +1 tolerance for the overage rule
      }
    }
  });
});
