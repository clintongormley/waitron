import type { DerivedTheme } from "./theme.js";
import { THEME_TOKENS } from "./tokens.js";

const COLOUR_VALUE = /^#[0-9a-f]{6}$/;
const RADIUS_VALUE = /^\d+px$/;

// A missing token fails its shape check, so this refuses any key set but exactly THEME_TOKENS,
// and nothing but a derived value can reach the stylesheet text.
function declarations(version: Readonly<Record<string, string>>, indent: string): string {
  const extra = Object.keys(version).find((key) => !THEME_TOKENS.includes(key));
  if (extra !== undefined) throw new RangeError(`not a theme token: ${extra}`);
  return THEME_TOKENS.map((name) => {
    const value = version[name]!;
    const shape = name.startsWith("--wt-color-") ? COLOUR_VALUE : RADIUS_VALUE;
    if (!shape.test(value)) throw new RangeError(`not a derived value for ${name}`);
    return `${indent}${name}: ${value};\n`;
  }).join("");
}

export function themeSheet(theme: Pick<DerivedTheme, "light" | "dark">): string {
  const light = declarations(theme.light, "    ");
  const dark = declarations(theme.dark, "    ");
  const preferredDark = declarations(theme.dark, "      ");
  return (
    "@media screen {\n" +
    `  [data-wt-theme-root] {\n${light}  }\n` +
    "  @media (prefers-color-scheme: dark) {\n" +
    `    [data-wt-theme-root]:not([data-theme="light"]) {\n${preferredDark}    }\n` +
    "  }\n" +
    `  [data-wt-theme-root][data-theme="dark"] {\n${dark}  }\n` +
    "}\n"
  );
}
