import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contract: a suite that wants a database asks for it through `useVenueDb`
 * (`packages/db/src/testing/venue-db.ts`), and the helper it replaced, `usePgliteDb`, is a RETIRED
 * NAME that no source file may write again.
 *
 * What this guard is for has changed with the storage swap, and the new job is the smaller one.
 * While both helpers existed it stopped a suite reaching past the seam. `usePgliteDb` is now
 * defined nowhere — `git grep -l usePgliteDb -- "*.ts"` answers with this file alone, taken
 * 2026-09-22 — so what it holds today is that the name stays retired: a reintroduced PGlite helper,
 * or a comment pointing a reader at one, is reported rather than quietly accumulating. That is a
 * thin subject, and it is stated plainly so nobody mistakes this for a check on how suites open
 * databases. CLAUDE.md §4 states the rule this file enforces; the two travel together.
 *
 * It lives in the ROOT Vitest project rather than beside the helper in `packages/db`, for the same
 * reason `scripts/column-vocabulary.test.ts` does, and the reason runs in the direction a reader
 * easily gets backwards. Both gates build `--filter "...<pkg>"` from the shared classifier's output
 * (`.husky/pre-push:112`, `.github/workflows/ci.yml:302`), and that expands a package to its
 * DEPENDENTS — so a scoped run reaches a check inside `packages/db` only when `@waitron/db` is
 * pulled in as a dependent, which is to say only when `db` DEPENDS on the changed package. It
 * depends on three (`membership`, `shared`, `sync-enrolment`), so it is almost never pulled in.
 * Measured on this tree, `pnpm --filter "...@waitron/bookings" ls --depth -1 --json` lists six
 * packages and `@waitron/db` is not among them — so the scoped run for a pull request adding a suite
 * in `packages/bookings` would not have reached a check that lived there. Two paths do still reach
 * it, and neither is the case this guard is for: a push whose scope the classifier calls `global`,
 * which makes CI emit every gate true (`.github/workflows/ci.yml:273`) and so run the `test-heavy`
 * shard (gated at `:580`, running `pnpm --filter "@waitron/db" test:shard` at `:620`), and a pull
 * request that changes `packages/db` itself. `global` is the narrow word and `not packages` would
 * be the wrong one: the `documentation` and `root` scopes also take that branch at `:273`, and
 * `test-heavy`'s gate needs `code` as well as `heavy`, which those two do not set. The PRE-PUSH HOOK is not one of those paths, and it is the natural
 * thing to assume: it runs no package tests at all (CLAUDE.md §2), so its unfiltered run reaches a
 * TYPECHECK of `packages/db`, never a suite living there. The root project needs none of this —
 * ci.yml's `lint` job and `.husky/pre-push` both run it on every non-documentation push.
 *
 * **It forbids the NAME, not just the call, and that is the deliberate part.** Seven dead pointers
 * in comments were standing when this guard was written, five of them in a `vitest.config.ts`,
 * where a call-shaped grep never looks. Comments are the class that kept recurring, so it reads
 * them.
 *
 * Three things it does not do, stated here because a failing test can never restore a missing
 * hedge. The first is an OVER-report rather than a blind spot; the other two are blind spots:
 *
 * 1. **It reads TEXT.** The name inside a string literal, a regular expression or prose is reported
 *    exactly like a call. That is the point rather than a flaw, but it means a file that needs to
 *    DISCUSS the old helper cannot, outside the package that owns it.
 * 2. **Its scope is `.ts` under `packages/` and `apps/`.** `scripts/`, `bench/`, `deploy/` and every
 *    markdown file in the repository are outside it — so a plan or a runbook naming the old helper
 *    is invisible to this guard, which is the class `docs/backlog.md` records as needing a human
 *    sweep, not a check. The name is still written in several markdown files today.
 * 3. **It checks a NAME, not how a suite opens a database.** A suite that opened one some other way
 *    entirely, under any other name, passes. Nothing here says a suite went through `useVenueDb`.
 *
 * There is no longer a whole-package exemption. `packages/db` held one while it defined both
 * helpers; it names neither now, so the exemption was earning nothing and covering whatever came
 * next. Removing it makes the rule apply to every `.ts` under both roots without exception.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["packages", "apps"];
const OLD_HELPER = "usePgliteDb";
const SEAM = "packages/db/src/testing/venue-db.ts";

/**
 * Every `.ts` file under `dir`, discovered rather than listed. The same walk three other root guards
 * use (`grep -rln "function sourceFilesIn" scripts/` returns four files, this one among them), kept
 * as a copy per house convention rather than shared.
 *
 * The shape to keep is that the DIRECTORY branch is taken first: a failing browser test writes its
 * screenshot into a directory named after the test file, and a walk that dispatched on the
 * extension would hand that directory to `readFileSync` and die with `EISDIR` instead of reporting
 * on the repository (root `CLAUDE.md` §4). The `isFile()` call then only has to drop an entry
 * `statSync` reports as neither file nor directory.
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
 * rather than reading it, so the controls below run this same function over a fixture string
 * instead of a reimplementation of it.
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
