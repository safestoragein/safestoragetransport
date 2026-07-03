import { describe, it, expect } from "vitest";
import { flag, money, pct } from "../lib/format";

describe("flag()", () => {
  it("treats 0 / '0' / null / false / '' as false (the intercity='0' bug)", () => {
    for (const v of [0, "0", null, undefined, false, "", "false", "FALSE", "no", 2, "2"]) {
      expect(flag(v)).toBe(false);
    }
  });
  it("treats 1 / '1' / true / 'true' (any case/space) as true", () => {
    for (const v of [1, "1", true, "true", "TRUE", " 1 ", " true "]) {
      expect(flag(v)).toBe(true);
    }
  });
});

describe("money()", () => {
  it("formats INR with grouping and no decimals", () => {
    expect(money(1234567)).toBe("₹12,34,567");
    expect(money(0)).toBe("₹0");
    expect(money(999.6)).toBe("₹1,000");
  });
});

describe("pct()", () => {
  it("rounds a 0..1 fraction to a percent", () => {
    expect(pct(0.5)).toBe("50%");
    expect(pct(0.833)).toBe("83%");
  });
});
