// Keeps `device.pairing_rate_limited` (errors.ts) reachable from this file — it is the DEFAULT code
// this limiter throws and one of the two the enrol surfaces pass (the print surface passes its own
// `agent.pairing_rate_limited`, registered in @waitron/printing's errors.ts and reached through
// print-api.ts's imports). The reachability convention device.ts / kitchen.ts follow. See errors.ts.
import "./errors.js";
import { AppError } from "@waitron/shared";

/**
 * The redemption rate-limit for the enrol routes (`POST /api/device/enrol`, device-identity-1 §8, and
 * `POST /print-api/agent/enrol`, which reuses this same limiter). A per-process, in-memory, GLOBAL
 * fixed-window counter, checked at the TOP of the enrol handler BEFORE the body is parsed and BEFORE the
 * pairing-code DELETE — so a rejected attempt touches no DB. Only the thrown CODE differs per surface
 * (see {@link EnrolRateLimiterOptions.code}); the window, cap and topology reasoning below are shared.
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

export interface EnrolRateLimiterOptions {
  /**
   * Injectable clock (defaults to `Date.now`), so a test can drive the fixed window deterministically
   * without a real sleep (CLAUDE.md §4). The window length and cap are NOT injectable: they are the
   * production {@link ENROL_RATE_WINDOW_MS}/{@link ENROL_RATE_MAX} constants, baked in so this limiter
   * can never be constructed with a different rate POLICY than the one it ships — only the clock and the
   * thrown {@link EnrolRateLimiterOptions.code} are configurable.
   */
  now?: () => number;
  /**
   * The `AppError` code thrown when the window is over the cap. Each enrol surface passes its OWN domain
   * code — `device.pairing_rate_limited` for `POST /api/device/enrol`, `agent.pairing_rate_limited` for
   * `POST /print-api/agent/enrol` — so a throttled enrol is answered in that surface's namespace (codes
   * name the domain concept, CLAUDE.md §1/§3) and no caller has to catch-and-translate a foreign one.
   * Defaults to `device.pairing_rate_limited`, the original device-enrol code, so a caller that omits it
   * keeps that behaviour. Both codes take empty params.
   */
  code?: "device.pairing_rate_limited" | "agent.pairing_rate_limited";
}

export interface EnrolRateLimiter {
  /**
   * Record one enrol attempt. Throws the configured {@link EnrolRateLimiterOptions.code} (→ HTTP 429)
   * when this window has already seen {@link ENROL_RATE_MAX} allowed attempts; otherwise returns, having
   * counted this one. The first call after {@link ENROL_RATE_WINDOW_MS} elapses opens a fresh window and
   * resets the count.
   */
  check(): void;
}

/**
 * The GLOBAL, in-memory, per-process enrol rate-limiter (spec §8). A fixed-window counter with the
 * window ({@link ENROL_RATE_WINDOW_MS}) and cap ({@link ENROL_RATE_MAX}) BAKED IN — a generic
 * `windowMs`/`max` API would misrepresent that fixed policy (CLAUDE.md §1/§3). The one thing it is
 * parameterised on is the thrown {@link EnrolRateLimiterOptions.code}, so the device and print enrol
 * routes share this counter yet each answers a throttle in its own namespace. Not per-key (no
 * per-IP/per-tenant bucket) by design — see the module doc: the on-prem topology makes a per-IP key
 * worthless, and one global bucket is exactly the connection-pool protection wanted. State is two
 * closure variables, so a fresh limiter is fully isolated (each test builds its own; production builds
 * one per enrol surface at boot); only the clock and code are injectable.
 */
export function createEnrolRateLimiter(opts: EnrolRateLimiterOptions = {}): EnrolRateLimiter {
  const { now = Date.now, code = "device.pairing_rate_limited" } = opts;
  let windowStart = now();
  let count = 0;
  return {
    check(): void {
      const t = now();
      // A new window opens the instant the current one has fully elapsed; the count resets with it.
      if (t - windowStart >= ENROL_RATE_WINDOW_MS) {
        windowStart = t;
        count = 0;
      }
      // Refuse BEFORE counting this attempt, so at most `ENROL_RATE_MAX` attempts are ever admitted per
      // window and the counter cannot run away under a sustained flood (it stays pinned at the cap).
      if (count >= ENROL_RATE_MAX) {
        throw new AppError(code, {});
      }
      count += 1;
    },
  };
}
