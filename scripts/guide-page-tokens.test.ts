// Weaker than its name: it reads the token files as text, finds a declaration by its exact name only
// in the blocks below, and never renders the page.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { GUIDE_PAGE_TOKENS, GUIDE_THEME_KEY } from "../apps/server/src/guide-pages.js";
import { THEME_STORAGE_KEY } from "../packages/ui/src/theme-choice.js";

const tokens = join(import.meta.dirname, "../packages/ui-core/src/tokens");

function read(file: string): string {
  return readFileSync(join(tokens, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

function block(css: string, opener: string): string {
  const start = css.indexOf(opener);
  expect(start, `no "${opener}" block`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at++) {
    if (css[at] === "{") depth++;
    else if (css[at] === "}" && --depth === 0) return css.slice(start, at + 1);
  }
  throw new Error(`unclosed "${opener}" block`);
}

function declared(css: string, name: string): string[] {
  return [...css.matchAll(new RegExp(`(?<![\\w-])${name}\\s*:\\s*([^;}]+)`, "g"))].map((m) =>
    m[1]!.trim(),
  );
}

const colors = read("colors.css");
const light = block(colors, ":where([data-wt-theme-root]) {");
const dark = block(colors, "@media (prefers-color-scheme: dark) {");
const forcedDark = block(colors, ':where([data-wt-theme-root][data-theme="dark"]) {');
const structure = read("structure.css");

const entries = Object.entries(GUIDE_PAGE_TOKENS);

it("each colour the guide page copies matches the token, light and dark", () => {
  const copies = entries.filter(([, value]) => typeof value !== "string");
  expect(copies.length).toBeGreaterThan(0);
  for (const [name, value] of copies) {
    const [lightCopy, darkCopy] = value as readonly [string, string];
    expect(declared(light, name), `${name}, light`).toEqual([lightCopy]);
    expect(declared(dark, name), `${name}, dark`).toEqual([darkCopy]);
    expect(declared(forcedDark, name), `${name}, forced dark`).toEqual([darkCopy]);
  }
});

it("each size the guide page copies matches the token", () => {
  const copies = entries.filter(([, value]) => typeof value === "string");
  expect(copies.length).toBeGreaterThan(0);
  for (const [name, value] of copies) {
    expect(declared(structure, name), name).toEqual([value]);
  }
});

it("the page's theme script reads the key the apps save the theme under", () => {
  expect(GUIDE_THEME_KEY).toBe(THEME_STORAGE_KEY);
});
