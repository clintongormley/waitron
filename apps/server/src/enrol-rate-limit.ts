// Keeps `device.join_rate_limited` (errors.ts) reachable from this file, the one code it throws.
import "./errors.js";
import { AppError, steadyNow } from "@waitron/shared";

/**
 * A per-process, in-memory fixed-window counter, one per mounted enrol surface with no per-caller
 * key. Most surfaces check it at the TOP of the handler, BEFORE the body is parsed and BEFORE any
 * DB work, so a rejected attempt touches no DB; the box-to-box agent route checks it once the
 * signature verifies, so unsigned traffic cannot use up a box's attempts. Either way a rejected
 * attempt creates no row. Every consumer throws the SAME `device.join_rate_limited`.
 *
 * It is not the primary guard: the print-agent knock, and outside devMode the device knock, are
 * admitted only while an admin holds the venue's pairing window open; self-enrolment is
 * loopback-only; and a box asking for its agent's token must sign the request. It is
 * defence-in-depth against a flood. Per-process rather than a DB attempt-counter, because a DB
 * counter would ADD write load to the unauthenticated path.
 */

export const ENROL_RATE_WINDOW_MS = 60_000;

/** Deliberately generous: the goal is to blunt a flood, NOT to police normal enrolment. */
export const ENROL_RATE_MAX = 30;

export interface EnrolRateLimiterOptions {
  /** Only the clock is injectable, so the rate policy stays fixed; elapsed milliseconds never decrease. */
  now?: () => number;
}

export interface EnrolRateLimiter {
  /**
   * Record one enrol attempt. Throws `device.join_rate_limited` (→ HTTP 429) when this window has
   * already seen {@link ENROL_RATE_MAX} allowed attempts; otherwise returns, having counted this one.
   * The first call after {@link ENROL_RATE_WINDOW_MS} elapses opens a
   * fresh window and resets the count.
   */
  check(): void;
}

export function createEnrolRateLimiter(opts: EnrolRateLimiterOptions = {}): EnrolRateLimiter {
  const { now = steadyNow } = opts;
  let windowStart = now();
  let count = 0;
  return {
    check(): void {
      const t = now();
      if (t - windowStart >= ENROL_RATE_WINDOW_MS) {
        windowStart = t;
        count = 0;
      }
      // Refuse BEFORE counting, so the counter stays pinned at the cap under a sustained flood.
      if (count >= ENROL_RATE_MAX) {
        throw new AppError("device.join_rate_limited", {});
      }
      count += 1;
    },
  };
}
