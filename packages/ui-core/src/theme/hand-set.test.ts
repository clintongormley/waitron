import { describe, expect, test } from "vitest";
import { contrastRatio } from "./colour.js";
import { THEME_RULES, checkRules } from "./contrast-rules.js";
import type { Mode } from "./defaults.js";
import {
  normaliseChoices,
  WAITRON_CHOICES,
  type DerivedTheme,
  type ThemeChoices,
} from "./theme.js";
import { colourToken, THEME_TOKENS, type ThemeColour } from "./tokens.js";
import { deriveTheme, WAITRON_DEFAULTS } from "./waitron.js";

const P = colourToken;
const ratio = (a: string, b: string) => contrastRatio(a, b).toFixed(2);

const DARK_GREEN: ThemeChoices = {
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  background: "tinted",
};
const DARK_GREEN_FIXED: ThemeChoices = { ...DARK_GREEN, brandFix: { dark: true } };
const BURGUNDY: ThemeChoices = { ...WAITRON_CHOICES, brandColor: "#7a1f2b", background: "tinted" };
const CREAM = "#f8f1e1";

const withHand = (
  choices: ThemeChoices,
  mode: Mode,
  values: Partial<Record<ThemeColour, string>>,
): ThemeChoices => ({ ...choices, handSet: { ...choices.handSet, [mode]: values } });

const failingIn = (theme: DerivedTheme, mode: Mode) =>
  checkRules(
    THEME_RULES[mode],
    (token) => (theme[mode][token] ?? WAITRON_DEFAULTS[mode][token])!,
  ).filter((result) => !result.pass);

const changedTokens = (a: DerivedTheme, b: DerivedTheme, mode: Mode) =>
  THEME_TOKENS.filter((token) => a[mode][token] !== b[mode][token]);

