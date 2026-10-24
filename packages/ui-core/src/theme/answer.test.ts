import { describe, expect, it } from "vitest";
import { isVenueThemeAnswer } from "./answer.js";

describe("isVenueThemeAnswer", () => {
  it("accepts only /api/theme's shape", () => {
    expect(isVenueThemeAnswer({ hash: "h", css: "", logo: null })).toBe(true);
    expect(isVenueThemeAnswer({ hash: "h", css: "x", logo: { light: "a", dark: null } })).toBe(
      true,
    );
    expect(isVenueThemeAnswer({ hash: "h", css: "x", logo: { light: "a", dark: "b" } })).toBe(true);
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
      { hash: "h", css: "", logo: "a" },
      { hash: "h", css: "", logo: [] },
      { hash: "h", css: "", logo: { light: 1, dark: null } },
      { hash: "h", css: "", logo: { light: "", dark: null } },
      { hash: "h", css: "", logo: { light: "a" } },
      { hash: "h", css: "", logo: { light: "a", dark: 7 } },
      { hash: "h", css: "", logo: { light: "a", dark: "" } },
    ]) {
      expect(isVenueThemeAnswer(value)).toBe(false);
    }
  });
});
