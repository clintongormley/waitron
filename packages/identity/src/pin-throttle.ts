import "./errors.js";
import { AppError } from "@waitron/shared";

/**
 * An in-memory back-off on wrong PINs, keyed per `(deviceId, personId)` (spec §5). It is NOT a
 * database write, so wrong PINs on the unauthenticated login path add no write load that could
 * contend with the sale path. State is per-process; a restart clearing it only ever RELAXES a throttle.
 */

/** Wrong PINs allowed before any wait window opens. */
export const PIN_THROTTLE_FREE_ATTEMPTS = 3;

export const PIN_THROTTLE_MAX_WAIT_SECONDS = 60;

/** An entry with no `check`/`recordFailure` for this long starts the escalation over. */
export const PIN_THROTTLE_IDLE_MS = 15 * 60_000;

/**
 * A failure may be recorded for any person id a till sends, known or not, so without a cap made-up
 * ids would grow the map without end. While it is full of live entries a new pair is refused for
 * {@link PIN_THROTTLE_FULL_RETRY_SECONDS}.
 */
export const PIN_THROTTLE_MAX_KEYS = 10_000;

export const PIN_THROTTLE_FULL_RETRY_SECONDS = 60;

export interface PinThrottleOptions {
  /** The policy constants above are deliberately NOT injectable; only the clock is. */
  now?: () => number;
}

export interface PinThrottle {
  /** Called before verifying a PIN; throws `pin.throttled` while inside a wait window. */
  check(deviceId: string, personId: string): void;
  recordFailure(deviceId: string, personId: string): void;
  clear(deviceId: string, personId: string): void;
}

interface Entry {
  fails: number;
  /** `0` while still inside the free attempts. */
  unlockAt: number;
  lastAt: number;
}

function entryKey(deviceId: string, personId: string): string {
  return `${deviceId}:${personId}`;
}

function waitSecondsFor(fails: number): number {
  return Math.min(PIN_THROTTLE_MAX_WAIT_SECONDS, 2 ** (fails - PIN_THROTTLE_FREE_ATTEMPTS));
}

export function createPinThrottle(opts: PinThrottleOptions = {}): PinThrottle {
  const { now = Date.now } = opts;
  // Kept in order of `lastAt`, oldest first: every touch moves its entry to the end.
  const entries = new Map<string, Entry>();

  function touch(key: string, entry: Entry, t: number): void {
    entry.lastAt = t;
    entries.delete(key);
    entries.set(key, entry);
  }

  function liveEntry(key: string, t: number): Entry | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (t - entry.lastAt >= PIN_THROTTLE_IDLE_MS) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  function hasRoom(t: number): boolean {
    for (const [key, entry] of entries) {
      if (entries.size < PIN_THROTTLE_MAX_KEYS || t - entry.lastAt < PIN_THROTTLE_IDLE_MS) break;
      entries.delete(key);
    }
    return entries.size < PIN_THROTTLE_MAX_KEYS;
  }

  return {
    check(deviceId: string, personId: string): void {
      const t = now();
      const key = entryKey(deviceId, personId);
      const entry = liveEntry(key, t);
      if (entry === undefined) {
        if (!hasRoom(t)) {
          throw new AppError("pin.throttled", {
            retryAfterSeconds: PIN_THROTTLE_FULL_RETRY_SECONDS,
          });
        }
        return;
      }
      if (t < entry.unlockAt) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.unlockAt - t) / 1000));
        throw new AppError("pin.throttled", { retryAfterSeconds });
      }
      // The window has elapsed: keep the streak so the NEXT wrong PIN escalates rather than resetting.
      touch(key, entry, t);
    },

    recordFailure(deviceId: string, personId: string): void {
      const t = now();
      const key = entryKey(deviceId, personId);
      let entry = liveEntry(key, t);
      if (entry === undefined) {
        // While full the pair stays unrecorded, and `check` refuses it anyway.
        if (!hasRoom(t)) return;
        entry = { fails: 0, unlockAt: 0, lastAt: t };
      }
      entry.fails += 1;
      touch(key, entry, t);
      if (entry.fails > PIN_THROTTLE_FREE_ATTEMPTS) {
        entry.unlockAt = t + waitSecondsFor(entry.fails) * 1000;
      }
    },

    clear(deviceId: string, personId: string): void {
      entries.delete(entryKey(deviceId, personId));
    },
  };
}
