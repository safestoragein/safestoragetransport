import { describe, it, expect } from "vitest";
import { baseOrderId, splitInfo, vendorFamily, splitOversizeBookings, SPLIT_CAP } from "../lib/split";
import { Booking } from "../lib/types";

const mk = (over: Partial<Booking>): Booking => ({
  id: "b1", refNo: "BH1", date: "2026-07-07", type: "retrieval", orderId: "111",
  customerName: "C", location: { lat: 0, lng: 0, label: "x" }, warehouse: { lat: 0, lng: 0, label: "wh" },
  pallets: 4, city: "Bangalore", ...over,
});

describe("baseOrderId / splitInfo", () => {
  it("strips and parses the -pNofM suffix", () => {
    expect(baseOrderId("111-p1of2")).toBe("111");
    expect(baseOrderId("111")).toBe("111");
    expect(splitInfo("111-p2of3")).toEqual({ part: 2, total: 3 });
    expect(splitInfo("111")).toBeNull();
  });
});

describe("vendorFamily", () => {
  it("collapses team suffixes to the parent vendor", () => {
    expect(vendorFamily("VMS Packers Team 1")).toBe("vms packers");
    expect(vendorFamily("VMS Packers Team 2")).toBe("vms packers");
    expect(vendorFamily("BRL Packers Dehli T2")).toBe("brl packers dehli");
    expect(vendorFamily("Unnathi Packers")).toBe("unnathi packers");
  });
});

describe("splitOversizeBookings", () => {
  it("leaves within-cap bookings untouched", () => {
    const out = splitOversizeBookings([mk({ pallets: SPLIT_CAP })]);
    expect(out).toHaveLength(1);
    expect(out[0].orderId).toBe("111");
  });
  it("splits a 16.9p booking into 2 equal parts, revenue on part 1 only", () => {
    const out = splitOversizeBookings([mk({ pallets: 16.9, transportCharge: 5000, packingCharge: 800 })]);
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.orderId)).toEqual(["111-p1of2", "111-p2of2"]);
    expect(out[0].pallets).toBeCloseTo(8.5, 1);
    expect(out[1].pallets).toBeCloseTo(8.5, 1);
    expect(out[0].pallets + out[1].pallets).toBeCloseTo(17, 1);
    expect(out[0].transportCharge).toBe(5000);
    expect(out[1].transportCharge).toBe(0); // counted once
  });
  it("splits into 3 when a load exceeds twice the cap", () => {
    const out = splitOversizeBookings([mk({ pallets: 25 })]);
    expect(out).toHaveLength(3);
    expect(out.every((b) => (b.pallets ?? 0) <= SPLIT_CAP + 1e-9)).toBe(true);
  });
});
