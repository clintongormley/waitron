import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every `afterAll`/`afterEach` that closes a resource must guard it.
 *
 * CLAUDE.md §4 states the rule. It fired for real on 2026-07-31 in this very package: a
 * Testcontainers start timed out in `client.test.ts`'s `beforeAll`, and `afterAll` two lines below
 * then threw `TypeError: Cannot read properties of undefined (reading 'stop')`.
 *
 * **The experiment, run rather than assumed.** A scratch suite with a `beforeAll` that throws a
 * known error, run twice under vitest — once with `res!.stop()` in the teardown, once with
 * `if (res !== undefined) res.stop()`:
 *
 * - unguarded → **two** errors reported, the real one AND the `TypeError`;
 * - guarded → **one**, the real one alone.
 *
 * So the spurious error accompanies the real one rather than replacing it — CLAUDE.md's "masks" is
 * about attention, not suppression. That still matters: it doubles the failure count, and when
 * several suites time out together the real cause is what gets scrolled past.
 *
 * The rule was already written down and still had dozens of violations, which is exactly the kind
 * of convention that needs a guard rather than a paragraph. A hand count of these has been recorded
 * wrongly twice before; this file makes counting a non-issue.
 *
 * **Self-contained rather than split into `guarded-teardowns.ts` + a test**, unlike
 * `english-only.ts` next door. This is test hygiene, not domain logic: nothing imports it, and
 * putting a file-scanner in `src/` non-test surface would buy coverage obligations for a scanner
 * whose only consumer is this file. `no-provider-vocabulary.test.ts` and `no-hardcoded-chrome.test.ts`
 * take the same self-contained shape.
 */

/** From `packages/db/src` up to the repo root — one level higher than `english-only.ts`'s
 * `PACKAGES_ROOT`, because this guard covers `apps/` too (see `SCAN_ROOTS`). */
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * **`apps/` is IN scope here, deliberately, and this differs from `english-only.ts`.** That guard
 * excludes `apps/*` by a recorded decision because vocabulary is a domain concern owned by the
 * packages. A masked teardown error is not a domain concern — it wastes the same debugging hour
 * wherever it happens — so there is no principled reason to exempt an app. If a third root appears,
 * add it here.
 */
const SCAN_ROOTS = ["packages", "apps"] as const;

/** Methods that release a resource acquired in `beforeAll`/`beforeEach`. `end` covers node-postgres
 * pools; `stop` covers Testcontainers; `close` covers this repo's `Database`. */
const CLOSERS = ["close", "stop", "end"] as const;

/**
 * This file exempts itself, as `english-only.ts` exempts its own two files. The detector's fixtures
 * below are teardown snippets held in template literals, and `stripComments` is deliberately naive
 * about string literals — so scanning this file reports its own fixtures. Exempting it costs
 * nothing: it acquires no resource and therefore has no teardown of its own to get wrong.
 */
const SELF = "guarded-teardowns.test.ts";

function isSkippable(relPath: string): boolean {
  const parts = relPath.split(sep);
  if (parts[parts.length - 1] === SELF) return true;
  return parts.includes("node_modules") || parts.includes("dist") || parts.includes("coverage");
}

function testFiles(): string[] {
  const found: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root);
    for (const rel of readdirSync(abs, { recursive: true, encoding: "utf8" })) {
      if (!rel.endsWith(".test.ts") || isSkippable(rel)) continue;
      found.push(join(abs, rel));
    }
  }
  return found.sort();
}

/**
 * Blanks block comments to equivalent whitespace (preserving line numbers so reported line numbers
 * stay true) and drops trailing line comments. Mirrors `english-only.ts`'s
 * `blankBlockComments`/`dropLineComment`, duplicated rather than imported for the reason
 * `no-provider-vocabulary.test.ts` records: neither helper is exported.
 *
 * Naive about `//` inside string literals. That is acceptable here and not in a vocabulary guard:
 * the worst case is a comment mentioning `db.close()` being treated as code, which can only produce
 * a FALSE POSITIVE — a demand to guard something already fine — never a false negative that lets a
 * real unguarded teardown through.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

/** Extract the `{ ... }` body that follows `startIndex`, by brace matching. Returns null when the
 * hook has no block body (e.g. a bare arrow expression), which no teardown in this tree uses. */
