import { describe, it, expect } from "vitest";
import { TEMPLATES, typeWord, requestedWindow, customerMessage, vendorMessage } from "../lib/notify-templates";

describe("typeWord()", () => {
  it("maps order types to retrieval/pickup", () => {
    expect(typeWord("pickup")).toBe("pickup");
    expect(typeWord("full_retrieval")).toBe("retrieval");
    expect(typeWord("partial_retrieval")).toBe("retrieval");
    expect(typeWord(null)).toBe("pickup");
  });
});

describe("requestedWindow()", () => {
  it("returns null when no explicit time was requested", () => {
    expect(requestedWindow(null)).toBeNull();
    expect(requestedWindow("")).toBeNull();
  });
  it("derives a 1-hour window from a requested time", () => {
    expect(requestedWindow("9 am")).toBe("9 AM–10 AM");
  });
  it("passes non-numeric text through", () => {
    expect(requestedWindow("morning slot")).toBe("morning slot");
  });
});

describe("customerMessage()", () => {
  it("uses the slot template with a window when a time was requested", () => {
    const m = customerMessage({ order_type: "pickup", customer_name: "Ramesh", required_time: "9 am" }, "2026-07-05");
    expect(m.template).toBe(TEMPLATES.customerSlot);
    expect(m.bodyValues[0]).toBe("Ramesh");
    expect(m.bodyValues[1]).toBe("pickup");
    expect(m.bodyValues[3]).toBe("9 AM–10 AM");
    expect(m.bodyValues).toHaveLength(4);
  });
  it("uses the 'shortly' template with no time", () => {
    const m = customerMessage({ order_type: "full_retrieval", customer_name: "Sita" }, "2026-07-05");
    expect(m.template).toBe(TEMPLATES.customerShortly);
    expect(m.bodyValues[1]).toBe("retrieval");
    expect(m.bodyValues).toHaveLength(3);
  });
  it("NEVER leaks vendor details to the customer", () => {
    const m = customerMessage({ order_type: "pickup", customer_name: "Ramesh", contact: "9876543210" }, "2026-07-05");
    expect(JSON.stringify(m.bodyValues)).not.toMatch(/vendor|supervisor|driver/i);
  });
});

describe("vendorMessage()", () => {
  const orders = [
    { order_type: "full_retrieval", customer_name: "Kishore", contact: "9876543210", locality: "Koramangala", required_time: "9 am" },
    { order_type: "pickup", customer_name: "Pravin", contact: "9123456789", locality: "Indiranagar", time_slot: "11am_1pm" },
  ];
  it("clubs all stops into ONE message with customer contact, and no pallets", () => {
    const m = vendorMessage("Pankaj", orders, "2026-07-05");
    const list = m.bodyValues[2] as string;
    expect(m.bodyValues[0]).toBe("Pankaj");
    expect(list).toContain("Kishore");
    expect(list).toContain("9876543210");     // customer contact included
    expect(list).toContain("Pravin");
    expect(list.split("\n")).toHaveLength(2);  // one line per stop
    expect(list).not.toMatch(/pallet/i);       // pallets removed
  });
  it("uses the fixed template when any stop has a requested time", () => {
    expect(vendorMessage("V", orders, "2026-07-05").template).toBe(TEMPLATES.vendorFixed);
  });
  it("uses the recommended template when no stop has a fixed time", () => {
    const flex = [{ order_type: "pickup", customer_name: "A", contact: "1", locality: "X", time_slot: "9am_11am" }];
    expect(vendorMessage("V", flex, "2026-07-05").template).toBe(TEMPLATES.vendorRecommended);
  });
});
