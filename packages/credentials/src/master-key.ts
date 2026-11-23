import {
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";
import { AppError, decodeMasterKeyCode, encodeMasterKeyCode, isUuid } from "@waitron/shared";
import "./errors.js";

const MASTER_KEY_BYTES = 24;
const SALT = Buffer.from("waitron.master-key.v1", "ascii");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI_BYTES = 44;

declare const sealingPublicKeyBrand: unique symbol;
/** The sealing pair's public half as SPKI DER: the only key a sealed packet is sealed with. */
export type SealingPublicKey = Buffer & { readonly [sealingPublicKeyBrand]: true };

function checkedMasterKey(masterKey: Uint8Array): Uint8Array {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new AppError("master_key.invalid", { reason: "length" });
  }
  return masterKey;
}

function derive(masterKey: Uint8Array, info: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", checkedMasterKey(masterKey), SALT, Buffer.from(info, "ascii"), 32),
  );
}

export function makeMasterKey(): Buffer {
  return randomBytes(MASTER_KEY_BYTES);
}

export function printMasterKey(masterKey: Uint8Array): string {
  return encodeMasterKeyCode(Buffer.from(checkedMasterKey(masterKey)).toString("base64url"));
}

export function readMasterKey(printed: string): Buffer {
  let secret: string;
  try {
    secret = decodeMasterKeyCode(printed);
  } catch {
    throw new AppError("master_key.invalid", { reason: "printed_form" });
  }
  return Buffer.from(secret, "base64url");
}

export function authorityKey(masterKey: Uint8Array): Buffer {
  return derive(masterKey, "authority");
}

/** What the box keeps to recognise its master key: `hex(SHA-256(authority key))`. */
export function masterKeyCheckValue(masterKey: Uint8Array): string {
  return createHash("sha256").update(authorityKey(masterKey)).digest("hex");
}

export function masterKeyMatches(masterKey: Uint8Array, checkValue: string): boolean {
  const expected = createHash("sha256").update(authorityKey(masterKey)).digest();
  if (!/^[0-9a-f]{64}$/.test(checkValue)) return false;
  return timingSafeEqual(expected, Buffer.from(checkValue, "hex"));
}

export function sealingPrivateKey(masterKey: Uint8Array): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, derive(masterKey, "seal.x25519")]),
    format: "der",
    type: "pkcs8",
  });
}

export function sealingPublicKey(masterKey: Uint8Array): SealingPublicKey {
  return createPublicKey(sealingPrivateKey(masterKey)).export({
    format: "der",
    type: "spki",
  }) as SealingPublicKey;
}

/** Checks the length itself: `createPublicKey` accepts an X25519 SPKI with a byte after it. */
export function sealingPublicKeyFrom(spki: Uint8Array): SealingPublicKey {
  let key: KeyObject;
  try {
    key = createPublicKey({ key: Buffer.from(spki), format: "der", type: "spki" });
  } catch {
    throw new AppError("master_key.invalid", { reason: "public_key" });
  }
  if (key.asymmetricKeyType !== "x25519" || spki.length !== X25519_SPKI_BYTES) {
    throw new AppError("master_key.invalid", { reason: "public_key" });
  }
  return Buffer.from(spki) as SealingPublicKey;
}

export function masterKeyId(publicKey: SealingPublicKey): Buffer {
  return createHash("sha256").update(publicKey).digest().subarray(0, 8);
}

export function backupKey(masterKey: Uint8Array, n: number): Buffer {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new AppError("master_key.derivation_input_invalid", { input: "backup_key_number" });
  }
  return derive(masterKey, `backup-key.${String(n)}`);
}

export function diskKey(masterKey: Uint8Array, boxId: string): Buffer {
  if (!isUuid(boxId)) {
    throw new AppError("master_key.derivation_input_invalid", { input: "box_id" });
  }
  return derive(masterKey, `disk.${boxId.toLowerCase()}`);
}