function blockAfter(source: string, startIndex: number): { body: string; offset: number } | null {
  const open = source.indexOf("{", startIndex);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return { body: source.slice(open, i + 1), offset: open };
    }
  }
  return null;
}

/** True when `body` proves `identifier` was checked before use — `?.`, an `if`, an explicit
 * `!== undefined`, or a `&&` short-circuit. */
function isGuarded(body: string, identifier: string): boolean {
  const id = identifier.replace(/[$]/g, "\\$&");
  return [
    new RegExp(`\\b${id}\\s*\\?\\.`),
    new RegExp(`if\\s*\\(\\s*!?\\s*${id}\\b`),
    new RegExp(`\\b${id}\\s*!==\\s*undefined`),
    new RegExp(`\\b${id}\\s*&&`),
  ].some((pattern) => pattern.test(body));
}

export interface Finding {
  file: string;
  line: number;
  expression: string;
}

/** Scan one file's source for unguarded closers inside teardown hooks. Exported shape kept simple
 * so the controls below can drive it with inline fixtures rather than real files. */
export function findUnguarded(source: string, file = "<inline>"): Finding[] {
  const clean = stripComments(source);
  const findings: Finding[] = [];
  const hook = /\bafter(?:All|Each)\s*\(/g;
  const closer = new RegExp(
    `\\b([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${CLOSERS.join("|")})\\s*\\(\\s*\\)`,
    "g",
  );

  for (let hookMatch = hook.exec(clean); hookMatch !== null; hookMatch = hook.exec(clean)) {
    const block = blockAfter(clean, hookMatch.index);
    if (block === null) continue;
    for (let call = closer.exec(block.body); call !== null; call = closer.exec(block.body)) {
      const [expression, identifier] = call;
      if (isGuarded(block.body, identifier)) continue;
      const line = clean.slice(0, block.offset + call.index).split("\n").length;
      findings.push({ file, line, expression });
    }
  }
  return findings;
}

describe("the scan itself", () => {
  // Without this, every assertion below passes vacuously against an empty set — the exact shape of
  // vacuous test this project has already shipped seven of.
  const files = testFiles();

  it("finds test files across every scanned root", () => {
    expect(files.length).toBeGreaterThan(50);
    for (const root of SCAN_ROOTS) {
      expect(files.some((f) => f.includes(`${sep}${root}${sep}`))).toBe(true);
    }
  });

  it("reaches packages/db's own suites", () => {
    expect(files.some((f) => f.endsWith(join("db", "src", "client.test.ts")))).toBe(true);
  });

  it("exempts only itself, and does so", () => {
    expect(files.some((f) => f.endsWith(SELF))).toBe(false);
    // The exemption is by exact filename, so a sibling with a similar name stays in scope.
    expect(isSkippable(join("packages", "db", "src", "client.test.ts"))).toBe(false);
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
    const guarded = [
      `afterAll(async () => {\n  if (db !== undefined) await db.close();\n});`,
      `afterAll(async () => {\n  if (db) await db.close();\n});`,
      `afterAll(async () => {\n  await db?.close();\n});`,
      `afterAll(async () => {\n  db && (await db.close());\n});`,
    ];
    for (const source of guarded) expect(findUnguarded(source)).toEqual([]);
  });

  // Negative control: the detector must not fire on a closer OUTSIDE a teardown hook, which is the
  // ordinary case (`await db.close()` at the end of an `it`) and vastly more common than the defect.
  it("ignores closers outside teardown hooks", () => {
    expect(findUnguarded(`it("works", async () => {\n  await db.close();\n});`)).toEqual([]);
  });

  it("ignores a closer that only appears in a comment", () => {
    expect(findUnguarded(`afterAll(async () => {\n  // await db.close();\n});`)).toEqual([]);
  });

  it("covers stop and end, not just close", () => {
    expect(findUnguarded(`afterAll(async () => {\n  await container.stop();\n});`)).toHaveLength(1);
    expect(findUnguarded(`afterEach(async () => {\n  await pool.end();\n});`)).toHaveLength(1);
  });
});

describe("every teardown in the tree", () => {
  it("guards the resource it releases", () => {
    const findings = testFiles().flatMap((file) =>
      findUnguarded(readFileSync(file, "utf8"), relative(REPO_ROOT, file)),
    );
    const report = findings.map((f) => `${f.file}:${f.line} — ${f.expression}`).sort();
    expect(report).toEqual([]);
  });
});
