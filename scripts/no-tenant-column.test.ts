import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

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
 *    column added through a drizzle table definition, because that regenerates a snapshot; it cannot
 *    see one added by hand-written SQL. Two other checks cover that path: migration `.sql` files, and
 *    the COLUMN spelling tested against non-test TypeScript as well as the identifier — so an
 *    `alter table … add column "tenant_id"` written inside a `sql` template is read too. What none of
 *    the three sees is SQL assembled from pieces that never spell the column out.
 * 3. **`HISTORICAL_TENANT_SQL` is a hand-written list of whole FILES.** It names the core migrations
 *    that created the column and later dropped it, and it exempts each one entirely — so a column
 *    re-added INSIDE one of those files is seen by nothing here. The mitigation is a convention
 *    rather than a check: drizzle migrations are append-only and are never edited, which is also why
 *    the list can only go stale in the safe direction (a regeneration deletes a baseline, and a name
 *    that has gone is tolerated rather than reported).
 */

const repoRoot = join(import.meta.dirname, "..");
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
 * The core migrations that name `tenant_id`: the baselines that created it, the later migrations
 * that touched tables carrying it, and `0030`–`0032`, which drop it. `packages/db` is the one set
 * with an upgrade test, so its column was removed by migration rather than by regenerating a
 * baseline the way the eleven module sets were.
 *
 * Deliberately empty of anything outside `packages/db/drizzle`.
 */
const HISTORICAL_TENANT_SQL: ReadonlySet<string> = new Set([
  "packages/db/drizzle/0000_db_baseline.sql",
  "packages/db/drizzle/0001_db_baseline_sql.sql",
  "packages/db/drizzle/0004_device_binding_rule_sql.sql",
  "packages/db/drizzle/0005_device_profile_form_factor_locked_sql.sql",
  "packages/db/drizzle/0006_tills_name_unique_sql.sql",
  "packages/db/drizzle/0008_join_requests.sql",
  "packages/db/drizzle/0011_drop_print_agent_pairing_codes_sql.sql",
  "packages/db/drizzle/0014_central_printer_provisioning_sql.sql",
  "packages/db/drizzle/0015_print_agent_node_id.sql",
  "packages/db/drizzle/0020_category_names.sql",
  "packages/db/drizzle/0030_drop_tenant_id_before_sql.sql",
  "packages/db/drizzle/0031_drop_tenant_id.sql",
  "packages/db/drizzle/0032_drop_tenant_id_after_sql.sql",
]);

/**
 * Every `.ts` file under `dir`, discovered rather than listed.
 *
 * The `isFile()` check is not decoration: a failing browser test writes its screenshot into a
 * DIRECTORY named after the test file, so a tree walk that trusts the extension hands a directory to
 * `readFileSync` and the guard dies with `EISDIR` instead of reporting on the repository (root
 * `CLAUDE.md` §4).
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

/** Every `drizzle/` migration set directly under a package or app, as repo-relative paths. */
function migrationSets(): string[] {
  const sets: string[] = [];
  for (const root of ROOTS) {
    for (const entry of readdirSync(join(repoRoot, root))) {
      const dir = join(repoRoot, root, entry, "drizzle");
      if (existsSync(dir) && statSync(dir).isDirectory()) sets.push(relative(repoRoot, dir));
    }
  }
  return sets.sort();
}

/**
 * Every `.sql` file in a migration set, as repo-relative paths. Walks the whole set rather than its
 * top level: no set nests its migrations today, and nothing stops one starting to.
 */
function migrationSql(set: string): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return walk(full);
      return statSync(full).isFile() && full.endsWith(".sql") ? [relative(repoRoot, full)] : [];
    });
  return walk(join(repoRoot, set)).sort();
}

/**
 * The snapshot drizzle holds for a set's HEAD — the schema as it stands, rather than the history
 * that built it. The journal's highest `idx` names it; `_journal.json` is the file drizzle itself
 * reads, so this follows the same pointer rather than guessing from file names.
 *
 * `"empty"` is a set that declares no migrations at all and so has no schema to check. That is a real
 * state, not a hole: `packages/fiscal-none` is the fiscal module that files nothing and owns no
 * tables. `"missing"` is a set whose journal DOES name a head whose snapshot is not on disk, which
 * would silently drop that set out of the schema check — the case the suite refuses.
 */
type HeadSnapshot = { kind: "file"; path: string } | { kind: "empty" } | { kind: "missing" };

function headSnapshot(set: string): HeadSnapshot {
  const journal = join(repoRoot, set, "meta", "_journal.json");
  if (!existsSync(journal)) return { kind: "missing" };
  const entries = JSON.parse(readFileSync(journal, "utf8")).entries as { idx: number }[];
  if (entries.length === 0) return { kind: "empty" };
  const head = Math.max(...entries.map((entry) => entry.idx));
  const snapshot = join(repoRoot, set, "meta", `${String(head).padStart(4, "0")}_snapshot.json`);
  return existsSync(snapshot)
    ? { kind: "file", path: relative(repoRoot, snapshot) }
    : { kind: "missing" };
}

describe("no tenant column", () => {
  it("scans a non-empty tree — an empty selection would pass every check below", () => {
    // An absence assertion over nothing passes exactly as well as one over everything. These two
    // numbers are the only thing separating this suite from a guard that reports on a typo in a
    // path. They are lower bounds, not counts: a number is a receipt that goes stale.
    expect(nonTestSources().length).toBeGreaterThan(500);
    expect(migrationSets().length).toBeGreaterThan(5);
    expect(migrationSets().flatMap((set) => migrationSql(set)).length).toBeGreaterThan(20);
  });

  it("declares no tenant column in any migration set's head schema", () => {
    const offenders = migrationSets()
      .map((set) => headSnapshot(set))
      .filter((head) => head.kind === "file")
      .map((head) => head.path)
      .filter((snapshot) => SQL_COLUMN.test(readFileSync(join(repoRoot, snapshot), "utf8")));

    expect(offenders).toEqual([]);
  });

  it("reads a head snapshot for every migration set that declares one", () => {
    // A set whose journal names a head with no snapshot on disk would drop out of the check above
    // without saying so, and an absence assertion cannot notice its own missing input.
    const unreadable = migrationSets().filter((set) => headSnapshot(set).kind === "missing");
    expect(unreadable).toEqual([]);

    // …and most sets really do declare one, so the check above is reading real schemas rather than
    // skipping every set as empty.
    const read = migrationSets().filter((set) => headSnapshot(set).kind === "file");
    expect(read.length).toBeGreaterThan(5);
  });

  it("names no tenant column in any migration SQL outside the recorded history", () => {
    const offenders = migrationSets()
      .flatMap((set) => migrationSql(set))
      .filter((file) => !HISTORICAL_TENANT_SQL.has(file))
      .filter((file) => SQL_COLUMN.test(readFileSync(join(repoRoot, file), "utf8")));

    expect(offenders).toEqual([]);
  });

  it("carries no tenant field, and no tenant column in raw SQL, in non-test TypeScript", () => {
    // BOTH spellings, not just the identifier. This package writes schema SQL as text — a
    // `sql` template naming the column reaches a database without ever spelling the field, and the
    // typechecker cannot see into it either. No allowlist, deliberately: nothing under `packages/`
    // or `apps/` has a reason to name one.
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