describe("colours set by hand", () => {
  test("the cream page (#f8f1e1) is kept, and the dark-green brand's worked-out colours fit it", () => {
    const theme = deriveTheme(withHand(DARK_GREEN_FIXED, "light", { bg: CREAM }));
    const light = theme.light;
    expect(light[P("bg")]).toBe(CREAM);
    expect(light[P("primary")]).toBe("#1e5b3a");
    expect(ratio(light[P("primary")]!, CREAM)).toBe("7.14");
    expect(ratio(light[P("primary-text")]!, CREAM)).toBe("7.14");
    expect(ratio(light[P("text")]!, CREAM)).toBe("15.78");
    expect(ratio(light[P("track")]!, CREAM)).toBe("1.42");
    expect(light[P("surface-lifted")]).toBe("#d3ecdb");
    expect(deriveTheme(DARK_GREEN_FIXED).light[P("surface-lifted")]).toBe("#d8f1e0");
    expect(theme.warnings).toEqual([]);
    expect(theme.tintStrength?.light).toBe(1);
    expect(theme.dark).toEqual(deriveTheme(DARK_GREEN_FIXED).dark);
  });

  test("the burgundy brand (#7a1f2b) keeps the cream page (#f8f1e1)", () => {
    const theme = deriveTheme(withHand(BURGUNDY, "light", { bg: CREAM }));
    const light = theme.light;
    expect(light[P("surface-lifted")]).toBe("#fce0e0");
    expect(light[P("surface-sunken")]).toBe("#e2d6d6");
    expect(light[P("field-fill")]).toBe("#f7eeed");
    expect(ratio("#ffffff", light[P("primary")]!)).toBe("10.20");
    expect(ratio(light[P("primary")]!, CREAM)).toBe("9.07");
    expect(theme.warnings.filter((warning) => warning.mode === "light")).toEqual([]);
    expect(deriveTheme(BURGUNDY).light[P("bg")]).toBe("#fff3f3");
  });

  test("Waitron's brand with light Main buttons #7a1f2b works the button family out from them", () => {
    const theme = deriveTheme(withHand(WAITRON_CHOICES, "light", { primary: "#7a1f2b" }));
    expect(theme.light[P("primary-hover")]).toBe("#67081c");
    expect(theme.light[P("primary-text")]).toBe("#7a1f2b");
    expect(theme.light[P("focus")]).toBe("#7a1f2b");
    expect(theme.light[P("surface-lifted")]).toBe("#fee2e2");
    expect(theme.warnings).toEqual([]);

    const dark = deriveTheme(withHand(WAITRON_CHOICES, "dark", { primary: "#9e4048" }));
    expect(dark.dark[P("primary-hover")]).toBe("#8a2e38");
  });

  test("the dark version's own button colour (#5fa77a) under the dark-green brand (#1e5b3a)", () => {
    const plain = deriveTheme(DARK_GREEN);
    const theme = deriveTheme(withHand(DARK_GREEN, "dark", { primary: "#5fa77a" }));
    const dark = theme.dark;
    expect(dark[P("on-primary")]).toBe("#001206");
    expect(ratio(dark[P("on-primary")]!, "#5fa77a")).toBe("6.70");
    expect(ratio("#5fa77a", dark[P("bg")]!)).toBe("6.63");
    expect(dark[P("bg")]).toBe("#0b110d");
    expect(dark[P("primary-hover")]).toBe("#72ba8c");
    expect(dark[P("primary-text")]).toBe("#6ab284");
    expect(failingIn(theme, "dark")).toEqual([]);
    expect(theme.light).toEqual(plain.light);

    const lightOwn = deriveTheme(withHand(DARK_GREEN, "light", { primary: "#5fa77a" }));
    expect(changedTokens(plain, lightOwn, "light")).toHaveLength(8);
    expect(failingIn(plain, "dark")).toHaveLength(5);
  });

  test("a hand-set Main buttons colour drops the brand fix, and the fix returns as an offer without it", () => {
    const choices = withHand(DARK_GREEN_FIXED, "dark", { primary: "#5a9c74" });
    const normalised = normaliseChoices(choices);
    expect(normalised.brandFix).toEqual({});
    expect(deriveTheme(choices).dark[P("primary")]).toBe("#5a9c74");

    const workedOut = deriveTheme(withHand(normalised, "dark", {}));
    expect(workedOut.dark[P("primary")]).toBe("#1e5b3a");
    expect(workedOut.warnings).toEqual([
      expect.objectContaining({ field: "brandColor", mode: "dark", fix: "#437e5b" }),
    ]);
  });

  test("a worked-out colour moves to stay within an at-most rule", () => {
    const theme = deriveTheme(withHand(DARK_GREEN_FIXED, "dark", { surface: "#000000" }));
    expect(theme.dark[P("primary-disabled")]).toBe("#1a3023");
  });

  test("a worked-out colour stays put when its move would break a rule naming no colour set by hand", () => {
    // Moving primary-disabled to within 1.5 of both hand-set surfaces would take on-primary-disabled
    // on it below 4.5: two rules would pass, and one naming only worked-out colours would newly fail.
    const theme = deriveTheme(
      withHand(WAITRON_CHOICES, "dark", { surface: "#c22d7d", "surface-raised": "#6319dd" }),
    );
    expect(theme.dark[P("primary-disabled")]).toBe(
      deriveTheme(WAITRON_CHOICES).dark[P("primary-disabled")],
    );
    expect(ratio(theme.dark[P("on-primary-disabled")]!, theme.dark[P("primary-disabled")]!)).toBe(
      "4.75",
    );
    expect(theme.warnings.find(({ field }) => field === "handSet.dark.surface")?.against).toContain(
      "primary-disabled",
    );
  });

  test("an uppercase hand-set value gives the same theme as lowercase", () => {
    expect(deriveTheme(withHand(DARK_GREEN_FIXED, "light", { bg: "#F8F1E1" }))).toEqual(
      deriveTheme(withHand(DARK_GREEN_FIXED, "light", { bg: CREAM })),
    );
    expect(
      normaliseChoices(withHand(DARK_GREEN_FIXED, "light", { bg: "#F8F1E1" })).handSet.light.bg,
    ).toBe(CREAM);
  });

  test.each(["#fff", "f8f1e1"])("a hand-set value %s is refused", (value) => {
    expect(() => deriveTheme(withHand(DARK_GREEN, "light", { bg: value }))).toThrow(RangeError);
  });

  test.each(["X#F8F1E1", "#F8F1E1X"])(
    "a hand-set value %s is refused before it is lower-cased, naming it as given",
    (value) => {
      expect(() => deriveTheme(withHand(DARK_GREEN, "dark", { bg: value }))).toThrow(
        new RangeError(`not a #rrggbb colour: ${value}`),
      );
    },
  );

  test.each(["X#1E5B3A", "#1E5B3AX"])(
    "a brand colour %s is refused before it is lower-cased, naming it as given",
    (brandColor) => {
      expect(() => deriveTheme({ ...DARK_GREEN, brandColor })).toThrow(
        new RangeError(`not a #rrggbb colour: ${brandColor}`),
      );
    },
  );

  test.each(["scrim", "danger"])("a hand-set %s is refused, naming the key", (key) => {
    const choices = withHand(DARK_GREEN, "dark", { [key]: "#000000" } as Partial<
      Record<ThemeColour, string>
    >);
    expect(() => deriveTheme(choices)).toThrow(new RangeError(`not a theme colour: ${key}`));
  });
});
