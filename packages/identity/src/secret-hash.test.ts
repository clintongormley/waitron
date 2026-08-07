import { describe, expect, it } from "vitest";
import { hashSecret, verifySecret } from "./secret-hash.js";

describe("secret-hash", () => {
  it("accepts the correct secret", () => {
    expect(verifySecret("hunter2", hashSecret("hunter2"))).toBe(true);
  });
  it("rejects a wrong secret", () => {
    expect(verifySecret("nope", hashSecret("hunter2"))).toBe(false);
  });
  it("salts each hash (same input, different output)", () => {
    expect(hashSecret("hunter2")).not.toBe(hashSecret("hunter2"));
  });
  it("tags the algorithm", () => {
    expect(hashSecret("hunter2").startsWith("scrypt$")).toBe(true);
  });
  it("rejects a malformed stored value without throwing", () => {
    expect(verifySecret("x", "not-a-valid-hash")).toBe(false);
  });
  it("rejects an unknown algorithm tag", () => {
    expect(verifySecret("x", "bcrypt$abcd$ef01")).toBe(false);
  });
  it("rejects a wrong-length derived key without throwing", () => {
    expect(verifySecret("x", "scrypt$abcd$ef01")).toBe(false);
  });
});
