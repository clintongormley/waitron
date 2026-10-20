import { scrypt, scryptSync, type BinaryLike, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

export type ScryptParams = { N: number; r: number; p: number; keylen: number; maxmem: number };

/** Hardened scrypt cost for downloadable, offline-brute-forceable secrets. N=2^17 per OWASP 2024; the
 * derivation needs 128*N*r = 128 MiB and scryptSync throws at exactly that, so maxmem is 256 MiB. */
export const SCRYPT_PARAMS: ScryptParams = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 256 * 1024 * 1024,
};

/** Derive an AES-256 key from a passphrase and a 16-byte salt. */
export function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: ScryptParams = SCRYPT_PARAMS,
): Buffer {
  const { N, r, p, keylen, maxmem } = params;
  return scryptSync(passphrase, salt, keylen, { N, r, p, maxmem });
}

// Typed by hand: promisify infers from scrypt's overload without options.
const scryptOffThread = promisify(scrypt) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** `deriveKey` on libuv's thread pool, so the derivation does not stall the event loop. */
export async function deriveKeyAsync(
  passphrase: string,
  salt: Buffer,
  params: ScryptParams = SCRYPT_PARAMS,
): Promise<Buffer> {
  const { N, r, p, keylen, maxmem } = params;
  return scryptOffThread(passphrase, salt, keylen, { N, r, p, maxmem });
}
