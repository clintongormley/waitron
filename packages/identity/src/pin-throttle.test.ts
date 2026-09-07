import { describe, expect, it } from "vitest";
import { hasCode, isAppError } from "@waitron/shared";
import { createPinThrottle } from "./pin-throttle.js";
import "./errors.js";

// Pure unit test — no DB, no container. The throttle keeps its state in a closure Map over an INJECTED
// clock, so the escalating windows and the 15-min idle reset are proven deterministically without a
// flaky real sleep (CLAUDE.md §4: a time test on a real clock is a false pass). The route-level wiring
// (Task 10) is proven elsewhere; this file proves only the pure policy arithmetic.

const DEVICE = "device-1";
const PERSON = "person-1";

/** Run `fn`, returning whatever it threw (or `undefined` if it did not). */
function caught(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

/** The `retryAfterSeconds` of a `pin.throttled` thrown by `fn`, or `undefined` if it did not throw it. */
function retryAfter(fn: () => void): number | undefined {
  const e = caught(fn);
  if (isAppError(e) && hasCode(e, "pin.throttled")) return e.params.retryAfterSeconds;
  return undefined;
}

describe("the per-(device,person) PIN-attempt throttle", () => {
  it("allows the 3 free failures, then throttles from the 4th with an escalating window", () => {
    let now = 1_000;
    const throttle = createPinThrottle({ now: () => now });

    // The first three wrong PINs are free: after each, a check does not throw.
    for (let i = 0; i < 3; i++) {
      throttle.recordFailure(DEVICE, PERSON);
      expect(caught(() => throttle.check(DEVICE, PERSON))).toBeUndefined();
    }

    // The 4th wrong PIN opens the first wait window: 2^(4-3) = 2 seconds.
    throttle.recordFailure(DEVICE, PERSON);
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(2);

    // Each further failure escalates 2 → 4 → 8 → 16 → 32, then caps at 60 from the 9th on. We advance
    // the clock past each window before the next failure so the count keeps climbing.
    for (const expected of [4, 8, 16, 32, 60, 60]) {
      now += expected * 1_000; // let the current window elapse
      throttle.recordFailure(DEVICE, PERSON);
      expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(expected);
    }
  });

  it("rounds retryAfterSeconds UP to a whole second, min 1", () => {
    let now = 0;
    const throttle = createPinThrottle({ now: () => now });

    for (let i = 0; i < 4; i++) throttle.recordFailure(DEVICE, PERSON); // 4th → 2s window from now=0

    now = 500; // 1.5s remain → ceil = 2
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(2);
    now = 1_100; // 0.9s remain → ceil = 1
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(1);
    now = 1_999; // 1ms remains → ceil = 1 (min 1)
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(1);
  });

  it("lets check return once the wait elapses, and a further wrong PIN escalates the window", () => {
    let now = 1_000;
    const throttle = createPinThrottle({ now: () => now });

    for (let i = 0; i < 4; i++) throttle.recordFailure(DEVICE, PERSON); // 4th → 2s window
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(2);

    now += 2_000; // the 2s window has fully elapsed
    expect(caught(() => throttle.check(DEVICE, PERSON))).toBeUndefined(); // may try again

    // That next attempt is also wrong → the 5th failure escalates to 4s, not back to 2s.
    throttle.recordFailure(DEVICE, PERSON);
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(4);
  });

  it("resets to zero on clear, so a subsequent single failure is back within the 3 free", () => {
    let now = 1_000;
    const throttle = createPinThrottle({ now: () => now });

    for (let i = 0; i < 5; i++) throttle.recordFailure(DEVICE, PERSON); // deep into the throttle
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(4);

    throttle.clear(DEVICE, PERSON); // successful login

    now += 1; // a fresh, later attempt
    throttle.recordFailure(DEVICE, PERSON); // 1st failure again
    expect(caught(() => throttle.check(DEVICE, PERSON))).toBeUndefined();
  });

  it("treats an entry as fresh after 15 idle minutes (pruned on access)", () => {
    let now = 1_000;
    const throttle = createPinThrottle({ now: () => now });

    for (let i = 0; i < 4; i++) throttle.recordFailure(DEVICE, PERSON); // throttled, 2s window
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(2);

    now += 15 * 60 * 1_000; // 15 idle minutes with no attempt
    throttle.recordFailure(DEVICE, PERSON); // starts from zero → 1st failure, still free
    expect(caught(() => throttle.check(DEVICE, PERSON))).toBeUndefined();
  });

  it("keys on (device, person): a different person or a different device is independent", () => {
    let now = 1_000;
    const throttle = createPinThrottle({ now: () => now });

    // Fully throttle (DEVICE, PERSON).
    for (let i = 0; i < 4; i++) throttle.recordFailure(DEVICE, PERSON);
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(2);

    // A DIFFERENT person on the SAME device is unthrottled.
    expect(caught(() => throttle.check(DEVICE, "person-2"))).toBeUndefined();
    // The SAME person on a DIFFERENT device is unthrottled.
    expect(caught(() => throttle.check("device-2", PERSON))).toBeUndefined();

    now += 1; // clock moves, but the throttled key is still inside its window
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(2);
  });

  it("defaults the clock to Date.now when none is injected", () => {
    // No `now` passed — the production path. A single failure under the free allowance never throttles,
    // proving the default clock wiring is live (the constructor does not require an injected clock).
    const throttle = createPinThrottle();
    throttle.recordFailure(DEVICE, PERSON);
    expect(caught(() => throttle.check(DEVICE, PERSON))).toBeUndefined();
  });
});
