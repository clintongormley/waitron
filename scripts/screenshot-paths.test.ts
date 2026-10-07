import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Contract: a browser test's `screenshot({ path })` lands where git ignores it, so a run leaves no
 * untracked image beside the test. Vitest resolves the path against the TEST FILE's directory.
 *
 * Weaker than its name: it parses only `*.test.ts` under `apps/` and `packages/`, skipping
 * `node_modules`, `dist` and dot-directories, and only a `.screenshot(...)` call whose first
 * argument is an object literal; any other call, `screenshot(options)` or
 * `screenshot({ … } as Options)` included, passes unchecked. A `path` written as a string or
 * template literal is judged with each `${...}` read as one segment of plain text. Any other way
 * the object could set the last path is reported as unreadable: a variable or call as the value,
 * the shorthand `{ path }`, a getter or method named `path`, a spread, or a computed key other
 * than a string literal naming another option. A path outside the repository is allowed without
 * being checked.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["apps", "packages"];
// A per-call kill timeout for a hung `git` (Vitest's timer cannot interrupt a blocking child), and
// a per-test bound above it.
const GIT_SPAWN_TIMEOUT_MS = 30_000;
const SPAWN_TEST_TIMEOUT_MS = 60_000;

/** Git exports `GIT_DIR` to every hook and `.husky/pre-push` runs this suite. */
const GIT_LOCATION_OVERRIDES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

interface ScreenshotPath {
  line: number;
  /** The path as written, each `${...}` read as `x`; `undefined` when the guard cannot read it. */
  path: string | undefined;
}

/** Where the options set `path`, `value` unset when unreadable; `undefined` when nothing does. */
function pathProperty(
  node: ts.ObjectLiteralExpression,
): { at: ts.Node; value: ts.Expression | undefined } | undefined {
  let found: { at: ts.Node; value: ts.Expression | undefined } | undefined;
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      found = { at: property, value: undefined };
      continue;
    }
    const name = property.name;
    if (ts.isComputedPropertyName(name)) {
      if (!ts.isStringLiteralLike(name.expression) || name.expression.text === "path")
        found = { at: property, value: undefined };
      continue;
    }
    if (!(ts.isIdentifier(name) || ts.isStringLiteral(name)) || name.text !== "path") continue;
    found = ts.isPropertyAssignment(property)
      ? { at: property.initializer, value: property.initializer }
      : { at: property, value: undefined };
  }
  return found;
}

function literalText(node: ts.Expression): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return node.head.text + node.templateSpans.map((span) => `x${span.literal.text}`).join("");
  return undefined;
}

export function mayTakeScreenshots(source: string): boolean {
  return source.includes("screenshot");
}

