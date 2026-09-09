import { describe, expect, it } from "vitest";
import { createPasswordThrottle } from "./password-throttle.js";

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
    expect(() => throttle.begin("one-more@example.com")).toThrowError(
      expect.objectContaining({ code: "password.throttled" }),
    );
    now = 15 * 60_000;
    throttle.begin("one-more@example.com")("success");
    throttle.begin("person0@example.com")("success");
  });
});
