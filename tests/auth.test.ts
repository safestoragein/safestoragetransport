import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signSession, verifySession, SESSION_MAX_AGE } from "../lib/auth";

describe("password hashing", () => {
  it("round-trips a correct password and rejects a wrong one", () => {
    const stored = hashPassword("SafeStorage@2026");
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(verifyPassword("SafeStorage@2026", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });
  it("rejects malformed/empty stored hashes without throwing", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "no-colon")).toBe(false);
    expect(verifyPassword("x", "abc:")).toBe(false);
  });
  it("uses a random salt (two hashes of the same password differ)", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });
});

describe("session tokens", () => {
  const user = { id: "1", email: "a@b.c", name: "A", role: "admin" };
  it("round-trips a signed session", () => {
    const tok = signSession(user);
    expect(verifySession(tok)).toEqual(user);
  });
  it("rejects null / malformed / tampered tokens", () => {
    expect(verifySession(null)).toBeNull();
    expect(verifySession("garbage")).toBeNull();
    const tok = signSession(user);
    expect(verifySession(tok.slice(0, -2) + "xy")).toBeNull(); // tampered signature
  });
  it("rejects an expired token", () => {
    const past = Date.now() - (SESSION_MAX_AGE + 60) * 1000;
    const tok = signSession(user, SESSION_MAX_AGE, past);
    expect(verifySession(tok)).toBeNull();
  });
});
