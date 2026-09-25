import { randomBytes, createCipheriv, createDecipheriv, type DecipherGCM } from "node:crypto";
import { AppError } from "@waitron/shared";
import { deriveKey, SCRYPT_PARAMS } from "./scrypt-kdf.js";
import "./errors.js";

/** The bundle wraps the vault master key: the passphrase is the whole risk surface. */
export const MIN_PASSPHRASE_LENGTH = 12;

/** A recovery bundle's plaintext: relative posix path → UTF-8 file contents. */
export type BundleFiles = Record<string, string>;

const ENVELOPE_VERSION = 1;
// decryptBundle derives with the envelope's own kdf.N/r/p, so this bound caps the real scrypt call.
const MAX_SCRYPT_N = 2 ** 20;
const MAX_PLAINTEXT_BYTES = 1024 * 1024;
// Checked on the base64 string length: decoding first would already have done the allocation.
const MAX_CT_BASE64_LENGTH = Math.ceil(MAX_PLAINTEXT_BYTES / 3) * 4;

interface Envelope {
  v: number;
  kdf: { name: string; N: number; r: number; p: number; salt: string };
  cipher: string;
  iv: string;
  tag: string;
  ct: string;
}

export function encryptBundle(files: BundleFiles, passphrase: string): string {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError("recovery.passphrase_too_short", { min: MIN_PASSPHRASE_LENGTH });
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(files), "utf8")),
    cipher.final(),
  ]);
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    kdf: {
      name: "scrypt",
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      salt: salt.toString("base64"),
    },
    cipher: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
  return JSON.stringify(envelope);
}

function parseEnvelope(envelopeJson: string): Envelope {
  let env: unknown;
  try {
    env = JSON.parse(envelopeJson);
  } catch {
    throw new AppError("recovery.bundle_invalid", { reason: "not_json" });
  }
  const e = env as Partial<Envelope>;
  const kdf = e.kdf as Partial<Envelope["kdf"]> | undefined;
  if (
    e.v !== ENVELOPE_VERSION ||
    e.cipher !== "aes-256-gcm" ||
    kdf?.name !== "scrypt" ||
    typeof kdf.salt !== "string" ||
    typeof e.iv !== "string" ||
    typeof e.tag !== "string" ||
    typeof e.ct !== "string" ||
    !Number.isInteger(kdf.N) ||
    !Number.isInteger(kdf.r) ||
    !Number.isInteger(kdf.p)
  ) {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  if (e.ct.length > MAX_CT_BASE64_LENGTH) {
    throw new AppError("recovery.bundle_invalid", { reason: "ct_too_large" });
  }
  const N = kdf.N as number,
    r = kdf.r as number,
    p = kdf.p as number;
  if (
    N < 2 ||
    N > MAX_SCRYPT_N ||
    r < 1 ||
    r > 32 ||
    p < 1 ||
    p > 16 ||
    // A cheap reject of the gross cases only; decryptBundle's try/catch is the backstop.
    128 * N * r > SCRYPT_PARAMS.maxmem ||
    // String-length caps before the decodes below, as for ct.
    kdf.salt.length > 64 ||
    e.iv.length > 64 ||
    e.tag.length > 64 ||
    Buffer.from(kdf.salt, "base64").length !== 16 ||
    Buffer.from(e.iv, "base64").length !== 12 ||
    Buffer.from(e.tag, "base64").length !== 16
  ) {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  return e as Envelope;
}

export function decryptBundle(envelopeJson: string, passphrase: string): BundleFiles {
  const env = parseEnvelope(envelopeJson);
  let decipher: DecipherGCM;
  try {
    // The envelope's own cost, so a bundle stays decryptable after SCRYPT_PARAMS is hardened.
    const key = deriveKey(passphrase, Buffer.from(env.kdf.salt, "base64"), {
      N: env.kdf.N,
      r: env.kdf.r,
      p: env.kdf.p,
      keylen: SCRYPT_PARAMS.keylen,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
    decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  } catch {
    // Not passphrase_invalid: this is a malformed bundle, not a failed authentication.
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(Buffer.from(env.ct, "base64")), decipher.final()]);
  } catch {
    // Wrong passphrase or tampered bundle — deliberately one code.
    throw new AppError("recovery.passphrase_invalid", {});
  }
  // Authentic is not well-formed: a passphrase holder can seal JSON that is not a string map.
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((v) => typeof v === "string")
  ) {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  return parsed as BundleFiles;
}
