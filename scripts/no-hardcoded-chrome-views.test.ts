import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract: the styles of the dashboard's and the till's views read colours and rem/em lengths from
 * declared `--wt-*` tokens, as `packages/ui/src/no-hardcoded-chrome.test.ts` requires of the
 * shared primitives.
 *
 * Weaker than its name. It reads the TEXT of each Lit `css` tagged template in a tracked,
 * non-test `.ts` under `apps/dashboard/src` and `apps/till/src`, and does not see: px sizes;
 * styles outside a `css` tag (inline `style=` attributes, `unsafeCSS` strings, string constants
 * such as `DRAWER_BREAKPOINT` or `PHONE_WIDTH`, `index.html`); the condition of a `@media` or
 * `@container` rule, which cannot read a custom property; a value interpolated with `${…}`; any
 * other app. Only the short list of named colours below is caught.
 */

const repoRoot = join(import.meta.dirname, "..");
const APPS = ["apps/dashboard/src", "apps/till/src"] as const;

const GIT_SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_TEST_TIMEOUT_MS = 60_000;

function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
  ]) {
    delete env[name];
  }
  return env;
}

function viewFiles(dir: string): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", dir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: isolatedGitEnv(),
    timeout: GIT_SPAWN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
}

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
  for (const match of source.matchAll(/(?<![\w$.])css`/g)) {
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

/** The colour and rem/em literals in a css body, outside comments and query conditions. */
function hardcodedLiterals(body: string): string[] {
  const css = body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/@(?:media|container)\b[^{]*\{/g, "{");
  return LITERAL_PATTERNS.flatMap((pattern) => [...css.matchAll(pattern)].map((m) => m[0]));
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
});

describe.each(APPS)("%s views", (dir) => {
  it(
    "declare no literal colours or rem/em lengths in their css",
    () => {
      const offenders: string[] = [];
      let blockCount = 0;
      for (const file of viewFiles(dir)) {
        for (const block of cssBlocks(readFileSync(join(repoRoot, file), "utf8"))) {
          blockCount += 1;
          const literals = hardcodedLiterals(block.body);
          if (literals.length > 0) offenders.push(`${file}:${block.line} ${literals.join(", ")}`);
        }
      }
      expect(blockCount).toBeGreaterThan(0);
      expect(offenders).toEqual([]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});
