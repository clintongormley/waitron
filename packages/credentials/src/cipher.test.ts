import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { aadFor, open, seal } from "./cipher.js";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);

describe("seal and open", () => {
  it("round-trips a payload", () => {
    const aad = aadFor("payments.stripe");
    const sealed = seal(KEY, aad, '{"secretKey":"sk_test"}');
    expect(open(KEY, aad, sealed)).toBe('{"secretKey":"sk_test"}');
  });

  it("uses a fresh iv per write, so the same plaintext never seals identically", () => {
    // GCM's security collapses if one (key, iv) pair encrypts two different plaintexts. A constant
    // iv would pass every other test in this file.
    const aad = aadFor("payments.stripe");
    const a = seal(KEY, aad, "same");
    const b = seal(KEY, aad, "same");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("emits a 12-byte iv and a 16-byte tag, matching the column CHECKs", () => {
    const sealed = seal(KEY, aadFor("p"), "x");
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.authTag).toHaveLength(16);
  });

  it("returns null for the wrong key", () => {
    const aad = aadFor("payments.stripe");
    expect(open(OTHER_KEY, aad, seal(KEY, aad, "x"))).toBeNull();
  });

  it("returns null for a tampered ciphertext", () => {
    const aad = aadFor("payments.stripe");
    const sealed = seal(KEY, aad, "x");
    sealed.ciphertext[0] ^= 0xff;
    expect(open(KEY, aad, sealed)).toBeNull();
  });

  it("returns null for a tampered auth tag", () => {
    const aad = aadFor("payments.stripe");
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
    const aad = aadFor("payments.stripe");
    const sealed = seal(KEY, aad, "x");
    expect(open(KEY, aad, { ...sealed, authTag: Buffer.alloc(15) })).toBeNull();
  });

  it("returns null for a zero-length iv, not a throw", () => {
    const aad = aadFor("payments.stripe");
    const sealed = seal(KEY, aad, "x");
    expect(open(KEY, aad, { ...sealed, iv: Buffer.alloc(0) })).toBeNull();
  });

  it("refuses a ciphertext moved to a different purpose", () => {
    const sealed = seal(KEY, aadFor("payments.stripe"), "x");
    expect(open(KEY, aadFor("fiscal.aeat"), sealed)).toBeNull();
  });
});

describe("aadFor", () => {
  it("is exactly the purpose's UTF-8 bytes", () => {
    // Pinned byte for byte: every stored row authenticates against these exact bytes, so changing
    // them makes every credential already sealed undecryptable.
    expect(aadFor("payments.stripe").equals(Buffer.from("payments.stripe", "utf8"))).toBe(true);
  });

  it("differs between two purposes", () => {
    expect(aadFor("payments.stripe").equals(aadFor("fiscal.aeat"))).toBe(false);
  });
});

describe("the seal/open property", () => {
  it("round-trips any payload under any purpose", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (purpose, plaintext) => {
        const aad = aadFor(purpose);
        return open(KEY, aad, seal(KEY, aad, plaintext)) === plaintext;
      }),
    );
  });
});
