import { isAppError } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { parseThemeChoices, parseThemeName } from "./theme-input.js";

function refusalOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return isAppError(error) ? { code: error.code, params: error.params } : error;
  }
  return "did not throw";
}

const NEUTRAL = {
  brandColor: null,
  brandFix: {},
  background: "neutral",
  corners: "standard",
  handSet: { light: {}, dark: {} },
};

describe("parseThemeChoices", () => {
  it("turns the check's refusal into theme.invalid naming its field and reason", () => {
    expect(refusalOf(() => parseThemeChoices({ ...NEUTRAL, brandFix: { light: true } }))).toEqual({
      code: "theme.invalid",
      params: { field: "brandFix.light", reason: "fix_without_brand" },
    });
  });

  it("returns lowercase choices for an uppercase document", () => {
    expect(
      parseThemeChoices({
        ...NEUTRAL,
        brandColor: "#F2D300",
        handSet: { light: { surface: "#ABCDEF" }, dark: {} },
      }),
    ).toEqual({
      ...NEUTRAL,
      brandColor: "#f2d300",
      handSet: { light: { surface: "#abcdef" }, dark: {} },
    });
  });
});

describe("parseThemeName", () => {
  it("trims the name and keys it in lowercase", () => {
    expect(parseThemeName("  Zoë Studio ")).toEqual({ name: "Zoë Studio", key: "zoë studio" });
  });

  it.each([
    [" waitron ", "reserved"],
    ["", "empty"],
    ["a".repeat(61), "too_long"],
  ])("refuses %j as %s", (name, reason) => {
    expect(refusalOf(() => parseThemeName(name))).toEqual({
      code: "theme.invalid",
      params: { field: "name", reason },
    });
  });
});
