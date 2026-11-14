import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashSecret, hashSecretAsync, verifySecretAsync } from "./secret-hash.js";

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

describe("hashSecretAsync", () => {
  it("keeps the stored format, fresh salts and synchronous verification", async () => {
    const first = await hashSecretAsync("hunter2");
    const second = await hashSecretAsync("hunter2");
    expect(first).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    const [, salt, key] = first.split("$");
    expect(scryptSync("hunter2", Buffer.from(salt!, "hex"), 32).toString("hex")).toBe(key);
  });

  it("lets the event loop turn while it creates a hash", async () => {
    const order: string[] = [];
    const hashed = hashSecretAsync("hunter2").then(() => order.push("hashed"));
    setImmediate(() => order.push("turned"));
    await hashed;
    expect(order).toEqual(["turned", "hashed"]);
  });
});
