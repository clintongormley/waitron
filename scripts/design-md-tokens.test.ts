import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * Contract: the values DESIGN.md's frontmatter and `.impeccable/design.json` copy from the token
 * files still match them, so design tools reading those summaries do not design with a colour the
 * code has since changed.
 *
 * What it checks, against `packages/ui-core/src/tokens/colors.css` and `structure.css` with their
 * comments stripped: each frontmatter `colors` entry, a light copy against both the base block and
 * the `[data-theme="light"]` block and a `night-*` or Sky copy against both dark blocks; each
 * `rounded` and `spacing` step; each typography role's `fontSize`, `control` included, with a
 * `var()` inside the token resolved, and its `fontFamily`; design.json's `colorMeta` keys against
 * the frontmatter's colours; its `shadows` and `motion` values; and, in every sample's CSS, that each
 * `var(--wt-*)` names a declared token and falls back to that token's light value, spaces and
 * quotes ignored. Each list must hold at least one entry, so deleting a whole list fails.
 *
 * Weaker than its name: it reads the files as text and renders nothing. It does not check
 * DESIGN.md's prose (sizes, the shadow values in backticks), the frontmatter's `fontWeight`,
 * `letterSpacing` and `components` entries, design.json's `typographyMeta`, `breakpoints`,
 * `narrative` and `tonalRamp` arrays, a literal value in a sample's CSS that does not go through a
 * `var(--wt-*)`, or whether a sample reads the same token as the component it stands for.
 */

const repoRoot = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(repoRoot, path), "utf8");
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The block `opener` starts, up to its matching closing brace. */
function block(css: string, opener: string): string {
  const start = css.indexOf(`${opener} {`);
  if (start < 0) throw new Error(`no block opened by ${opener}`);
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at++) {
    if (css[at] === "{") depth++;
    else if (css[at] === "}" && --depth === 0) return css.slice(start, at + 1);
  }
  throw new Error(`unclosed block opened by ${opener}`);
}

/** The `--wt-*` declarations in `css`, by name without `--wt-`. */
function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name, value] of css.matchAll(/--wt-([a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    found.set(name!, value!.trim());
  }
  return found;
}

const colorsCss = withoutComments(read("packages/ui-core/src/tokens/colors.css"));
const root = ":where([data-wt-theme-root])";
const lightBlocks = [
  declarations(block(colorsCss, root)),
  declarations(block(colorsCss, ':where([data-wt-theme-root][data-theme="light"])')),
];
const darkBlocks = [
  declarations(block(colorsCss, "@media (prefers-color-scheme: dark)")),
  declarations(block(colorsCss, ':where([data-wt-theme-root][data-theme="dark"])')),
];
const structure = declarations(
  block(withoutComments(read("packages/ui-core/src/tokens/structure.css")), root),
);

/** The value each of `blocks` declares for `token`, one entry per block. */
const valuesIn = (blocks: Map<string, string>[], token: string) =>
  blocks.map((declared) => declared.get(token));

/** A token's value with each `var(--wt-*)` inside it replaced by that token's structure value. */
function resolved(value: string): string {
  return value.replace(/var\(\s*--wt-([a-z0-9-]+)\s*\)/g, (_, name: string) =>
    resolved(structure.get(name) ?? `undefined --wt-${name}`),
  );
}

/** A value with quotes dropped and spacing that CSS ignores taken out, for comparing two copies. */
const normalised = (value: string) =>
  value
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([,()])\s*/g, "$1")
    .trim();

