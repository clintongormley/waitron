import { hashSecret, verifySecret } from "./secret-hash.js";

// PIN hashing delegates to the generic scrypt helper in `./secret-hash.ts`, so the KDF lives in one
// place and PIN and (later) password hashing cannot drift apart. The stored format is unchanged —
// `scrypt$<saltHex>$<derivedKeyHex>` — so existing `persons.pin_hash` rows keep verifying.
// `verifyPin` is called by `./credential.ts` (`verifyPersonCredential`), which backs both
// `./login.ts`'s `loginWithPin` and `./authorize.ts`'s supervisor-override path.

/**
 * Hashes a PIN for storage in `persons.pin_hash`. The returned string is self-describing —
 * `scrypt$<saltHex>$<derivedKeyHex>` — so `verifyPin` needs no out-of-band parameters to check it.
 */
export function hashPin(pin: string): string {
  return hashSecret(pin);
}

/**
 * Verifies a PIN against a stored hash. Fails CLOSED on anything it does not understand — a
 * malformed value, an unknown algorithm tag, or a derived key of the wrong length — rather than
 * throwing, so a hand-edited or corrupt row rejects the PIN instead of crashing the login path.
 */
export function verifyPin(pin: string, stored: string): boolean {
  return verifySecret(pin, stored);
}