/** Each `.screenshot({ path })` call in `source`, with the path it writes to. */
export function screenshotPaths(source: string): ScreenshotPath[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const found: ScreenshotPath[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "screenshot"
    ) {
      const options = node.arguments[0];
      const path =
        options !== undefined && ts.isObjectLiteralExpression(options)
          ? pathProperty(options)
          : undefined;
      if (path !== undefined)
        found.push({
          line: file.getLineAndCharacterOfPosition(path.at.getStart()).line + 1,
          path: path.value === undefined ? undefined : literalText(path.value),
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("the matcher", () => {
  it("reads a template path, reading each substitution as plain text", () => {
    const source = [
      "await page.screenshot({",
      "  fullPage: true,",
      "  path: `look/${locale}-${theme}.png`,",
      "});",
    ].join("\n");
    expect(screenshotPaths(source)).toEqual([{ line: 3, path: "look/x-x.png" }]);
  });

  it("reads a string path and reports a path that is not a literal", () => {
    const source = [
      'await page.screenshot({ path: "a/b.png" });',
      "await page.screenshot({ path: target });",
    ].join("\n");
    expect(screenshotPaths(source)).toEqual([
      { line: 1, path: "a/b.png" },
      { line: 2, path: undefined },
    ]);
  });

  it("ignores a call with no path, another method's path and a path in a comment", () => {
    const source = [
      "await page.screenshot();",
      "await page.screenshot({ fullPage: true });",
      'emit(el, "wt-move", { path: [] });',
      '// page.screenshot({ path: "look/a.png" })',
    ].join("\n");
    expect(screenshotPaths(source)).toEqual([]);
  });

  it("reports a spread after the last path as unreadable, and reads a path after a spread", () => {
    const source = [
      'await page.screenshot({ path: "__screenshots__/a.png", ...{ path: "look/leak.png" } });',
      "await page.screenshot({ ...options });",
      'await page.screenshot({ ...defaults, path: "__screenshots__/b.png" });',
      'await page.screenshot({ ["path"]: target, path: "__screenshots__/c.png" });',
    ].join("\n");
    expect(screenshotPaths(source)).toEqual([
      { line: 1, path: undefined },
      { line: 2, path: undefined },
      { line: 3, path: "__screenshots__/b.png" },
      { line: 4, path: "__screenshots__/c.png" },
    ]);
  });

  it("reports a shorthand path, a getter or method named path and a computed key as unreadable", () => {
    const source = [
      "await page.screenshot({ path });",
      'await page.screenshot({ get path() { return "look/a.png"; } });',
      'await page.screenshot({ path() { return "look/a.png"; } });',
      'await page.screenshot({ ["path"]: "look/a.png" });',
      "await page.screenshot({ [key]: target });",
      'await page.screenshot({ ["fullPage"]: true });',
    ].join("\n");
    expect(screenshotPaths(source)).toEqual([
      { line: 1, path: undefined },
      { line: 2, path: undefined },
      { line: 3, path: undefined },
      { line: 4, path: undefined },
      { line: 5, path: undefined },
    ]);
  });

  it("reads a call written with a space before its parenthesis", () => {
    expect(screenshotPaths('await page.screenshot ({ path: "look/a.png" });')).toEqual([
      { line: 1, path: "look/a.png" },
    ]);
    expect(mayTakeScreenshots('page.screenshot ({ path: "look/a.png" })')).toBe(true);
  });
});

/** Every `*.test.ts` file under `dir`; a failing browser test writes a DIRECTORY named after one. */
function testFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...testFilesIn(full));
    else if (stats.isFile() && full.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** The subset of repository-relative `paths` that git ignores. */
function ignoredByGit(paths: string[]): Set<string> {
  const env = { ...process.env };
  for (const name of GIT_LOCATION_OVERRIDES) delete env[name];
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: repoRoot,
    env,
    input: paths.join("\n"),
    encoding: "utf8",
    timeout: GIT_SPAWN_TIMEOUT_MS,
  });
  // Exit 1 means none of the paths is ignored.
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`git check-ignore failed (${result.status}): ${result.stderr}`);
  return new Set(result.stdout.split("\n").filter((line) => line !== ""));
}

describe("the tree", () => {
  const unreadable: string[] = [];
  const written = new Map<string, string>();
  for (const file of ROOTS.flatMap((root) => testFilesIn(join(repoRoot, root)))) {
    const source = readFileSync(file, "utf8");
    if (!mayTakeScreenshots(source)) continue;
    const name = relative(repoRoot, file);
    for (const { line, path } of screenshotPaths(source)) {
      if (path === undefined) {
        unreadable.push(`${name}:${line}`);
        continue;
      }
      const target = relative(repoRoot, resolve(dirname(file), path));
      if (target.startsWith("..") || isAbsolute(target)) continue;
      written.set(`${name}:${line}`, target);
    }
  }

  it("finds the screenshot paths it judges", () => {
    expect(written.size).toBeGreaterThan(0);
  });

  it("reads every screenshot path as a literal", () => {
    expect(unreadable.sort()).toEqual([]);
  });

  it(
    "writes every screenshot where git ignores it",
    () => {
      const ignored = ignoredByGit([...new Set(written.values())]);
      const tracked = [...written]
        .filter(([, target]) => !ignored.has(target))
        .map(([site, target]) => `${site} -> ${target}`);
      expect(tracked.sort()).toEqual([]);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});
