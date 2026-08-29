import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** The floor for a bundle passphrase. The bundle wraps the unrecoverable vault master key, so a weak
 * passphrase is the whole risk surface; 12 chars is the operator-facing minimum (spec §12). */
export const MIN_PASSPHRASE_LENGTH = 12;

/** A recovery bundle's plaintext: relative posix path → UTF-8 file contents. */
export type BundleFiles = Record<string, string>;

const ENVELOPE_VERSION = 1;
// scrypt work factor. N=2^15 with r=8,p=1 needs ~32MB (128*N*r); maxmem is set well above that on both
// sides so a future N bump does not silently fail. keylen 32 = AES-256.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 128 * 1024 * 1024 } as const;
// Bounds an UNTRUSTED envelope's KDF cost so a hand-edited bundle cannot make decrypt allocate wildly.
// The operator runs decrypt on their own bundle, so this is defence-in-depth, not a security boundary.
const MAX_SCRYPT_N = 2 ** 20;

interface Envelope {
  v: number;
  kdf: { name: string; N: number; r: number; p: number; salt: string };
  cipher: string;
  iv: string;
  tag: string;
  ct: string;
}

function deriveKey(passphrase: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return scryptSync(passphrase, salt, SCRYPT.keylen, { N, r, p, maxmem: SCRYPT.maxmem });
}

export function encryptBundle(files: BundleFiles, passphrase: string): string {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError("recovery.passphrase_too_short", { min: MIN_PASSPHRASE_LENGTH });
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(files), "utf8")),
    cipher.final(),
  ]);
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    kdf: { name: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64") },
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
    !Number.isInteger(kdf.p) ||
    (kdf.N as number) < 2 ||
    (kdf.N as number) > MAX_SCRYPT_N ||
    (kdf.r as number) < 1 ||
    (kdf.r as number) > 32 ||
    (kdf.p as number) < 1 ||
    (kdf.p as number) > 16
  ) {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  return e as Envelope;
}

export function decryptBundle(envelopeJson: string, passphrase: string): BundleFiles {
  const env = parseEnvelope(envelopeJson);
  const key = deriveKey(
    passphrase,
    Buffer.from(env.kdf.salt, "base64"),
    env.kdf.N,
    env.kdf.r,
    env.kdf.p,
  );
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
  decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(Buffer.from(env.ct, "base64")), decipher.final()]);
  } catch {
    // GCM authentication failed: wrong passphrase OR tampered bundle — deliberately one code.
    throw new AppError("recovery.passphrase_invalid", {});
  }
  return JSON.parse(plaintext.toString("utf8")) as BundleFiles;
}
