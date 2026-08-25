import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { createFixedWindowLimiter } from "./enrol-rate-limit.js";
import "./errors.js";

// Pure unit test — no DB, no container. The limiter is a plain counter over an INJECTED clock, so the
// window-reset behaviour is proven deterministically here without a flaky real sleep (CLAUDE.md §4: a
// contention/time test on a real clock is a false pass). The route-level proof that the guard
// short-circuits BEFORE the pairing-code DELETE (so a rejected attempt consumes no row) lives in
// device-api.rls.test.ts against real Postgres; this file proves only the counter's arithmetic.

/** Run `fn`, returning whatever it threw (or `undefined` if it did not). */
function caught(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

describe("the enrol fixed-window rate limiter", () => {
  it("allows up to the cap within one window, then throws device.pairing_rate_limited", () => {
    const now = 1_000; // fixed — every check falls in the one window
    const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 3, now: () => now });

    // Three checks inside the one window are allowed (the cap is 3).
    expect(caught(() => limiter.check())).toBeUndefined();
    expect(caught(() => limiter.check())).toBeUndefined();
    expect(caught(() => limiter.check())).toBeUndefined();

    // The fourth in the SAME window is refused with the domain code (→ HTTP 429 at the route).
    const e = caught(() => limiter.check());
    expect(isAppError(e)).toBe(true);
    if (isAppError(e)) expect(e.code).toBe("device.pairing_rate_limited");
  });

  it("resets the counter once the window advances (injected clock)", () => {
    let now = 1_000;
    const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 1, now: () => now });

    expect(caught(() => limiter.check())).toBeUndefined(); // 1st: allowed
    expect(isAppError(caught(() => limiter.check()))).toBe(true); // 2nd, same window: refused

    now += 60_000; // advance to the start of the next window (>= windowMs since the window opened)
    expect(caught(() => limiter.check())).toBeUndefined(); // new window: allowed again
  });

  it("defaults the clock to Date.now when none is injected", () => {
    // No `now` passed — the production path. A single check under a generous cap never trips, proving
    // the default clock wiring is live (the constructor does not require an injected clock).
    const limiter = createFixedWindowLimiter({ windowMs: 60_000, max: 5 });
    expect(caught(() => limiter.check())).toBeUndefined();
  });
});
