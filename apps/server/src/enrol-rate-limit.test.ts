import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  ENROL_RATE_MAX,
  ENROL_RATE_WINDOW_MS,
  createEnrolRateLimiter,
} from "./enrol-rate-limit.js";
import "./errors.js";

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
  it("allows up to the baked-in cap within one window, then throws device.join_rate_limited", () => {
    const now = 1_000; // fixed — every check falls in the one window
    const limiter = createEnrolRateLimiter({ now: () => now });

    for (let i = 0; i < ENROL_RATE_MAX; i++) {
      expect(caught(() => limiter.check())).toBeUndefined();
    }

    const e = caught(() => limiter.check());
    expect(isAppError(e)).toBe(true);
    if (isAppError(e)) expect(e.code).toBe("device.join_rate_limited");
  });

  it("resets the counter once the window advances (injected clock)", () => {
    let now = 1_000;
    const limiter = createEnrolRateLimiter({ now: () => now });

    for (let i = 0; i < ENROL_RATE_MAX; i++) {
      expect(caught(() => limiter.check())).toBeUndefined();
    }
    expect(isAppError(caught(() => limiter.check()))).toBe(true); // over the cap, same window: refused

    now += ENROL_RATE_WINDOW_MS; // advance to the start of the next window (>= the window since it opened)
    expect(caught(() => limiter.check())).toBeUndefined(); // new window: allowed again
  });

  it("defaults the clock to Date.now when none is injected", () => {
    const limiter = createEnrolRateLimiter();
    expect(caught(() => limiter.check())).toBeUndefined();
  });
});
