import { describe, it, expect } from "vitest";
import { geocodeAddress, CITY_CENTER } from "../lib/geocode";

describe("geocodeAddress()", () => {
  it("falls back to the city centre (imprecise) for an empty address", () => {
    const g = geocodeAddress("", "bangalore");
    expect(g.precise).toBe(false);
    expect(g.lat).toBe(CITY_CENTER.bangalore.lat);
    expect(g.lng).toBe(CITY_CENTER.bangalore.lng);
  });
  it("resolves a known locality to a precise pin", () => {
    const g = geocodeAddress("Plot 5, Electronic City Phase 1", "bangalore");
    expect(g.precise).toBe(true);
    expect(g.locality).toBe("electronic city");
  });
  it("picks the LONGEST matching locality (most specific)", () => {
    // "kalyan nagar" should win over any shorter substring match.
    const g = geocodeAddress("near Kalyan Nagar main road", "bangalore");
    expect(g.precise).toBe(true);
    expect(g.locality).toBe("kalyan nagar");
  });
  it("defaults unknown cities to the Bangalore centre", () => {
    const g = geocodeAddress("", "atlantis");
    expect(g.lat).toBe(CITY_CENTER.bangalore.lat);
  });
});
