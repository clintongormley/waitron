// A real SQLite venue directory: what is under test is what the engine keeps after drizzle's
// migrator is refused part-way through a migration, which a mocked handle cannot show.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { isAppError, sqliteFailureOf } from "@waitron/shared";
import { applyMigrations } from "./apply.js";

const TABLE = "__drizzle_migrations_probe";
const OTHER_TABLE = "__drizzle_migrations_other";
const scratch: string[] = [];

const BREAK = "\n--> statement-breakpoint\n";

/** The shape of the 2026-09-26 incident: a first statement that succeeds, then one the engine refuses. */
const REFUSED_SECOND_STATEMENT = [
  "ALTER TABLE `probe_items` ADD `setup_port` integer;",
  "ALTER TABLE `absent_table` DROP COLUMN `has_cash_drawer`;",
].join(BREAK);

const FIRST = "CREATE TABLE `probe_items` (`id` integer PRIMARY KEY NOT NULL);";

/** A migrations folder whose entries are the given SQL texts, in order. */
function folderOf(migrations: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-apply-failed-"));
  scratch.push(dir);
  mkdirSync(join(dir, "meta"));
  const entries = migrations.map((text, idx) => {
    const tag = `000${idx}_probe`;
    writeFileSync(join(dir, `${tag}.sql`), text);
    return { idx, version: "6", when: 1_000_000_000_000 + idx, tag, breakpoints: true };
  });
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }, null, 2),
  );
  return dir;
}

function freshVenue(): string {
  const dir = mkdtempSync(join(tmpdir(), "wt-venue-"));
  scratch.push(dir);
  return dir;
}

async function onVenue<T>(directory: string, read: (venue: Venue) => T): Promise<T> {
  const store = await openVenueDatabase(directory);
  try {
    return read(store.venue);
  } finally {
    await store.close();
  }
}
type Venue = Awaited<ReturnType<typeof openVenueDatabase>>["venue"];

const columnsOf = (venue: Venue, table: string) =>
  venue
    .all<{ name: string }>(sql.raw(`select name from pragma_table_info('${table}')`))
    .map((row) => row.name);

const tablesOf = (venue: Venue) =>
  venue
    .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
    .map((row) => row.name);

const journalRows = (venue: Venue, table: string) =>
  venue.all<{ n: number }>(sql.raw(`select cast(count(*) as int) as n from "${table}"`))[0]!.n;

async function refusal(run: () => Promise<void>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("the migration was not refused — this case is measuring nothing");
}

describe("applyMigrations when the engine refuses a migration", () => {
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it("throws migrations.apply_failed naming the set, with the engine's failure kept as its cause", async () => {
    const venue = freshVenue();
    const folder = folderOf([FIRST, REFUSED_SECOND_STATEMENT]);

    const error = await refusal(() =>
      applyMigrations(venue, [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    );

    expect(isAppError(error) && error.code).toBe("migrations.apply_failed");
    expect(isAppError(error) && error.params).toEqual({ set: TABLE });
    // The engine's own words stay reachable, for the installer and for the dev-mode hint.
    expect(sqliteFailureOf(error)?.message).toMatch(/no such table: absent_table/);
  });

  // The receipt for "the step that failed was undone" in the recovery page's text.
  it("leaves the refused migration's earlier statements unapplied", async () => {
    const venue = freshVenue();
    await applyMigrations(venue, [{ migrationsFolder: folderOf([FIRST]), migrationsTable: TABLE }]);
    const upgrade = folderOf([FIRST, REFUSED_SECOND_STATEMENT]);

    await refusal(() =>
      applyMigrations(venue, [{ migrationsFolder: upgrade, migrationsTable: TABLE }]),
    );

    await onVenue(venue, (db) => {
      expect(columnsOf(db, "probe_items")).toEqual(["id"]);
      expect(journalRows(db, TABLE)).toBe(1);
    });
  });

  it("undoes every migration the set applied in the same run, not only the refused one", async () => {
    const venue = freshVenue();

    await refusal(() =>
      applyMigrations(venue, [
        { migrationsFolder: folderOf([FIRST, REFUSED_SECOND_STATEMENT]), migrationsTable: TABLE },
      ]),
    );

    await onVenue(venue, (db) => expect(tablesOf(db)).not.toContain("probe_items"));
  });

  // Why the page must not say the whole update was undone.
  it("keeps an earlier set that applied in the same run", async () => {
    const venue = freshVenue();

    await refusal(() =>
      applyMigrations(venue, [
        { migrationsFolder: folderOf([FIRST]), migrationsTable: OTHER_TABLE },
        {
          migrationsFolder: folderOf(["ALTER TABLE `absent_table` ADD `x` integer;"]),
          migrationsTable: TABLE,
        },
      ]),
    );

    await onVenue(venue, (db) => {
      expect(tablesOf(db)).toContain("probe_items");
      expect(journalRows(db, OTHER_TABLE)).toBe(1);
    });
  });

  it("applies a corrected migration on the next run", async () => {
    const venue = freshVenue();
    await applyMigrations(venue, [{ migrationsFolder: folderOf([FIRST]), migrationsTable: TABLE }]);
    await refusal(() =>
      applyMigrations(venue, [
        { migrationsFolder: folderOf([FIRST, REFUSED_SECOND_STATEMENT]), migrationsTable: TABLE },
      ]),
    );

    const corrected = folderOf([FIRST, "ALTER TABLE `probe_items` ADD `setup_port` integer;"]);
    await applyMigrations(venue, [{ migrationsFolder: corrected, migrationsTable: TABLE }]);

    await onVenue(venue, (db) => {
      expect(columnsOf(db, "probe_items")).toEqual(["id", "setup_port"]);
      expect(journalRows(db, TABLE)).toBe(2);
    });
  });

  // Not the engine refusing a statement, so not this code: drizzle cannot find a file the journal names.
  it("passes on a failure that did not come from the engine untouched", async () => {
    const folder = folderOf([FIRST]);
    rmSync(join(folder, "0000_probe.sql"));

    const error = await refusal(() =>
      applyMigrations(freshVenue(), [{ migrationsFolder: folder, migrationsTable: TABLE }]),
    );

    expect(isAppError(error)).toBe(false);
    expect(sqliteFailureOf(error)).toBeNull();
  });
});
