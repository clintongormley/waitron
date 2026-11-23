import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
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
const BACKUP_KEY_VERSION = 2;
const MASTER_KEY_ID_LEN = 8;
const KEY_NUMBER_LEN = 4;
/** Version 2's authenticated prefix: MAGIC|version|master key id|N|salt|iv. */
const BACKUP_KEY_AAD_LEN =
  MAGIC.length + 1 + MASTER_KEY_ID_LEN + KEY_NUMBER_LEN + SALT_LEN + IV_LEN;
const BACKUP_KEY_INFO = Buffer.from("waitron.archive.v2");

export type ArtifactVersion = 1 | 2;
export type ArtifactHeader =
  { version: 1 } | { version: 2; masterKeyId: Buffer; keyNumber: number };
export interface BackupKeyFrameInput {
  backupKey: Uint8Array;
  keyNumber: number;
  masterKeyId: Uint8Array;
}

/** Everything an artifact of this version holds besides its ciphertext, which is as long as its
 * plaintext. */
export function artifactHeaderBytes(version: ArtifactVersion): number {
  return (version === 1 ? AAD_LEN : BACKUP_KEY_AAD_LEN) + TAG_LEN;
}

/** Encrypt bytes under a passphrase. Frame: MAGIC|version|salt|iv|tag|ciphertext (all binary). */
export function encryptArtifact(plaintext: Uint8Array, passphrase: string): Buffer {
  return encryptArtifactWithSalt(plaintext, passphrase, randomBytes(SALT_LEN));
}

/** `encryptArtifact` under a salt the caller chose, with a fresh IV; product writers keep
 * `encryptArtifact`'s fresh salt. A repeated salt lets a cached key derivation be reused. */
export function encryptArtifactWithSalt(
  plaintext: Uint8Array,
  passphrase: string,
  salt: Buffer,
): Buffer {
  if (salt.length !== SALT_LEN) throw new RangeError(`salt must be ${SALT_LEN} bytes`);
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
  const frame = readFrame(framed);
  return openFrame(frame, deriveKey(passphrase, frame.salt, frame.params));
}

export async function decryptArtifactAsync(
  framed: Uint8Array,
  passphrase: string,
): Promise<Buffer> {
  const frame = readFrame(Buffer.from(framed));
  const key = await deriveKeyAsync(passphrase, frame.salt, frame.params);
  return openFrame(frame, key);
}

function readFrame(framed: Uint8Array) {
  const buf = Buffer.from(framed.buffer, framed.byteOffset, framed.byteLength);
  if (buf.length < artifactHeaderBytes(1))
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
  return { salt, iv, tag, ct, header, params };
}

function openFrame(
  { iv, tag, ct, header }: Pick<ReturnType<typeof readFrame>, "iv" | "tag" | "ct" | "header">,
  key: Buffer,
): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new AppError("recovery.passphrase_invalid", {});
  }
}

/** Reads the version and, for version 2, which master key and backup key N the artifact needs,
 * without opening it. Nothing read here is authenticated until the artifact opens. */
export function readArtifactHeader(framed: Uint8Array): ArtifactHeader {
  const buf = Buffer.from(framed.buffer, framed.byteOffset, framed.byteLength);
  const version = buf[MAGIC.length];
  if (version === undefined) throw new AppError("backup.artifact_invalid", { reason: "too_short" });
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new AppError("backup.artifact_invalid", { reason: "bad_magic" });
  }
  if (version !== 1 && version !== BACKUP_KEY_VERSION) {
    throw new AppError("backup.artifact_invalid", { reason: "bad_version" });
  }
  if (buf.length < artifactHeaderBytes(version)) {
    throw new AppError("backup.artifact_invalid", { reason: "too_short" });
  }
  if (version === 1) return { version };
  const idStart = MAGIC.length + 1;
  return {
    version,
    masterKeyId: Buffer.from(buf.subarray(idStart, idStart + MASTER_KEY_ID_LEN)),
    keyNumber: buf.readUInt32BE(idStart + MASTER_KEY_ID_LEN),
  };
}

/** The authenticated prefix of a version 2 frame, which its tag follows. */
export function backupKeyFrameHeader(
  { keyNumber, masterKeyId }: Omit<BackupKeyFrameInput, "backupKey">,
  salt: Uint8Array,
  iv: Uint8Array,
): Buffer {
  if (masterKeyId.length !== MASTER_KEY_ID_LEN) {
    throw new AppError("backup.archive_key_invalid", { input: "master_key_id" });
  }
  if (!Number.isInteger(keyNumber) || keyNumber < 1 || keyNumber > 0xffffffff) {
    throw new AppError("backup.archive_key_invalid", { input: "key_number" });
  }
  const n = Buffer.alloc(KEY_NUMBER_LEN);
  n.writeUInt32BE(keyNumber);
  return Buffer.concat([MAGIC, Buffer.from([BACKUP_KEY_VERSION]), masterKeyId, n, salt, iv]);
}

/** The AES-256-GCM key of a version 2 frame: HKDF-SHA256 over backup key N, salted by the frame. */
export function backupKeyFrameKey(backupKey: Uint8Array, salt: Uint8Array): Buffer {
  if (backupKey.length !== 32) {
    throw new AppError("backup.archive_key_invalid", { input: "backup_key" });
  }
  return Buffer.from(hkdfSync("sha256", backupKey, salt, BACKUP_KEY_INFO, 32));
}

/** Frame version 2: MAGIC|2|master key id|N (uint32 BE)|salt|iv|tag|ciphertext. */
export function encryptArtifactUnderBackupKey(
  plaintext: Uint8Array,
  input: BackupKeyFrameInput,
): Buffer {
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const header = backupKeyFrameHeader(input, salt, iv);
  const key = backupKeyFrameKey(input.backupKey, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  key.fill(0);
  cipher.setAAD(header);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, cipher.getAuthTag(), ct]);
}

/** Opens a version 2 frame; refuses a version 1 frame as `bad_version`. A wrong key and a changed
 * byte are alike: recovery.passphrase_invalid, as for version 1. */
export function decryptArtifactUnderBackupKey(framed: Uint8Array, backupKey: Uint8Array): Buffer {
  const buf = Buffer.from(framed.buffer, framed.byteOffset, framed.byteLength);
  if (readArtifactHeader(buf).version !== BACKUP_KEY_VERSION) {
    throw new AppError("backup.artifact_invalid", { reason: "bad_version" });
  }
  const saltStart = BACKUP_KEY_AAD_LEN - IV_LEN - SALT_LEN;
  const salt = buf.subarray(saltStart, saltStart + SALT_LEN);
  const iv = buf.subarray(saltStart + SALT_LEN, BACKUP_KEY_AAD_LEN);
  const key = backupKeyFrameKey(backupKey, salt);
  try {
    return openFrame(
      {
        iv,
        tag: buf.subarray(BACKUP_KEY_AAD_LEN, artifactHeaderBytes(BACKUP_KEY_VERSION)),
        ct: buf.subarray(artifactHeaderBytes(BACKUP_KEY_VERSION)),
        header: buf.subarray(0, BACKUP_KEY_AAD_LEN),
      },
      key,
    );
  } finally {
    key.fill(0);
  }
}
