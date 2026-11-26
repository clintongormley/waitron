import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { AppError } from "@waitron/shared";
import { deriveKey, deriveKeyAsync, type ScryptParams } from "./scrypt-kdf.js";
import "./errors.js";

const MAGIC = Buffer.from("WBK1"); // Waitron BacKup
export const VERSION = 1;
/** Version 1 is opened by a passphrase through scrypt with these params; version 2 by a backup key,
 * with no scrypt. A future SCRYPT_PARAMS hardening takes an unused version number and keeps v1's
 * params here.
 *
 * v1's entry is a FROZEN LITERAL, deliberately NOT an alias of `SCRYPT_PARAMS`: an in-place hardening
 * of that constant would otherwise re-cost every v1 artifact and make it undecryptable. */
export const KDF_BY_VERSION: Record<number, ScryptParams> = {
  1: { N: 2 ** 17, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 },
};
const SALT_LEN = 16;
const IV_LEN = 12;
export const ARTIFACT_TAG_BYTES = 16;
const BACKUP_KEY_VERSION = 2;
const MASTER_KEY_ID_LEN = 8;
const KEY_NUMBER_LEN = 4;
/** Everything before the tag. These bytes are bound into the GCM tag as AAD, so a flipped header
 * byte fails authentication. v1: MAGIC|version|salt|iv; v2: MAGIC|version|master key id|N|salt|iv. */
const AUTHENTICATED_LEN = {
  1: MAGIC.length + 1 + SALT_LEN + IV_LEN,
  2: MAGIC.length + 1 + MASTER_KEY_ID_LEN + KEY_NUMBER_LEN + SALT_LEN + IV_LEN,
} as const;
const BACKUP_KEY_INFO = Buffer.from("waitron.archive.v2");

export type ArtifactVersion = 1 | 2;
export type ArtifactHeader =
  { version: 1 } | { version: 2; masterKeyId: Buffer; keyNumber: number };
/** A header as read, nothing in it authenticated yet. `bytes` is the whole header, tag last; the
 * ciphertext follows it. */
export type ParsedArtifactHeader = ArtifactHeader & {
  salt: Buffer;
  iv: Buffer;
  authenticated: Buffer;
  tag: Buffer;
  bytes: Buffer;
};
/** A new frame's authenticated prefix, which its tag follows, and the IV and key to seal it under. */
export interface FrameStart {
  authenticated: Buffer;
  iv: Buffer;
  key: Buffer;
}
export interface BackupKeyFrameInput {
  backupKey: Uint8Array;
  keyNumber: number;
  masterKeyId: Uint8Array;
}

/** Everything an artifact of this version holds besides its ciphertext, which is as long as its
 * plaintext. */
export function artifactHeaderBytes(version: ArtifactVersion): number {
  return AUTHENTICATED_LEN[version] + ARTIFACT_TAG_BYTES;
}

function invalid(reason: string): never {
  throw new AppError("backup.artifact_invalid", { reason });
}

/** Reads a frame's header without opening it. `expected` refuses any other version as
 * `bad_version` before the header's length for that version is checked. */
export function parseArtifactHeader(
  framed: Uint8Array,
  expected?: ArtifactVersion,
): ParsedArtifactHeader {
  const buf = Buffer.from(framed.buffer, framed.byteOffset, framed.byteLength);
  if (buf.length < artifactHeaderBytes(1)) invalid("too_short");
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) invalid("bad_magic");
  const version = buf[MAGIC.length];
  if (version !== 1 && version !== BACKUP_KEY_VERSION) invalid("bad_version");
  if (expected !== undefined && version !== expected) invalid("bad_version");
  if (buf.length < artifactHeaderBytes(version)) invalid("too_short");
  let off = MAGIC.length + 1;
  let named: ArtifactHeader = { version: 1 };
  if (version === BACKUP_KEY_VERSION) {
    const masterKeyId = Buffer.from(buf.subarray(off, (off += MASTER_KEY_ID_LEN)));
    const keyNumber = buf.readUInt32BE(off);
    off += KEY_NUMBER_LEN;
    if (keyNumber === 0) invalid("bad_key_number");
    named = { version, masterKeyId, keyNumber };
  }
  const salt = buf.subarray(off, (off += SALT_LEN));
  const iv = buf.subarray(off, (off += IV_LEN));
  return {
    ...named,
    salt,
    iv,
    authenticated: buf.subarray(0, off),
    tag: buf.subarray(off, off + ARTIFACT_TAG_BYTES),
    bytes: buf.subarray(0, off + ARTIFACT_TAG_BYTES),
  };
}

/** Reads the version and, for version 2, which master key and backup key N the artifact needs,
 * without opening it. Nothing read here is authenticated until the artifact opens. */
export function readArtifactHeader(framed: Uint8Array): ArtifactHeader {
  const header = parseArtifactHeader(framed);
  if (header.version === 1) return { version: 1 };
  return { version: 2, masterKeyId: header.masterKeyId, keyNumber: header.keyNumber };
}

