import { describe, expect, it } from "vitest";
import { deriveReservedSeriesCodes, stripOwnSuffixes } from "./reserved-series.js";

describe("deriveReservedSeriesCodes", () => {
  it("suffixes each code with the installation number and preserves purpose", () => {
    const derived = deriveReservedSeriesCodes(
      [
        { code: "A", purpose: "standard" },
        { code: "R", purpose: "rectificative" },
      ],
      42,
    );
    expect(derived).toEqual([
      { code: "A-42", purpose: "standard" },
      { code: "R-42", purpose: "rectificative" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(deriveReservedSeriesCodes([], 42)).toEqual([]);
  });
});

describe("stripOwnSuffixes", () => {
  it("strips only trailing -<digits> groups that are registered installation numbers", () => {
    const registered = new Set([7, 210441234]);
    expect(stripOwnSuffixes("FA", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-7", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-210441234", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-7-210441234", registered)).toBe("FA");
    expect(stripOwnSuffixes("FA-2026", registered)).toBe("FA-2026");
    expect(stripOwnSuffixes("FA-2026-7", registered)).toBe("FA-2026");
  });
});
