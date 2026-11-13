import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sourceFilesIn } from "./no-till-as-issuer.mjs";

const excluded = new Set([
  "apps/dashboard/src/screens/staff-screen.ts",
  "apps/dashboard/src/screens/floor-plan-editor.ts",
  "packages/staffing/src/dashboard/staff-roles-screen.ts",
]);
const screen = "apps/dashboard/src/screens/content-languages-screen.ts";
const compliant =
  'static override styles = [baseStyles, pageTitleStyles, css``]; html`<h1 class="title">Orders</h1>`';

function violations(path: string, source: string): string[] {
  source = source.replace(/(^|\s)\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "$1");
  if (excluded.has(path) || path.startsWith("packages/fiscal-verifactu/") || !/<h1\b/.test(source))
    return [];
  const failures: string[] = [];
  const styles =
    source.match(/static\s+(?:override\s+)?styles(?:\s*:[^=]+)?\s*=\s*\[([\s\S]*?)\]\s*;/)?.[1] ??
    "";
  if (!/\bpageTitleStyles\b/.test(styles)) failures.push("adopt pageTitleStyles");
  const classes = [...source.matchAll(/<h1\b[^>]*class="([^"]*)"/g)].flatMap((match) =>
    match[1]!.split(/\s+/),
  );
  for (const style of source.matchAll(/css`([\s\S]*?)`/g)) {
    for (const rule of style[1]!.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\bfont(?:-size)?\s*:/.test(rule[2]!)) continue;
      const applies = rule[1]!
        .split(",")
        .some(
          (selector) =>
            /\bh1\b/.test(selector) ||
            ([...selector.matchAll(/\.([\w-]+)/g)].some((match) => classes.includes(match[1]!)) &&
              !/\bh[2-6]\b/.test(selector)),
        );
      if (applies) failures.push("remove local title size");
    }
  }
  return failures;
}

it.each([
  ["adopted title", screen, compliant, []],
  [
    "image MIME text is not a comment",
    screen,
    'static styles = [baseStyles]; html`<input accept="image/*"><h1>Images</h1>`; css`h1 { font-size: var(--wt-font-size-lg); }`; /** Image settings. */',
    ["adopt pageTitleStyles", "remove local title size"],
  ],
  ["typed style list", screen, compliant.replace("styles =", "styles: CSSResultGroup ="), []],
  [
    "style after local CSS",
    screen,
    compliant.replace("pageTitleStyles, css``", "css``, pageTitleStyles"),
    [],
  ],
  [
    "different class",
    screen,
    compliant + "css`.title-row { font-size: var(--wt-font-size-sm); }`",
    [],
  ],
  [
    "comment-only H1",
    screen,
    "/** A page uses an <h1>. */\n// A page uses an <h1>.\nstatic styles = [baseStyles];",
    [],
  ],
  [
    "style-only screen",
    screen,
    "static override styles = [baseStyles, pageTitleStyles]; html`<h1>Orders</h1>`",
    [],
  ],
  [
    "missing adoption",
    screen,
    "static styles = [baseStyles]; html`<h1>Orders</h1>`",
    ["adopt pageTitleStyles"],
  ],
  [
    "unused import",
    screen,
    'import { pageTitleStyles } from "@waitron/ui"; static styles = [baseStyles]; html`<h1>Orders</h1>`',
    ["adopt pageTitleStyles"],
  ],
  [
    "local H1 size",
    screen,
    compliant + "css`h1 { font-size: var(--wt-font-size-lg); }`",
    ["remove local title size"],
  ],
  [
    "local class size",
    screen,
    compliant + "css`.title { font-size: var(--wt-font-size-lg); }`",
    ["remove local title size"],
  ],
  [
    "calibration H2 size",
    screen,
    compliant + "css`h2.title { font-size: var(--wt-font-size-lg); }`",
    [],
  ],
  ["no H1", screen, "html`<h2>Calibration</h2>`", []],
  ...[...excluded, "packages/fiscal-verifactu/src/dashboard/fiscal-filing-screen.ts"].map(
    (path) => ["excluded page", path, "html`<h1>Title</h1>`", []],
  ),
])("%s", (_name, path, source, expected) => {
  expect(violations(path as string, source as string)).toEqual(expected);
});

it("uses the shared title style in dashboard and module literal-H1 owners", () => {
  const root = join(import.meta.dirname, "..");
  const failures = sourceFilesIn(root)
    .filter(
      (path: string) =>
        /^(apps\/dashboard\/src\/screens\/|packages\/[^/]+\/src\/dashboard\/).*\.ts$/.test(path) &&
        !path.endsWith(".test.ts"),
    )
    .flatMap((path: string) =>
      violations(path, readFileSync(join(root, path), "utf8")).map(
        (reason) => `${path}: ${reason}`,
      ),
    );
  expect(failures).toEqual([]);
});
