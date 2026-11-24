import {
  createHash,
  createPrivateKey,
  createPublicKey,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { AppError, isCalendarDate, keySymbols } from "@waitron/shared";
import "./errors.js";

const MASTER_KEY_BYTES = 16;
const SALT = Buffer.from("waitron.master-key.v1", "ascii");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

function derive(masterKey: Uint8Array, info: string): Buffer {
  if (masterKey.length !== MASTER_KEY_BYTES) {
    throw new AppError("master_key.code_invalid", {});
  }
  return Buffer.from(hkdfSync("sha256", masterKey, SALT, Buffer.from(info, "ascii"), 32));
}

export function makeMasterKey(): Buffer {
  return randomBytes(MASTER_KEY_BYTES);
}

export function authorityKey(masterKey: Uint8Array): Buffer {
  return derive(masterKey, "authority");
}

export function masterKeyCheckValue(masterKey: Uint8Array): string {
  return createHash("sha256").update(authorityKey(masterKey)).digest("hex");
}

export function authorityKeyMatches(authority: Uint8Array, checkValue: string): boolean {
  if (authority.length !== 32 || !/^[0-9a-f]{64}$/.test(checkValue)) return false;
  const expected = createHash("sha256").update(authority).digest();
  return timingSafeEqual(expected, Buffer.from(checkValue, "hex"));
}

export function masterKeyMatches(masterKey: Uint8Array, checkValue: string): boolean {
  return authorityKeyMatches(authorityKey(masterKey), checkValue);
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

export function masterKeyId(publicKey: Uint8Array): Buffer {
  return createHash("sha256").update(publicKey).digest().subarray(0, 8);
}

/** `YYYY-MM-DD · XXXX`: the day given, then the first 4 of the 13 symbols that print the id. */
export function masterKeyName(publicKey: Uint8Array, day: string): string {
  if (!isCalendarDate(day)) {
    throw new AppError("master_key.name_day_invalid", {});
  }
  return `${day} · ${keySymbols(masterKeyId(publicKey)).slice(0, 4)}`;
}
