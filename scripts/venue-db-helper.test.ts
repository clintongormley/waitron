import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract: a suite that wants a PGlite database asks for it through `useVenueDb`. That helper is
 * the seam the SQLite switch (task F1) replaces, so the switch changes one function body rather
 * than every call site.
 *
 * It lives in the ROOT Vitest project rather than beside the helper in `packages/db`, for the same
 * reason `scripts/column-vocabulary.test.ts` does: CI expands a changed package to its DEPENDENTS,
 * and most packages do not list `@waitron/db`, so a check living there would not run on the pull
 * request that adds a suite somewhere else. The root project is ungated — ci.yml's `lint` job and
 * `.husky/pre-push` both run it on every non-documentation push.
 *
 * **It forbids the NAME, not just the call, and that is the deliberate part.** `useVenueDb`'s whole
 * body is `return usePgliteDb(options)`, so a comment elsewhere in the tree pointing a reader at
 * "the suite's `usePgliteDb` options" stays true while naming a function that file cannot call.
 * Seven such dead pointers were standing when this guard was written and are swept in the same
 * pull request; five of them were in a `vitest.config.ts`, where a call-shaped grep would never
 * have looked. `docs/backlog.md` asked whoever wrote this guard to decide about comments
 * deliberately and say so: it reads them, because they are the class that kept recurring.
 *
 * Five gaps, stated here because a failing test can never restore a missing hedge:
 *
 * 1. **It reads TEXT.** The name inside a string literal, a regular expression or prose is reported
 *    exactly like a call. That is the point rather than a flaw, but it means a file that needs to
 *    DISCUSS the old helper cannot, outside the package that owns it.
 * 2. **`packages/db/` is exempt WHOLE**, not file by file. It defines both helpers, tests them, and
 *    documents them in its README and its vitest config, so a per-file list there would be four
 *    entries that go stale on the next refactor. The price: a suite inside that package could call
 *    `usePgliteDb` directly and this guard would not see it.
 * 3. **It sees one of the three doors to a PGlite database.** `createPgliteDb` called directly and
 *    `describeEachTarget`'s PGlite half are the other two, and neither is reported. On `e596fea4f`,
 *    `comm -23 <(grep -rlE "createPgliteDb\(" --include="*.test.ts" packages apps | sort)
 *    <(grep -rlE "useVenueDb\(|describeEachTarget\(" --include="*.test.ts" packages apps | sort)`
 *    returns 10 suites taking the first door and no other, and
 *    `grep -rlE "describeEachTarget\(" --include="*.test.ts" packages apps` returns 7 taking the
 *    second. They are not a mechanical rename — `describeEachTarget` hands out a fresh cluster PER
 *    TEST where this helper hands out one database per SUITE with a truncate between tests, a
 *    different isolation contract — so plan task P2 left them to F1 and so does this guard. A
 *    control below pins that rather than only claiming it.
 * 4. **Its scope is `.ts` under `packages/` and `apps/`.** `scripts/`, `bench/`, `deploy/` and every
 *    markdown file in the repository are outside it — so a plan or a runbook naming the old helper
 *    is invisible to this guard, which is the class `docs/backlog.md` records as needing a human
 *    sweep, not a check.
 * 5. **It reads the file, not the module graph.** Re-exporting `usePgliteDb` from `packages/db`
 *    under a different name and importing THAT name elsewhere passes.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["packages", "apps"];
const OWNER = "packages/db/";
const OLD_HELPER = "usePgliteDb";
const SEAM = "packages/db/src/testing/venue-db.ts";

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (stats.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function allSources(): string[] {
  return ROOTS.flatMap((root) => sourceFilesIn(join(repoRoot, root)))
    .map((file) => relative(repoRoot, file))
    .sort();
}

/**
 * `"<file> names usePgliteDb"` if this file names the old helper and is not allowed to, else
 * nothing. Takes the text rather than reading it, so the controls below run this same function over
 * a fixture string instead of a reimplementation of it.
 */
function offendingMention(file: string, text: string): string[] {
  if (file.startsWith(OWNER)) return [];
  return text.includes(OLD_HELPER) ? [`${file} names ${OLD_HELPER}`] : [];
}

function offenders(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    offendingMention(file, readFileSync(join(repoRoot, file), "utf8")),
  );
}

describe("a suite asks for its PGlite database through useVenueDb", () => {
  it("no file outside the package that owns the helpers names the old one", () => {
    expect(offenders(allSources())).toEqual([]);
  });

  it("the seam the rule points at still exists", () => {
    const seam = readFileSync(join(repoRoot, SEAM), "utf8");
    expect(seam).toContain("export function useVenueDb(");
  });

  it("reaches both roots", () => {
    const files = allSources();
    for (const root of ROOTS) {
      expect(files.some((file) => file.startsWith(`${root}/`))).toBe(true);
    }
  });
});

describe("negative controls", () => {
  const other = "packages/x/src/x.test.ts";
  const report = (source: string, file = other) => offendingMention(file, source);

  it("reports a call", () => {
    expect(report(`const pg = usePgliteDb({ migrations: [] });`)).toEqual([
      `${other} names ${OLD_HELPER}`,
    ]);
  });

  it("reports a named import", () => {
    expect(report(`import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";`)).toEqual([
      `${other} names ${OLD_HELPER}`,
    ]);
  });

  it("reports one renamed on the way in", () => {
    expect(
      report(`import { usePgliteDb as useDb } from "@waitron/db/testing/lifecycle.js";`),
    ).toEqual([`${other} names ${OLD_HELPER}`]);
  });

  it("reports a bare mention in a comment — the dead-pointer class this sweep kept finding", () => {
    expect(report(`// the boot runs under usePgliteDb's own 60s default`)).toEqual([
      `${other} names ${OLD_HELPER}`,
    ]);
  });

  it("reports a file naming it more than once only once", () => {
    expect(report(`import { usePgliteDb } from "x";\nconst pg = usePgliteDb({});`)).toEqual([
      `${other} names ${OLD_HELPER}`,
    ]);
  });

  it("leaves the seam's own name alone", () => {
    expect(report(`const pg = useVenueDb({ migrations: [] });`)).toEqual([]);
  });

  it("leaves the other two doors alone — they are task F1's, not this rule's", () => {
    expect(
      report(`const db = await createPgliteDb();\ndescribeEachTarget("x", () => {});`),
    ).toEqual([]);
  });

  it("exempts the package that owns both helpers", () => {
    expect(report(`const pg = usePgliteDb({});`, "packages/db/src/testing/lifecycle.ts")).toEqual(
      [],
    );
  });

  it("does not exempt a package whose name merely starts with the owner's", () => {
    expect(report(`const pg = usePgliteDb({});`, "packages/db-extra/src/x.test.ts")).toEqual([
      `packages/db-extra/src/x.test.ts names ${OLD_HELPER}`,
    ]);
  });
});
