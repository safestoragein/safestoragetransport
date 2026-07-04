import { describe, it, expect } from "vitest";
import { normalizePhone, issueVendorToken, verifyVendor } from "../lib/vendor-auth";
import { NextRequest } from "next/server";

describe("normalizePhone", () => {
  it("keeps the last 10 digits, dropping +91 / spaces / punctuation", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("098765-43210")).toBe("9876543210");
    expect(normalizePhone("9876543210")).toBe("9876543210");
  });
  it("returns short/empty inputs as-is-ish", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("12345")).toBe("12345");
  });
});

describe("vendor token round-trip", () => {
  const id = { vendorId: "veh-123", name: "Rainbow Packers", city: "Bangalore", phone: "9876543210" };
  it("issues a token that verifies back to the vendor id", () => {
    const token = issueVendorToken(id);
    const req = new NextRequest("http://x/api/vendor/assignments", { headers: { authorization: `Bearer ${token}` } });
    const v = verifyVendor(req);
    expect(v?.vendorId).toBe("veh-123");
    expect(v?.name).toBe("Rainbow Packers");
  });
  it("rejects a missing or malformed token", () => {
    expect(verifyVendor(new NextRequest("http://x"))).toBeNull();
    expect(verifyVendor(new NextRequest("http://x", { headers: { authorization: "Bearer garbage" } }))).toBeNull();
  });
  it("rejects a non-vendor (admin) session token", () => {
    // an admin cookie token must NOT authorise vendor endpoints
    const req = new NextRequest("http://x", { headers: { authorization: "Bearer eyJ.not-a-vendor.sig" } });
    expect(verifyVendor(req)).toBeNull();
  });
});
