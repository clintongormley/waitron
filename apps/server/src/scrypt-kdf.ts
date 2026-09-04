import { scryptSync } from "node:crypto";

/** Hardened scrypt cost — shared by the recovery-bundle envelope and the backup artifact cipher.
 * Both wrap a downloadable, offline-brute-forceable secret (the recovery bundle wraps the vault
 * master key and TLS private keys; the backup artifact wraps the DB dump), so the KDF must be strong.
 *
 * N=2^17 per OWASP 2024. At N=2^17, r=8 the derivation needs exactly 128*N*r = 134,217,728 bytes =
 * 128 MiB, and scryptSync throws at the exact boundary; maxmem is 256 MiB to sit above 128*N*r with
 * headroom. keylen 32 = AES-256. Copied verbatim from the recovery-bundle's original constant so its
 * envelope stays byte-compatible. */
export const SCRYPT_PARAMS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 256 * 1024 * 1024,
} as const;

/** Derive a 32-byte AES-256 key from a passphrase and a 16-byte salt. */
export function deriveKey(passphrase: string, salt: Buffer): Buffer {
  const { N, r, p, keylen, maxmem } = SCRYPT_PARAMS;
  return scryptSync(passphrase, salt, keylen, { N, r, p, maxmem });
}
