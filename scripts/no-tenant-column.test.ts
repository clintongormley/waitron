import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  headSnapshot,
  migrationSets,
  migrationSqlFiles,
} from "../packages/sync-enrolment/src/testing/migration-sets.js";

/**
 * Contract: the schema carries no tenant column and no code carries a tenant id. One taxpayer lives
 * in a database, as the single row of `tenants`; a query that wants "this tenant's rows" reads the
 * table. Nothing filters by a tenant, so a column reintroduced by habit would be silently unfiltered
 * on every read — which is how a by-id read on `working_orders.id` once let one taxpayer abandon
 * another's order (root `CLAUDE.md`, the by-id-read receipt).
 *
 * Reads TEXT, not code: it matches SPELLINGS of the column, so a column reintroduced under a name
 * containing neither `tenant_id` nor `tenantId` — `owner_ref`, say — passes. That is the known gap,
 * and it is what a guard costs that needs no database and no type information to run.
 *
 * What the spellings DO reach, because a hedge vaguer than the code is its own defect: a prefix and
 * a plural as well as the bare name, so `sourceTenantId`, `tenantIds`, `source_tenant_id` and
 * `tenant_ids` are all caught, and `tenantID` alongside `tenantId`. Pinned in both directions by
 * `negative controls` below — the earlier patterns anchored the FRONT of the name and missed every
 * prefixed and plural spelling, `sourceTenantId` included, which is a spelling this repository
 * carried until the branch that added this guard.
 *
 * Three more gaps, stated here because a failing test can never restore a missing hedge:
 *
 * 1. **It does not read `*.test.ts`.** A test may name a tenant in a comment about the past, or in a
 *    local variable, without anything shipping. A tenant column reintroduced for real has to be
 *    declared in non-test source to reach a database, so the column itself is still covered — but a
 *    stale claim written in a test is not.
 * 2. **The schema check reads drizzle's own snapshot of the schema, not a live database.** It sees a
 *    column added through a drizzle table definition, because that regenerates a snapshot (and
 *    `migrations-match-schema.test.ts` fails when it was not regenerated); it cannot see one added
 *    by hand-written SQL. Two other checks cover that path: migration `.sql` files, and
 *    the COLUMN spelling tested against non-test TypeScript as well as the identifier — so an
 *    `alter table … add column "tenant_id"` written inside a `sql` template is read too. What none of
 *    the three sees is SQL assembled from pieces that never spell the column out.
 * 3. **`HISTORICAL_TENANT_SQL` is a hand-written list of whole FILES, and it is EMPTY today.** It
 *    used to name the thirteen core migrations that created the column and later dropped it, and it
 *    exempted each one entirely — so a column re-added inside one of those files was seen by nothing
 *    here. The SQLite regeneration deleted every file it named (each one checked absent, 2026-09-21),
 *    so the exemption is gone and the SQL check below now reads every migration file in the tree.
 *    That is a STRENGTHENING: this limitation stands only as the shape the list would take again, and
 *    an empty list has no gap to hedge. The gap returns the moment a name is added back, which is why
 *    the paragraph stays.
 */

const repoRoot = join(import.meta.dirname, "..");
const sets = migrationSets(repoRoot);
const ROOTS = ["packages", "apps"];

/**
 * The snake_case column, as it appears in SQL, in a drizzle snapshot, and inside a `sql` template in
 * TypeScript. Anchored only at the END, so a prefixed column (`source_tenant_id`) and a plural
 * (`tenant_ids`) are caught as well as the bare name.
 */
const SQL_COLUMN = /tenant_ids?\b/;

/**
 * The camelCase field and the brand that used to type it. Anchored only at the END, so a prefixed
 * field (`sourceTenantId`) and a plural (`tenantIds`) are caught as well as the bare name, and
 * either casing of `Id` covers `tenantID` alongside `tenantId`. The snake_case column is deliberately
 * NOT this pattern's job — `SQL_COLUMN` is, and the check over TypeScript tests both, so the two
 * spellings stay separable and each control below pins one thing.
 *
 * The trailing boundary is what keeps the taxpayer identity's own names out: `TenantIdentity` and
 * `readTenantIdentities` (`packages/provisioning/src/tenant-guard.ts`) are the `(country, taxId)`
 * pair on the taxpayer row, a different thing from a tenant column, and they stay. `negative
 * controls` below pins that in both directions, because widening this pattern until it swallows them
 * is what would force an allowlist — and an allowlist is the thing that goes stale.
 */
