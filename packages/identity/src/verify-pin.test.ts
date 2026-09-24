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
    expect(hashPin("1234")).not.toBe(hashPin("1234"));
  });

  it("tags the stored value with its algorithm, so a future KDF is distinguishable", () => {
    expect(hashPin("1234").startsWith("scrypt$")).toBe(true);
  });

  it("rejects a malformed stored value rather than throwing", () => {
    expect(verifyPin("1234", "not-a-real-hash")).toBe(false);
  });

  it("rejects a stored value tagged with an unknown algorithm", () => {
    expect(verifyPin("1234", "bcrypt$abcd$ef01")).toBe(false);
  });

  it("rejects a stored value whose derived key is the wrong length, without throwing", () => {
    // timingSafeEqual throws on length-mismatched buffers.
    const stored = hashPin("1234");
    const [algo, salt] = stored.split("$");
    const truncated = `${algo}$${salt}$00`;
    expect(verifyPin("1234", truncated)).toBe(false);
  });
});
