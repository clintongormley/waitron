import {
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { AppError, decodeMasterKeyCode, encodeMasterKeyCode, keySymbols } from "@waitron/shared";
import "./errors.js";

const MASTER_KEY_BYTES = 16;
const SALT = Buffer.from("waitron.master-key.v1", "ascii");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

function derive(masterKey: Uint8Array, info: string): Buffer {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new AppError("shared.invalid_key_code", {});
  }
  return Buffer.from(hkdfSync("sha256", masterKey, SALT, Buffer.from(info, "ascii"), 32));
}

export function makeMasterKey(): Buffer {
  return randomBytes(MASTER_KEY_BYTES);
}

export function printMasterKey(masterKey: Uint8Array): string {
  return encodeMasterKeyCode(masterKey);
}

export function readMasterKey(printed: string): Buffer {
  return Buffer.from(decodeMasterKeyCode(printed));
}

export function authorityKey(masterKey: Uint8Array): Buffer {
  return derive(masterKey, "authority");
}

function checkDigest(masterKey: Uint8Array): Buffer {
  return createHash("sha256").update(authorityKey(masterKey)).digest();
}

/** What the box keeps to recognise its master key: `hex(SHA-256(authority key))`. */
export function masterKeyCheckValue(masterKey: Uint8Array): string {
  return checkDigest(masterKey).toString("hex");
}

export function masterKeyMatches(masterKey: Uint8Array, checkValue: string): boolean {
  const expected = checkDigest(masterKey);
  if (!/^[0-9a-f]{64}$/.test(checkValue)) return false;
  return timingSafeEqual(expected, Buffer.from(checkValue, "hex"));
}

/** The sealing pair's public half as SPKI DER. The private half is never returned. */
export function sealingPublicKey(masterKey: Uint8Array): Buffer {
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, derive(masterKey, "seal.x25519")]),
    format: "der",
    type: "pkcs8",
  });
  return createPublicKey(privateKey).export({ format: "der", type: "spki" });
}

/** The first 8 bytes of SHA-256 over the sealing public key's SPKI DER. */
export function masterKeyId(publicKey: Uint8Array): Buffer {
  return createHash("sha256").update(publicKey).digest().subarray(0, 8);
}

/** `YYYY-MM-DD · XXXX`: the day given, then the first 4 of the 13 symbols that print the id. */
export function masterKeyName(publicKey: Uint8Array, day: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(day)) {
    throw new AppError("master_key.name_day_invalid", { value: day });
  }
  return `${day} · ${keySymbols(masterKeyId(publicKey)).slice(0, 4)}`;
}
