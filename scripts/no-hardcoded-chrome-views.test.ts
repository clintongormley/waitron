import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

/**
 * Contract: the styles of the dashboard's and the till's views, and of the screens modules add to
 * the dashboard, read colours and rem/em lengths from declared `--wt-*` tokens, as
 * `packages/ui/src/no-hardcoded-chrome.test.ts` requires of the shared primitives.
 *
 * Weaker than its name. It reads the declaration values in each Lit `css` tagged template in every
 * non-test `.ts` on disk under `apps/dashboard/src`, `apps/till/src` and every
 * `packages/<name>/src/dashboard` there is when it runs, skipping `sourceFilesIn`'s ignored
 * folders, and does not see: px sizes; styles outside a `css` tag (inline `style=` attributes,
 * `unsafeCSS` strings, string constants such as `DRAWER_BREAKPOINT` or `PHONE_WIDTH`,
 * `index.html`); selectors, quoted strings and the contents of `url(…)`; the condition of an
 * at-rule that opens a block (`@media`, `@container`, `@supports`, …; a `@media` or `@container`
 * size condition cannot use `var()`); a value interpolated with `${…}`, and part or all of the rest
 * of the template after a regular expression inside `${…}` whose text holds `//`, `/*`, a quote, a
 * backtick or a `{`; `apps/setup`, `apps/server`, or a package's other folders. Only the short list
 * of named colours below is caught.
 */

const repoRoot = join(import.meta.dirname, "..");
const MODULE_DASHBOARDS = readdirSync(join(repoRoot, "packages"))
  .map((name) => `packages/${name}/src/dashboard`)
  .filter((dir) => statSync(join(repoRoot, dir), { throwIfNoEntry: false })?.isDirectory());
const GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["apps/dashboard/src", ["apps/dashboard/src"]],
  ["apps/till/src", ["apps/till/src"]],
  ["packages/*/src/dashboard", MODULE_DASHBOARDS],
];

interface CssBlock {
  readonly line: number;
  readonly body: string;
}

/** Skips a template literal whose opening backtick is at `start`; returns the index after it. */
function skipTemplate(source: string, start: number, out?: string[]): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      out?.push(source.slice(i, i + 2));
      i += 2;
    } else if (ch === "`") {
      return i + 1;
    } else if (ch === "$" && source[i + 1] === "{") {
      i = skipInterpolation(source, i + 2);
      out?.push(" ");
    } else {
      out?.push(ch);
      i += 1;
    }
  }
  return i;
}

