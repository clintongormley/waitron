// Keeps `device.pairing_rate_limited` (errors.ts) reachable from the file that throws it — the
// reachability convention device.ts / kitchen.ts follow. See errors.ts.
import "./errors.js";
import { AppError } from "@waitron/shared";

/**
 * The redemption rate-limit for `POST /api/device/enrol` (device-identity-1 §8, the spec's net-new
 * control). A per-process, in-memory, GLOBAL fixed-window counter, checked at the TOP of the enrol
 * handler BEFORE the body is parsed and BEFORE the pairing-code DELETE — so a rejected attempt touches
 * no DB.
 *
 * Why a limit at all, and why THIS shape:
 *  - The primary brute-force controls already exist — the pairing code is ~40-bit Crockford entropy,
 *    single-use, 15-min TTL (device.ts §2c) — so brute-forcing a code over HTTP is already infeasible.
 *    This limit is therefore DEFENSE-IN-DEPTH plus DoS / connection-pool protection.
 *  - Rejecting BEFORE the DB is the point: an enrol flood must not exhaust the connection pool and
 *    starve the sale path (the fiscal invariant "nothing may block a sale", CLAUDE.md §5). Since the
 *    check runs before `c.req.json()` and before `enrolDevice`'s locking DELETE, a rejected attempt does
 *    no DB work and consumes no pairing code.
 *  - GLOBAL, not per-IP: the on-prem server sits behind the snitun tunnel / a reverse proxy, so every
 *    client presents one source address and a per-IP key would collapse to a single bucket and buy
 *    nothing. A single global cap is robust to that topology.
 *  - Per-process, not a DB attempt-counter: a DB counter would ADD write load to the unauthenticated hot
 *    path (the opposite of the goal), and cross-instance coordination is speculative — there is one
 *    on-prem server per venue today (CLAUDE.md §3).
 */

/**
 * The fixed window's length. 60s is long enough that the cap is meaningful against a sustained flood yet
 * short enough that a legitimate operator who tripped it (they will not — see {@link ENROL_RATE_MAX}) is
 * unblocked within a minute.
 */
export const ENROL_RATE_WINDOW_MS = 60_000;

/**
 * The most enrol attempts allowed per {@link ENROL_RATE_WINDOW_MS}. 30/min ≈ one every two seconds
 * sustained — vast headroom over legitimate use (an operator mints a code and one device redeems it;
 * even a handful of fat-fingered retries is nowhere near this), while a brute-force / DoS flood of
 * thousands per second is blunted to 30 DB-touching attempts a minute and the rest are refused before
 * any DB work. Deliberately generous: the goal is to blunt a flood, NOT to police normal enrolment, so
 * the cap must never block a real retry.
 */
export const ENROL_RATE_MAX = 30;

export interface FixedWindowLimiterOptions {
  /** The window length in milliseconds. */
  windowMs: number;
  /** The most `check()` calls allowed per window before it starts refusing. */
  max: number;
  /** Injectable clock (defaults to `Date.now`) — a test drives the window without a real sleep. */
  now?: () => number;
}

export interface FixedWindowLimiter {
  /**
   * Record one attempt. Throws `device.pairing_rate_limited` (→ HTTP 429) when this window has already
   * seen `max` allowed attempts; otherwise returns, having counted this one. The first call after the
   * window elapses opens a fresh window and resets the count.
   */
  check(): void;
}

/**
 * A GLOBAL fixed-window counter. Not per-key (no per-IP/per-tenant bucket) by design — see the module
 * doc: the on-prem topology makes a per-IP key worthless, and one global bucket is exactly the
 * connection-pool protection wanted. State is two module-free closure variables, so a fresh limiter is
 * fully isolated (each test builds its own; production builds exactly one at boot).
 */
export function createFixedWindowLimiter(opts: FixedWindowLimiterOptions): FixedWindowLimiter {
  const { windowMs, max, now = Date.now } = opts;
  let windowStart = now();
  let count = 0;
  return {
    check(): void {
      const t = now();
      // A new window opens the instant the current one has fully elapsed; the count resets with it.
      if (t - windowStart >= windowMs) {
        windowStart = t;
        count = 0;
      }
      // Refuse BEFORE counting this attempt, so at most `max` attempts are ever admitted per window and
      // the counter cannot run away under a sustained flood (it stays pinned at `max`).
      if (count >= max) {
        throw new AppError("device.pairing_rate_limited", {});
      }
      count += 1;
    },
  };
}