/** Each DESIGN.md colour, whether it copies a light or a dark token, and the token. */
const COLOR_TOKENS: Record<string, ["light" | "dark", string]> = {
  "waitron-teal": ["light", "color-primary"],
  "waitron-teal-hover": ["light", "color-primary-hover"],
  "waitron-teal-disabled": ["light", "color-primary-disabled"],
  sky: ["dark", "color-primary"],
  "sky-hover": ["dark", "color-primary-hover"],
  "on-teal": ["light", "color-on-primary"],
  "on-sky": ["dark", "color-on-primary"],
  page: ["light", "color-bg"],
  surface: ["light", "color-surface"],
  "surface-lifted": ["light", "color-surface-lifted"],
  "surface-sunken": ["light", "color-surface-sunken"],
  ink: ["light", "color-text"],
  "ink-muted": ["light", "color-text-muted"],
  hairline: ["light", "color-border"],
  "field-fill": ["light", "color-field-fill"],
  "field-line": ["light", "color-field-line"],
  "field-value": ["light", "color-field-value"],
  danger: ["light", "color-danger"],
  "danger-hover": ["light", "color-danger-hover"],
  success: ["light", "color-success"],
  warning: ["light", "color-warning"],
  highlight: ["light", "color-highlight"],
  "night-page": ["dark", "color-bg"],
  "night-surface": ["dark", "color-surface"],
  "night-surface-raised": ["dark", "color-surface-raised"],
  "night-ink": ["dark", "color-text"],
  "night-ink-muted": ["dark", "color-text-muted"],
  "night-hairline": ["dark", "color-border"],
  "night-field-fill": ["dark", "color-field-fill"],
  "night-field-line": ["dark", "color-field-line"],
  "night-field-value": ["dark", "color-field-value"],
  "night-danger": ["dark", "color-danger"],
  "night-success": ["dark", "color-success"],
  "night-warning": ["dark", "color-warning"],
  "table-free": ["light", "color-table-free"],
  "table-seated": ["light", "color-table-seated"],
  "table-bill": ["light", "color-table-bill"],
  "table-reserved": ["light", "color-table-reserved"],
  "table-calm": ["light", "color-table-calm"],
};

const TYPE_SIZES: Record<string, string> = {
  title: "font-size-xl",
  headline: "font-size-lg",
  body: "font-size-md",
  control: "text-control-font-size",
  label: "font-size-sm",
  mono: "font-size-md",
};

interface Frontmatter {
  colors: Record<string, string>;
  typography: Record<string, { fontFamily: string; fontSize: string }>;
  rounded: Record<string, string>;
  spacing: Record<string, string>;
}

const designMd = read("DESIGN.md");
const frontmatter = parse(designMd.split(/^---$/m)[1]!) as Frontmatter;

interface Sidecar {
  extensions: {
    colorMeta: Record<string, unknown>;
    shadows: { name: string; value: string }[];
    motion: { name: string; value: string }[];
  };
  components: { name: string; css: string }[];
}

const sidecar = JSON.parse(read(".impeccable/design.json")) as Sidecar;

/** Each `var(--wt-*)` in `css`: the token, and its fallback, or undefined when it has none. */
function varCalls(css: string): { token: string; fallback: string | undefined }[] {
  const calls: { token: string; fallback: string | undefined }[] = [];
  for (const match of css.matchAll(/var\(\s*--wt-([a-z0-9-]+)\s*([,)])/g)) {
    if (match[2] === ")") {
      calls.push({ token: match[1]!, fallback: undefined });
      continue;
    }
    const from = match.index + match[0].length;
    let depth = 1;
    let at = from;
    for (; at < css.length && depth > 0; at++) {
      if (css[at] === "(") depth++;
      else if (css[at] === ")") depth--;
    }
    calls.push({ token: match[1]!, fallback: css.slice(from, at - 1).trim() });
  }
  return calls;
}

/** The light value of a token: structure.css's, or one per light colour block. */
const lightValues = (token: string) =>
  structure.has(token) ? [structure.get(token)] : valuesIn(lightBlocks, token);

