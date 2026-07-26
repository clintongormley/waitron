import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aadFor, open, seal } from "./cipher.js";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

describe("seal and open", () => {
  it("round-trips a payload", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    const sealed = seal(KEY, aad, '{"secretKey":"sk_test"}');
    expect(open(KEY, aad, sealed)).toBe('{"secretKey":"sk_test"}');
  });

  it("uses a fresh iv per write, so the same plaintext never seals identically", () => {
    // GCM's security collapses if one (key, iv) pair encrypts two different plaintexts. A constant
    // iv would pass every other test in this file.
    const aad = aadFor(TENANT, "payments.stripe");
    const a = seal(KEY, aad, "same");
    const b = seal(KEY, aad, "same");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("emits a 12-byte iv and a 16-byte tag, matching the column CHECKs", () => {
    const sealed = seal(KEY, aadFor(TENANT, "p"), "x");
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.authTag).toHaveLength(16);
  });

  it("returns null for the wrong key", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    expect(open(OTHER_KEY, aad, seal(KEY, aad, "x"))).toBeNull();
  });

  it("returns null for a tampered ciphertext", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    const sealed = seal(KEY, aad, "x");
    sealed.ciphertext[0] ^= 0xff;
    expect(open(KEY, aad, sealed)).toBeNull();
  });

  it("returns null for a tampered auth tag", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    const sealed = seal(KEY, aad, "x");
    sealed.authTag[0] ^= 0xff;
    expect(open(KEY, aad, sealed)).toBeNull();
  });

  // A `Sealed` with a malformed field length throws SYNCHRONOUSLY from Node's crypto binding
  // (ERR_CRYPTO_INVALID_AUTH_TAG / ERR_CRYPTO_INVALID_IV) — a different failure from GCM's own
  // authentication check at `final()`. Nothing in this package's own path can build a `Sealed`
  // this shape (the column CHECKs pin both lengths), but this file exists specifically to defend
  // against someone with database write access, so a row they hand-tamper into an illegal shape
  // must still return null, not crash the reader with a raw Node error string.
  it("returns null for an auth tag of the wrong length, not a throw", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    const sealed = seal(KEY, aad, "x");
    expect(open(KEY, aad, { ...sealed, authTag: Buffer.alloc(15) })).toBeNull();
  });

  it("returns null for a zero-length iv, not a throw", () => {
    const aad = aadFor(TENANT, "payments.stripe");
    const sealed = seal(KEY, aad, "x");
    expect(open(KEY, aad, { ...sealed, iv: Buffer.alloc(0) })).toBeNull();
  });

  // THE TEETH TEST. This is the entire reason the AAD exists: without it, someone with write
  // access to the database moves tenant B's sealed Stripe credentials into tenant A's row and
  // tenant A silently starts settling against tenant B's account. Deleting the two setAAD calls in
  // cipher.ts must turn THIS red — verify that by hand before committing.
  it("refuses a ciphertext moved to a different tenant", () => {
    const sealed = seal(KEY, aadFor(TENANT, "payments.stripe"), '{"secretKey":"sk_b"}');
    expect(open(KEY, aadFor(OTHER_TENANT, "payments.stripe"), sealed)).toBeNull();
  });

  it("refuses a ciphertext moved to a different purpose", () => {
    const sealed = seal(KEY, aadFor(TENANT, "payments.stripe"), "x");
    expect(open(KEY, aadFor(TENANT, "fiscal.aeat"), sealed)).toBeNull();
  });
});

describe("aadFor", () => {
  it("distinguishes splits that would otherwise concatenate identically", () => {
    // Without a separator, ("ab","c") and ("a","bc") both produce "abc" and seal interchangeably.
    // Tenant ids are fixed-length uuids today, so this can only bite a future caller — which is
    // exactly when nobody will remember to check.
    expect(aadFor("ab", "c").equals(aadFor("a", "bc"))).toBe(false);
  });
});

describe("the seal/open property", () => {
  it("round-trips any payload under any (tenant, purpose)", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (tenant, purpose, plaintext) => {
        const aad = aadFor(tenant, purpose);
        return open(KEY, aad, seal(KEY, aad, plaintext)) === plaintext;
      }),
    );
  });
});
