import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  type DecipherGCM,
} from "node:crypto";
import { AppError } from "@waitron/shared";
import "./errors.js";

/** The floor for a bundle passphrase. The bundle wraps the unrecoverable vault master key, so a weak
 * passphrase is the whole risk surface; the 12-char floor is this build's choice, not a
 * spec-mandated number. */
export const MIN_PASSPHRASE_LENGTH = 12;

/** A recovery bundle's plaintext: relative posix path → UTF-8 file contents. */
export type BundleFiles = Record<string, string>;

const ENVELOPE_VERSION = 1;
// scrypt work factor. N=2^17 per OWASP 2024 — the bundle wraps the vault master key AND the TLS
// private keys and is a downloadable, offline-brute-forceable file, so the KDF must be strong. At
// N=2^17, r=8 the derivation needs exactly 128*N*r = 134,217,728 bytes = 128 MiB, and scryptSync
// throws at the exact boundary; maxmem is 256 MiB to sit above 128*N*r with headroom. keylen 32 =
// AES-256.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 } as const;
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
    !Number.isInteger(kdf.p)
  ) {
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  // Past the Number.isInteger guards N/r/p are known-numbers; name them once instead of re-casting.
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
    // scrypt's memory use is ~128*N*r bytes; N and r can BOTH pass their individual bounds
    // (e.g. N=2^20, r=32 ≈ 4GB) and still breach maxmem. This is a CHEAP up-front reject of the
    // gross cases, NOT the real backstop: OpenSSL's actual limit is slightly larger
    // (~128*r*(N+2+p)), so a shape-valid envelope just under it could still throw a raw
    // ERR_CRYPTO_INVALID_SCRYPT_PARAMS out of scryptSync — which decryptBundle's try/catch turns
    // into our contract error. That try/catch, not this bound, is what guarantees no raw 500.
    128 * N * r > SCRYPT.maxmem ||
    // Decoded byte lengths: a short/odd base64 salt/iv/tag passes the typeof check above but makes
    // scryptSync / createDecipheriv / setAuthTag throw a raw length error later.
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
    const key = deriveKey(
      passphrase,
      Buffer.from(env.kdf.salt, "base64"),
      env.kdf.N,
      env.kdf.r,
      env.kdf.p,
    );
    decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(env.iv, "base64"));
    decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  } catch {
    // Belt-and-braces: parseEnvelope already rejects the reachable KDF/length cases, but any
    // residual raw error from key derivation or cipher setup on a shape-valid but hostile envelope
    // becomes our contract error, never a raw 500 on the operator recovery path. NOT
    // passphrase_invalid: this is a malformed bundle, not a failed authentication.
    throw new AppError("recovery.bundle_invalid", { reason: "malformed" });
  }
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(Buffer.from(env.ct, "base64")), decipher.final()]);
  } catch {
    // GCM authentication failed: wrong passphrase OR tampered bundle — deliberately one code.
    throw new AppError("recovery.passphrase_invalid", {});
  }
  return JSON.parse(plaintext.toString("utf8")) as BundleFiles;
}
