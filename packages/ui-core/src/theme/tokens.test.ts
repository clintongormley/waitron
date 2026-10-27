import { describe, expect, test } from "vitest";
import {
  BRAND_FAMILY,
  THEME_COLOURS,
  THEME_FONT_SIZES,
  THEME_RADII,
  THEME_TEXT_TOKENS,
  THEME_TOKENS,
  type TextScale,
  colourToken,
  cornerRadii,
  fontSizes,
} from "./tokens.js";
import { WAITRON_CHOICES } from "./theme.js";
import { deriveTheme, WAITRON_DEFAULTS } from "./waitron.js";

const MEANING =
  /^(on-)?(station-|palette-|table-|tab-|day-|danger|success|warning|google-|highlight)/;
const PREFIX = "--wt-color-";

describe("the token list a theme writes", () => {
  test("the theme writes exactly the colours that carry no meaning, less the scrim and the logo plate", () => {
    const neutral = Object.keys(WAITRON_DEFAULTS.light)
      .filter((name) => name.startsWith(PREFIX))
      .map((name) => name.slice(PREFIX.length))
      .filter((key) => !MEANING.test(key) && key !== "scrim" && key !== "logo-plate");
    expect(new Set(THEME_COLOURS)).toEqual(new Set(neutral));
    expect(THEME_COLOURS).toHaveLength(22);
    expect(new Set(THEME_COLOURS).size).toBe(THEME_COLOURS.length);
  });

  test("every token the theme writes is declared in both modes", () => {
    for (const key of THEME_COLOURS) {
      expect(WAITRON_DEFAULTS.light, key).toHaveProperty([colourToken(key)]);
      expect(WAITRON_DEFAULTS.dark, key).toHaveProperty([colourToken(key)]);
    }
    for (const radius of THEME_RADII) expect(WAITRON_DEFAULTS.structure).toHaveProperty([radius]);
    for (const size of THEME_FONT_SIZES) expect(WAITRON_DEFAULTS.structure).toHaveProperty([size]);
    for (const name of THEME_TEXT_TOKENS) expect(WAITRON_DEFAULTS.structure).toHaveProperty([name]);
  });

  test("the scrim and every meaning colour stay outside", () => {
    expect(THEME_TOKENS).not.toContain("--wt-color-scrim");
    expect(THEME_TOKENS).not.toContain("--wt-color-logo-plate");
    for (const name of THEME_TOKENS) {
      if (name.startsWith(PREFIX))
        expect(MEANING.test(name.slice(PREFIX.length)), name).toBe(false);
    }
    const structure = THEME_TOKENS.filter((name) => name in WAITRON_DEFAULTS.structure);
    expect(structure).toEqual([
      "--wt-radius-sm",
      "--wt-radius-md",
      "--wt-radius-lg",
      "--wt-font-size-sm",
      "--wt-font-size-md",
      "--wt-font-size-lg",
      "--wt-font-size-xl",
      "--wt-font-family",
      "--wt-font-weight-normal",
      "--wt-font-weight-medium",
      "--wt-font-weight-bold",
    ]);
  });

  test("the theme never writes the code typeface or Google's type", () => {
    for (const name of [
      "--wt-font-family-mono",
      "--wt-font-family-google",
      "--wt-google-button-line-height",
      "--wt-google-button-font-size",
      "--wt-google-button-font-weight",
    ])
      expect(THEME_TOKENS).not.toContain(name);
  });

  test("the logo plate is white in both modes and no theme writes it", () => {
    expect(WAITRON_DEFAULTS.light["--wt-color-logo-plate"]).toBe("#ffffff");
    expect(WAITRON_DEFAULTS.dark["--wt-color-logo-plate"]).toBe("#ffffff");
    const theme = deriveTheme({
      ...WAITRON_CHOICES,
      handSet: { light: { surface: "#0000ff" }, dark: { surface: "#0000ff" } },
    });
    expect(theme.light).not.toHaveProperty(["--wt-color-logo-plate"]);
    expect(theme.dark).not.toHaveProperty(["--wt-color-logo-plate"]);
  });

  test("the list is the colour tokens in order, then the three radii, then the four sizes, then the typeface and three weights", () => {
    expect(colourToken("bg")).toBe("--wt-color-bg");
    expect(THEME_FONT_SIZES).toEqual([
      "--wt-font-size-sm",
      "--wt-font-size-md",
      "--wt-font-size-lg",
      "--wt-font-size-xl",
    ]);
    expect(THEME_TOKENS).toEqual([
      ...THEME_COLOURS.map(colourToken),
      ...THEME_RADII,
      ...THEME_FONT_SIZES,
      ...THEME_TEXT_TOKENS,
    ]);
    expect(THEME_TEXT_TOKENS).toEqual([
      "--wt-font-family",
      "--wt-font-weight-normal",
      "--wt-font-weight-medium",
      "--wt-font-weight-bold",
    ]);
    expect(THEME_COLOURS[0]).toBe("bg");
    expect(THEME_COLOURS[21]).toBe("stepper-button");
  });

  // Weaker than its name: it reads packages/ui-core/src only, as text, so a copy in apps/ or
  // another package passes.
  test("only text.ts names the serif stack (weaker than its name: ui-core's own source only)", () => {
    const sources = import.meta.glob<string>("../**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const naming = Object.entries(sources)
      .filter(([path, text]) => !path.endsWith(".test.ts") && text.includes("ui-serif"))
      .map(([path]) => path);
    expect(Object.keys(sources)).toContain("./tokens.ts");
    expect(naming).toEqual(["./text.ts"]);
  });

  test("the brand family", () => {
    expect(BRAND_FAMILY).toEqual([
      "primary",
      "on-primary",
      "primary-hover",
      "primary-text",
      "focus",
      "field-label-focus",
      "primary-disabled",
      "on-primary-disabled",
      "surface-lifted",
      "stepper-button",
    ]);
  });
});

describe("corner radii", () => {
  test("standard is Waitron's own", () => {
    expect(cornerRadii("standard", WAITRON_DEFAULTS)).toEqual({
      "--wt-radius-sm": "4px",
      "--wt-radius-md": "8px",
      "--wt-radius-lg": "16px",
    });
  });

  test("standard follows the defaults it is given", () => {
    const defaults = {
      ...WAITRON_DEFAULTS,
      structure: { "--wt-radius-sm": "1px", "--wt-radius-md": "2px", "--wt-radius-lg": "3px" },
    };
    expect(cornerRadii("standard", defaults)).toEqual(defaults.structure);
  });

  test("square and round", () => {
    expect(cornerRadii("square", WAITRON_DEFAULTS)).toEqual({
      "--wt-radius-sm": "0px",
      "--wt-radius-md": "2px",
      "--wt-radius-lg": "4px",
    });
    expect(cornerRadii("round", WAITRON_DEFAULTS)).toEqual({
      "--wt-radius-sm": "8px",
      "--wt-radius-md": "14px",
      "--wt-radius-lg": "24px",
    });
  });
});

describe("text sizes", () => {
  const sizes = (sm: number, md: number, lg: number, xl: number) => ({
    "--wt-font-size-sm": `${sm}px`,
    "--wt-font-size-md": `${md}px`,
    "--wt-font-size-lg": `${lg}px`,
    "--wt-font-size-xl": `${xl}px`,
  });

  test.each<[TextScale, Record<string, string>]>([
    [100, sizes(12, 14, 18, 22)],
    [105, sizes(13, 15, 19, 23)],
    [110, sizes(13, 15, 20, 24)],
    [115, sizes(14, 16, 21, 25)],
    [120, sizes(14, 17, 22, 26)],
    [125, sizes(15, 18, 23, 28)],
    [130, sizes(16, 18, 23, 29)],
  ])("at %i%% Waitron's sizes round half up to whole pixels", (step, expected) => {
    expect(fontSizes(step, WAITRON_DEFAULTS)).toEqual(expected);
  });

  test("follows the defaults it is given", () => {
    const defaults = { ...WAITRON_DEFAULTS, structure: sizes(13, 15, 19, 24) };
    expect(fontSizes(115, defaults)).toEqual(sizes(15, 17, 22, 28));
  });

  test("refuses a default that is not whole pixels", () => {
    for (const value of ["14.5px", "1rem", "x14px", "14px;", "14"]) {
      const defaults = {
        ...WAITRON_DEFAULTS,
        structure: { ...sizes(12, 14, 18, 22), "--wt-font-size-md": value },
      };
      expect(() => fontSizes(100, defaults), value).toThrow(
        new RangeError("not a whole-pixel size: --wt-font-size-md"),
      );
    }
    const withoutLarge: Record<string, string> = sizes(12, 14, 18, 22);
    delete withoutLarge["--wt-font-size-lg"];
    expect(() => fontSizes(100, { ...WAITRON_DEFAULTS, structure: withoutLarge })).toThrow(
      new RangeError("not a whole-pixel size: --wt-font-size-lg"),
    );
  });
});
