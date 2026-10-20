import { describe, expect, test } from "vitest";
import {
  BRAND_FAMILY,
  THEME_COLOURS,
  THEME_RADII,
  THEME_TOKENS,
  colourToken,
  cornerRadii,
} from "./tokens.js";
import { WAITRON_DEFAULTS } from "./waitron.js";

const MEANING = /^(on-)?(station-|palette-|table-|day-|danger|success|warning|google-|highlight)/;
const PREFIX = "--wt-color-";

describe("the token list a theme writes", () => {
  test("the theme writes exactly the colours that carry no meaning, less the scrim", () => {
    const neutral = Object.keys(WAITRON_DEFAULTS.light)
      .filter((name) => name.startsWith(PREFIX))
      .map((name) => name.slice(PREFIX.length))
      .filter((key) => !MEANING.test(key) && key !== "scrim");
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
  });

  test("the scrim and every meaning colour stay outside", () => {
    expect(THEME_TOKENS).not.toContain("--wt-color-scrim");
    for (const name of THEME_TOKENS) {
      if (name.startsWith(PREFIX))
        expect(MEANING.test(name.slice(PREFIX.length)), name).toBe(false);
    }
    const structure = THEME_TOKENS.filter((name) => name in WAITRON_DEFAULTS.structure);
    expect(structure).toEqual(["--wt-radius-sm", "--wt-radius-md", "--wt-radius-lg"]);
  });

  test("the list is the colour tokens in order, then the three radii", () => {
    expect(colourToken("bg")).toBe("--wt-color-bg");
    expect(THEME_TOKENS).toEqual([...THEME_COLOURS.map(colourToken), ...THEME_RADII]);
    expect(THEME_COLOURS[0]).toBe("bg");
    expect(THEME_COLOURS[21]).toBe("stepper-button");
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
