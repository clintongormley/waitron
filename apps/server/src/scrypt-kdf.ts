import { scryptSync } from "node:crypto";

/** The scrypt cost knobs a derivation needs — pulled out as a type so a caller can pass a
 * non-default set (e.g. the cost recorded in an older, self-describing envelope) while still
 * getting `SCRYPT_PARAMS` as the default for anything encrypted fresh. */
export type ScryptParams = { N: number; r: number; p: number; keylen: number; maxmem: number };

/** Hardened scrypt cost — shared by the recovery-bundle envelope and the backup artifact cipher.
 * Both wrap a downloadable, offline-brute-forceable secret (the recovery bundle wraps the vault
 * master key and TLS private keys; the backup artifact wraps the DB dump), so the KDF must be strong.
 *
 * N=2^17 per OWASP 2024. At N=2^17, r=8 the derivation needs exactly 128*N*r = 134,217,728 bytes =
 * 128 MiB, and scryptSync throws at the exact boundary; maxmem is 256 MiB to sit above 128*N*r with
 * headroom. keylen 32 = AES-256. Copied verbatim from the recovery-bundle's original constant so its
 * envelope stays byte-compatible. */
export const SCRYPT_PARAMS: ScryptParams = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 256 * 1024 * 1024,
};

/** Derive a 32-byte AES-256 key from a passphrase and a 16-byte salt, at the given cost (default
 * `SCRYPT_PARAMS`). Pass an explicit `params` to decrypt something sealed under a DIFFERENT cost
 * than the compiled default — e.g. a recovery bundle records its own `kdf.N/r/p` precisely so it
 * stays decryptable after `SCRYPT_PARAMS` is later hardened; encrypting anything new should still
 * use the default. */
export function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: ScryptParams = SCRYPT_PARAMS,
): Buffer {
  const { N, r, p, keylen, maxmem } = params;
  return scryptSync(passphrase, salt, keylen, { N, r, p, maxmem });
}
