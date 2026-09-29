import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./verify-pin.js";

describe("hashPin / verifyPin", () => {
  it("accepts the PIN that was hashed", async () => {
    const stored = hashPin("1234");
    expect(await verifyPin("1234", stored)).toBe(true);
  });

  it("rejects a wrong PIN", async () => {
    const stored = hashPin("1234");
    expect(await verifyPin("9999", stored)).toBe(false);
  });

  it("salts each hash, so the same PIN never produces the same stored value", () => {
    expect(hashPin("1234")).not.toBe(hashPin("1234"));
  });

  it("tags the stored value with its algorithm, so a future KDF is distinguishable", () => {
    expect(hashPin("1234").startsWith("scrypt$")).toBe(true);
  });

  it("rejects a malformed stored value rather than throwing", async () => {
    expect(await verifyPin("1234", "not-a-real-hash")).toBe(false);
  });

  it("rejects a stored value tagged with an unknown algorithm", async () => {
    expect(await verifyPin("1234", "bcrypt$abcd$ef01")).toBe(false);
  });

  it("rejects a stored value whose derived key is the wrong length, without throwing", async () => {
    // timingSafeEqual throws on length-mismatched buffers.
    const stored = hashPin("1234");
    const [algo, salt] = stored.split("$");
    const truncated = `${algo}$${salt}$00`;
    expect(await verifyPin("1234", truncated)).toBe(false);
  });

  it("lets the event loop turn while it derives the key", async () => {
    const stored = hashPin("1234");
    const order: string[] = [];
    const verified = verifyPin("1234", stored).then(() => order.push("verified"));
    setImmediate(() => order.push("turned"));
    await verified;
    expect(order).toEqual(["turned", "verified"]);
  });
});
