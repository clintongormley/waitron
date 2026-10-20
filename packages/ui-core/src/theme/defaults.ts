export type Mode = "light" | "dark";

export const MODES: readonly Mode[] = ["light", "dark"];

export interface WaitronDefaults {
  readonly light: Readonly<Record<string, string>>;
  readonly dark: Readonly<Record<string, string>>;
  readonly structure: Readonly<Record<string, string>>;
}

const FORCED = (mode: Mode) => `:where([data-wt-theme-root][data-theme="${mode}"])`;

// A bundler with no text loader for `?raw` hands over an object, not the text; refusing it here
// turns that into a loud failure instead of a theme with no values.
export function parseBlock(css: unknown, selector: string, from = 0): Record<string, string> {
  if (typeof css !== "string") throw new TypeError("token CSS was not loaded as text");
  const at = css.indexOf(selector, from);
  const open = at < 0 ? -1 : css.indexOf("{", at + selector.length);
  const close = open < 0 ? -1 : css.indexOf("}", open);
  if (close < 0) throw new Error(`token CSS has no block for ${selector}`);
  const values: Record<string, string> = {};
  for (const declaration of css
    .slice(open + 1, close)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")) {
    const match = /^\s*(--wt-[a-z0-9-]+)\s*:\s*([\s\S]*?)\s*$/.exec(declaration);
    if (match) values[match[1]!] = match[2]!;
  }
  return values;
}

function requireToken(block: Record<string, string>, name: string, what: string) {
  if (!(name in block)) throw new Error(`${what} has no ${name}`);
  return block;
}

export function readDefaults(colorsCss: unknown, structureCss: unknown): WaitronDefaults {
  return {
    light: requireToken(
      parseBlock(colorsCss, FORCED("light")),
      "--wt-color-primary",
      "the light colours",
    ),
    dark: parseBlock(colorsCss, FORCED("dark")),
    structure: requireToken(
      parseBlock(structureCss, ":where([data-wt-theme-root])"),
      "--wt-radius-md",
      "the structure tokens",
    ),
  };
}
