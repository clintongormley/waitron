import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./verify-pin.js";

describe("hashPin / verifyPin", () => {
  it("accepts the PIN that was hashed", () => {
    const stored = hashPin("1234");
    expect(verifyPin("1234", stored)).toBe(true);
  });

  it("rejects a wrong PIN", () => {
    const stored = hashPin("1234");
    expect(verifyPin("9999", stored)).toBe(false);
  });

  it("salts each hash, so the same PIN never produces the same stored value", () => {
    // Without a per-hash salt, two staff members who happen to pick the same PIN would carry
    // identical `pin_hash` values — a visible equality an operator with SELECT could exploit.
    expect(hashPin("1234")).not.toBe(hashPin("1234"));
  });

  it("tags the stored value with its algorithm, so a future KDF is distinguishable", () => {
    expect(hashPin("1234").startsWith("scrypt$")).toBe(true);
  });

  it("rejects a malformed stored value rather than throwing", () => {
    // A row whose pin_hash was never written by hashPin (a bad migration, a hand-edited row) must
    // fail closed, not crash the clock-in path.
    expect(verifyPin("1234", "not-a-real-hash")).toBe(false);
  });

  it("rejects a stored value tagged with an unknown algorithm", () => {
    expect(verifyPin("1234", "bcrypt$abcd$ef01")).toBe(false);
  });

  it("rejects a stored value whose derived key is the wrong length, without throwing", () => {
    // timingSafeEqual throws on length-mismatched buffers; the length guard is what turns a
    // truncated or tampered hash into a plain `false`. Deleting the guard makes this test throw
    // instead of returning false.
    const stored = hashPin("1234");
    const [algo, salt] = stored.split("$");
    const truncated = `${algo}$${salt}$00`;
    expect(verifyPin("1234", truncated)).toBe(false);
  });
});
