import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `usePgliteDb`, the helper `useVenueDb` (`packages/db/src/testing/venue-db.ts`) replaced, is a
 * RETIRED NAME that no source file may write again. Nothing defines it any more, so all this holds
 * is that the name stays retired; it is not a check on how suites open databases.
 *
 * It forbids the NAME, not just the call, so a comment pointing a reader at the old helper is
 * reported too. What it does not do:
 *
 * 1. **It reads TEXT.** The name inside a string literal, a regular expression or prose is reported
 *    exactly like a call, so a file that needs to DISCUSS the old helper cannot.
 * 2. **Its scope is `.ts` under `packages/` and `apps/`.** `scripts/`, `bench/`, `deploy/`, the
 *    root `vitest.config.ts` and every markdown file are outside it.
 * 3. **It checks a NAME, not how a suite opens a database.** A suite that opened one some other way
 *    entirely, under any other name, passes.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["packages", "apps"];
const OLD_HELPER = "usePgliteDb";
const SEAM = "packages/db/src/testing/venue-db.ts";

/**
 * Every `.ts` file under `dir`. The DIRECTORY branch is taken first: a failing browser test writes
 * its screenshot into a directory named after the test file, and a walk that dispatched on the
 * extension would hand that directory to `readFileSync` and die with `EISDIR`.
 */
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

/** Every `.ts` file under `packages/` and `apps/`, as repo-relative paths. */
function allSources(): string[] {
  return ROOTS.flatMap((root) => sourceFilesIn(join(repoRoot, root)))
    .map((file) => relative(repoRoot, file))
    .sort();
}

/**
 * `"<file> names usePgliteDb"` if this file names the retired helper, else nothing. Takes the text
 * so the controls below run this same function over a fixture string.
 */
function offendingMention(file: string, text: string): string[] {
  return text.includes(OLD_HELPER) ? [`${file} names ${OLD_HELPER}`] : [];
}

function offenders(files: readonly string[]): string[] {
  return files.flatMap((file) =>
    offendingMention(file, readFileSync(join(repoRoot, file), "utf8")),
  );
}

describe("the retired helper name is written nowhere", () => {
  it("no source file under either root names it", () => {
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
    expect(report(`import { usePgliteDb } from "@waitron/db/testing/venue-db.js";`)).toEqual([
      `${other} names ${OLD_HELPER}`,
    ]);
  });

  it("reports one renamed on the way in", () => {
    expect(
      report(`import { usePgliteDb as useDb } from "@waitron/db/testing/venue-db.js";`),
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

  it("reports the retired name inside packages/db too, which used to be exempt", () => {
    expect(report(`const pg = usePgliteDb({});`, "packages/db/src/testing/venue-db.ts")).toEqual([
      `packages/db/src/testing/venue-db.ts names ${OLD_HELPER}`,
    ]);
  });
});
