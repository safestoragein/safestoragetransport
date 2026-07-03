import { describe, it, expect } from "vitest";
import { parseSlot, parseRequiredTime, fmtMin } from "../lib/timeslot";

describe("parseSlot()", () => {
  it("parses a two-ended slot like '9am_11am'", () => {
    expect(parseSlot("9am_11am")).toEqual({ startMin: 9 * 60, endMin: 11 * 60 });
  });
  it("defaults to a 1-hour window when only one time is given", () => {
    expect(parseSlot("10 am")).toEqual({ startMin: 10 * 60, endMin: 11 * 60 });
  });
  it("returns null for empty/garbage", () => {
    expect(parseSlot(null)).toBeNull();
    expect(parseSlot("no numbers here")).toBeNull();
  });
});

describe("fmtMin()", () => {
  it("formats minutes-from-midnight as 12h time", () => {
    expect(fmtMin(0)).toBe("12 AM");
    expect(fmtMin(9 * 60)).toBe("9 AM");
    expect(fmtMin(12 * 60)).toBe("12 PM");
    expect(fmtMin(13 * 60 + 30)).toBe("1:30 PM");
  });
});

describe("parseRequiredTime()", () => {
  it("returns null when there's no time hint", () => {
    expect(parseRequiredTime("please handle with care")).toBeNull();
    expect(parseRequiredTime(null)).toBeNull();
  });
  it("extracts an explicit clock time", () => {
    const r = parseRequiredTime("customer wants pickup at 10 am");
    expect(r?.slot).toEqual({ startMin: 10 * 60, endMin: 11 * 60 });
  });
  it("handles 'before' as a bounded window ending at the time", () => {
    const r = parseRequiredTime("please come before 2pm");
    expect(r?.slot?.endMin).toBe(14 * 60);
  });
  it("maps 'morning slot' to a morning window", () => {
    const r = parseRequiredTime("morning slot preferred");
    expect(r?.text).toBe("morning slot");
    expect(r?.slot).toEqual({ startMin: 9 * 60, endMin: 12 * 60 });
  });
});
