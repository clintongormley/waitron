// Keeps `pin.throttled` (errors.ts) reachable from this file — it is the only code this module throws.
// The reachability convention every code-throwing module here follows. See errors.ts.
import "./errors.js";
import { AppError } from "@waitron/shared";

/**
 * A pure, in-memory back-off on wrong PINs, keyed per `(deviceId, personId)`. It is NOT a DB write on
 * the login path: a throttle counter in Postgres would add write load to an unauthenticated hot path and
 * could contend with the sale path — the fiscal invariant "nothing may block a sale" (CLAUDE.md §5). State
 * is one closure `Map`, per-process; a restart clearing it only ever RELAXES a throttle, which is safe.
 *
 * Policy (spec §5):
 *  - {@link PIN_THROTTLE_FREE_ATTEMPTS} wrong PINs are free (a fat-fingered operator is not punished).
 *  - From the next failure `n` on, a wait window opens of `2^(n - free)` seconds — 2, 4, 8, 16, 32 —
 *    capped at {@link PIN_THROTTLE_MAX_WAIT_SECONDS}. {@link PinThrottle.check} throws `pin.throttled`
 *    while inside the window and returns once it elapses, so the operator may try again; that next wrong
 *    PIN escalates the count further (the window grows, it does not reset).
 *  - {@link PinThrottle.clear} (a successful login) resets the entry to zero.
 *  - An entry untouched for {@link PIN_THROTTLE_IDLE_MS} is treated as fresh and pruned on the next access,
 *    so a lull between attempts starts the escalation over.
 *
 * The back-off SHAPE differs from `apps/server/src/enrol-rate-limit.ts`: that limiter is a FIXED-window
 * counter (N attempts per rolling window), whereas this is an EXPONENTIAL back-off (each failure past
 * the free attempts doubles the wait). What the two share is only the testing seam — an injected clock
 * ({@link PinThrottleOptions.now}) so tests drive the windows deterministically without a real sleep
 * (CLAUDE.md §4); the policy constants are baked in, not injectable, so the throttle can never be built
 * with a different back-off than it ships.
 */

/** Wrong PINs allowed before any wait window opens. The 4th failure is the first to throttle. */
export const PIN_THROTTLE_FREE_ATTEMPTS = 3;

/** The wait window's ceiling in seconds — the escalating `2^k` back-off never grows past this. */
export const PIN_THROTTLE_MAX_WAIT_SECONDS = 60;

/** An entry with no `check`/`recordFailure` for this long is treated as fresh and pruned on access. */
export const PIN_THROTTLE_IDLE_MS = 15 * 60_000;

export interface PinThrottleOptions {
  /**
   * Injectable clock (defaults to `Date.now`), so a test can drive the escalating windows and the idle
   * reset deterministically without a real sleep (CLAUDE.md §4). The policy constants above are NOT
   * injectable — baked in so this throttle can never be constructed with a different back-off than the
   * one it ships.
   */
  now?: () => number;
}

export interface PinThrottle {
  /**
   * Called before verifying a PIN. Throws `pin.throttled` with the whole seconds remaining
   * (`retryAfterSeconds`, rounded UP, min 1) while this `(deviceId, personId)` is inside a wait window;
   * otherwise returns. Prunes the entry first if it has gone idle (see {@link PIN_THROTTLE_IDLE_MS}).
   */
  check(deviceId: string, personId: string): void;
  /**
   * Records one wrong PIN for this `(deviceId, personId)`, escalating the wait window once the free
   * attempts are used up. Prunes an idle entry first, so a failure after a lull starts from zero.
   */
  recordFailure(deviceId: string, personId: string): void;
  /** Resets this `(deviceId, personId)` to zero — called on a successful login. */
  clear(deviceId: string, personId: string): void;
}

interface Entry {
  /** Total wrong PINs in this streak (reset by `clear` or by going idle). */
  fails: number;
  /** Epoch ms until which `check` throttles; `0` while still inside the free attempts. */
  unlockAt: number;
  /** Epoch ms of the last access, for the idle-expiry prune. */
  lastAt: number;
}

function entryKey(deviceId: string, personId: string): string {
  return `${deviceId}:${personId}`;
}

/** The wait window in seconds for the `fails`-th failure (only meaningful once past the free attempts). */
function waitSecondsFor(fails: number): number {
  return Math.min(PIN_THROTTLE_MAX_WAIT_SECONDS, 2 ** (fails - PIN_THROTTLE_FREE_ATTEMPTS));
}

export function createPinThrottle(opts: PinThrottleOptions = {}): PinThrottle {
  const { now = Date.now } = opts;
  const entries = new Map<string, Entry>();

  // The live entry for this key at time `t`, or `undefined` — pruning (and dropping) an idle one first, so
  // a streak that went quiet for the idle window starts over.
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
      // The window has elapsed: allow the attempt, but keep the streak (fails) alive so the NEXT wrong PIN
      // escalates rather than resetting — and refresh liveness against the idle prune.
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
