import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTableName, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  locations,
  openVenueDatabase,
  runMigrations,
  tenants,
  tills,
  withTransaction,
} from "./index.js";

const FOLDER_A = join(import.meta.dirname, "..", "test", "migrations-a");

/**
 * A coherence check on the package root, not a duplicate of the per-module unit tests.
 * `client.test.ts` and `migrate.sqlite.test.ts` already exercise the behaviour in depth; this file
 * only proves that `./index.js` re-exports the right things — that a consumer importing from the
 * package root, rather than reaching into `./client.js`/`./migrate.js` directly, gets a surface
 * that actually works end to end.
 */
const opened: { close: () => Promise<void> }[] = [];
const directories: string[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("package public surface (./index.js)", () => {
  it("opens a database and runs migrations via the package root", async () => {
    // The `driver` assertion this case used to open with is gone with the tag itself
    // (`client.ts:29-31`): there is one engine, so there is nothing for a consumer to read off a
    // handle to tell which one it got. What is left is the end-to-end claim — open, migrate, query
    // — using only names the barrel exports.
    const directory = mkdtempSync(join(tmpdir(), "waitron-db-root-"));
    directories.push(directory);
    const store = await openVenueDatabase(directory);
    opened.push(store);

    await runMigrations(store.venue, {
      migrationsFolder: FOLDER_A,
      migrationsTable: "__drizzle_migrations_root_probe",
    });
    expect(store.venue.all<{ n: number }>(sql`select count(*) as n from probe_a`)).toEqual([
      { n: 0 },
    ]);
  });

  // `tenancy.test.ts` imports its subjects from the deep paths (`./schema/tenants.js`,
  // `./tenancy.js`), never from `./index.js`, so it cannot catch a re-export deleted from the root.
  // The brief lists `withTransaction` and the three tables (`tenants`, `locations`, `tills`) under
  // "Produces" — this is the one test that pins them as part of the actual package surface a
  // consumer imports.
  it("re-exports withTransaction and the tenancy tables from the package root", () => {
    expect(withTransaction).toBeTypeOf("function");
    expect(getTableName(tenants)).toBe("tenants");
    expect(getTableName(locations)).toBe("locations");
    expect(getTableName(tills)).toBe("tills");
  });
});
