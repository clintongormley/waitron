import { describe, expect, it } from "vitest";
import { forEachBounded } from "./pool.js";

describe("forEachBounded", () => {
  it("runs every item once, in order of start, with at most the given number in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const started: Array<[string, number]> = [];
    const items = ["a", "b", "c", "d", "e"];
    await forEachBounded(items, 2, async (item, index) => {
      started.push([item, index]);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
    });
    expect(started).toEqual(items.map((item, index) => [item, index]));
    expect(peak).toBe(2);
  });

  it("starts no work for an empty list", async () => {
    let calls = 0;
    await forEachBounded([], 8, async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });
});
