import { join } from "node:path";
import { getTableName, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPgliteDb, locations, runMigrations, tenants, tills, withTenant } from "./index.js";

const FOLDER_A = join(import.meta.dirname, "..", "test", "migrations-a");

/**
 * A coherence check on the package root, not a duplicate of the per-module
 * unit tests. `client.test.ts` and `migrate.test.ts` already exercise the
 * behaviour in depth; this file only proves that `./index.js` re-exports the
 * right things — that a consumer importing from the package root, rather
 * than reaching into `./client.js`/`./migrate.js` directly, gets a surface
 * that actually works end to end.
 */
describe("package public surface (./index.js)", () => {
  it("creates a database and runs migrations via the package root", async () => {
    const db = await createPgliteDb();
    expect(db.driver).toBe("pglite");

    await runMigrations(db, {
      migrationsFolder: FOLDER_A,
      migrationsTable: "__drizzle_migrations_root_probe",
    });
    const result = await db.execute(sql`select count(*)::int as n from probe_a`);
    expect((result.rows[0] as { n: number }).n).toBe(0);

    await db.close();
  });

  // `tenancy.test.ts` imports its subjects from the deep paths
  // (`./schema/tenants.js`, `./tenancy.js`), never from `./index.js`, so it
  // cannot catch a re-export deleted from the root. The brief lists
  // `withTenant` and the three tables (`tenants`, `locations`, `tills`) under
  // "Produces" — this is the one test that pins them as part of the actual
  // package surface a consumer imports.
  it("re-exports withTenant and the tenancy tables from the package root", () => {
    expect(withTenant).toBeTypeOf("function");
    expect(getTableName(tenants)).toBe("tenants");
    expect(getTableName(locations)).toBe("locations");
    expect(getTableName(tills)).toBe("tills");
  });
});
