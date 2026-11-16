import "./errors.js";
import { createHmac, randomBytes } from "node:crypto";
import {
  PIN_THROTTLE_IDLE_MS,
  pinThrottleRetryAfterSeconds,
  pinThrottleUnlockAt,
} from "@waitron/identity";
import { AppError, steadyNow } from "@waitron/shared";

type Outcome = "success" | "invalid" | "error";
export interface PasswordThrottle {
  begin(email: string): (outcome: Outcome) => void;
}

export interface PasswordThrottleProbe {
  /** Whether `begin` would refuse `email` now. Changes nothing, not even what it forgets. */
  wouldRefuse(email: string): boolean;
}

const MAX_TRACKED = 1000;
const BUCKETS = 2 ** 16;
const MAX_BUCKET_FAILS = 255;

interface Entry {
  fails: number;
  /** `0` while still inside the free attempts. */
  unlockAt: number;
  lastAt: number;
  bucket: number;
  fingerprint: number;
}

interface Counters {
  fails: Uint8Array;
  unlockAt: Float64Array;
  lastAt: Float64Array;
}

interface Buckets extends Counters {
  fingerprint: Uint32Array;
  occupied: Uint8Array;
  overflow: Counters;
}

function placeOf(
  secret: Uint8Array,
  email: string,
): { key: string; bucket: number; fingerprint: number } {
  const digest = createHmac("sha256", secret).update(email.trim().toLowerCase()).digest();
  return {
    key: digest.toString("base64"),
    bucket: digest.readUInt16BE(0),
    fingerprint: digest.readUInt32BE(2),
  };
}

export function passwordThrottleBucket(secret: Uint8Array, email: string): number {
  return placeOf(secret, email).bucket;
}

/** The PIN delay policy per key, with one attempt in flight per key; `now` never steps back. */
export function createPasswordThrottle(
  now: () => number = steadyNow,
  secret: Uint8Array = randomBytes(32),
): PasswordThrottle & PasswordThrottleProbe & { tracked(): number } {
  // Finished attempts, oldest `lastAt` first: a finish re-inserts its entry at the end.
  const entries = new Map<string, Entry>();
  // Never forgotten or folded, so trimming `entries` never has to walk past one.
  const inFlight = new Map<string, Entry>();
  // Shared overflow never clears on success: it may still hold another address's failures.
  let buckets: Buckets | undefined;

  function bucketLive(table: Counters, bucket: number, t: number): boolean {
    return t - table.lastAt[bucket]! < PIN_THROTTLE_IDLE_MS;
  }

  function fold(entry: Entry, t: number): void {
    if (t - entry.lastAt >= PIN_THROTTLE_IDLE_MS) return;
    buckets ??= {
      fails: new Uint8Array(BUCKETS),
      unlockAt: new Float64Array(BUCKETS),
      lastAt: new Float64Array(BUCKETS),
      fingerprint: new Uint32Array(BUCKETS),
      occupied: new Uint8Array(BUCKETS),
      overflow: {
        fails: new Uint8Array(BUCKETS),
        unlockAt: new Float64Array(BUCKETS),
        lastAt: new Float64Array(BUCKETS),
      },
    };
    const b = entry.bucket;
    const takes =
      buckets.occupied[b] === 0 ||
      !bucketLive(buckets, b, t) ||
      buckets.fingerprint[b] === entry.fingerprint;
    if (takes) {
      buckets.fails[b] = Math.min(MAX_BUCKET_FAILS, entry.fails);
      buckets.unlockAt[b] = entry.unlockAt;
      buckets.lastAt[b] = entry.lastAt;
      buckets.fingerprint[b] = entry.fingerprint;
      buckets.occupied[b] = 1;
      return;
    }
    const overflow = buckets.overflow;
    const live = bucketLive(overflow, b, t);
    overflow.fails[b] = Math.min(
      MAX_BUCKET_FAILS,
      Math.max(live ? overflow.fails[b]! : 0, entry.fails),
    );
    overflow.unlockAt[b] = Math.max(live ? overflow.unlockAt[b]! : 0, entry.unlockAt);
    overflow.lastAt[b] = Math.max(live ? overflow.lastAt[b]! : entry.lastAt, entry.lastAt);
  }

  function ownedBucket(entry: Pick<Entry, "bucket" | "fingerprint">): Buckets | undefined {
    return buckets?.occupied[entry.bucket] === 1 &&
      buckets.fingerprint[entry.bucket] === entry.fingerprint
      ? buckets
      : undefined;
  }

  function sweepIdle(t: number): void {
    for (const [key, entry] of entries) {
      if (t - entry.lastAt >= PIN_THROTTLE_IDLE_MS) entries.delete(key);
      else break;
    }
  }

  // Holds the total to the cap, or to the number in flight while that is larger.
  function trim(t: number): void {
    for (const [key, entry] of entries) {
      if (entries.size + inFlight.size <= MAX_TRACKED) return;
      fold(entry, t);
      entries.delete(key);
    }
  }

  function liveEntry(entry: Entry | undefined, t: number): Entry | undefined {
    return entry !== undefined && t - entry.lastAt < PIN_THROTTLE_IDLE_MS ? entry : undefined;
  }

  function fresh(bucket: number, fingerprint: number, t: number): Entry {
    const owned = ownedBucket({ bucket, fingerprint });
    const source = owned !== undefined && bucketLive(owned, bucket, t) ? owned : buckets?.overflow;
    const inherits = source !== undefined && bucketLive(source, bucket, t);
    return {
      fails: inherits ? source.fails[bucket]! : 0,
      unlockAt: inherits ? source.unlockAt[bucket]! : 0,
      lastAt: t,
      bucket,
      fingerprint,
    };
  }

  return {
    tracked: () => entries.size + inFlight.size,
    wouldRefuse(email) {
      const { key, bucket, fingerprint } = placeOf(secret, email);
      const t = now();
      if (inFlight.has(key)) return true;
      const kept = entries.get(key);
      // An idle entry is one `begin` would sweep away before looking.
      return t < (liveEntry(kept, t) ?? fresh(bucket, fingerprint, t)).unlockAt;
    },
    begin(email) {
      sweepIdle(now());
      const { key, bucket, fingerprint } = placeOf(secret, email);
      const t = now();
      if (inFlight.has(key)) throw new AppError("password.throttled", { retryAfterSeconds: 1 });
      const entry = liveEntry(entries.get(key), t) ?? fresh(bucket, fingerprint, t);
      if (t < entry.unlockAt) {
        throw new AppError("password.throttled", {
          retryAfterSeconds: pinThrottleRetryAfterSeconds(entry.unlockAt, t),
        });
      }
      entries.delete(key);
      inFlight.set(key, entry);
      trim(t);
      const held = entry;
      return (outcome) => {
        if (outcome === "success") {
          inFlight.delete(key);
          const owned = ownedBucket(held);
          if (owned !== undefined) {
            owned.fails[held.bucket] = 0;
            owned.unlockAt[held.bucket] = 0;
            owned.lastAt[held.bucket] = 0;
            owned.fingerprint[held.bucket] = 0;
            owned.occupied[held.bucket] = 0;
          }
          held.fails = 0;
          held.unlockAt = 0;
          held.lastAt = now();
          entries.set(key, held);
          trim(held.lastAt);
          return;
        }
        const finishedAt = now();
        inFlight.delete(key);
        if (outcome === "invalid") {
          held.fails += 1;
          held.unlockAt = pinThrottleUnlockAt(held.fails, finishedAt);
        }
        held.lastAt = finishedAt;
        entries.set(key, held);
        trim(finishedAt);
      };
    },
  };
}
