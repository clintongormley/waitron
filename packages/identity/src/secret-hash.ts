import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Generic scrypt secret hashing from node:crypto — no native dependency, a real password KDF
// (salted, memory-hard), and the same "reach for node:crypto, not a new package" posture the
// credentials vault takes with AES-256-GCM. bcrypt/argon2 would each add a native module for what
// this does not need. Extracted from `./verify-pin.ts` so PIN and (later) password hashing share
// one implementation; `verify-pin.ts` now delegates here.

/** 16 random bytes, fresh per hash: without a per-hash salt two identical secrets would share a
 * stored hash, a visible equality an operator with SELECT could read. */
const SALT_BYTES = 16;
/** scrypt output length. A 32-byte derived key is the standard width and is what `verifySecret`'s
 * length guard expects back. */
const KEY_BYTES = 32;
/** The algorithm tag stored alongside the salt and derived key, so a future KDF migration can tell
 * an old row from a new one rather than guessing from length. */
const ALGORITHM = "scrypt";

/**
 * Hashes a secret for storage. The returned string is self-describing —
 * `scrypt$<saltHex>$<derivedKeyHex>` — so `verifySecret` needs no out-of-band parameters to check
 * it.
 */
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
