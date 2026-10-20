import { describe, expect, test } from "vitest";
import { contrastRatio } from "./colour.js";
import { MODES, type Mode } from "./defaults.js";
import { deriveThemeFrom, WAITRON_CHOICES, type DerivedTheme, type ThemeChoices } from "./theme.js";
import { BRAND_FAMILY, colourToken, THEME_COLOURS, THEME_RADII, THEME_TOKENS } from "./tokens.js";
import { deriveTheme, WAITRON_DEFAULTS } from "./waitron.js";

const P = colourToken;
const ratio = (a: string, b: string) => contrastRatio(a, b).toFixed(2);

const DARK_GREEN: ThemeChoices = {
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  background: "tinted",
  corners: "round",
};
const LEMON: ThemeChoices = { ...WAITRON_CHOICES, brandColor: "#f2d300" };

const waitronValue = (mode: Mode, token: string) =>
  (WAITRON_DEFAULTS[mode][token] ?? WAITRON_DEFAULTS.structure[token])!;

const differing = (theme: DerivedTheme, mode: Mode) =>
  THEME_TOKENS.filter((token) => theme[mode][token] !== waitronValue(mode, token));

function expectFullList(theme: DerivedTheme) {
  for (const mode of MODES) expect(Object.keys(theme[mode])).toEqual(THEME_TOKENS);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe("Waitron's look", () => {
  test("every token is Waitron's own value, with no tint", () => {
    const theme = deriveTheme(WAITRON_CHOICES);
    for (const mode of MODES) {
      for (const colour of THEME_COLOURS) {
        expect(theme[mode][P(colour)], `${mode} ${colour}`).toBe(WAITRON_DEFAULTS[mode][P(colour)]);
      }
      for (const radius of THEME_RADII) {
        expect(theme[mode][radius]).toBe(WAITRON_DEFAULTS.structure[radius]);
      }
    }
    expect(theme.tintStrength).toBeNull();
    expect(theme.warnings).toEqual([]);
    expectFullList(theme);
  });

  test("Tinted moves six light and eight dark colours, none of them in the brand family", () => {
    const theme = deriveTheme({ ...WAITRON_CHOICES, background: "tinted" });
    expect(differing(theme, "light")).toHaveLength(6);
    expect(differing(theme, "dark")).toHaveLength(8);
    for (const mode of MODES) {
      for (const colour of BRAND_FAMILY) {
        expect(theme[mode][P(colour)], `${mode} ${colour}`).toBe(WAITRON_DEFAULTS[mode][P(colour)]);
      }
    }
    expect(theme.tintStrength).toEqual({ light: 1, dark: 1 });
    expectFullList(theme);
  });

  test("a brand fix flag with Waitron's brand colour gives exactly Waitron's values", () => {
    const theme = deriveTheme({ ...WAITRON_CHOICES, brandFix: { light: true, dark: true } });
    expect(theme).toEqual(deriveTheme(WAITRON_CHOICES));
    expect(differing(theme, "light")).toEqual([]);
    expect(differing(theme, "dark")).toEqual([]);
  });
});

describe("the dark-green brand (#1e5b3a), Tinted, Round", () => {
  test("paints the brand colour as picked in both modes", () => {
    const theme = deriveTheme(DARK_GREEN);
    expect(theme.light[P("primary")]).toBe("#1e5b3a");
    expect(theme.light[P("on-primary")]).toBe("#ffffff");
    expect(ratio("#ffffff", theme.light[P("primary")]!)).toBe("8.04");
    expect(theme.light[P("bg")]).toBe("#f0f9f3");
    expect(theme.dark[P("primary")]).toBe("#1e5b3a");
    expect(theme.dark[P("bg")]).toBe("#0b110d");
    expect(theme.dark[P("surface")]).toBe("#141b17");
    expect(theme.dark[P("field-fill")]).toBe("#202923");
    for (const mode of MODES) {
      expect(THEME_RADII.map((radius) => theme[mode][radius])).toEqual(["8px", "14px", "24px"]);
    }
    expectFullList(theme);
  });

  test("the dark brand fix paints the fix's shade in dark and leaves light alone", () => {
    const theme = deriveTheme({ ...DARK_GREEN, brandFix: { dark: true } });
    expect(theme.dark[P("primary")]).toBe("#417c59");
    expect(theme.dark[P("on-primary")]).toBe("#ffffff");
    expect(ratio("#ffffff", theme.dark[P("primary")]!)).toBe("4.94");
    expect(theme.dark[P("bg")]).toBe("#0b110d");
    expect(theme.light).toEqual(deriveTheme(DARK_GREEN).light);
    expectFullList(theme);
  });

  test("every light and dark token equals the reference's", () => {
    const theme = deriveTheme(DARK_GREEN);
    expect(theme.tintStrength).toEqual({ light: 1, dark: 1 });
    // ~/waitron-campaign/a841-plan1-probes/output-tinted-full.txt
    expect(theme.light).toEqual({
      [P("bg")]: "#f0f9f3",
      [P("surface")]: "#ffffff",
      [P("surface-raised")]: "#ffffff",
      [P("surface-lifted")]: "#d8f1e0",
      [P("surface-sunken")]: "#d2dcd5",
      [P("track")]: "#c5cfc8",
      [P("border")]: "#d2dcd5",
      [P("text")]: "#16181d",
      [P("text-muted")]: "#5c626e",
      [P("primary")]: "#1e5b3a",
      [P("primary-hover")]: "#074a2a",
      [P("on-primary")]: "#ffffff",
      [P("primary-disabled")]: "#91cea7",
      [P("on-primary-disabled")]: "#ffffff",
      [P("primary-text")]: "#1e5b3a",
      [P("focus")]: "#1e5b3a",
      [P("field-fill")]: "#ebf2ed",
      [P("field-line")]: "#7d8390",
      [P("field-label-focus")]: "#1e5b3a",
      [P("field-value")]: "#000000",
      [P("field-fill-disabled")]: "#f4f8f5",
      [P("stepper-button")]: "#def8e7",
      "--wt-radius-sm": "8px",
      "--wt-radius-md": "14px",
      "--wt-radius-lg": "24px",
    });
    expect(theme.dark).toEqual({
      [P("bg")]: "#0b110d",
      [P("surface")]: "#141b17",
      [P("surface-raised")]: "#1d2520",
      [P("surface-lifted")]: "#263e2f",
      [P("surface-sunken")]: "#0b110d",
      [P("track")]: "#2f3832",
      [P("border")]: "#2f3832",
      [P("text")]: "#eceef2",
      [P("text-muted")]: "#a1a7b3",
      [P("primary")]: "#1e5b3a",
      [P("primary-hover")]: "#074a2a",
      [P("on-primary")]: "#ffffff",
      [P("primary-disabled")]: "#1f3628",
      [P("on-primary-disabled")]: "#96ab9d",
      [P("primary-text")]: "#73af89",
      [P("focus")]: "#73af89",
      [P("field-fill")]: "#202923",
      [P("field-line")]: "#7a8291",
      [P("field-label-focus")]: "#73af89",
      [P("field-value")]: "#ffffff",
      [P("field-fill-disabled")]: "#1a201c",
      [P("stepper-button")]: "#182c1f",
      "--wt-radius-sm": "8px",
      "--wt-radius-md": "14px",
      "--wt-radius-lg": "24px",
    });
  });

  test("an uppercase brand colour gives the same theme as the lowercase one", () => {
    expect(deriveTheme({ ...DARK_GREEN, brandColor: "#1E5B3A" })).toEqual(deriveTheme(DARK_GREEN));
  });

  test("a brand colour that is not #rrggbb is refused", () => {
    expect(() => deriveTheme({ ...DARK_GREEN, brandColor: "#1e5" })).toThrow(RangeError);
    expect(() => deriveTheme({ ...DARK_GREEN, brandColor: "1e5b3a" })).toThrow(RangeError);
  });

  test("a deep-frozen choices object derives, and two calls give equal themes", () => {
    const frozen = deepFreeze({ ...DARK_GREEN, brandFix: { dark: true as const } });
    const first = deriveTheme(frozen);
    expect(deriveTheme(frozen)).toEqual(first);
    expect(first.dark[P("primary")]).toBe("#417c59");
  });
});

describe("the lemon brand (#f2d300), Neutral", () => {
  test("paints as picked, and the light fix paints a darker shade", () => {
    const picked = deriveTheme(LEMON);
    expect(picked.light[P("primary")]).toBe("#f2d300");
    expect(picked.dark[P("primary")]).toBe("#f2d300");
    expect(picked.tintStrength).toBeNull();

    const fixed = deriveTheme({ ...LEMON, brandFix: { light: true } });
    const primary = fixed.light[P("primary")]!;
    expect(primary).toBe("#9f8b18");
    expect(fixed.light[P("on-primary")]).toBe("#000000");
    expect(ratio("#000000", primary)).toBe("6.18");
    expect(ratio(primary, "#ffffff")).toBe("3.40");
    expect(ratio(primary, fixed.light[P("bg")]!)).toBe("3.17");
    expect(fixed.dark[P("primary")]).toBe("#f2d300");
    expectFullList(picked);
    expectFullList(fixed);
  });
});

describe("Waitron's blue typed as a custom colour (#1f6feb), Neutral", () => {
  test("works out its own link colour rather than Waitron's", () => {
    const theme = deriveTheme({ ...WAITRON_CHOICES, brandColor: "#1f6feb" });
    expect(theme.dark[P("primary")]).toBe("#1f6feb");
    expect(theme.dark[P("on-primary")]).toBe("#ffffff");
    expect(theme.dark[P("primary-text")]).toBe("#67a0fd");
    expect(theme.dark[P("primary-text")]).not.toBe(WAITRON_DEFAULTS.dark[P("primary-text")]);
    expectFullList(theme);
  });
});

describe("the tint gives way", () => {
  // A contrived palette: no real input weakens the tint.
  const contrived = {
    ...WAITRON_DEFAULTS,
    light: { ...WAITRON_DEFAULTS.light, [P("track")]: "#d0d0d0", [P("text")]: "#585858" },
  };

  test("to 0.6 when full strength fails a rule between worked-out colours", () => {
    const theme = deriveThemeFrom(contrived, DARK_GREEN);
    expect(theme.tintStrength?.light).toBe(0.6);
    expect(theme.light[P("track")]).toBe("#cacfcb");
    expect(theme.light[P("bg")]).toBe("#f3f8f5");
    expectFullList(theme);
  });

  test("not at all on Waitron's real palette", () => {
    expect(deriveThemeFrom(WAITRON_DEFAULTS, DARK_GREEN).tintStrength?.light).toBe(1);
  });
});
