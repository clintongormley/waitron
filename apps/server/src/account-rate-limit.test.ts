import { describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import {
  ACCOUNT_ACTION_GLOBAL_RATE_MAX,
  ACCOUNT_ACTION_RATE_MAX,
  ACCOUNT_ACTION_RATE_WINDOW_MS,
  createAccountActionRateLimiter,
  createPasswordResetCooldown,
} from "./account-rate-limit.js";

describe("account action rate limiter", () => {
  it("refuses attempts beyond the fixed window cap and resets next window", () => {
    let now = 0;
    const limiter = createAccountActionRateLimiter(() => now);
    for (let i = 0; i < ACCOUNT_ACTION_RATE_MAX; i += 1) limiter.check("account-a");
    try {
      limiter.check("account-a");
      throw new Error("expected rate limit");
    } catch (error) {
      expect(isAppError(error) && error.code).toBe("account_action.rate_limited");
    }
    now = ACCOUNT_ACTION_RATE_WINDOW_MS;
    expect(() => limiter.check("account-a")).not.toThrow();
  });

  it("does not let one account exhaust another account's bucket", () => {
    const limiter = createAccountActionRateLimiter(() => 0);
    for (let i = 0; i < ACCOUNT_ACTION_RATE_MAX; i += 1) limiter.check("account-a");
    expect(() => limiter.check("account-b")).not.toThrow();
  });

  it("caps unique subjects globally so arbitrary keys cannot grow memory without bound", () => {
    const limiter = createAccountActionRateLimiter(() => 0);
    for (let i = 0; i < ACCOUNT_ACTION_GLOBAL_RATE_MAX; i += 1) limiter.check(`account-${i}`);
    expect(() => limiter.check("one-more-account")).toThrowError(
      expect.objectContaining({ code: "account_action.rate_limited" }),
    );
  });
});

describe("password reset cooldown", () => {
  it("waits a full minute per normalized email without delaying other addresses", () => {
    let now = 59_000;
    const accept = createPasswordResetCooldown(() => now);
    expect(accept("  PERSON@example.com ")).toBe(true);
    now = 60_000;
    expect(accept("person@example.com")).toBe(false);
    expect(accept("other@example.com")).toBe(true);
    now = 118_999;
    expect(accept("person@example.com")).toBe(false);
    now = 119_000;
    expect(accept("person@example.com")).toBe(true);
    expect(accept("other@example.com")).toBe(false);
  });
});
