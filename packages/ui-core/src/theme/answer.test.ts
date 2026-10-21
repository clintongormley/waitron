import { describe, expect, it } from "vitest";
import { isVenueThemeAnswer } from "./answer.js";

describe("isVenueThemeAnswer", () => {
  it("accepts only /api/theme's shape", () => {
    expect(isVenueThemeAnswer({ hash: "h", css: "", logo: null })).toBe(true);
    expect(isVenueThemeAnswer({ hash: "h", css: "x", logo: { light: "a", dark: null } })).toBe(
      true,
    );
    for (const value of [
      null,
      [],
      42,
      "text",
      { css: "", logo: null },
      { hash: 1, css: "", logo: null },
      { hash: "h", logo: null },
      { hash: "h", css: 7, logo: null },
      { hash: "h", css: "" },
    ]) {
      expect(isVenueThemeAnswer(value)).toBe(false);
    }
  });
});
