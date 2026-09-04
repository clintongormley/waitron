import { describe, expect, it } from "vitest";
import { deriveReservedSeriesCodes } from "./reserved-series.js";

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