const TS_IDENTIFIER = /[tT]enant[Ii][Dd]s?\b/;

/**
 * Migration files allowed to name the column because they are the recorded history of carrying it and
 * dropping it again. EMPTY, and empty is the STRONG state: nothing in the tree is exempt, so the SQL
 * check below reads every migration file there is. Not an oversight, and not something to fill in —
 * an entry here is a hole in that check, one whole file wide.
 *
 * It held the thirteen `packages/db/drizzle` migrations that named `tenant_id`, from the baselines
 * that created it to `0032`–`0034`, which dropped it. The SQLite regeneration replaced core's whole
 * history with one baseline and deleted all thirteen; each name was checked absent from the tree on
 * 2026-09-21 before this set was emptied.
 */
const HISTORICAL_TENANT_SQL: ReadonlySet<string> = new Set<string>();

/**
 * Every `.ts` file under `dir`, discovered rather than listed.
 *
 * The shape to keep is that the DIRECTORY branch is taken first: a failing browser test writes its
 * screenshot into a directory named after the test file, and a walk that dispatched on the
 * extension would hand that directory to `readFileSync` and die with `EISDIR` instead of reporting
 * on the repository (root `CLAUDE.md` §4). The `isFile()` call then only drops an entry `statSync`
 * reports as neither file nor directory. (Corrected 2026-09-18: this comment used to credit
 * `isFile()` with saving the screenshot case, which the branch order says it does not — the version
 * of `sourceFilesIn` in `packages/db/src/english-only.ts` is the one where it does, because that
 * one filters on the extension first.)
 */
