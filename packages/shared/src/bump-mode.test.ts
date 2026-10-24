import { describe, expect, it } from "vitest";
import { BUMP_MODES, isBumpMode } from "./bump-mode.js";

describe("bump mode", () => {
  it("lists the two ways a station's screen marks work done", () => {
    expect(BUMP_MODES).toEqual(["line", "ticket"]);
  });

  it("accepts each mode and nothing else", () => {
    for (const mode of BUMP_MODES) expect(isBumpMode(mode)).toBe(true);
    for (const value of ["Line", "", null, 1]) expect(isBumpMode(value)).toBe(false);
  });
});
