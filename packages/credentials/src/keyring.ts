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
 * Reads and VALIDATES the ring once, from an environment-shaped record rather than `process.env`
 * directly, so tests need no global mutation and the host can pass whatever it loaded config from.
 *
 * Validates the ring's SHAPE — present, correctly base64-encoded, correctly sized, a version number
 * for every key, no version collision — loudly, rather than at the first decrypt of the first
 * credential at three in the morning. It does NOT validate that a key's bytes are the ones that
 * actually sealed any stored row: swapping `WAITRON_CREDENTIALS_KEY` for a different-but-valid
 * 32-byte key, without bumping `_VERSION` and without setting `_PREVIOUS`, is accepted here cleanly.
 * `rotate` then reports `rotated 0, already current 1` — a clean-looking maintenance run — and every
 * read afterwards throws `credentials.decrypt_failed`, at exactly the moment this comment used to
 * claim it would pre-empt. Catching that needs a stored-row probe (attempt a real decrypt against a
 * known row before accepting the ring), which this function deliberately does not do — a known
 * limit, not an oversight.
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
  // Two members sharing a version has two real consequences, even though loadKeyRing itself
  // refuses to construct such a ring (this guard is what refuses it): a caller could still build a
  // KeyRing object by hand, bypassing loadKeyRing entirely, so the properties below describe that
  // hand-built shape rather than something any committed test constructs. `keyForVersion` checks
  // `current` before `previous`, so a collision permanently SHADOWS
  // `previous`'s key for that version number — a row actually sealed under the distinct `previous`
  // key material decrypts with the wrong bytes and fails GCM authentication; it is never silently
  // misread. And in `rotateCredentials`, every row stamped with the shared version number satisfies
  // `row.keyVersion === ring.current.version` and takes the "already current" branch, so a rotate
  // run against such a ring re-seals NOTHING and reports the whole vault as clean — masking a
  // stalled rotation, not performing one. (It does NOT let a rotate that forgot to bump the version
  // "re-seal every row with the same key while reporting success", as this comment previously
  // claimed: the already-current skip fires before any re-seal could happen.) This is NOT a
  // "missing" case — both variables were supplied — so it gets its own code rather than reusing
  // `key_ring_incomplete`, whose params would otherwise tell an operator to set a variable they
  // have already set.
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
 * than a throw: the store owns the error, because only it knows which (tenant, purpose) failed. */
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
  // Number("") is 0 and Number("1.5") is 1.5, so both a blank and a fractional version must be
  // rejected explicitly — parseInt would silently accept "1.5" as 1 and "1abc" as 1. `raw` NEVER
  // appears in the thrown error: an operator who transposed WAITRON_CREDENTIALS_KEY and
  // WAITRON_CREDENTIALS_KEY_VERSION (or templated both from one value) hands this function key
  // material, and this package's own bin.ts prints an AppError's params verbatim to stderr — a
  // shape classification is all the operator needs to fix the mistake.
  if (!Number.isInteger(value)) {
    throw new AppError("credentials.key_version_invalid", { variable, reason: "not-an-integer" });
  }
  if (value < 1) {
    throw new AppError("credentials.key_version_invalid", { variable, reason: "below-1" });
  }
  return value;
}