function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...sourceFilesIn(full));
    else if (st.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Every non-test `.ts` file under `packages/` and `apps/`, as repo-relative paths. */
function nonTestSources(): string[] {
  return ROOTS.flatMap((root) => sourceFilesIn(join(repoRoot, root)))
    .filter((file) => !file.endsWith(".test.ts"))
    .map((file) => relative(repoRoot, file))
    .sort();
}

describe("no tenant column", () => {
  it("scans a non-empty tree — an empty selection would pass every check below", () => {
    // An absence assertion over nothing passes exactly as well as one over everything. These two
    // numbers are the only thing separating this suite from a guard that reports on a typo in a
    // path. They are lower bounds, not counts: a number is a receipt that goes stale.
    expect(nonTestSources().length).toBeGreaterThan(500);
    expect(sets.length).toBeGreaterThan(5);
    // The SQL floor came down from 20 to 8 when the sets were regenerated as one SQLite baseline
    // each. Measured 2026-09-21: 1139 non-test sources, 13 sets, and 12 `.sql` files — one per set,
    // `packages/fiscal-none` shipping none. Still a lower bound strictly under the tree, so it
    // catches an empty or mis-pathed selection without failing the day a set is retired.
    expect(sets.flatMap((set) => migrationSqlFiles(repoRoot, set)).length).toBeGreaterThan(8);
  });

  it("declares no tenant column in any migration set's head schema", () => {
    const offenders = sets
      .map((set) => headSnapshot(repoRoot, set))
      .filter((head) => head.kind === "file")
      .map((head) => head.path)
      .filter((snapshot) => SQL_COLUMN.test(readFileSync(join(repoRoot, snapshot), "utf8")));

    expect(offenders).toEqual([]);
  });

  it("reads a head snapshot for every migration set that declares one", () => {
    // A set whose journal names a head with no snapshot on disk would drop out of the check above
    // without saying so, and an absence assertion cannot notice its own missing input.
    const unreadable = sets.filter((set) => headSnapshot(repoRoot, set).kind === "missing");
    expect(unreadable).toEqual([]);

    // …and most sets really do declare one, so the check above is reading real schemas rather than
    // skipping every set as empty.
    const read = sets.filter((set) => headSnapshot(repoRoot, set).kind === "file");
    expect(read.length).toBeGreaterThan(5);
  });

  it("names no tenant column in any migration SQL outside the recorded history", () => {
    const offenders = sets
      .flatMap((set) => migrationSqlFiles(repoRoot, set))
      .filter((file) => !HISTORICAL_TENANT_SQL.has(file))
      .filter((file) => SQL_COLUMN.test(readFileSync(join(repoRoot, file), "utf8")));

    expect(offenders).toEqual([]);
  });

  it("carries no tenant field, and no tenant column in raw SQL, in non-test TypeScript", () => {
    // BOTH spellings, not just the identifier. This package writes schema SQL as text — a
    // `sql` template naming the column reaches a database without ever spelling the field, and the
    // typechecker cannot see into it either. No allowlist, deliberately: nothing under `packages/`
    // or `apps/` has a reason to name one.
    //
    // It reads TEXT, so it also refuses a COMMENT that happens to contain the spelling. The case
    // that came up was a citation: two core migrations were called `0033_drop_tenant…` and
    // `0034_drop_tenant…`, so quoting either path was an offence. Both files are gone with the
    // SQLite regeneration, so nothing in the tree needs that dodge today — but the shape recurs
    // whenever a file name carries the spelling, and the answer is to cite by number ("migration
    // `0033` line 236, in `packages/db/drizzle/`") rather than to reach for an allowlist.
    const offenders = nonTestSources().filter((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      return TS_IDENTIFIER.test(source) || SQL_COLUMN.test(source);
    });

    expect(offenders).toEqual([]);
  });
});

describe("negative controls", () => {
  it("would catch a reintroduced column and field — the patterns are not vacuous", () => {
    // The checks above assert absence, which passes just as well when the predicate is broken. This
    // pins both predicates against the exact spellings the schema and the code used to contain.
    expect(SQL_COLUMN.test('"tenant_id" uuid NOT NULL')).toBe(true);
    expect(SQL_COLUMN.test('ALTER TABLE "sales" ADD COLUMN "tenant_id" uuid;')).toBe(true);
    expect(TS_IDENTIFIER.test('tenantId: uuid("tenant_id").notNull()')).toBe(true);
    expect(TS_IDENTIFIER.test("function f(cfg: { tenantId: TenantId }) {}")).toBe(true);
  });

  it("catches a prefixed or plural spelling — the patterns are not anchored at the front", () => {
    // Every one of these passed an earlier version of this guard, which anchored the front of the
    // name as well as the back. `sourceTenantId` is not hypothetical: it is a spelling this
    // repository carried, so a guard blind to it would not have stopped it coming back.
    expect(TS_IDENTIFIER.test("sourceTenantId: string;")).toBe(true);
    expect(TS_IDENTIFIER.test("readonly tenantIds: string[];")).toBe(true);
    expect(TS_IDENTIFIER.test("tenantID: string;")).toBe(true);
    expect(SQL_COLUMN.test('"source_tenant_id" uuid')).toBe(true);
    expect(SQL_COLUMN.test("tenant_ids uuid[]")).toBe(true);
  });

  it("catches a tenant column written as raw SQL inside TypeScript", () => {
    // The check over non-test sources tests BOTH patterns for this reason. Only `SQL_COLUMN` fires
    // here — nothing in the statement spells the camelCase field — so testing the identifier alone
    // would read straight past a column on its way into a database.
    const raw = 'await tx.execute(sql`alter table "products" add column "tenant_id" uuid`);';
    expect(TS_IDENTIFIER.test(raw)).toBe(false);
    expect(SQL_COLUMN.test(raw)).toBe(true);
  });

  it("leaves the taxpayer identity's own names alone — the patterns are not too wide", () => {
    // `TenantIdentity` and `readTenantIdentities` are the `(country, taxId)` pair on the taxpayer
    // row and they stay. Matching them would make this guard unfixable without an allowlist, which
    // is the thing that goes stale. The word boundary is what keeps them out.
    expect(TS_IDENTIFIER.test("export interface TenantIdentity { country: string }")).toBe(false);
    expect(TS_IDENTIFIER.test("await readTenantIdentities(db)")).toBe(false);
    expect(SQL_COLUMN.test("select country, tax_id from tenants")).toBe(false);
    expect(SQL_COLUMN.test("insert into tenants (country, tax_id) values ($1, $2)")).toBe(false);
  });
});
