import {
  CORE_MIGRATIONS,
  captureError,
  createPgliteDb,
  pgErrorCode,
  pgErrorMessage,
  runMigrations,
} from "@waitron/db";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FISCAL_MIGRATIONS } from "./migrations.js";

/** A fresh in-memory PGlite with nothing in it at all. */
async function emptyDb() {
  return createPgliteDb();
}

async function tableNames(db: Awaited<ReturnType<typeof emptyDb>>): Promise<string[]> {
  const rows = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
  );
  return rows.rows.map((r) => r.table_name);
}

/**
 * Unqualified, not `"drizzle".<table>` — `runMigrations` (packages/db/src/migrate.ts) hardcodes
 * `migrationsSchema: "public"` rather than accepting drizzle's own default of the `drizzle`
 * schema, matching what `drizzle.config.ts` fixes for this project's generated migrations. Both
 * journal tables therefore live in `public`, on the default search_path, exactly like
 * `packages/db/src/migrate.test.ts`'s own `countIn` helper reads them.
 */
async function journalCount(db: Awaited<ReturnType<typeof emptyDb>>, table: string) {
  const rows = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return rows.rows[0]?.n ?? 0;
}

describe("migration composition across packages", () => {
  it("applies core then fiscal against an empty database", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    const names = await tableNames(db);
    // Core's tables and the module's tables coexist in one schema, created by two independent
    // migration sets that know nothing of each other.
    expect(names).toContain("sales");
    expect(names).toContain("tills");
    expect(names).toContain("registros_facturacion");
    expect(names).toContain("cadenas");
    expect(names).toContain("registro_sif");
    expect(names).toContain("envios");
    await db.close();
  });

  it("keeps the two journals separate", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    // Two tables, both non-empty. One shared journal would make each package's next `generate`
    // read the other's entries as unknown and re-apply its own set from zero.
    expect(await journalCount(db, CORE_MIGRATIONS.migrationsTable)).toBeGreaterThan(0);
    expect(await journalCount(db, FISCAL_MIGRATIONS.migrationsTable)).toBeGreaterThan(0);
    expect(CORE_MIGRATIONS.migrationsTable).not.toBe(FISCAL_MIGRATIONS.migrationsTable);
    expect(CORE_MIGRATIONS.migrationsFolder).not.toBe(FISCAL_MIGRATIONS.migrationsFolder);
    await db.close();
  });

  it("is idempotent — running both sets twice is a no-op", async () => {
    const db = await emptyDb();
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    const before = [
      await journalCount(db, CORE_MIGRATIONS.migrationsTable),
      await journalCount(db, FISCAL_MIGRATIONS.migrationsTable),
      (await tableNames(db)).length,
    ];

    // No throw, and nothing applied a second time. The custom SQL in 0001 uses no IF NOT EXISTS
    // guards for the trigger/policy objects, so a re-application would raise 42710
    // (duplicate_object) rather than pass quietly — which is the reason this test asserts on a
    // fresh run rather than on the counts alone.
    await runMigrations(db, CORE_MIGRATIONS);
    await runMigrations(db, FISCAL_MIGRATIONS);

    expect([
      await journalCount(db, CORE_MIGRATIONS.migrationsTable),
      await journalCount(db, FISCAL_MIGRATIONS.migrationsTable),
      (await tableNames(db)).length,
    ]).toEqual(before);
    await db.close();
  });

  it("fails when fiscal runs before core", async () => {
    // THIS is what makes the first test mean anything. Ordering is the runtime's responsibility —
    // Drizzle enforces nothing — so a smoke test that would also pass with the sets applied in
    // the wrong order tests nothing at all. The failure is real: `cadenas` (the first table in
    // fiscal's 0000 snapshot, alphabetically) declares a foreign key onto `tenants`, a table
    // `packages/db` creates — so applying the fiscal folder first fails on a missing relation
    // before a single fiscal table finishes being created.
    //
    // `.rejects.toThrow(...)` does NOT work here: drizzle wraps the driver error in
    // `DrizzleQueryError`, whose OWN `.message` is `Failed query: <sql>\nparams: ...` — not the
    // real Postgres text. Verified live: asserting on `.rejects.toThrow(/relation .* does not
    // exist/i)` failed with the wrapper's generic message, not the underlying one. `pgErrorCode`/
    // `pgErrorMessage` unwrap `.cause` to reach the real driver error, exactly the pattern
    // packages/db/src/immutability.test.ts already uses for the same reason.
    const db = await emptyDb();
    const error = await captureError(() => runMigrations(db, FISCAL_MIGRATIONS));
    expect(pgErrorCode(error)).toBe("42P01"); // undefined_table
    expect(pgErrorMessage(error)).toMatch(/relation .* does not exist/i);

    // And the database is not half-built afterwards.
    expect(await tableNames(db)).not.toContain("registros_facturacion");
    await db.close();
  });
});