function passphraseFrame(salt: Buffer) {
  if (salt.length !== SALT_LEN) throw new RangeError(`salt must be ${SALT_LEN} bytes`);
  const iv = randomBytes(IV_LEN);
  return { authenticated: Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv]), salt, iv };
}

/** A new version 1 frame under a fresh salt and IV; the caller derives the key from `salt` with
 * `KDF_BY_VERSION[1]`. */
export function startPassphraseFrame(): { authenticated: Buffer; salt: Buffer; iv: Buffer } {
  return passphraseFrame(randomBytes(SALT_LEN));
}

/** A new version 2 frame under a fresh salt and IV. */
export function startBackupKeyFrame({
  backupKey,
  keyNumber,
  masterKeyId,
}: BackupKeyFrameInput): FrameStart {
  if (masterKeyId.length !== MASTER_KEY_ID_LEN) {
    throw new AppError("backup.archive_key_invalid", { input: "master_key_id" });
  }
  if (!Number.isInteger(keyNumber) || keyNumber < 1 || keyNumber > 0xffffffff) {
    throw new AppError("backup.archive_key_invalid", { input: "key_number" });
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const n = Buffer.alloc(KEY_NUMBER_LEN);
  n.writeUInt32BE(keyNumber);
  const authenticated = Buffer.concat([
    MAGIC,
    Buffer.from([BACKUP_KEY_VERSION]),
    masterKeyId,
    n,
    salt,
    iv,
  ]);
  return { authenticated, iv, key: backupKeyFrameKey(backupKey, salt) };
}

export function backupKeyFrameKey(backupKey: Uint8Array, salt: Uint8Array): Buffer {
  if (backupKey.length !== 32) {
    throw new AppError("backup.archive_key_invalid", { input: "backup_key" });
  }
  return Buffer.from(hkdfSync("sha256", backupKey, salt, BACKUP_KEY_INFO, 32));
}

/** Zeroes the key once the cipher holds it. */
function seal(plaintext: Uint8Array, { authenticated, iv, key }: FrameStart): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  key.fill(0);
  cipher.setAAD(authenticated);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([authenticated, cipher.getAuthTag(), ct]);
}

/** A wrong key and a changed byte are alike: recovery.passphrase_invalid. Zeroes the key. */
function open(framed: Uint8Array, header: ParsedArtifactHeader, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, header.iv);
  key.fill(0);
  decipher.setAAD(header.authenticated);
  decipher.setAuthTag(header.tag);
  const ct = Buffer.from(framed.buffer, framed.byteOffset, framed.byteLength).subarray(
    header.bytes.length,
  );
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new AppError("recovery.passphrase_invalid", {});
  }
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
  const frame = passphraseFrame(salt);
  return seal(plaintext, { ...frame, key: deriveKey(passphrase, salt, KDF_BY_VERSION[VERSION]) });
}

/** `encryptArtifact` with the key derived on the thread pool; the same frame, opened by
 * `decryptArtifact`. */
export async function encryptArtifactAsync(
  plaintext: Uint8Array,
  passphrase: string,
): Promise<Buffer> {
  const frame = startPassphraseFrame();
  const key = await deriveKeyAsync(passphrase, frame.salt, KDF_BY_VERSION[VERSION]);
  return seal(plaintext, { ...frame, key });
}

/** Decrypt a framed artifact. Throws backup.artifact_invalid (malformed frame) or
 * recovery.passphrase_invalid (wrong key / tamper — GCM auth failure, deliberately alike). */
export function decryptArtifact(framed: Uint8Array, passphrase: string): Buffer {
  const header = parseArtifactHeader(framed, VERSION);
  return open(framed, header, deriveKey(passphrase, header.salt, KDF_BY_VERSION[VERSION]));
}

export async function decryptArtifactAsync(
  framed: Uint8Array,
  passphrase: string,
): Promise<Buffer> {
  const copy = Buffer.from(framed);
  const header = parseArtifactHeader(copy, VERSION);
  const key = await deriveKeyAsync(passphrase, header.salt, KDF_BY_VERSION[VERSION]);
  return open(copy, header, key);
}

/** Frame version 2: MAGIC|2|master key id|N (uint32 BE)|salt|iv|tag|ciphertext. */
export function encryptArtifactUnderBackupKey(
  plaintext: Uint8Array,
  input: BackupKeyFrameInput,
): Buffer {
  return seal(plaintext, startBackupKeyFrame(input));
}

/** Opens a version 2 frame; refuses a version 1 frame as `bad_version`. A wrong key and a changed
 * byte are alike: recovery.passphrase_invalid, as for version 1. */
export function decryptArtifactUnderBackupKey(framed: Uint8Array, backupKey: Uint8Array): Buffer {
  const header = parseArtifactHeader(framed, BACKUP_KEY_VERSION);
  return open(framed, header, backupKeyFrameKey(backupKey, header.salt));
}
