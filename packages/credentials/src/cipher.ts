import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
/** GCM's standard nonce length, and the value `tenant_credentials_iv_len_ck` enforces. */
const IV_BYTES = 12;

/** What one write produces: node's crypto output, as `Buffer`s. */
export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/** What one read consumes: a `binary()` column reads back as a plain `Uint8Array`
 * (`packages/db/src/schema/columns.ts`). A `Sealed` satisfies it, so a write's output still flows
 * into `open`. */
export interface SealedRow {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
}

/**
 * The additional authenticated data: the row's own identity, its purpose. GCM covers it by the auth
 * tag without storing it, so a ciphertext only opens under the purpose it was sealed for.
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
 * Null — never a throw, and never a reason — when the row does not open. The wrong key, a tampered
 * ciphertext and a row moved between purposes are indistinguishable on purpose: an error that told
 * them apart would be an oracle for whoever caused it.
 *
 * The setup calls are inside the try too: a malformed iv, tag or key length throws from Node's
 * crypto, and a tampered row must read as unopened rather than crash the reader.
 */
export function open(key: Buffer, aad: Buffer, sealed: SealedRow): string | null {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, sealed.iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.authTag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
