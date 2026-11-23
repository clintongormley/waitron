import { describe, expect, it } from "vitest";
import { SERIES_BASES } from "./series-bases.js";

describe("SERIES_BASES", () => {
  it("lists the standard, full, corrective and full corrective series, in that order", () => {
    expect(SERIES_BASES.map((base) => base.purpose)).toEqual([
      "standard",
      "full",
      "corrective",
      "full_corrective",
    ]);
  });

  it("refuses a change, so one test cannot leak a series into the next", () => {
    expect(() => (SERIES_BASES as unknown as { code: string }[]).push({ code: "X" })).toThrow(
      TypeError,
    );
    expect(() => {
      (SERIES_BASES[0] as { code: string }).code = "X";
    }).toThrow(TypeError);
  });
});
