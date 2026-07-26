import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
/** GCM's standard nonce length, and the value `tenant_credentials_iv_len_ck` enforces. */
const IV_BYTES = 12;

/** What one write produces and one read consumes. Three columns, no encoding in between. */
export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * The additional authenticated data: the row's own identity. GCM covers it by the auth tag without
 * storing it, so a ciphertext only opens under the exact (tenant, purpose) it was sealed for — the
 * moved-row attack in cipher.test.ts.
 *
 * The NUL separator is not decoration. Without it `aadFor("ab", "c")` and `aadFor("a", "bc")` are
 * the same bytes, and two rows would seal interchangeably. Tenant ids are fixed-length uuids today,
 * so this only matters to a future caller — which is when nobody is looking for it.
 */
export function aadFor(tenantId: string, purpose: string): Buffer {
  return Buffer.from(`${tenantId}\0${purpose}`);
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
 * ciphertext and a row moved between (tenant, purpose) pairs are indistinguishable here on purpose:
 * an error that told them apart would be an oracle for whoever caused it. The store turns the null
 * into `credentials.decrypt_failed`, because only the store knows which row it was.
 *
 * `createDecipheriv`/`setAAD`/`setAuthTag` are deliberately INSIDE the try, not just `update`/
 * `final`: a `Sealed` with a malformed `iv` (e.g. zero-length) or `authTag` (any length but 16)
 * throws synchronously from Node's crypto binding — `ERR_CRYPTO_INVALID_IV` /
 * `ERR_CRYPTO_INVALID_AUTH_TAG` / `ERR_CRYPTO_INVALID_KEYLEN` — a DIFFERENT failure from GCM's own
 * authentication check at `final()`, but one this file has no defence against otherwise. Today the
 * column CHECKs (12-byte iv, 16-byte tag) and `loadKeyRing`'s own validation (32-byte key) mean
 * this package's own callers cannot reach it — but this file exists specifically to defend a row
 * against someone with database write access, and a `Sealed` built from a tampered row must not
 * crash the reader with a raw, untranslatable Node error string.
 */
export function open(key: Buffer, aad: Buffer, sealed: Sealed): string | null {
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
