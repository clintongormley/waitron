import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
/** GCM's standard nonce length, and the value `tenant_credentials_iv_len_ck` enforces. */
const IV_BYTES = 12;

/** What one write produces. Three columns, no encoding in between; node's crypto hands `seal` its
 * output as `Buffer`s, so that is what this says. */
export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/** What one read consumes — the same three columns as a row hands them back.
 *
 * Wider than `Sealed` rather than the same type, because the three columns are `binary()` columns
 * and that helper's `fromDriver` returns a plain `Uint8Array` (`packages/db/src/schema/columns.ts`).
 * A `Sealed` satisfies this shape and not the reverse, so a write's output still flows into `open`.
 *
 * Two interfaces rather than one widened `Sealed`, and that is a measurement rather than taste:
 * `seal` returns what node's crypto hands it, which is `Buffer`s, and `cipher.test.ts:21-22` calls
 * `Buffer`'s own `.equals()` on the result. Declaring `Sealed` with `Uint8Array` fields instead
 * gave `tsc --noEmit` two `TS2339`s on exactly those two lines, measured 2026-09-18.
 *
 * That both types survive node's crypto is carried by `credentials.test.ts`'s round trip, which
 * reads a row back through this column and decrypts it — a `Uint8Array` all the way in. */
export interface SealedRow {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

/**
 * The additional authenticated data: the row's own identity, its purpose. GCM covers it by the auth
 * tag without storing it, so a ciphertext only opens under the purpose it was sealed for — the
 * moved-row attack in cipher.test.ts and store.test.ts.
 */
export function aadFor(purpose: string): Buffer {
  return Buffer.from(purpose, "utf8");
}

export function seal(key: Buffer, aad: Buffer, plaintext: string): Sealed {
  // Fresh per call, never derived from the row: reusing an (key, iv) pair across two different
  // plaintexts breaks GCM outright — not merely weakens it.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

/**
 * Null — never a throw, and never a reason — when authentication fails. The wrong key, a tampered
 * ciphertext and a row moved between purposes are indistinguishable here on purpose:
 * an error that told them apart would be an oracle for whoever caused it. The store turns the null
 * into `credentials.decrypt_failed`, because only the store knows which row it was.
 *
 * `createDecipheriv`/`setAAD`/`setAuthTag` are deliberately INSIDE the try, not just `update`/
 * `final`: a `SealedRow` with a malformed `iv` (e.g. zero-length) or `authTag` (any length but 16)
 * throws synchronously from Node's crypto binding — `ERR_CRYPTO_INVALID_IV` /
 * `ERR_CRYPTO_INVALID_AUTH_TAG` / `ERR_CRYPTO_INVALID_KEYLEN` — a DIFFERENT failure from GCM's own
 * authentication check at `final()`, but one this file has no defence against otherwise. Today the
 * column CHECKs (12-byte iv, 16-byte tag) and `loadKeyRing`'s own validation (32-byte key) mean
 * this package's own callers cannot reach it — but this file exists specifically to defend a row
 * against someone with database write access, and a `SealedRow` built from a tampered row must not
 * crash the reader with a raw, untranslatable Node error string.
 */
export function open(key: Buffer, aad: Buffer, sealed: SealedRow): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, sealed.iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.authTag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Two distinct failure shapes collapse to this one catch: `final()` throwing "Unsupported
    // state or unable to authenticate data" on a genuine tag mismatch, AND the setup calls above
    // throwing on a malformed iv/tag/key length. Both mean the same thing to a caller — "this did
    // not open" — and telling them apart would itself be an oracle for whoever caused it.
    return null;
  }
}
