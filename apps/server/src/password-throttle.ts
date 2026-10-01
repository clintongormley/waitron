import "./errors.js";
import { createHmac, randomBytes } from "node:crypto";
import {
  PIN_THROTTLE_IDLE_MS,
  pinThrottleRetryAfterSeconds,
  pinThrottleUnlockAt,
} from "@waitron/identity";
import { AppError } from "@waitron/shared";

type Outcome = "success" | "invalid" | "error";
export interface PasswordThrottle {
  begin(email: string): (outcome: Outcome) => void;
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

interface Buckets {
  fails: Uint8Array;
  unlockAt: Float64Array;
  lastAt: Float64Array;
  fingerprint: Uint32Array;
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

/** The PIN delay policy per key, with one attempt in flight per key. */
export function createPasswordThrottle(
  now: () => number = Date.now,
  secret: Uint8Array = randomBytes(32),
): PasswordThrottle & { tracked(): number } {
  // Finished attempts, oldest `lastAt` first: a finish re-inserts its entry at the end.
  const entries = new Map<string, Entry>();
  // Never forgotten or folded, so trimming `entries` never has to walk past one.
  const inFlight = new Map<string, Entry>();
  // An address forgotten to make room leaves its count in a counter picked by a secret, so a
  // made-up address cannot be aimed at a real one's counter. A counter holds one address's count at
  // a time, named by its fingerprint, and only an address carrying that fingerprint picks it up
  // again. Another address takes the counter over once it is idle, or with strictly more wrong
  // tries; the address it displaces then comes back with a fresh count.
  let buckets: Buckets | undefined;

  function bucketLive(table: Buckets, bucket: number, t: number): boolean {
    return t - table.lastAt[bucket]! < PIN_THROTTLE_IDLE_MS;
  }

  function fold(entry: Entry, t: number): void {
    buckets ??= {
      fails: new Uint8Array(BUCKETS),
      unlockAt: new Float64Array(BUCKETS),
      lastAt: new Float64Array(BUCKETS),
      fingerprint: new Uint32Array(BUCKETS),
    };
    const b = entry.bucket;
    const takes =
      !bucketLive(buckets, b, t) ||
      buckets.fingerprint[b] === entry.fingerprint ||
      entry.fails > buckets.fails[b]!;
    if (!takes) return;
    buckets.fails[b] = Math.min(MAX_BUCKET_FAILS, entry.fails);
    buckets.unlockAt[b] = entry.unlockAt;
    buckets.lastAt[b] = entry.lastAt;
    buckets.fingerprint[b] = entry.fingerprint;
  }

  function ownedBucket(entry: Pick<Entry, "bucket" | "fingerprint">): Buckets | undefined {
    return buckets?.fingerprint[entry.bucket] === entry.fingerprint ? buckets : undefined;
  }

  function sweepIdle(t: number): void {
    for (const [key, entry] of entries) {
      if (t - entry.lastAt < PIN_THROTTLE_IDLE_MS) break;
      entries.delete(key);
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

  return {
    tracked: () => entries.size + inFlight.size,
    begin(email) {
      sweepIdle(now());
      const { key, bucket, fingerprint } = placeOf(secret, email);
      const t = now();
      if (inFlight.has(key)) throw new AppError("password.throttled", { retryAfterSeconds: 1 });
      let entry = entries.get(key);
      if (entry === undefined) {
        const owned = ownedBucket({ bucket, fingerprint });
        const inherits = owned !== undefined && bucketLive(owned, bucket, t);
        entry = {
          fails: inherits ? owned.fails[bucket]! : 0,
          unlockAt: inherits ? owned.unlockAt[bucket]! : 0,
          lastAt: t,
          bucket,
          fingerprint,
        };
      }
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
          }
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
