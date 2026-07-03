import { describe, it, expect } from "vitest";
import { normalizePhone } from "../lib/interakt";

describe("normalizePhone()", () => {
  it("splits a bare 10-digit Indian number", () => {
    expect(normalizePhone("9876543210")).toEqual({ countryCode: "+91", phoneNumber: "9876543210" });
  });
  it("strips the 91 country prefix", () => {
    expect(normalizePhone("919876543210")).toEqual({ countryCode: "+91", phoneNumber: "9876543210" });
  });
  it("strips a leading 0", () => {
    expect(normalizePhone("09876543210")).toEqual({ countryCode: "+91", phoneNumber: "9876543210" });
  });
  it("takes the first number from a '/'-separated pair and ignores formatting", () => {
    expect(normalizePhone("+91 98765 43210 / 9123456789")).toEqual({ countryCode: "+91", phoneNumber: "9876543210" });
  });
  it("returns null for empty or too-short input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
  });
});
