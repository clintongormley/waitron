import { PIN_THROTTLE_IDLE_MS } from "@waitron/identity";
import { describe, expect, it } from "vitest";
import { createPasswordThrottle, passwordThrottleBucket } from "./password-throttle.js";

describe("password login backoff", () => {
  it("uses the PIN policy: three free failures, then doubling waits capped at a minute", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now);
    for (let i = 0; i < 3; i++) throttle.begin("owner@example.com")("invalid");
    for (const seconds of [2, 4, 8, 16, 32, 60, 60]) {
      throttle.begin(" OWNER@example.com ")("invalid");
      expect(() => throttle.begin("owner@example.com")).toThrowError(
        expect.objectContaining({
          code: "password.throttled",
          params: { retryAfterSeconds: seconds },
        }),
      );
      now += seconds * 1000;
    }
    throttle.begin("owner@example.com")("success");
    for (let i = 0; i < 3; i++) throttle.begin("owner@example.com")("invalid");
    throttle.begin("owner@example.com")("success");
  });

  it("blocks overlapping requests for one address while allowing another", () => {
    const throttle = createPasswordThrottle(() => 0);
    const finish = throttle.begin("owner@example.com");
    expect(() => throttle.begin(" OWNER@example.com ")).toThrowError(
      expect.objectContaining({ code: "password.throttled" }),
    );
    throttle.begin("other@example.com")("success");
    finish("error");
    for (let i = 0; i < 4; i++) throttle.begin("owner@example.com")("error");
    throttle.begin("owner@example.com")("success");
  });

  it("prunes idle addresses and bounds memory even when every email is new", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now);
    for (let i = 0; i < 1000; i++) throttle.begin(`person${i}@example.com`)("invalid");
    expect(() => throttle.begin("one-more@example.com")("invalid")).not.toThrow();
    now = 15 * 60_000;
    throttle.begin("one-more@example.com")("success");
    throttle.begin("person0@example.com")("success");
  });

  it("starts a tracked address fresh once it has been idle for the idle time", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now);
    for (let i = 0; i < 4; i++) throttle.begin("owner@example.com")("invalid");
    now = PIN_THROTTLE_IDLE_MS;
    for (let i = 0; i < 3; i++) throttle.begin("owner@example.com")("invalid");
    expect(() => throttle.begin("owner@example.com")("error")).not.toThrow();
  });

  it("passes a failure other than a throttle refusal through unchanged, holding no attempt open", () => {
    const clockFault = new Error("clock unavailable");
    let reads = 0;
    let failSecondRead = true;
    const throttle = createPasswordThrottle(() => {
      reads += 1;
      if (failSecondRead && reads === 2) throw clockFault;
      return 0;
    });
    let thrown: unknown;
    try {
      throttle.begin("owner@example.com");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(clockFault);
    failSecondRead = false;
    expect(() => throttle.begin("owner@example.com")("success")).not.toThrow();
  });
});

