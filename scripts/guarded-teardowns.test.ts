import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every `afterAll`/`afterEach` that closes a resource must guard it.
 *
 * **A backstop, not the primary defence.** `@waitron/db/testing/venue-db.js` owns the hooks for the
 * suites that use it, so they cannot write a teardown at all. What remains in scope is a suite that
 * legitimately builds its own resource.
 *
 * ## Three limits
 *
 * 1. **It cannot see a suite with no teardown at all.** It inspects closers INSIDE
 *    `afterAll`/`afterEach`; a suite that creates a resource per test and never closes one is
 *    invisible.
 * 2. **`isGuarded` proves a check exists on the call's line, not that it covers this call.** See
 *    its own doc comment.
 * 3. **The suites in `scripts/` are outside it**, including ones with a real teardown. Adding
 *    `scripts/` as a root makes this file report its own template-literal fixtures, which is what
 *    the assertion in "the scan itself" pins.
 *
 * ## Why not an ESLint rule
 *
 * An esquery selector can only mandate the `?.` form, whereas the form CLAUDE.md documents is
 * `if (x !== undefined)`; lint would mean rewriting teardowns to a different canonical form. If the
 * canonical form ever changes, revisit this.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * **`apps/` is IN scope, unlike `english-only.ts`'s scan**: a masked teardown error wastes the same
 * debugging hour wherever it happens. `scripts/` is NOT a scan root, which keeps the fixtures below
 * out of the scan.
 */
const SCAN_ROOTS = ["packages", "apps"] as const;

/** Directories never descended into. Filtered DURING traversal, not after: pnpm's workspace links
 * make `node_modules` vast. */
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "coverage", ".turbo", ".vite"]);

/** Methods that release a resource. A resource exposing `dispose`/`destroy` would escape. */
const CLOSERS = ["close", "stop", "end"] as const;

const CLOSER_PATTERN = new RegExp(
  `\\b([A-Za-z_][\\w$]*)\\s*\\.\\s*(${CLOSERS.join("|")})\\s*\\(\\s*\\)`,
  "g",
);
const TEARDOWN_HOOK = /\bafter(?:All|Each)\s*\(/g;

function collectTestFiles(directory: string, found: string[]): void {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // A concurrently-written tree can delete a directory between listing its parent and reading
    // it; crashing here would report a scan failure as a teardown failure.
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // `withFileTypes` reports a symlinked directory as a symlink, not a directory, so this also
      // stops the combinatorial descent through pnpm's workspace links.
      if (!SKIP_DIRECTORIES.has(entry.name)) collectTestFiles(join(directory, entry.name), found);
    } else if (entry.name.endsWith(".test.ts")) {
      found.push(join(directory, entry.name));
    }
  }
}

/** Memoised: the tree does not change mid-run. */
let cachedFiles: string[] | undefined;
function testFiles(): string[] {
  if (cachedFiles === undefined) {
    const found: string[] = [];
    for (const root of SCAN_ROOTS) collectTestFiles(join(REPO_ROOT, root), found);
    cachedFiles = found;
  }
  return cachedFiles;
}

/**
 * Blanks block comments to whitespace (preserving line numbers) and drops line comments. The
 * `(^|[^:])` guard on the line-comment pattern keeps `"postgres://host/db"; await db.close();` from
 * losing everything after `postgres:`, which would hide the teardown from the scan.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

/** The `{ ... }` block following `startIndex`, by brace matching. */
function blockAfter(source: string, startIndex: number): { body: string; offset: number } | null {
  const open = source.indexOf("{", startIndex);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) {
      return { body: source.slice(open, index + 1), offset: open };
    }
  }
  return null;
}

/**
 * True when `statement` — the single line holding the call, not the whole hook — checks
 * `identifier` first.
 *
 * **Scoped to the line deliberately.** Searching the whole hook body accepted
 * `{ if (db !== undefined) await truncate(db); await db.close(); }`, where the check guards a
 * different call. Line scope can only err the other way, demanding a guard on a multi-line
 * `if (db !== undefined) { await db.close(); }`.
 */
function isGuarded(statement: string, identifier: string): boolean {
  return [
    new RegExp(`\\b${identifier}\\s*\\?\\.`),
    new RegExp(`if\\s*\\(\\s*!?\\s*${identifier}\\b`),
    new RegExp(`\\b${identifier}\\s*!==\\s*undefined`),
    new RegExp(`\\b${identifier}\\s*&&`),
  ].some((pattern) => pattern.test(statement));
}

