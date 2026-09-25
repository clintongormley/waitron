import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import { deriveKey, deriveKeyAsync, type ScryptParams } from "./scrypt-kdf.js";
import "./errors.js";

const MAGIC = Buffer.from("WBK1"); // Waitron BacKup, format 1
export const VERSION = 1;
/** The version byte selects the KDF cost params, so an artifact stays decryptable after a future
 * SCRYPT_PARAMS hardening: bump VERSION for new writes and keep the old params here.
 *
 * v1's entry is a FROZEN LITERAL, deliberately NOT an alias of `SCRYPT_PARAMS`: an in-place hardening
 * of that constant would otherwise re-cost every v1 artifact and make it undecryptable. */
export const KDF_BY_VERSION: Record<number, ScryptParams> = {
  1: { N: 2 ** 17, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 },
};
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
/** The authenticated header prefix: MAGIC|version|salt|iv, everything before the tag. These bytes are
 * bound into the GCM tag as AAD, so a flipped header byte fails authentication. */
const AAD_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN; // 33
const HEADER_LEN = AAD_LEN + TAG_LEN; // 49

/** Encrypt bytes under a passphrase. Frame: MAGIC|version|salt|iv|tag|ciphertext (all binary). */
export function encryptArtifact(plaintext: Uint8Array, passphrase: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  return frameUnderKey(plaintext, salt, deriveKey(passphrase, salt, KDF_BY_VERSION[VERSION]));
}

/** `encryptArtifact` with the key derived on the thread pool; the same frame, opened by
 * `decryptArtifact`. */
export async function encryptArtifactAsync(
  plaintext: Uint8Array,
  passphrase: string,
): Promise<Buffer> {
  const salt = randomBytes(SALT_LEN);
  const key = await deriveKeyAsync(passphrase, salt, KDF_BY_VERSION[VERSION]);
  return frameUnderKey(plaintext, salt, key);
}

function frameUnderKey(plaintext: Uint8Array, salt: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv]);
  cipher.setAAD(header);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([header, tag, ct]);
}

/** Decrypt a framed artifact. Throws backup.artifact_invalid (malformed frame) or
 * recovery.passphrase_invalid (wrong key / tamper — GCM auth failure, deliberately alike). */
export function decryptArtifact(framed: Uint8Array, passphrase: string): Buffer {
  const buf = Buffer.from(framed.buffer, framed.byteOffset, framed.byteLength);
  if (buf.length < HEADER_LEN)
    throw new AppError("backup.artifact_invalid", { reason: "too_short" });
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new AppError("backup.artifact_invalid", { reason: "bad_magic" });
  }
  const version = buf[MAGIC.length];
  const params = KDF_BY_VERSION[version];
  if (params === undefined) {
    throw new AppError("backup.artifact_invalid", { reason: "bad_version" });
  }
  let off = MAGIC.length + 1;
  const salt = buf.subarray(off, (off += SALT_LEN));
  const iv = buf.subarray(off, (off += IV_LEN));
  const tag = buf.subarray(off, (off += TAG_LEN));
  const ct = buf.subarray(off);
  const header = buf.subarray(0, AAD_LEN);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt, params), iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new AppError("recovery.passphrase_invalid", {});
  }
}
