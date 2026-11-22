import { AppError, isUnset, readVariable, type EnvironmentVariableName } from "@waitron/shared";
import "./errors.js";

const KEY_BYTES = 32;
const CURRENT = "WAITRON_CREDENTIALS_KEY" satisfies EnvironmentVariableName;
const CURRENT_VERSION = "WAITRON_CREDENTIALS_KEY_VERSION" satisfies EnvironmentVariableName;
const PREVIOUS = "WAITRON_CREDENTIALS_KEY_PREVIOUS" satisfies EnvironmentVariableName;
const PREVIOUS_VERSION =
  "WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION" satisfies EnvironmentVariableName;

/** Every variable `loadKeyRing` reads. */
export const KEY_RING_VARIABLES = [CURRENT, CURRENT_VERSION, PREVIOUS, PREVIOUS_VERSION] as const;

/**
 * `env` with each key ring variable written on one line, so that wherever `loadKeyRing` reads a ring
 * from the original it reads the same one from the result: a key as the base64 of the bytes it
 * decodes to, a version as the number it reads. An env file line ends at a line break, which base64
 * decoding and `Number` both skip.
 */
export function singleLineKeyRingVariables(
  env: Readonly<Record<string, string>>,
): Record<string, string> {
  const out = { ...env };
  for (const name of [CURRENT, PREVIOUS] as const) {
    const value = readVariable(env, name);
    if (value !== undefined) out[name] = Buffer.from(value, "base64").toString("base64");
  }
  for (const name of [CURRENT_VERSION, PREVIOUS_VERSION] as const) {
    const value = readVariable(env, name);
    if (!isUnset(value)) out[name] = String(Number(value));
  }
  return out;
}

export interface KeyEntry {
  key: Buffer;
  version: number;
}

/** The keys this process can decrypt with. `previous` is present only during a rotation window. */
export interface KeyRing {
  current: KeyEntry;
  previous?: KeyEntry;
}

/** A key ring with its keys in base64, as `secrets.env` holds them. */
export interface EncodedKeyRing {
  key: string;
  version: number;
  previous?: { key: string; version: number };
}

export function encodeKeyRing(ring: KeyRing): EncodedKeyRing {
  const encoded: EncodedKeyRing = {
    key: ring.current.key.toString("base64"),
    version: ring.current.version,
  };
  if (ring.previous !== undefined)
    encoded.previous = {
      key: ring.previous.key.toString("base64"),
      version: ring.previous.version,
    };
  return encoded;
}

/** The ring's variables, as `loadKeyRing` reads them; the previous pair only when it has one. */
export function keyRingEnv(ring: EncodedKeyRing): Record<string, string> {
  const env: Record<string, string> = {
    WAITRON_CREDENTIALS_KEY: ring.key,
    WAITRON_CREDENTIALS_KEY_VERSION: String(ring.version),
  };
  if (ring.previous !== undefined) {
    env.WAITRON_CREDENTIALS_KEY_PREVIOUS = ring.previous.key;
    env.WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION = String(ring.previous.version);
  }
  return env;
}

/**
 * Validates the ring's SHAPE — present, 32 bytes once base64-decoded, a version for every key, no
 * version collision — and not that a key's bytes are the ones that sealed any stored row. Replacing
 * `WAITRON_CREDENTIALS_KEY` with a different valid key under an unchanged
 * `WAITRON_CREDENTIALS_KEY_VERSION` is accepted here; rows stamped with that version are then
 * skipped by `rotate` as already current, and every read of them throws
 * `credentials.decrypt_failed`.
 */
export function loadKeyRing(env: Record<string, string | undefined>): KeyRing {
  const current: KeyEntry = {
    key: readKey(env, CURRENT),
    version: readVersion(env, CURRENT_VERSION, 1),
  };

  const previousRaw = readVariable(env, PREVIOUS);
  const previousVersionRaw = readVariable(env, PREVIOUS_VERSION);
  if (isUnset(previousRaw) && isUnset(previousVersionRaw)) return { current };
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

function readKey(
  env: Record<string, string | undefined>,
  variable: EnvironmentVariableName,
): Buffer {
  const raw = readVariable(env, variable);
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
  variable: EnvironmentVariableName,
  fallback: number | null,
): number {
  const raw = readVariable(env, variable);
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
