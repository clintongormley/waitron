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
  const entries = new Map<string, Entry>();

  function liveEntry(key: string, t: number): Entry | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (t - entry.lastAt >= PIN_THROTTLE_IDLE_MS) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    check(deviceId: string, personId: string): void {
      const t = now();
      const entry = liveEntry(entryKey(deviceId, personId), t);
      if (entry === undefined) return;
      if (t < entry.unlockAt) {
        const retryAfterSeconds = Math.max(1, Math.ceil((entry.unlockAt - t) / 1000));
        throw new AppError("pin.throttled", { retryAfterSeconds });
      }
      // The window has elapsed: keep the streak so the NEXT wrong PIN escalates rather than resetting.
      entry.lastAt = t;
    },

    recordFailure(deviceId: string, personId: string): void {
      const t = now();
      const key = entryKey(deviceId, personId);
      let entry = liveEntry(key, t);
      if (entry === undefined) {
        entry = { fails: 0, unlockAt: 0, lastAt: t };
        entries.set(key, entry);
      }
      entry.fails += 1;
      entry.lastAt = t;
      if (entry.fails > PIN_THROTTLE_FREE_ATTEMPTS) {
        entry.unlockAt = t + waitSecondsFor(entry.fails) * 1000;
      }
    },

    clear(deviceId: string, personId: string): void {
      entries.delete(entryKey(deviceId, personId));
    },
  };
}
