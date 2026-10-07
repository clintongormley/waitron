import { expect, it, vi } from "vitest";
import * as labels from "./compare-labels.js";

it("parses each distinct name once with a comparator scoped to one sort", () => {
  const names = ["Pack 10,5 kg", "Pack 2.25 kg", "Pack 0,5 kg", "Pack 0.25 kg", "Pack 2.25 kg"];
  const parsed: string[] = [];
  const match = String.prototype.match;
  const spy = vi.spyOn(String.prototype, "match").mockImplementation(function (
    this: string,
    pattern,
  ) {
    parsed.push(String(this));
    return match.call(this, pattern);
  });
  try {
    const compare = labels.createLabelComparator();
    expect([...names].sort(compare)).toEqual([
      "Pack 0.25 kg",
      "Pack 0,5 kg",
      "Pack 2.25 kg",
      "Pack 2.25 kg",
      "Pack 10,5 kg",
    ]);
    expect(parsed.sort()).toEqual([...new Set(names)].sort());
    parsed.length = 0;
    expect([...names].sort(labels.createLabelComparator())).toEqual([...names].sort(compare));
    expect(parsed.sort()).toEqual([...new Set(names)].sort());
  } finally {
    spy.mockRestore();
  }
});

it("retains empty, equal-decimal, punctuation and exact-decimal order in cached comparisons", () => {
  const compare = labels.createLabelComparator();
  expect(["Table 2", "", "Table 1", "CAFÉ", "cafe"].sort(compare)).toEqual([
    "",
    "CAFÉ",
    "cafe",
    "Table 1",
    "Table 2",
  ]);
  expect(compare("Pack 00,50", "Pack 0.5")).toBe(0);
  expect(compare("Menu 2", "Menu (old)")).toBeGreaterThan(0);
  expect(compare("0.10000000000000001 kg", "0,10000000000000002 kg")).toBeLessThan(0);
});
