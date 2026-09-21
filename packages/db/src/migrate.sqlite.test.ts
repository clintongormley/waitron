import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueDatabase } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { runMigrations } from "./migrate.js";

/**
 * `runMigrations` against a real file, through Drizzle's own migrator rather than the layered
 * probe that step 13 used — the probe reads each set's SQL and executes the statements itself, so
 * it cannot show that the journal, the folder layout and the migrator agree.
 *
 * `migrate.test.ts` beside this file still drives the two PostgreSQL migrators; converting or
 * deleting it is the storage swap's step 25 (step group 7).
 */
const opened: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
});

const open = async () => {
  const store = await openVenueDatabase(mkdtempSync(join(tmpdir(), "waitron-migrate-")));
  opened.push(store);
  return store;
};

const tableNames = (db: { all: <T>(q: ReturnType<typeof sql>) => T[] }) =>
  db
    .all<{ name: string }>(sql`select name from sqlite_master where type = 'table' order by name`)
    .map((row) => row.name);

describe("runMigrations on SQLite", () => {
  it("creates the core set's tables", async () => {
    const { venue } = await open();
    await runMigrations(venue, CORE_MIGRATIONS);
    const names = tableNames(venue);
    expect(names).toContain("tenants");
    expect(names).toContain("change_log");
    expect(names).toContain("sales");
  });

  it("records what it applied in this package's own journal table", async () => {
    const { venue } = await open();
    await runMigrations(venue, CORE_MIGRATIONS);
    expect(tableNames(venue)).toContain(CORE_MIGRATIONS.migrationsTable);
  });

  it("applies nothing the second time", async () => {
    const { venue } = await open();
    await runMigrations(venue, CORE_MIGRATIONS);
    const before = tableNames(venue);
    await runMigrations(venue, CORE_MIGRATIONS);
    expect(tableNames(venue)).toEqual(before);
  });
});
