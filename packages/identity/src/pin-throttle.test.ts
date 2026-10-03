import { describe, expect, it } from "vitest";
import { hasCode, isAppError } from "@waitron/shared";
import {
  createPinThrottle,
  PIN_THROTTLE_IDLE_MS,
  PIN_THROTTLE_MAX_KEYS_PER_SLOT,
} from "./pin-throttle.js";
import "./errors.js";

const DEVICE = "device-1";
const PERSON = "person-1";

function caught(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

function retryAfter(fn: () => void): number | undefined {
  const e = caught(fn);
  if (isAppError(e) && hasCode(e, "pin.throttled")) return e.params.retryAfterSeconds;
  return undefined;
}

describe("the per-(slot, person) PIN-attempt throttle", () => {
  it("allows the 3 free failures, then throttles from the 4th with an escalating window", () => {
    let now = 1_000;
    const throttle = createPinThrottle({ now: () => now });

    for (let i = 0; i < 3; i++) {
      throttle.recordFailure(DEVICE, PERSON);
      expect(caught(() => throttle.check(DEVICE, PERSON))).toBeUndefined();
    }

    // The 4th wrong PIN opens the first wait window: 2^(4-3) = 2 seconds.
    throttle.recordFailure(DEVICE, PERSON);
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(2);

    // Each further failure escalates 2 → 4 → 8 → 16 → 32, then caps at 60 from the 9th on.
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

  it("keys on (slot, person): a different person or a different slot is independent", () => {
    let now = 1_000;
    const throttle = createPinThrottle({ now: () => now });

    for (let i = 0; i < 4; i++) throttle.recordFailure(DEVICE, PERSON);
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(2);

    expect(caught(() => throttle.check(DEVICE, "person-2"))).toBeUndefined();
    expect(caught(() => throttle.check("device-2", PERSON))).toBeUndefined();

    now += 1; // clock moves, but the throttled key is still inside its window
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(2);
  });

  it("defaults the clock to Date.now when none is injected", () => {
    const throttle = createPinThrottle();
    throttle.recordFailure(DEVICE, PERSON);
    expect(caught(() => throttle.check(DEVICE, PERSON))).toBeUndefined();
  });
});

describe("the PIN throttle's per-slot bound on how many pairs it holds", () => {
  function fill(throttle: ReturnType<typeof createPinThrottle>, count: number, prefix = "p"): void {
    for (let i = 0; i < count; i++) throttle.recordFailure(DEVICE, `${prefix}-${i}`);
  }

  it("refuses a device's new pair for 60 seconds once that device holds its cap of live pairs", () => {
    const throttle = createPinThrottle({ now: () => 1_000 });
    fill(throttle, PIN_THROTTLE_MAX_KEYS_PER_SLOT);

    expect(retryAfter(() => throttle.check(DEVICE, "newcomer"))).toBe(60);
  });

  it("does not add a new pair's failure while full, so that pair stays refused", () => {
    const throttle = createPinThrottle({ now: () => 1_000 });
    fill(throttle, PIN_THROTTLE_MAX_KEYS_PER_SLOT);

    throttle.recordFailure(DEVICE, "newcomer");
    expect(retryAfter(() => throttle.check(DEVICE, "newcomer"))).toBe(60);
  });

  it("still counts a pair it already holds while full", () => {
    const throttle = createPinThrottle({ now: () => 1_000 });
    fill(throttle, PIN_THROTTLE_MAX_KEYS_PER_SLOT);

    expect(caught(() => throttle.check(DEVICE, "p-0"))).toBeUndefined();
    for (let i = 0; i < 3; i++) throttle.recordFailure(DEVICE, "p-0"); // 4th failure → 2s window
    expect(retryAfter(() => throttle.check(DEVICE, "p-0"))).toBe(2);
  });

  it("makes room by dropping idle pairs, keeping the live ones", () => {
    let now = 0;
    const throttle = createPinThrottle({ now: () => now });
    fill(throttle, PIN_THROTTLE_MAX_KEYS_PER_SLOT - 1); // all idle by the time the newcomer arrives
    now = PIN_THROTTLE_IDLE_MS / 2;
    for (let i = 0; i < 4; i++) throttle.recordFailure(DEVICE, PERSON); // live, and at the cap

    now = PIN_THROTTLE_IDLE_MS;
    expect(caught(() => throttle.check(DEVICE, "newcomer"))).toBeUndefined();
    throttle.recordFailure(DEVICE, PERSON); // PERSON's streak survived: 5th failure → 4s
    expect(retryAfter(() => throttle.check(DEVICE, PERSON))).toBe(4);
  });

  it("frees a device's slot when one of its pairs is cleared, and not for a pair it never held", () => {
    const throttle = createPinThrottle({ now: () => 1_000 });
    fill(throttle, PIN_THROTTLE_MAX_KEYS_PER_SLOT);

    throttle.clear(DEVICE, "never-seen");
    expect(retryAfter(() => throttle.check(DEVICE, "newcomer"))).toBe(60);
    throttle.clear(DEVICE, "p-0");
    expect(caught(() => throttle.check(DEVICE, "newcomer"))).toBeUndefined();
  });

  it("does not refuse another device's new pair while one device is full", () => {
    const throttle = createPinThrottle({ now: () => 1_000 });
    fill(throttle, PIN_THROTTLE_MAX_KEYS_PER_SLOT);

    expect(retryAfter(() => throttle.check(DEVICE, "newcomer"))).toBe(60);
    expect(caught(() => throttle.check("device-2", "newcomer"))).toBeUndefined();
    for (let i = 0; i < 4; i++) throttle.recordFailure("device-2", "newcomer"); // 4th → 2s window
    expect(retryAfter(() => throttle.check("device-2", "newcomer"))).toBe(2);
  });

  it("makes room even when the oldest pair was used again recently", () => {
    let now = 0;
    const throttle = createPinThrottle({ now: () => now });
    fill(throttle, PIN_THROTTLE_MAX_KEYS_PER_SLOT); // "p-0" first
    now = PIN_THROTTLE_IDLE_MS / 2;
    throttle.recordFailure(DEVICE, "p-0"); // the first pair added is now the most recently used

    now = PIN_THROTTLE_IDLE_MS;
    expect(caught(() => throttle.check(DEVICE, "newcomer"))).toBeUndefined();
  });
});

describe("asking the PIN throttle whether it would refuse", () => {
  type Throttle = ReturnType<typeof createPinThrottle>;
  const checkRefuses = (throttle: Throttle, slot: string, person: string): boolean =>
    caught(() => throttle.check(slot, person)) !== undefined;
  const fail = (throttle: Throttle, person: string, times: number, slot = DEVICE): void => {
    for (let i = 0; i < times; i++) throttle.recordFailure(slot, person);
  };

  it("answers as check would for a new pair, one waiting, one whose wait is over and one gone idle", () => {
    let now = 0;
    const throttle = createPinThrottle({ now: () => now });
    expect(throttle.wouldRefuse(DEVICE, PERSON)).toBe(false);
    expect(checkRefuses(throttle, DEVICE, PERSON)).toBe(false);

    fail(throttle, PERSON, 4);
    now = 1_999;
    expect(throttle.wouldRefuse(DEVICE, PERSON)).toBe(true);
    expect(checkRefuses(throttle, DEVICE, PERSON)).toBe(true);
    now = 2_000;
    expect(throttle.wouldRefuse(DEVICE, PERSON)).toBe(false);
    expect(checkRefuses(throttle, DEVICE, PERSON)).toBe(false);

    fail(throttle, PERSON, 5);
    now += PIN_THROTTLE_IDLE_MS;
    expect(throttle.wouldRefuse(DEVICE, PERSON)).toBe(false);
    expect(checkRefuses(throttle, DEVICE, PERSON)).toBe(false);
  });

  it("answers as check would for a new pair while its slot is full, and once idle pairs make room", () => {
    let now = 0;
    const throttle = createPinThrottle({ now: () => now });
    fail(throttle, "idle", 1);
    fail(throttle, "idle elsewhere", 1, "device-2");
    now = PIN_THROTTLE_IDLE_MS / 2;
    for (let i = 1; i < PIN_THROTTLE_MAX_KEYS_PER_SLOT; i++)
      throttle.recordFailure(DEVICE, `p-${i}`);
    expect(throttle.wouldRefuse(DEVICE, "newcomer")).toBe(true);
    expect(checkRefuses(throttle, DEVICE, "newcomer")).toBe(true);
    expect(throttle.wouldRefuse("device-2", "newcomer")).toBe(false);
    expect(checkRefuses(throttle, "device-2", "newcomer")).toBe(false);

    now = PIN_THROTTLE_IDLE_MS;
    expect(throttle.wouldRefuse(DEVICE, "newcomer")).toBe(false);
    expect(checkRefuses(throttle, DEVICE, "newcomer")).toBe(false);
  });

  it("changes nothing: every later check and failure is as if it had never been asked", () => {
    let now = 0;
    const asked = createPinThrottle({ now: () => now });
    const control = createPinThrottle({ now: () => now });
    const pairs: [string, string][] = [
      [DEVICE, PERSON],
      [DEVICE, "person-2"],
      ["device-2", PERSON],
      [DEVICE, "never-seen"],
    ];
    const ask = () => {
      for (const [slot, person] of pairs) asked.wouldRefuse(slot, person);
    };
    const onBoth = (step: (throttle: Throttle) => void) => {
      ask();
      step(asked);
      step(control);
      ask();
    };
    const history = (throttle: Throttle): string[] => {
      const start = now;
      const seen: string[] = [];
      for (const offset of [0, 1_000, 2_000, 5_000, 6_000, PIN_THROTTLE_IDLE_MS]) {
        now = start + offset;
        for (const [slot, person] of pairs) {
          const after = retryAfter(() => throttle.check(slot, person));
          seen.push(`${slot} ${person} at ${offset}: ${after ?? "admitted"}`);
          if (after === undefined) throttle.recordFailure(slot, person);
        }
      }
      now = start;
      return seen;
    };

    onBoth((throttle) => fail(throttle, PERSON, 4));
    onBoth((throttle) => fail(throttle, "person-2", 2));
    onBoth((throttle) => fail(throttle, PERSON, 1, "device-2"));
    // Each pair is a minute short of going idle: a check now would keep it live for 15 more.
    now = PIN_THROTTLE_IDLE_MS - 60_000;
    ask();
    now = PIN_THROTTLE_IDLE_MS;

    const askedHistory = history(asked);
    expect(askedHistory).toEqual(history(control));
    expect(askedHistory.filter((line) => !line.endsWith("admitted")).length).toBeGreaterThan(0);
  });
});
