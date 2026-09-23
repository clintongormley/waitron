import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttl-cache.js";

describe("createTtlCache", () => {
  it("computes once inside the window and again after it", async () => {
    let clock = new Date("2026-09-15T00:00:00Z");
    const cache = createTtlCache<number>({ ttlMs: 5 * 60_000, now: () => clock });
    const compute = vi.fn(async () => 42);
    expect(await cache.get("r1", compute)).toBe(42);
    clock = new Date("2026-09-15T00:04:59Z");
    expect(await cache.get("r1", compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
    clock = new Date("2026-09-15T00:05:01Z");
    await cache.get("r1", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("keeps keys apart", async () => {
    const cache = createTtlCache<string>({ ttlMs: 60_000, now: () => new Date() });
    expect(await cache.get("a", async () => "A")).toBe("A");
    expect(await cache.get("b", async () => "B")).toBe("B");
  });

  it("does not cache a rejected compute", async () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, now: () => new Date() });
    await expect(
      cache.get("r", async () => {
        throw new Error("x");
      }),
    ).rejects.toThrow("x");
    expect(await cache.get("r", async () => 7)).toBe(7);
  });

  it("shares one compute for concurrent cold gets", async () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, now: () => new Date() });
    const compute = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 1;
    });
    await Promise.all([cache.get("r", compute), cache.get("r", compute)]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not let an older compute's failure drop a newer cached value", async () => {
    let clock = new Date("2026-09-15T00:00:00Z");
    const cache = createTtlCache<number>({ ttlMs: 60_000, now: () => clock });
    let failOld!: (e: Error) => void;
    const old = cache.get("r", () => new Promise<number>((_, reject) => (failOld = reject)));
    clock = new Date("2026-09-15T00:02:00Z");
    expect(await cache.get("r", async () => 2)).toBe(2);
    failOld(new Error("old compute failed"));
    await expect(old).rejects.toThrow("old compute failed");
    const recompute = vi.fn(async () => 3);
    expect(await cache.get("r", recompute)).toBe(2);
    expect(recompute).not.toHaveBeenCalled();
  });
});
