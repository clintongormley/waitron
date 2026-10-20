import { describe, expect, test } from "vitest";
import { contrastRatio } from "./colour.js";
import { deriveThemeFrom, WAITRON_CHOICES, type ThemeChoices } from "./theme.js";
import { colourToken } from "./tokens.js";
import { deriveTheme, WAITRON_DEFAULTS } from "./waitron.js";

const P = colourToken;
const ratio = (a: string, b: string) => contrastRatio(a, b).toFixed(2);

const LEMON: ThemeChoices = { ...WAITRON_CHOICES, brandColor: "#f2d300" };
const DARK_GREEN: ThemeChoices = {
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  background: "tinted",
  corners: "round",
};
const BURGUNDY: ThemeChoices = { ...WAITRON_CHOICES, brandColor: "#7a1f2b", background: "tinted" };

describe("the brand colour's readability warning", () => {
  test("the lemon brand (#f2d300) warns in light against three grounds, and its fix reads", () => {
    const theme = deriveTheme(LEMON);
    expect(theme.warnings).toEqual([
      {
        field: "brandColor",
        mode: "light",
        against: ["field-fill", "bg", "surface"],
        fix: "#9f8b18",
        blockedBy: [],
      },
    ]);
    const primary = theme.light[P("primary")]!;
    expect(
      ["field-fill", "bg", "surface"].map((key) => ratio(primary, theme.light[P(key)]!)),
    ).toEqual(["1.32", "1.39", "1.49"]);

    const fixed = deriveTheme({ ...LEMON, brandFix: { light: true } });
    expect(fixed.warnings).toEqual([]);
    expect(fixed.light[P("primary")]).toBe("#9f8b18");
  });

  test("the dark-green brand (#1e5b3a) warns in dark, and its fix clears it", () => {
    const theme = deriveTheme(DARK_GREEN);
    expect(theme.warnings).toEqual([
      {
        field: "brandColor",
        mode: "dark",
        against: ["field-fill", "bg", "surface"],
        fix: "#417c59",
        blockedBy: [],
      },
    ]);
    const primary = theme.dark[P("primary")]!;
    expect(
      ["field-fill", "bg", "surface"].map((key) => ratio(primary, theme.dark[P(key)]!)),
    ).toEqual(["1.86", "2.37", "2.18"]);

    const fixed = deriveTheme({ ...DARK_GREEN, brandFix: { dark: true } });
    expect(fixed.warnings).toEqual([]);
    expect(fixed.dark[P("primary")]).toBe("#417c59");
  });

  test("the burgundy brand (#7a1f2b), Tinted, warns in dark with its fix", () => {
    expect(deriveTheme(BURGUNDY).warnings).toEqual([
      {
        field: "brandColor",
        mode: "dark",
        against: ["field-fill", "bg", "surface"],
        fix: "#b05157",
        blockedBy: [],
      },
    ]);
    expect(deriveTheme({ ...BURGUNDY, brandFix: { dark: true } }).warnings).toEqual([]);
  });

  test("Waitron's blue typed as a brand colour, and Waitron's own look, warn in neither mode", () => {
    expect(deriveTheme({ ...WAITRON_CHOICES, brandColor: "#1f6feb" }).warnings).toEqual([]);
    expect(deriveTheme(WAITRON_CHOICES).warnings).toEqual([]);
  });

  // From the reference: ~/waitron-campaign/a841-plan1-probes/t9/waitron-primary-ref.mjs.
  test("Waitron's own brand colour never warns, even on a palette where it fails", () => {
    const pageColouredButtons = {
      ...WAITRON_DEFAULTS,
      light: {
        ...WAITRON_DEFAULTS.light,
        [colourToken("primary")]: WAITRON_DEFAULTS.light[colourToken("bg")]!,
      },
    };
    const theme = deriveThemeFrom(pageColouredButtons, WAITRON_CHOICES);
    expect(theme.light[colourToken("primary")]).toBe("#f7f7f8");
    expect(theme.warnings).toEqual([]);
  });

  test("a fix flag where the brand colour already reads paints it unchanged", () => {
    const theme = deriveTheme({ ...DARK_GREEN, brandFix: { light: true } });
    expect(theme.light[P("primary")]).toBe("#1e5b3a");
    expect(theme.warnings).toEqual([
      expect.objectContaining({ field: "brandColor", mode: "dark" }),
    ]);
    expect(theme.warnings.filter((warning) => warning.mode === "light")).toEqual([]);
  });

  test("a brand colour set by hand for a mode does not warn as the brand colour there", () => {
    const theme = deriveThemeFrom(WAITRON_DEFAULTS, {
      ...LEMON,
      handSet: { light: { primary: "#f2d300" }, dark: {} },
    });
    expect(theme.warnings.filter((warning) => warning.field === "brandColor")).toEqual([]);
  });
});
