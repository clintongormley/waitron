import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// PIN hashing with scrypt from node:crypto — no native dependency, a real password KDF (salted,
// memory-hard), and the same "reach for node:crypto, not a new package" posture the credentials
// vault takes with AES-256-GCM. bcrypt/argon2 would each add a native module for what a PIN verify
// does not need. Slice 1 stores the hash on `persons.pin_hash`; the clock-in path (Slice 2) is the
// caller that will verify against it.

/** 16 random bytes, fresh per hash: without a per-hash salt two identical PINs would share a
 * `pin_hash`, a visible equality an operator with SELECT could read. */
const SALT_BYTES = 16;
/** scrypt output length. A 32-byte derived key is the standard width and is what `verifyPin`'s
 * length guard expects back. */
const KEY_BYTES = 32;
/** The algorithm tag stored alongside the salt and derived key, so a future KDF migration can tell
 * an old row from a new one rather than guessing from length. */
const ALGORITHM = "scrypt";

/**
 * Hashes a PIN for storage in `persons.pin_hash`. The returned string is self-describing —
 * `scrypt$<saltHex>$<derivedKeyHex>` — so `verifyPin` needs no out-of-band parameters to check it.
 */
export function hashPin(pin: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(pin, salt, KEY_BYTES);
  return `${ALGORITHM}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verifies a PIN against a stored hash. Fails CLOSED on anything it does not understand — a
 * malformed value, an unknown algorithm tag, or a derived key of the wrong length — rather than
 * throwing, so a hand-edited or corrupt row rejects the PIN instead of crashing the clock-in path.
 */
export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [algorithm, saltHex, derivedHex] = parts;
  if (algorithm !== ALGORITHM) return false;

  const salt = Buffer.from(saltHex!, "hex");
  const expected = Buffer.from(derivedHex!, "hex");
  const actual = scryptSync(pin, salt, KEY_BYTES);
  // timingSafeEqual throws on length-mismatched buffers, so a truncated or tampered `derivedHex`
  // must be rejected here rather than reaching it.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
