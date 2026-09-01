import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerbosityController } from "./verbosity.js";

describe("verbosity controller", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-08-31T10:00:00.000Z") }));
  afterEach(() => vi.useRealTimers());
  const now = () => new Date();

  it("defaults to the configured level", () => {
    const c = createVerbosityController({ defaultLevel: "info", now });
    expect(c.current()).toBe("info");
    expect(c.revertsAt()).toBeNull();
  });

  it("raises then auto-reverts after the ttl", () => {
    const c = createVerbosityController({ defaultLevel: "info", now });
    c.raise("debug", 60_000);
    expect(c.current()).toBe("debug");
    expect(c.revertsAt()).toEqual(new Date("2026-08-31T10:01:00.000Z"));
    vi.advanceTimersByTime(59_999);
    expect(c.current()).toBe("debug");
    vi.advanceTimersByTime(1);
    expect(c.current()).toBe("info");
    expect(c.revertsAt()).toBeNull();
  });

  it("a second raise replaces the pending revert", () => {
    const c = createVerbosityController({ defaultLevel: "info", now });
    c.raise("debug", 10_000);
    c.raise("debug", 60_000);
    vi.advanceTimersByTime(10_000);
    expect(c.current()).toBe("debug"); // first timer was cleared
    vi.advanceTimersByTime(50_000);
    expect(c.current()).toBe("info");
  });
});