/** Skips the inside of `${…}` starting after `${`; returns the index after its closing brace. */
function skipInterpolation(source: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "`") {
      i = skipTemplate(source, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      i += 1;
      while (i < source.length && source[i] !== ch) i += source[i] === "\\" ? 2 : 1;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return i;
}

/** The body of each `css\`…\`` in `source`, with every interpolation replaced by a space. */
function cssBlocks(source: string): CssBlock[] {
  const blocks: CssBlock[] = [];
  for (const match of source.matchAll(
    /(?<![\w$.])css(?:\s|\/\*(?:[^*]|\*(?!\/))*\*\/|\/\/[^\n]*\n)*`/g,
  )) {
    const open = match.index + match[0].length - 1;
    const out: string[] = [];
    skipTemplate(source, open, out);
    blocks.push({ line: source.slice(0, open).split("\n").length, body: out.join("") });
  }
  return blocks;
}

const LITERAL_PATTERNS: readonly RegExp[] = [
  /#[0-9a-fA-F]{3,8}\b/g,
  /(?<![\w-])(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(/gi,
  /(?<![\w-])(?:red|blue|green|yellow|black|white|gray|grey|orange|purple|pink|brown)(?![\w-])/gi,
  /(?<![\w-])-?\d*\.?\d+(?:rem|em)\b/g,
];

/**
 * The colour and rem/em literals in a css body's declaration values. Comments and quoted strings
 * are blanked first; a segment ending in `{` is a selector or an at-rule's condition, not a value.
 */
function hardcodedLiterals(body: string): string[] {
  const css = body
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'/g, '""')
    .replace(/url\([^)]*\)/gi, "url()");
  const values = [...css.matchAll(/[^;{}]*[;{}]|[^;{}]+$/g)]
    .map((m) => m[0])
    .filter((segment) => !segment.endsWith("{") && segment.includes(":"))
    .map((segment) => segment.slice(segment.indexOf(":") + 1));
  return values.flatMap((value) =>
    LITERAL_PATTERNS.flatMap((pattern) => [...value.matchAll(pattern)].map((m) => m[0])),
  );
}

describe("the scanner", () => {
  const found = (css: string) => hardcodedLiterals(css);

  it.each([
    ["a hex colour", "color: #12abef;", "#12abef"],
    ["a colour function", "color: oklch(50% 0.1 20);", "oklch("],
    ["a named colour", "background: White;", "White"],
    ["a rem", "max-width: 3rem;", "3rem"],
    ["an em", "letter-spacing: 0.1em;", "0.1em"],
    ["a rem inside a var() fallback", "width: var(--wt-x, 24rem);", "24rem"],
    ["the last declaration of a rule, with no semicolon", "a { color: #000 }", "#000"],
    [
      "a value in a rule nested in a media query",
      "@media (min-width: 1px) { a { color: red } }",
      "red",
    ],
    [
      "a value after an unquoted url() holding a semicolon",
      "a { background: url(data:image/png;base64,AAA) #fff; }",
      "#fff",
    ],
  ])("finds %s", (_label, css, literal) => {
    expect(found(css)).toEqual([literal]);
  });

  it.each([
    ["white-space", "white-space: nowrap;"],
    ["a media query condition", "@media (max-width: 40rem) { a { gap: 1px; } }"],
    ["a container query condition", "@container (max-width: 30rem) { a { gap: 1px; } }"],
    ["transparent", "background: transparent;"],
    ["currentColor", "border-color: currentColor;"],
    ["a token read", "color: var(--wt-color-text); padding: var(--wt-space-2);"],
    ["a comment", "/* #fff and 2rem */ color: var(--wt-color-text);"],
    ["a selector naming a colour", ".white { color: var(--wt-color-text); }"],
    ["a :not() selector naming a colour", "a:not(.red) { color: var(--wt-color-text); }"],
    ["a quoted string", 'a::after { content: "red"; }'],
  ])("passes %s", (_label, css) => {
    expect(found(css)).toEqual([]);
  });

  it("replaces interpolations, nested braces included, before scanning", () => {
    const source =
      "const s = css`\n  a { width: ${unsafeCSS(`${{ w: '2rem' }.w}`)}; color: #000; }\n`;";
    const [block] = cssBlocks(source);
    expect(block?.line).toBe(1);
    expect(block?.body).not.toContain("2rem");
    expect(hardcodedLiterals(block?.body ?? "")).toEqual(["#000"]);
  });

  it.each([
    ["a block comment", "css /* app styles */ `a { color: #12abef; }`"],
    ["whitespace", "css\n  `a { color: #12abef; }`"],
    ["a line comment", "css // app styles\n`a { color: #12abef; }`"],
  ])("finds a css tag separated from its template by %s", (_label, source) => {
    const blocks = cssBlocks(source);
    expect(blocks.map((block) => hardcodedLiterals(block.body))).toEqual([["#12abef"]]);
  });

  it("does not stretch a comment after `css` over code to a later template", () => {
    const source = 'import { css /* lit */, html } from "lit";\n/* doc */ `a { color: #000 }`';
    expect(cssBlocks(source)).toEqual([]);
  });

  it.each([
    ["a block comment", 'a { width: ${/* } */ unsafeCSS("2rem")}; color: #000; }'],
    ["a line comment", 'a { width: ${unsafeCSS("1px") // } 2rem\n}; color: #000; }'],
  ])("skips %s inside an interpolation", (_label, body) => {
    const [block] = cssBlocks(`css\`${body}\``);
    expect(block?.body).not.toContain("2rem");
    expect(hardcodedLiterals(block?.body ?? "")).toEqual(["#000"]);
  });
});

describe.each(GROUPS)("%s views", (_group, dirs) => {
  it("declare no literal colours or rem/em lengths in their css", () => {
    const offenders: string[] = [];
    let blockCount = 0;
    for (const file of dirs
      .flatMap((dir) => sourceFilesIn(repoRoot, dir))
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))) {
      for (const block of cssBlocks(readFileSync(join(repoRoot, file), "utf8"))) {
        blockCount += 1;
        const literals = hardcodedLiterals(block.body);
        if (literals.length > 0) offenders.push(`${file}:${block.line} ${literals.join(", ")}`);
      }
    }
    expect(blockCount).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
