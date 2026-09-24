import { AppError } from "@waitron/shared";
import "./errors.js";

const KEY_BYTES = 32;
const CURRENT = "WAITRON_CREDENTIALS_KEY";
const CURRENT_VERSION = "WAITRON_CREDENTIALS_KEY_VERSION";
const PREVIOUS = "WAITRON_CREDENTIALS_KEY_PREVIOUS";
const PREVIOUS_VERSION = "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION";

export interface KeyEntry {
  key: Buffer;
  version: number;
}

/** The keys this process can decrypt with. `previous` is present only during a rotation window. */
export interface KeyRing {
  current: KeyEntry;
  previous?: KeyEntry;
}

/**
 * Validates the ring's SHAPE — present, 32 bytes once base64-decoded, a version for every key, no
 * version collision — and not that a key's bytes are the ones that sealed any stored row. A
 * different valid key under an unchanged `_VERSION` is accepted here; `rotate` then re-seals
 * nothing and every read throws `credentials.decrypt_failed`.
 */
export function loadKeyRing(env: Record<string, string | undefined>): KeyRing {
  const current: KeyEntry = {
    key: readKey(env, CURRENT),
    version: readVersion(env, CURRENT_VERSION, 1),
  };

  const previousRaw = env[PREVIOUS];
  const previousVersionRaw = env[PREVIOUS_VERSION];
  if (previousRaw === undefined && previousVersionRaw === undefined) return { current };
  // Both or neither: a key with no version cannot be matched to a row, and a version with no key
  // cannot decrypt one. Either alone is a half-finished rotation setup, and failing now beats
  // discovering it when a row on the old version is read.
  if (previousRaw === undefined || previousVersionRaw === undefined) {
    throw new AppError("credentials.key_ring_incomplete", {
      supplied: previousRaw === undefined ? PREVIOUS_VERSION : PREVIOUS,
      missing: previousRaw === undefined ? PREVIOUS : PREVIOUS_VERSION,
    });
  }

  const previous: KeyEntry = {
    key: readKey(env, PREVIOUS),
    version: readVersion(env, PREVIOUS_VERSION, null),
  };
  // A shared version would let `keyForVersion`, which checks `current` first, shadow `previous`'s
  // key, and `rotateCredentials` would count every row on that version as already current and
  // re-seal nothing. Its own code, not `key_ring_incomplete`: both variables were set.
  if (previous.version === current.version) {
    throw new AppError("credentials.key_ring_version_collision", {
      version: current.version,
      currentVariable: CURRENT_VERSION,
      previousVariable: PREVIOUS_VERSION,
    });
  }
  return { current, previous };
}

/** The key that sealed a row on `version`, or null when the ring no longer carries it. Null rather
 * than a throw: the store owns the error, because only it knows which purpose failed. */
export function keyForVersion(ring: KeyRing, version: number): Buffer | null {
  if (ring.current.version === version) return ring.current.key;
  if (ring.previous?.version === version) return ring.previous.key;
  return null;
}

function readKey(env: Record<string, string | undefined>, variable: string): Buffer {
  const raw = env[variable];
  if (raw === undefined || raw === "") throw new AppError("credentials.key_missing", { variable });
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new AppError("credentials.key_invalid", { variable, byteLength: key.length });
  }
  return key;
}

/** `fallback` null means the variable is required. */
function readVersion(
  env: Record<string, string | undefined>,
  variable: string,
  fallback: number | null,
): number {
  const raw = env[variable];
  if (raw === undefined || raw === "") {
    if (fallback !== null) return fallback;
    throw new AppError("credentials.key_version_invalid", { variable, reason: "empty" });
  }
  const value = Number(raw);
  // `raw` NEVER appears in the thrown error: a transposed key and version variable hands this
  // function key material, and `bin.ts` prints an AppError's params to stderr.
  if (!Number.isInteger(value)) {
    throw new AppError("credentials.key_version_invalid", { variable, reason: "not-an-integer" });
  }
  if (value < 1) {
    throw new AppError("credentials.key_version_invalid", { variable, reason: "below-1" });
  }
  return value;
}
