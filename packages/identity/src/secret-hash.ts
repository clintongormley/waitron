import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// scrypt from node:crypto: a real password KDF (salted, memory-hard) with no native dependency.

/** Fresh per hash: without a per-hash salt two identical secrets would share a stored hash. */
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const ALGORITHM = "scrypt";
const scryptAsync = promisify(scrypt) as (
  secret: string,
  salt: Buffer,
  keyLength: number,
) => Promise<Buffer>;

export function hashSecret(secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(secret, salt, KEY_BYTES);
  return `${ALGORITHM}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** The salt and derived key of a stored hash, or null for anything it does not understand. */
function parseStored(stored: string): { salt: Buffer; expected: Buffer } | null {
  const parts = stored.split("$");
  if (parts.length !== 3) return null;
  const [algorithm, saltHex, derivedHex] = parts;
  if (algorithm !== ALGORITHM) return null;
  return { salt: Buffer.from(saltHex!, "hex"), expected: Buffer.from(derivedHex!, "hex") };
}

function matches(expected: Buffer, actual: Buffer): boolean {
  // timingSafeEqual throws on length-mismatched buffers, so a truncated or tampered `derivedHex`
  // must be rejected here rather than reaching it.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Verifies a secret against a stored hash. Fails CLOSED on anything it does not understand — a
 * malformed value, an unknown algorithm tag, or a derived key of the wrong length — rather than
 * throwing, so a hand-edited or corrupt row rejects the secret instead of crashing the caller.
 */
export function verifySecret(secret: string, stored: string): boolean {
  const parsed = parseStored(stored);
  if (parsed === null) return false;
  return matches(parsed.expected, scryptSync(secret, parsed.salt, KEY_BYTES));
}

/**
 * {@link verifySecret}, deriving the key on libuv's thread pool, so the event loop keeps turning —
 * and a caller holding no lock blocks nobody — while scrypt runs.
 */
export async function verifySecretAsync(secret: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (parsed === null) return false;
  return matches(parsed.expected, await scryptAsync(secret, parsed.salt, KEY_BYTES));
}
