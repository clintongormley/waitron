import { describe, expect, it } from "vitest";
import { BATCH_SIZE, batches } from "./batches.js";

describe("batches", () => {
  it("splits a list into consecutive slices of at most the size, in order", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(batches([], 2)).toEqual([]);
  });

  it("takes a thousand at a time unless told otherwise", () => {
    expect(BATCH_SIZE).toBe(1000);
    const items = Array.from({ length: 2001 }, (_, index) => index);
    expect(batches(items).map((batch) => batch.length)).toEqual([1000, 1000, 1]);
    expect(batches(items).flat()).toEqual(items);
  });
});
