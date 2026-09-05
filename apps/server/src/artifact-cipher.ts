import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import { deriveKey, type ScryptParams } from "./scrypt-kdf.js";
import "./errors.js";

const MAGIC = Buffer.from("WBK1"); // Waitron BacKup, format 1
export const VERSION = 1;
/** The version byte selects the KDF cost params, so an artifact stays decryptable after a future
 * SCRYPT_PARAMS hardening: bump to VERSION 2 for new writes and keep v1's params in this map.
 * (Same self-describing-KDF property the recovery bundle keeps — see the Task 1 ruling.)
 *
 * v1's entry is a FROZEN LITERAL of today's `SCRYPT_PARAMS`, deliberately NOT an alias of the live
 * shared constant: if it aliased `SCRYPT_PARAMS`, a future in-place hardening of that constant that
 * bumped `VERSION` but forgot to pin v1 would silently re-cost every historical v1 artifact and make
 * it undecryptable. The guard test in artifact-cipher.test.ts asserts this literal still equals
 * `SCRYPT_PARAMS` today (they match) and FAILS the moment `SCRYPT_PARAMS` is changed in place without
 * a new frozen entry here — forcing the safe move (bump VERSION, add the new params, leave v1 pinned). */
export const KDF_BY_VERSION: Record<number, ScryptParams> = {
  1: { N: 2 ** 17, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 },
};
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN; // 49

/** Encrypt bytes under a passphrase. Frame: MAGIC|version|salt|iv|tag|ciphertext (all binary). */
export function encryptArtifact(plaintext: Uint8Array, passphrase: string): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv, tag, ct]);
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
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt, params), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new AppError("recovery.passphrase_invalid", {});
  }
}
