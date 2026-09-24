import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt from node:crypto: a real password KDF (salted, memory-hard) with no native dependency.

/** Fresh per hash: without a per-hash salt two identical secrets would share a stored hash. */
const SALT_BYTES = 16;
const KEY_BYTES = 32;
/** The algorithm tag stored alongside the salt and derived key, so a future KDF migration can tell
 * an old row from a new one rather than guessing from length. */
const ALGORITHM = "scrypt";

/** The returned string is self-describing — `scrypt$<saltHex>$<derivedKeyHex>` — so `verifySecret`
 * needs no out-of-band parameters to check it. */
export function hashSecret(secret: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(secret, salt, KEY_BYTES);
  return `${ALGORITHM}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verifies a secret against a stored hash. Fails CLOSED on anything it does not understand — a
 * malformed value, an unknown algorithm tag, or a derived key of the wrong length — rather than
 * throwing, so a hand-edited or corrupt row rejects the secret instead of crashing the caller.
 */
export function verifySecret(secret: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [algorithm, saltHex, derivedHex] = parts;
  if (algorithm !== ALGORITHM) return false;

  const salt = Buffer.from(saltHex!, "hex");
  const expected = Buffer.from(derivedHex!, "hex");
  const actual = scryptSync(secret, salt, KEY_BYTES);
  // timingSafeEqual throws on length-mismatched buffers, so a truncated or tampered `derivedHex`
  // must be rejected here rather than reaching it.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