interface Finding {
  file: string;
  line: number;
  expression: string;
}

function findUnguarded(source: string, file = "<inline>"): Finding[] {
  const clean = stripComments(source);
  const lines = clean.split("\n");
  const findings: Finding[] = [];

  for (const hook of clean.matchAll(TEARDOWN_HOOK)) {
    const block = blockAfter(clean, hook.index);
    if (block === null) continue;
    for (const call of block.body.matchAll(CLOSER_PATTERN)) {
      const [expression, identifier] = call;
      const line = clean.slice(0, block.offset + call.index).split("\n").length;
      if (identifier === undefined || isGuarded(lines[line - 1] ?? "", identifier)) continue;
      findings.push({ file, line, expression });
    }
  }
  return findings;
}

describe("the scan itself", () => {
  const files = testFiles();

  // Without these, every assertion below passes vacuously against an empty set.
  it("finds test files across every scanned root", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const root of SCAN_ROOTS) {
      expect(files.some((file) => file.includes(`${sep}${root}${sep}`))).toBe(true);
    }
  });

  it("reaches a package's nested suites, not just its top level", () => {
    expect(files.some((file) => file.endsWith(join("db", "src", "client.test.ts")))).toBe(true);
  });

  it("skips node_modules", () => {
    expect(files.some((file) => file.split(sep).includes("node_modules"))).toBe(false);
  });

  it("does not reach this directory, which is what keeps its own fixtures out", () => {
    // The fixtures below are teardown snippets in template literals, and `stripComments` is
    // deliberately naive about string literals, so a scan that reached `scripts/` would report
    // this file as violating the rule it exists to enforce.
    expect(files.some((file) => file.startsWith(join(REPO_ROOT, "scripts") + sep))).toBe(false);
  });
});

describe("the detector itself", () => {
  it("flags an unguarded close in afterAll", () => {
    const findings = findUnguarded(`afterAll(async () => {\n  await db.close();\n});`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.expression).toBe("db.close()");
    expect(findings[0]?.line).toBe(2);
  });

  it("accepts each guard form", () => {
    for (const source of [
      `afterAll(async () => {\n  if (db !== undefined) await db.close();\n});`,
      `afterAll(async () => {\n  if (db) await db.close();\n});`,
      `afterAll(async () => {\n  await db?.close();\n});`,
      `afterAll(async () => {\n  db && (await db.close());\n});`,
    ]) {
      expect(findUnguarded(source)).toEqual([]);
    }
  });

  // Negative control: a closer outside a hook is the ordinary case and far more common than the
  // defect, so a detector that flagged it would also have gone green against the tree.
  it("ignores closers outside teardown hooks", () => {
    expect(findUnguarded(`it("works", async () => {\n  await db.close();\n});`)).toEqual([]);
  });

  it("ignores a closer that only appears in a comment", () => {
    expect(findUnguarded(`afterAll(async () => {\n  // await db.close();\n});`)).toEqual([]);
  });

  it("is not fooled by a URL in a string literal", () => {
    const source = `afterAll(async () => {\n  const uri = "postgres://h/db"; await db.close();\n});`;
    expect(findUnguarded(source)).toHaveLength(1);
  });

  it("does not accept a guard that covers a different call", () => {
    const source = `afterAll(async () => {\n  if (db !== undefined) await truncate(db);\n  await db.close();\n});`;
    expect(findUnguarded(source)).toHaveLength(1);
  });

  it("covers stop and end, not just close", () => {
    expect(findUnguarded(`afterAll(async () => {\n  await container.stop();\n});`)).toHaveLength(1);
    expect(findUnguarded(`afterEach(async () => {\n  await pool.end();\n});`)).toHaveLength(1);
  });
});

describe("every teardown in the tree", () => {
  it("guards the resource it releases", () => {
    const report = testFiles().flatMap((file) =>
      findUnguarded(readFileSync(file, "utf8"), relative(REPO_ROOT, file)).map(
        (finding) => `${finding.file}:${finding.line} — ${finding.expression}`,
      ),
    );
    expect(report).toEqual([]);
  });
});