describe("DESIGN.md frontmatter", () => {
  it("names a token for every colour, and only for colours it lists", () => {
    expect(Object.keys(frontmatter.colors).length).toBeGreaterThan(0);
    expect(Object.keys(frontmatter.colors).sort()).toEqual(Object.keys(COLOR_TOKENS).sort());
  });

  it("copies each colour's value from its token, in both blocks of its theme", () => {
    const stale = Object.entries(frontmatter.colors).flatMap(([key, value]) => {
      const [theme, token] = COLOR_TOKENS[key]!;
      const blocks = theme === "dark" ? darkBlocks : lightBlocks;
      return valuesIn(blocks, token).flatMap((actual, index) =>
        actual === value ? [] : [`${key}: ${value}, but --wt-${token} is ${actual} (${index})`],
      );
    });
    expect(stale).toEqual([]);
  });

  it("copies each radius and space from structure.css", () => {
    expect(Object.keys(frontmatter.rounded).length).toBeGreaterThan(0);
    expect(Object.keys(frontmatter.spacing).length).toBeGreaterThan(0);
    for (const [step, value] of Object.entries(frontmatter.rounded)) {
      expect(`${step}: ${value}`).toBe(`${step}: ${structure.get(`radius-${step}`)}`);
    }
    for (const [step, value] of Object.entries(frontmatter.spacing)) {
      expect(`${step}: ${value}`).toBe(`${step}: ${structure.get(`space-${step}`)}`);
    }
  });

  it("copies each type role's size and family from structure.css", () => {
    expect(Object.keys(frontmatter.typography).sort()).toEqual(Object.keys(TYPE_SIZES).sort());
    for (const [role, token] of Object.entries(TYPE_SIZES)) {
      expect(`${role}: ${frontmatter.typography[role]!.fontSize}`).toBe(
        `${role}: ${resolved(structure.get(token)!)}`,
      );
    }
    const body = structure.get("font-family")!.replaceAll('"', "");
    for (const role of ["title", "headline", "body", "control", "label"]) {
      expect(`${role}: ${frontmatter.typography[role]!.fontFamily}`).toBe(`${role}: ${body}`);
    }
    expect(frontmatter.typography.mono!.fontFamily).toBe(structure.get("font-family-mono"));
  });
});

describe(".impeccable/design.json", () => {
  it("describes exactly the colours DESIGN.md lists", () => {
    expect(Object.keys(sidecar.extensions.colorMeta).sort()).toEqual(
      Object.keys(frontmatter.colors).sort(),
    );
  });

  it("copies each shadow and duration from structure.css", () => {
    expect(sidecar.extensions.shadows.length).toBeGreaterThan(0);
    expect(sidecar.extensions.motion.length).toBeGreaterThan(0);
    for (const { name, value } of [...sidecar.extensions.shadows, ...sidecar.extensions.motion]) {
      const actual =
        name === "scrim" ? valuesIn(lightBlocks, "color-scrim") : [structure.get(name)];
      for (const each of actual) expect(`${name}: ${value}`).toBe(`${name}: ${each}`);
    }
  });

  it("falls back to each token's light value in its component CSS", () => {
    expect(sidecar.components.length).toBeGreaterThan(0);
    const calls = sidecar.components.flatMap(({ name, css }) =>
      varCalls(withoutComments(css)).map((call) => ({ name, ...call })),
    );
    expect(calls.length).toBeGreaterThan(0);
    const stale = calls.flatMap(({ name, token, fallback }) =>
      lightValues(token).flatMap((actual) =>
        actual !== undefined &&
        fallback !== undefined &&
        normalised(resolved(actual)) === normalised(fallback)
          ? []
          : [`${name}: --wt-${token} falls back to ${fallback}, but is ${actual}`],
      ),
    );
    expect(stale).toEqual([]);
  });

  it("reads at least one token in every sample's CSS", () => {
    const tokenless = sidecar.components
      .filter(({ css }) => varCalls(withoutComments(css)).length === 0)
      .map(({ name }) => name);
    expect(tokenless).toEqual([]);
  });
});
