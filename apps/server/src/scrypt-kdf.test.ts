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

  it("derives with explicit cost parameters instead of the default when given a third argument", () => {
    const salt = Buffer.alloc(16, 3);
    const lighter = { N: 2 ** 14, r: 8, p: 1, keylen: 32, maxmem: SCRYPT_PARAMS.maxmem };
    const withDefault = deriveKey("pw", salt);
    const withExplicitLighterCost = deriveKey("pw", salt, lighter);
    const withExplicitDefaultCost = deriveKey("pw", salt, SCRYPT_PARAMS);
    // A different cost changes the derived key (scrypt mixes N/r/p into the derivation, not just
    // salt+passphrase), so this only passes if the third argument is actually used.
    expect(withExplicitLighterCost.equals(withDefault)).toBe(false);
    // Passing the default explicitly must reproduce calling with no third argument at all — proves
    // the parameter, not just its presence, drives the default.
    expect(withExplicitDefaultCost.equals(withDefault)).toBe(true);
  });
});
