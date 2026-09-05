import { randomBytes, createCipheriv, createDecipheriv, type DecipherGCM } from "node:crypto";
import { AppError } from "@waitron/shared";
import { deriveKey, SCRYPT_PARAMS } from "./scrypt-kdf.js";
import "./errors.js";

/** The floor for a bundle passphrase. The bundle wraps the unrecoverable vault master key, so a weak
 * passphrase is the whole risk surface; the 12-char floor is this build's choice, not a
 * spec-mandated number. */
export const MIN_PASSPHRASE_LENGTH = 12;

/** A recovery bundle's plaintext: relative posix path → UTF-8 file contents. */
export type BundleFiles = Record<string, string>;

const ENVELOPE_VERSION = 1;
// Bounds an UNTRUSTED envelope's KDF cost so a hand-edited bundle cannot make decrypt allocate wildly.
// decryptBundle derives with the ENVELOPE's OWN recorded kdf.N/r/p (self-describing, so a bundle
// stays decryptable after SCRYPT_PARAMS is later hardened — see decryptBundle), so this bound is what
// actually caps the real scryptSync call's memory use, not just the envelope's shape. The operator
// runs decrypt on their own bundle, so this is defence-in-depth, not a security boundary.
const MAX_SCRYPT_N = 2 ** 20;
// Bounds an UNTRUSTED envelope's ciphertext so a hostile bundle cannot make decrypt allocate a huge
// Buffer (from `env.ct`) BEFORE the GCM auth failure. The bundle only ever holds 6 small secret files
// (a JSON map of secrets.env + trading.env + 4 PEMs — well under a few KB), so 1 MiB is very generous.
const MAX_PLAINTEXT_BYTES = 1024 * 1024;
// The longest base64 STRING that can decode to MAX_PLAINTEXT_BYTES. Checked against env.ct.length
// BEFORE any Buffer.from decode — decoding first would already have done the allocation we reject.
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
  // Reject an over-large ciphertext on the base64 STRING length, BEFORE decryptBundle's
  // `Buffer.from(env.ct, "base64")` allocates it — checking the decoded length would defeat the point.
  if (e.ct.length > MAX_CT_BASE64_LENGTH) {
    throw new AppError("recovery.bundle_invalid", { reason: "ct_too_large" });
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
    // into our contract error. That try/catch, not this bound, is what guarantees no raw 500. These
    // values genuinely reach scryptSync (decryptBundle derives with the envelope's own kdf.N/r/p), so
    // unlike a pure shape check, getting this bound wrong lets a hostile N actually reach scryptSync.
    128 * N * r > SCRYPT_PARAMS.maxmem ||
    // Cap the base64 STRING length before decoding: salt/iv/tag decode to exactly 16/12/16 bytes
    // (~24 base64 chars), so 64 is generous. Without this, a hostile huge salt/iv/tag string would
    // allocate a large Buffer below just to be rejected by the exact-length check — same DoS shape
    // as the ct cap. The === checks that follow remain the precise validation.
    kdf.salt.length > 64 ||
    e.iv.length > 64 ||
    e.tag.length > 64 ||
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
    // Derive with the ENVELOPE's own recorded cost, not the compiled default: a bundle is an
    // external, operator-held artifact meant to survive indefinitely, and it stays decryptable after
    // SCRYPT_PARAMS is hardened only if decrypt honours whatever cost it was actually sealed under.
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
  // GCM auth proves the bundle is authentic, NOT that its plaintext is a string-map: someone who
  // knows the passphrase can seal valid JSON that is an array or has non-string values, which would
  // then throw a RAW error out of unpackBundleToDir's Object.entries/writeFileAtomic — the same
  // contract-bypass class every other guard here closes. Validate the shape before returning it.
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
