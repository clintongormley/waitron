import { afterEach, describe, expect, test } from "vitest";
import colorsCss from "../tokens/colors.css?raw";
import { mountTokenRoot, token } from "../tokens/token-test-helpers.js";
import { MODES, parseBlock, readDefaults } from "./defaults.js";
import { WAITRON_DEFAULTS } from "./waitron.js";

const ROOT = ":where([data-wt-theme-root])";
const FORCED_LIGHT = ':where([data-wt-theme-root][data-theme="light"])';
const FORCED_DARK = ':where([data-wt-theme-root][data-theme="dark"])';

describe("Waitron's values", () => {
  test("hold the page colour of each mode and the structure's medium radius", () => {
    expect(WAITRON_DEFAULTS.light["--wt-color-bg"]).toBe("#f7f7f8");
    expect(WAITRON_DEFAULTS.dark["--wt-color-bg"]).toBe("#101216");
    expect(WAITRON_DEFAULTS.structure["--wt-radius-md"]).toBe("8px");
  });

  test("the forced blocks hold what the default and the media blocks hold", () => {
    const fallback = parseBlock(colorsCss, ROOT);
    const mediaDark = parseBlock(
      colorsCss,
      ROOT,
      colorsCss.indexOf("@media (prefers-color-scheme: dark)"),
    );
    const forcedLight = parseBlock(colorsCss, FORCED_LIGHT);
    const forcedDark = parseBlock(colorsCss, FORCED_DARK);
    expect(Object.keys(forcedLight).some((name) => name.startsWith("--wt-color-"))).toBe(true);
    expect(Object.keys(forcedDark).some((name) => name.startsWith("--wt-color-"))).toBe(true);
    expect(fallback).toEqual(forcedLight);
    expect(mediaDark).toEqual(forcedDark);
  });

  describe("the parsed values are what the browser resolves", () => {
    let root: HTMLElement | undefined;
    afterEach(() => root?.remove());

    for (const mode of MODES) {
      test(mode, () => {
        root = mountTokenRoot(mode);
        const names = Object.keys(WAITRON_DEFAULTS[mode]);
        expect(names).toContain("--wt-color-scrim");
        for (const name of names) {
          expect(token(root, name), name).toBe(WAITRON_DEFAULTS[mode][name]);
        }
      });
    }
  });
});

describe("parseBlock and readDefaults refuse what they cannot read", () => {
  test("token CSS that a bundler did not load as text", () => {
    expect(() => parseBlock({}, ROOT)).toThrow(TypeError);
    expect(() => parseBlock({}, ROOT)).toThrow("token CSS was not loaded as text");
  });

  test("a selector the text does not hold", () => {
    expect(() => parseBlock("a{}", ":where(x)")).toThrow(":where(x)");
  });

  test("a closing brace inside a comment within the block", () => {
    expect(parseBlock(`${ROOT} { --wt-a: 1; /* } */ --wt-b: 2; }`, ROOT)).toEqual({
      "--wt-a": "1",
      "--wt-b": "2",
    });
  });

  test("the selector's text inside an earlier comment", () => {
    expect(parseBlock(`/* ${ROOT} { --wt-x: 9; } */ ${ROOT} { --wt-a: 1; }`, ROOT)).toEqual({
      "--wt-a": "1",
    });
  });

  test("colours with no brand colour", () => {
    const structure = `${ROOT} { --wt-radius-md: 8px; }`;
    const colours = `${FORCED_LIGHT} { --wt-color-bg: #ffffff; } ${FORCED_DARK} { --wt-color-primary: #000000; }`;
    expect(() => readDefaults(colours, structure)).toThrow(
      "the light colours have no --wt-color-primary",
    );
  });

  test("structure with no medium radius", () => {
    const colours = `${FORCED_LIGHT} { --wt-color-primary: #1f6feb; } ${FORCED_DARK} { --wt-color-primary: #000000; }`;
    expect(() => readDefaults(colours, `${ROOT} { --wt-radius-sm: 4px; }`)).toThrow(
      "the structure tokens have no --wt-radius-md",
    );
  });
});

describe("parseBlock reads only the selector's own block", () => {
  test("a selector the text does not hold, with another block later in the text", () => {
    expect(() => parseBlock(".a-long-selector { --wt-a: 1; }", ":where(x)")).toThrow(
      "token CSS has no block for :where(x)",
    );
  });

  test("a selector with no block after it", () => {
    expect(() => parseBlock("a {} :where(x)", ":where(x)")).toThrow(
      "token CSS has no block for :where(x)",
    );
  });

  test("a block opening just before the selector", () => {
    expect(parseBlock("b{}:where(y){--wt-a:1}", ":where(y)")).toEqual({ "--wt-a": "1" });
  });

  test("declarations with and without spaces, and ones that are not a token", () => {
    expect(parseBlock(`${ROOT} {--wt-a:1; --wt-b : 2 ; x--wt-c: 3; color: red}`, ROOT)).toEqual({
      "--wt-a": "1",
      "--wt-b": "2",
    });
  });

  test("the structure comes from the theme root's block, not the first block", () => {
    const colours = `${FORCED_LIGHT} { --wt-color-primary: #1f6feb; } ${FORCED_DARK} { --wt-color-primary: #000000; }`;
    const structure = `.other { --wt-radius-md: 1px; } ${ROOT} { --wt-radius-md: 8px; }`;
    expect(readDefaults(colours, structure).structure).toEqual({ "--wt-radius-md": "8px" });
  });
});
