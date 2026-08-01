import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every `afterAll`/`afterEach` that closes a resource must guard it.
 *
 * CLAUDE.md §4 states the rule. It fired for real on 2026-07-31 in `packages/db`, where this file
 * used to live: a Testcontainers start timed out in `client.test.ts`'s `beforeAll`, and `afterAll`
 * two lines below then threw `TypeError: Cannot read properties of undefined (reading 'stop')`.
 *
 * **It lives in the repo-level Vitest project because it reads the whole tree** — every
 * `*.test.ts` under `packages/` and `apps/`, from the repository root. In `packages/db` it only
 * ever loaded when `packages/db` was in scope, and since the scoping landed neither gate put it
 * there on most pushes: measured on 2026-08-01, `pnpm --filter "...@waitron/ui" ls -r --depth -1
 * --json` lists `@waitron/ui` alone and `--filter "...@waitron/payments"` lists six packages, none
 * of them `@waitron/db`. See the repo-root `vitest.config.ts` for what that project is and which
 * two gates run it.
 *
 * **The experiment, run rather than assumed.** A scratch suite with a `beforeAll` that throws a
 * known error, run twice under vitest — once with `res!.stop()` in the teardown, once with
 * `if (res !== undefined) res.stop()`: unguarded reported **two** errors, the real one AND the
 * `TypeError`; guarded reported **one**. So the spurious error accompanies the real one rather than
 * replacing it. That still matters — it doubles the failure count, and when several suites time out
 * together the real cause is what gets scrolled past.
 *
 * **This guard is a backstop, not the primary defence.** `@waitron/db/testing/lifecycle.js` owns the
 * hooks for the suites that use it, so they cannot write a teardown at all, guarded or otherwise.
 * What remains in scope here is the residue that legitimately builds its own resources —
 * `client.test.ts` and `migrate.test.ts` construct containers because they are the unit tests OF the
 * constructor and the migrator, and `testing/postgres.test.ts` tests the very surface the helper is
 * built on.
 *
 * ## Three limits, stated because none is obvious
 *
 * 1. **It cannot see a suite with no teardown at all.** It inspects closers INSIDE
 *    `afterAll`/`afterEach`; a suite that creates a resource per test and never closes one is
 *    invisible. That is not theoretical — `packages/fiscal-verifactu/src/registro-sif.test.ts` was
 *    leaking 13 PGlite instances per run with no teardown whatsoever, and this guard passed the
 *    whole time. It was found by reading, not by scanning.
 * 2. **`isGuarded` proves a check exists in the hook, not that it covers this call.** See its own
 *    doc comment.
 * 3. **The suites in this directory are outside it, including one with a real teardown.** The scan
 *    roots are `packages/` and `apps/`, and it matches `*.test.ts`; `scripts/check-signoff.test.mjs`
 *    fails both tests and has an `afterAll` that removes a temp directory (guarded by hand). Adding
 *    `scripts/` as a root is not the fix — measured on 2026-08-01, it makes this file report its own
 *    template-literal fixtures as violations, which is what the assertion in "the scan itself"
 *    pins. A root-level suite keeps the rule by hand until someone finds a scan that can tell a
 *    fixture from a teardown.
 *
 * ## Why not an ESLint rule
 *
 * `eslint.config.js` is the repo's existing cross-package enforcement surface, and a
 * `no-restricted-syntax` selector over the real AST is both faster and more precise than comment
 * stripping. It was rejected for one reason: an esquery selector can only mandate the `?.` form,
 * whereas the tree contains 172 teardown closers of which ~78 already use `if (x !== undefined)` —
 * the form CLAUDE.md documents. Lint would therefore mean a 172-site rewrite to a different
 * canonical form, not a fix. If the canonical form ever changes, revisit this.
 *
 * **Self-contained rather than split into a module plus a test**, unlike the other guard in this
 * directory: nothing imports it, and putting a file-scanner in a non-test file would buy coverage
 * obligations for a scanner whose only consumer is this file. `english-only.test.ts` is split that
 * way for a reason this file does not share — its module has consumers of its own, listed in that
 * file's header — and the repo-root `vitest.config.ts` names the one file it therefore measures.
 */

/** From `scripts/` up to the repo root. */
const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * **`apps/` is IN scope, deliberately, unlike `english-only.ts`.** That guard excludes `apps/*`
 * because vocabulary is a domain concern owned by the packages. A masked teardown error is not a
 * domain concern — it wastes the same debugging hour wherever it happens.
 *
 * `scripts/` — this file's own directory — is NOT a scan root, and that is what keeps the fixtures
 * below out of the scan; see the "the scan itself" block for the assertion that pins it.
 */
const SCAN_ROOTS = ["packages", "apps"] as const;

/** Directories never descended into. Filtered DURING traversal, not after: a post-filter walk of
 * `packages/` enumerated ~996,000 entries to find ~190 files, because pnpm's workspace links make
 * `node_modules` vast. Filtering here takes it to single-digit milliseconds. */
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "coverage", ".turbo", ".vite"]);

/** Methods that release a resource. `end` covers node-postgres pools; `stop` covers Testcontainers;
 * `close` covers this repo's `Database`. A resource exposing `dispose`/`destroy` would escape — the
 * cost of a hand-maintained list, accepted because the tree has none. */
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
    // A concurrently-written tree (another agent's coverage output, a parallel build) can delete a
    // directory between listing its parent and reading it. Observed twice. A guard that crashes on
    // that reports a scan failure as a teardown failure, which is the confusion it exists to end.
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

/** Memoised: the tree does not change mid-run, and this used to be walked twice per suite. */
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
 * Blanks block comments to whitespace (preserving line numbers) and drops line comments.
 *
 * The `(^|[^:])` guard on the line-comment pattern is load-bearing and mirrors `english-only.ts`'s
 * `dropLineComment`: without it, `const uri = "postgres://host/db"; await db.close();` loses
 * everything after `postgres:` and the teardown vanishes from the scan — a FALSE NEGATIVE. An
 * earlier revision of this file omitted it while claiming false negatives were impossible, and 21
 * test files in this tree contain a `postgres://` literal.
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
 * different call: a false negative. Line scope can only err the other way, demanding a guard on a
 * multi-line `if (db !== undefined) { await db.close(); }` — of which this tree has none, all 134
 * guards being the single-line form CLAUDE.md documents.
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

  // Without these, every assertion below passes vacuously against an empty set — the exact shape of
  // vacuous test this project has already shipped seven of.
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
    // this file as violating the rule it exists to enforce. Until 2026-08-01 a `SELF` constant
    // held that off by filename, because the file lived in `packages/db/src`; from here the scan
    // roots do it, and this is the assertion that says so rather than a comment claiming it.
    //
    // Proven by mutation on 2026-08-01: adding "scripts" to SCAN_ROOTS fails this test AND "every
    // teardown in the tree", the second one naming this file's own fixture lines.
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
