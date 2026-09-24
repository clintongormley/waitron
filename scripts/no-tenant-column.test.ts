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
 * in a database, as the single row of `tenants`. Nothing filters by a tenant, so a column
 * reintroduced by habit would be silently unfiltered on every read.
 *
 * Reads TEXT, not code: it matches SPELLINGS of the column, so a column reintroduced under a name
 * containing neither `tenant_id` nor `tenantId` — `owner_ref`, say — passes. The spellings reach a
 * prefix and a plural as well as the bare name, and `tenantID` alongside `tenantId`; `negative
 * controls` below pins that in both directions.
 *
 * Three more gaps:
 *
 * 1. **It does not read `*.test.ts`.** A tenant column reintroduced for real has to be declared in
 *    non-test source to reach a database, so the column itself is still covered — but a stale claim
 *    written in a test is not.
 * 2. **The schema check reads drizzle's own snapshot of the schema, not a live database.** It
 *    cannot see a column added by hand-written SQL; the checks over migration `.sql` files and over
 *    the column spelling in non-test TypeScript cover that path. What none of the three sees is SQL
 *    assembled from pieces that never spell the column out.
 * 3. **`HISTORICAL_TENANT_SQL` exempts whole FILES.** It is empty, so nothing is exempt; a name
 *    added back is a file in which a re-added column is seen by nothing here.
 */

const repoRoot = join(import.meta.dirname, "..");
const sets = migrationSets(repoRoot);
const ROOTS = ["packages", "apps"];

/**
 * The snake_case column, as it appears in SQL, in a drizzle snapshot, and inside a `sql` template
 * in TypeScript. Anchored only at the END, so a prefixed column (`source_tenant_id`) and a plural
 * (`tenant_ids`) are caught as well as the bare name.
 */
const SQL_COLUMN = /tenant_ids?\b/;

/**
 * The camelCase field and the brand that used to type it. Anchored only at the END, so a prefixed
 * field (`sourceTenantId`) and a plural (`tenantIds`) are caught as well as the bare name, and
 * either casing of `Id` covers `tenantID` alongside `tenantId`.
 *
 * The trailing boundary keeps `TenantIdentity` and `readTenantIdentities`
 * (`packages/provisioning/src/tenant-guard.ts`), the taxpayer row's `(country, taxId)` pair, out.
 */
const TS_IDENTIFIER = /[tT]enant[Ii][Dd]s?\b/;

/**
 * Migration files allowed to name the column, exempted whole. EMPTY: an entry here is a hole in the
 * SQL check below, one whole file wide.
 */
const HISTORICAL_TENANT_SQL: ReadonlySet<string> = new Set<string>();

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
    // An absence assertion over nothing passes. Lower bounds, not counts.
    expect(nonTestSources().length).toBeGreaterThan(500);
    expect(sets.length).toBeGreaterThan(5);
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

    // …and most sets really do declare one, so the check above is not skipping every set as empty.
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
    // BOTH spellings: a `sql` template naming the column reaches a database without ever spelling
    // the field. No allowlist, deliberately. It reads TEXT, so a COMMENT containing the spelling is
    // refused too: cite such a file by number rather than reaching for an allowlist.
    const offenders = nonTestSources().filter((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      return TS_IDENTIFIER.test(source) || SQL_COLUMN.test(source);
    });

    expect(offenders).toEqual([]);
  });
});

describe("negative controls", () => {
  it("would catch a reintroduced column and field — the patterns are not vacuous", () => {
    // The checks above assert absence, which passes just as well when the predicate is broken.
    expect(SQL_COLUMN.test('"tenant_id" uuid NOT NULL')).toBe(true);
    expect(SQL_COLUMN.test('ALTER TABLE "sales" ADD COLUMN "tenant_id" uuid;')).toBe(true);
    expect(TS_IDENTIFIER.test('tenantId: uuid("tenant_id").notNull()')).toBe(true);
    expect(TS_IDENTIFIER.test("function f(cfg: { tenantId: TenantId }) {}")).toBe(true);
  });

  it("catches a prefixed or plural spelling — the patterns are not anchored at the front", () => {
    expect(TS_IDENTIFIER.test("sourceTenantId: string;")).toBe(true);
    expect(TS_IDENTIFIER.test("readonly tenantIds: string[];")).toBe(true);
    expect(TS_IDENTIFIER.test("tenantID: string;")).toBe(true);
    expect(SQL_COLUMN.test('"source_tenant_id" uuid')).toBe(true);
    expect(SQL_COLUMN.test("tenant_ids uuid[]")).toBe(true);
  });

  it("catches a tenant column written as raw SQL inside TypeScript", () => {
    // Only `SQL_COLUMN` fires here, so testing the identifier alone would read straight past it.
    const raw = 'await tx.execute(sql`alter table "products" add column "tenant_id" uuid`);';
    expect(TS_IDENTIFIER.test(raw)).toBe(false);
    expect(SQL_COLUMN.test(raw)).toBe(true);
  });

  it("leaves the taxpayer identity's own names alone — the patterns are not too wide", () => {
    // The word boundary keeps these out; matching them would force an allowlist.
    expect(TS_IDENTIFIER.test("export interface TenantIdentity { country: string }")).toBe(false);
    expect(TS_IDENTIFIER.test("await readTenantIdentities(db)")).toBe(false);
    expect(SQL_COLUMN.test("select country, tax_id from tenants")).toBe(false);
    expect(SQL_COLUMN.test("insert into tenants (country, tax_id) values ($1, $2)")).toBe(false);
  });
});
