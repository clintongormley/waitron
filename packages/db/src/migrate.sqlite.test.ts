import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { openVenueDatabase, type Database, type VenueDatabase } from "./client.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { runMigrations } from "./migrate.js";
import { captureError, pgErrorMessage } from "./testing/errors.js";

/**
 * `runMigrations` against a real file, through Drizzle's own migrator rather than the layered
 * probe that step 13 used — the probe reads each set's SQL and executes the statements itself, so
 * it cannot show that the journal, the folder layout and the migrator agree.
 *
 * **This is the migrator's only suite.** `migrate.test.ts` beside it drove the two PostgreSQL
 * migrators and was deleted with them; the cases below that name a probe folder came from it. This
 * file was the survivor because the fixture the converted cases need — a fresh directory per case,
 * closed afterwards — was already here.
 *
 * **One case was deleted rather than converted:** "applies a migration folder via the node-postgres
 * driver", the whole of the old file's Testcontainers block. It existed because `runMigrations`
 * chose between two migrators on a driver tag, so one engine proved nothing about the other. There
 * is one engine and one migrator (`migrate.ts:37`), and no tag to dispatch on. Nothing is lost that
 * a second target could still have shown.
 */
const FOLDER_A = join(import.meta.dirname, "..", "test", "migrations-a");
const FOLDER_B = join(import.meta.dirname, "..", "test", "migrations-b");
const TABLE_A = "__drizzle_migrations_a";
const TABLE_B = "__drizzle_migrations_b";

const opened: VenueDatabase[] = [];
const directories: string[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

/**
 * Its OWN empty database, never `useVenueDb`. These cases migrate probe folders rather than the
 * real sets, and half of them turn on what a database does NOT contain yet.
 */
const open = async () => {
  const directory = mkdtempSync(join(tmpdir(), "waitron-migrate-"));
  directories.push(directory);
  const store = await openVenueDatabase(directory);
  opened.push(store);
  return store;
};

const tableNames = (db: Database) =>
  db
    .all<{ name: string }>(sql`select name from sqlite_master where type = 'table' order by name`)
    .map((row) => row.name);

/** Rows in one package's journal table. `count(*)` without a cast: SQLite has no `::`. */
const countIn = (db: Database, table: string) =>
  db.all<{ n: number }>(sql`select count(*) as n from ${sql.identifier(table)}`)[0]?.n;

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

/**
 * The same migrator against the two probe folders under `packages/db/test`, which exist so these
 * cases can name a folder nothing else migrates and a journal table nothing else writes.
 *
 * Their SQL needed no translating — `create table "probe_a" ("id" integer primary key not null)`
 * and folder B's `references "probe_a"("id")` are accepted verbatim by SQLite, measured by running
 * these cases. The `dialect` field in each `meta/_journal.json` was corrected to `sqlite` for the
 * reader's sake only: `readMigrationFiles` reads `journal.entries` and nothing else
 * (`drizzle-orm/migrator.js:12`), so the field reaches no code either way.
 */
describe("runMigrations against a probe folder", () => {
  it("applies a migration folder", async () => {
    const { venue } = await open();
    await runMigrations(venue, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    expect(venue.all<{ n: number }>(sql`select count(*) as n from probe_a`)).toEqual([{ n: 0 }]);
  });

  it("records the applied migration in the journal table it was given", async () => {
    const { venue } = await open();
    await runMigrations(venue, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    expect(countIn(venue, TABLE_A)).toBe(1);
  });

  it("does not create drizzle's default journal table", async () => {
    // If the migrationsTable option were dropped, drizzle silently falls back to
    // __drizzle_migrations — and everything still passes, right up until a second package migrates
    // into the same history.
    const { venue } = await open();
    await runMigrations(venue, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    expect(
      venue.all(
        sql`select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'`,
      ),
    ).toEqual([]);
  });

  it("is idempotent — a second run adds no journal row", async () => {
    // The core-set case above compares the TABLE LIST, which a re-applied migration would not
    // change; this one counts the journal, which is where a second application would show.
    const { venue } = await open();
    await runMigrations(venue, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    await runMigrations(venue, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    expect(countIn(venue, TABLE_A)).toBe(1);
  });

  it("keeps two packages' journals independent", async () => {
    const { venue } = await open();
    await runMigrations(venue, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    await runMigrations(venue, { migrationsFolder: FOLDER_B, migrationsTable: TABLE_B });
    // One row each, not two in one table: each package can replay its own history without the
    // other's rows in it.
    expect(countIn(venue, TABLE_A)).toBe(1);
    expect(countIn(venue, TABLE_B)).toBe(1);
  });

  it("emits a cross-package foreign key that actually holds", async () => {
    const { venue } = await open();
    await runMigrations(venue, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    await runMigrations(venue, { migrationsFolder: FOLDER_B, migrationsTable: TABLE_B });

    // Refused by the key rather than by anything else: `probe_a` exists here and holds no row 99.
    // The control is the line after it — the same insert, once row 99 exists, is accepted.
    const refusal = await captureError(async () =>
      venue.run(sql`insert into probe_b (id, a_id) values (1, 99)`),
    );
    expect(pgErrorMessage(refusal)).toBe("FOREIGN KEY constraint failed");
    venue.run(sql`insert into probe_a (id) values (99)`);
    venue.run(sql`insert into probe_b (id, a_id) values (1, 99)`);
  });

  it("migrates a module folder before the core folder, and the refusal lands at the first write", async () => {
    // WHAT CHANGED. This case replaces "fails loudly when a module folder is migrated before the
    // core folder", whose assertion was that migrating folder B alone REJECTS, with a message
    // matching /probe_a/ — green against PGlite and real PostgreSQL until this branch, which is the
    // only receipt here for what the other engine did. It does not hold on SQLite: measured by
    // running folder B alone on this tree, `runMigrations` throws NOTHING and leaves `probe_b` in
    // `sqlite_master`, because SQLite resolves a foreign key when a row is written rather than when
    // the table is created.
    //
    // WHAT IS LOST, and nothing now checks it: migration ORDER is no longer caught at migrate time.
    // A database migrated module-before-core comes up with tables that look right. Ordering was
    // never `runMigrations`' promise — `migrate.ts`'s own docstring says so — so what has gone is a
    // backstop the engine supplied, not a guarantee this package made.
    //
    // WHAT REPLACES IT is where the refusal actually lands. Both inserts below were measured: a
    // write naming a parent row and a write whose foreign key is NULL are refused alike while
    // `probe_a` is missing, with the same message. The null one is an assertion rather than a
    // footnote because it is the one that shows the refusal is about the missing TABLE — a refusal
    // about the missing ROW could not fire for a null key.
    const { venue } = await open();
    await runMigrations(venue, { migrationsFolder: FOLDER_B, migrationsTable: TABLE_B });
    expect(tableNames(venue)).toContain("probe_b");

    for (const statement of [
      sql`insert into probe_b (id, a_id) values (1, 99)`,
      sql`insert into probe_b (id, a_id) values (2, null)`,
    ]) {
      const refusal = await captureError(async () => venue.run(statement));
      expect(pgErrorMessage(refusal)).toBe("no such table: main.probe_a");
    }
  });
});
