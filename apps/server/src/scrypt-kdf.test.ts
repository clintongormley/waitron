import { describe, expect, it } from "vitest";
import { deriveKey, SCRYPT_PARAMS } from "./scrypt-kdf.js";

describe("deriveKey", () => {
  it("derives a stable 32-byte key for a passphrase + salt", () => {
    const salt = Buffer.alloc(16, 7);
    const a = deriveKey("correct horse battery", salt);
    const b = deriveKey("correct horse battery", salt);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
  });

  it("derives a different key for a different salt", () => {
    const a = deriveKey("pw", Buffer.alloc(16, 1));
    const b = deriveKey("pw", Buffer.alloc(16, 2));
    expect(a.equals(b)).toBe(false);
  });

  it("uses the hardened scrypt cost parameters", () => {
    expect(SCRYPT_PARAMS).toMatchObject({ N: 2 ** 17, r: 8, p: 1, keylen: 32 });
  });
});
