import { afterEach, expect, test } from "vitest";
import { mountTokenRoot, token } from "../tokens/token-test-helpers.js";
import { themeSheet } from "./sheet.js";
import { type ThemeChoices, WAITRON_CHOICES } from "./theme.js";
import { THEME_TOKENS } from "./tokens.js";
import { deriveTheme } from "./waitron.js";

const LEMON: ThemeChoices = { ...WAITRON_CHOICES, brandColor: "#f2d300" };
const GREEN: ThemeChoices = {
  ...WAITRON_CHOICES,
  brandColor: "#1e5b3a",
  brandFix: { dark: true },
  background: "tinted",
  corners: "round",
};

const roots: HTMLElement[] = [];
let adopted: CSSStyleSheet | undefined;

const removeAdopted = () => {
  const stale = adopted;
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== stale);
  adopted = undefined;
};

afterEach(() => {
  for (const root of roots.splice(0)) root.remove();
  removeAdopted();
});

const mount = (theme: "light" | "dark") => {
  const root = mountTokenRoot(theme);
  roots.push(root);
  return root;
};

const expectStyleRule = (rule: CSSRule | undefined, selector: string) => {
  expect(rule).toBeInstanceOf(CSSStyleRule);
  const style = rule as CSSStyleRule;
  expect(style.selectorText).toBe(selector);
  expect(style.style.length).toBe(THEME_TOKENS.length);
};

test("parses as one screen rule holding the three blocks", () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(themeSheet(deriveTheme(LEMON)));

  expect(sheet.cssRules.length).toBe(1);
  const screen = sheet.cssRules[0] as CSSMediaRule;
  expect(screen).toBeInstanceOf(CSSMediaRule);
  expect(screen.media.mediaText).toBe("screen");
  expect(screen.cssRules.length).toBe(3);

  expectStyleRule(screen.cssRules[0], "[data-wt-theme-root]");
  const preference = screen.cssRules[1] as CSSMediaRule;
  expect(preference).toBeInstanceOf(CSSMediaRule);
  expect(preference.media.mediaText).toBe("(prefers-color-scheme: dark)");
  expect(preference.cssRules.length).toBe(1);
  expectStyleRule(preference.cssRules[0], '[data-wt-theme-root]:not([data-theme="light"])');
  expectStyleRule(screen.cssRules[2], '[data-wt-theme-root][data-theme="dark"]');
});

test("the text is the three blocks, laid out one declaration per line", () => {
  const theme = deriveTheme(LEMON);
  const lines = (mode: "light" | "dark", indent: string) =>
    THEME_TOKENS.map((name) => `${indent}${name}: ${theme[mode][name]};\n`).join("");
  expect(themeSheet(theme)).toBe(
    "@media screen {\n" +
      `  [data-wt-theme-root] {\n${lines("light", "    ")}  }\n` +
      "  @media (prefers-color-scheme: dark) {\n" +
      `    [data-wt-theme-root]:not([data-theme="light"]) {\n${lines("dark", "      ")}    }\n` +
      "  }\n" +
      `  [data-wt-theme-root][data-theme="dark"] {\n${lines("dark", "    ")}  }\n` +
      "}\n",
  );
});

test("a forced light root paints the light version and a forced dark root the dark", () => {
  const theme = deriveTheme(GREEN);
  const light = mount("light");
  const dark = mount("dark");

  expect(token(light, "--wt-color-primary")).toBe("#1f6feb");
  expect(token(dark, "--wt-color-primary")).toBe("#4c8dff");
  expect(token(light, "--wt-radius-md")).toBe("8px");
  expect(token(dark, "--wt-radius-md")).toBe("8px");

  adopted = new CSSStyleSheet();
  adopted.replaceSync(themeSheet(theme));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, adopted];

  expect(theme.light["--wt-color-primary"]).not.toBe(theme.dark["--wt-color-primary"]);
  expect(theme.light["--wt-color-primary"]).not.toBe("#1f6feb");
  expect(theme.dark["--wt-color-primary"]).not.toBe("#4c8dff");
  expect(token(light, "--wt-color-primary")).toBe(theme.light["--wt-color-primary"]);
  expect(token(dark, "--wt-color-primary")).toBe(theme.dark["--wt-color-primary"]);
  expect(token(light, "--wt-radius-md")).toBe("14px");
  expect(token(dark, "--wt-radius-md")).toBe("14px");

  removeAdopted();
  expect(token(light, "--wt-color-primary")).toBe("#1f6feb");
  expect(token(dark, "--wt-color-primary")).toBe("#4c8dff");
  expect(token(light, "--wt-radius-md")).toBe("8px");
});

test("refuses what is not a derived value", () => {
  const { light, dark } = deriveTheme(LEMON);
  const withLight = (changed: Record<string, string>) => () => themeSheet({ light: changed, dark });
  const withDark = (changed: Record<string, string>) => () => themeSheet({ light, dark: changed });
  const missingBg = Object.fromEntries(
    Object.entries(light).filter(([name]) => name !== "--wt-color-bg"),
  );

  expect(withLight({ ...light, "--wt-color-bg": "red; } body { display: none" })).toThrow(
    new RangeError("not a derived value for --wt-color-bg"),
  );
  expect(withLight({ ...light, "--wt-color-bg": "#FFFFFF" })).toThrow(RangeError);
  expect(withLight({ ...light, "--wt-color-bg": "#ffffff00" })).toThrow(RangeError);
  expect(withLight({ ...light, "--wt-color-bg": "x#ffffff" })).toThrow(RangeError);
  expect(withLight({ ...light, "--wt-radius-md": "1em" })).toThrow(RangeError);
  expect(withLight({ ...light, "--wt-radius-md": "14px;" })).toThrow(RangeError);
  expect(withLight({ ...light, "--wt-radius-md": "x14px" })).toThrow(RangeError);
  expect(withLight({ ...light, "--wt-radius-md": "#ffffff" })).toThrow(RangeError);
  expect(withLight({ ...light, "--wt-color-bg": "14px" })).toThrow(RangeError);
  expect(withLight(missingBg)).toThrow(new RangeError("not a derived value for --wt-color-bg"));
  expect(withLight({ ...light, "--wt-color-danger": "#ff0000" })).toThrow(
    new RangeError("not a theme token: --wt-color-danger"),
  );
  expect(withDark({ ...dark, "--wt-color-bg": "red" })).toThrow(RangeError);
  expect(withDark({ ...missingBg, "--wt-color-danger": "#ff0000" })).toThrow(RangeError);
  expect(withLight(light)).not.toThrow();
});
