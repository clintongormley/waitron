import { describe, expect, it } from "vitest";
import { hashSecret, verifySecretAsync } from "./secret-hash.js";

describe("hashSecret", () => {
  it("salts each hash (same input, different output)", () => {
    expect(hashSecret("hunter2")).not.toBe(hashSecret("hunter2"));
  });
  it("tags the algorithm", () => {
    expect(hashSecret("hunter2").startsWith("scrypt$")).toBe(true);
  });
});

describe("verifySecretAsync", () => {
  it("accepts the correct secret and rejects a wrong one", async () => {
    const stored = hashSecret("hunter2");
    expect(await verifySecretAsync("hunter2", stored)).toBe(true);
    expect(await verifySecretAsync("nope", stored)).toBe(false);
  });
  it("rejects a malformed value, an unknown algorithm and a wrong-length key without throwing", async () => {
    for (const stored of ["not-a-valid-hash", "bcrypt$abcd$ef01", "scrypt$abcd$ef01"])
      expect(await verifySecretAsync("x", stored)).toBe(false);
  });
  it("lets the event loop turn while it derives the key", async () => {
    const stored = hashSecret("hunter2");
    const order: string[] = [];
    const verified = verifySecretAsync("hunter2", stored).then(() => order.push("verified"));
    setImmediate(() => order.push("turned"));
    await verified;
    expect(order).toEqual(["turned", "verified"]);
  });
});