describe("password login backoff under a flood of made-up addresses", () => {
  // A fixed secret makes every address's counter reproducible, so a test can pick addresses that do
  // or do not share one rather than leave it to chance.
  const SECRET = new Uint8Array(32);
  const REAL = "real@example.com";
  const bucketOf = (email: string) => passwordThrottleBucket(SECRET, email);
  type Throttle = ReturnType<typeof createPasswordThrottle>;

  function madeUp(count: number, prefix = "made-up", avoid: readonly string[] = []): string[] {
    const avoided = new Set(avoid.map(bucketOf));
    const addresses: string[] = [];
    for (let i = 0; addresses.length < count; i++) {
      const email = `${prefix}-${i}@example.com`;
      if (!avoided.has(bucketOf(email))) addresses.push(email);
    }
    return addresses;
  }

  let neighbourCache: string[] | undefined;
  /** Two addresses other than {@link REAL} that share its counter. */
  function neighbours(): string[] {
    if (neighbourCache === undefined) {
      neighbourCache = [];
      for (let i = 0; neighbourCache.length < 2; i++) {
        const candidate = `neighbour-${i}@example.com`;
        if (bucketOf(candidate) === bucketOf(REAL)) neighbourCache.push(candidate);
      }
    }
    return neighbourCache;
  }

  function fail(throttle: Throttle, email: string, times: number): void {
    for (let i = 0; i < times; i++) throttle.begin(email)("invalid");
  }

  /** Makes the throttle forget every address it tracks, with 1000 made-up ones away from REAL's counter. */
  function forgetAll(throttle: Throttle, prefix: string): void {
    for (const email of madeUp(1000, prefix, [REAL])) throttle.begin(email)("invalid");
  }

  const refusal = (retryAfterSeconds: number) =>
    expect.objectContaining({ code: "password.throttled", params: { retryAfterSeconds } });

  it("picks an address's counter by the secret, so another secret puts it elsewhere", () => {
    const other = new Uint8Array(32).fill(1);
    const emails = madeUp(20);
    expect(emails.map((email) => passwordThrottleBucket(other, email))).not.toEqual(
      emails.map(bucketOf),
    );
  });

  it("does not refuse a new address while it tracks 1000 others", () => {
    const throttle = createPasswordThrottle(() => 0, SECRET);
    for (const email of madeUp(1000)) throttle.begin(email)("invalid");
    expect(() => throttle.begin(REAL)("invalid")).not.toThrow();
  });

  it("tracks at most 1000 addresses however many arrive", () => {
    const throttle = createPasswordThrottle(() => 0, SECRET);
    for (const email of madeUp(3000)) throttle.begin(email)("invalid");
    expect(throttle.tracked()).toBe(1000);
  });

  it("keeps a throttled address's wait and its count through a flood that forgets it", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    fail(throttle, REAL, 4);
    for (const email of madeUp(1500, "made-up", [REAL])) throttle.begin(email)("invalid");

    now = 500;
    expect(() => throttle.begin(REAL)).toThrowError(refusal(2));
    now = 2000;
    fail(throttle, REAL, 1);
    expect(() => throttle.begin(REAL)).toThrowError(refusal(4));
  });

  it("lets a newcomer sharing a counter with a forgotten address start with all three free tries", () => {
    const throttle = createPasswordThrottle(() => 0, SECRET);
    const [other, newcomer] = neighbours();
    fail(throttle, other!, 4);
    forgetAll(throttle, "a");

    fail(throttle, newcomer!, 3);
    expect(() => throttle.begin(newcomer!)("error")).not.toThrow();
  });

  it("keeps a counter's address when a different one with no more wrong tries is forgotten into it", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    const [other] = neighbours();
    fail(throttle, REAL, 4);
    forgetAll(throttle, "a");
    now = 1000;
    fail(throttle, other!, 4);
    forgetAll(throttle, "b");

    now = 2000;
    fail(throttle, REAL, 1);
    expect(() => throttle.begin(REAL)).toThrowError(refusal(4));
  });

  it("lets a different address with more wrong tries take the counter, and the one it displaces comes back fresh", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    const [other] = neighbours();
    fail(throttle, REAL, 4);
    forgetAll(throttle, "a");
    now = 1000;
    fail(throttle, other!, 4);
    now = 3000;
    fail(throttle, other!, 1);
    forgetAll(throttle, "b");

    now = 4000;
    expect(() => throttle.begin(other!)).toThrowError(refusal(3));
    fail(throttle, REAL, 3);
    expect(() => throttle.begin(REAL)("error")).not.toThrow();
  });

  it("escalates further when the same address is forgotten again with more wrong tries", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    fail(throttle, REAL, 4);
    forgetAll(throttle, "a");
    now = 2000;
    fail(throttle, REAL, 1);
    forgetAll(throttle, "b");

    now = 6000;
    fail(throttle, REAL, 1);
    expect(() => throttle.begin(REAL)).toThrowError(refusal(8));
  });

  it("keeps a counter live while its own address keeps coming back, even with no new wrong tries", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    fail(throttle, REAL, 4);
    forgetAll(throttle, "a");
    now = 10 * 60_000;
    throttle.begin(REAL)("error");
    forgetAll(throttle, "b");

    now = 16 * 60_000;
    fail(throttle, REAL, 1);
    expect(() => throttle.begin(REAL)).toThrowError(refusal(4));
  });

  it("starts a forgotten address fresh once its counter has been idle for the idle time", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    fail(throttle, REAL, 4);
    forgetAll(throttle, "a");

    now = PIN_THROTTLE_IDLE_MS;
    fail(throttle, REAL, 3);
    expect(() => throttle.begin(REAL)("error")).not.toThrow();
  });

  it("lets a lower count take a counter whose address has gone idle", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    const [other] = neighbours();
    fail(throttle, REAL, 4);
    forgetAll(throttle, "a");
    now = PIN_THROTTLE_IDLE_MS;
    fail(throttle, other!, 1);
    forgetAll(throttle, "b");

    fail(throttle, other!, 2);
    expect(() => throttle.begin(other!)("invalid")).not.toThrow();
    expect(() => throttle.begin(other!)).toThrowError(refusal(2));
  });

  it("clears a forgotten address's counter when it signs in", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    fail(throttle, REAL, 4);
    forgetAll(throttle, "a");
    now = 2000;
    throttle.begin(REAL)("success");

    fail(throttle, REAL, 3);
    expect(() => throttle.begin(REAL)("error")).not.toThrow();
  });

  it("leaves a counter alone when a different address sharing it signs in", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    const [other] = neighbours();
    fail(throttle, REAL, 4);
    forgetAll(throttle, "a");
    now = 500;
    throttle.begin(other!)("success");

    now = 2000;
    fail(throttle, REAL, 1);
    expect(() => throttle.begin(REAL)).toThrowError(refusal(4));
  });

  it("keeps the longest wait for an address with more wrong tries than a counter holds", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    for (let i = 0; i < 256; i++) {
      throttle.begin(REAL)("invalid");
      now += 60_000;
    }
    forgetAll(throttle, "a");
    fail(throttle, REAL, 1);
    expect(() => throttle.begin(REAL)).toThrowError(refusal(60));
  });

  it("never forgets an address whose attempt is still in flight", () => {
    const throttle = createPasswordThrottle(() => 0, SECRET);
    const finish = throttle.begin(REAL);
    for (const email of madeUp(1000)) throttle.begin(email)("invalid");
    expect(() => throttle.begin(REAL)).toThrowError(refusal(1));
    finish("error");
  });

  it("keeps holding an address whose attempt has been in flight longer than the idle time", () => {
    let now = 0;
    const throttle = createPasswordThrottle(() => now, SECRET);
    const finish = throttle.begin(REAL);
    now = PIN_THROTTLE_IDLE_MS;
    expect(() => throttle.begin(REAL)).toThrowError(refusal(1));
    finish("error");
  });

  it("counts attempts in flight toward the 1000, whether or not the others have finished", () => {
    const throttle = createPasswordThrottle(() => 0, SECRET);
    for (const email of madeUp(1000, "finished")) throttle.begin(email)("invalid");
    const finishes = madeUp(1001, "held").map((email) => throttle.begin(email));
    expect(throttle.tracked()).toBe(1001);
    finishes[0]!("invalid");
    expect(throttle.tracked()).toBe(1000);
    for (const finish of finishes.slice(1, 11)) finish("error");
    expect(throttle.tracked()).toBe(1000);
  });

  it("admits new addresses while every tracked one is in flight, then shrinks back to 1000 as they finish, keeping the counts it forgets", () => {
    const throttle = createPasswordThrottle(() => 0, SECRET);
    const emails = madeUp(1002);
    const finishes = emails.map((email) => throttle.begin(email));
    expect(throttle.tracked()).toBe(1002);
    for (const finish of finishes) finish("invalid");
    expect(throttle.tracked()).toBe(1000);

    fail(throttle, emails[0]!, 3);
    expect(() => throttle.begin(emails[0]!)).toThrowError(refusal(2));
    throttle.begin(REAL)("invalid");
    expect(throttle.tracked()).toBe(1000);
  });
});
