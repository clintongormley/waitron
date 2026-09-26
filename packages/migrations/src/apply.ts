import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openVenueDatabase, removeChangeFeed, runMigrations, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { installAppendOnlyTriggers } from "@waitron/store";
import type { VenueMigrationOptions } from "./manifest.js";
import { appliedSchemaVersion } from "./schema-version.js";
import "./errors.js";

/**
 * The file two migrating processes queue on, beside the two database files it protects.
 *
 * SQLite's own locking serialises the writes and is not enough: drizzle reads the journal to decide
 * what is pending OUTSIDE the transaction it then writes in, so a second migrator can plan from a
 * journal the first is about to change and replay what the first applied. Measured in #489.
 *
 * A SQLite `begin immediate` rather than an exclusively-created lock file, because closing the
 * connection or killing the holder releases it; a lock file would survive a crash and wedge every
 * later boot.
 */
const LOCK_FILE = "migrations.lock";

/**
 * How long a second migrator waits before SQLite refuses it with `database is locked`: a bound on
 * the longest migration a box can run, not a preference. The full manifest has not been timed.
 */
const LOCK_WAIT_MS = 120_000;

/**
 * Applies every set in order to the venue file under `directory`.
 *
 * Every set goes to the VENUE file, and `node.db` stays empty
 * (`docs/superpowers/specs/2026-09-23-sqlite-slice2-stream-and-cold-restore-design.md` §2).
 *
 * It also installs the append-only triggers, set by set, from each set's `appendOnlyTables`, so no
 * caller that migrates through here can forget them. A caller that hands over no
 * `appendOnlyTables` gets a migrated database with no triggers on it.
 *
 * It removes the change feed first and does not put it back, because a migration cannot drop a
 * column the feed's update trigger names; `installChangeFeed` in
 * `apps/server/src/boot.ts` installs it again.
 */
export async function applyMigrations(
  directory: string,
  options: readonly VenueMigrationOptions[],
): Promise<void> {
  // Before the venue file is opened, not after: the store's open takes `venue.lock`, which refuses a
  // second process at once instead of making it wait.
  await mkdir(directory, { recursive: true });
  const lock = new DatabaseSync(join(directory, LOCK_FILE));
  try {
    // The timeout is set FIRST, because a statement issued before it has none and fails at once.
    lock.exec(`pragma busy_timeout = ${LOCK_WAIT_MS}`);
    lock.exec("begin immediate");
    await migrateEverySet(directory, options);
  } finally {
    // No commit: nothing was written, and closing releases the lock.
    lock.close();
  }
}

async function migrateEverySet(
  directory: string,
  options: readonly VenueMigrationOptions[],
): Promise<void> {
  const store = await openVenueDatabase(directory);
  try {
    removeChangeFeed(store.venue);
    // Sets apply in the order the caller passes. Boot derives it from each module's declared
    // `requires` (`orderedMigrationSets`, which refuses a missing dependency or a cycle). Core must
    // come before media, whose triggers are on core's `products`.
    for (const set of options) {
      await runMigrations(store.venue, set);
      await assertSetApplied(store.venue, set);
      // Inside the loop, not once at the end, so a set already migrated is protected even when a
      // LATER set aborts the run.
      installAppendOnlyTriggers(store.venue, set.appendOnlyTables ?? []);
    }
  } finally {
    await store.close();
  }
}

/**
 * Refuses a set that reported success with fewer migrations applied than its folder ships.
 *
 * Drizzle decides what to apply from `max(created_at)` alone, so a migration whose `when` sits below
 * a value the database already recorded is skipped, and nothing is raised.
 *
 * `applied < expected`, not `!==`: a journal holding MORE rows than this image ships is a database
 * migrated by a NEWER image, a different fault with its own code (`provisioning.database_ahead`).
 *
 * `expected` is read from `set.migrationsFolder` exactly as drizzle's migrator reads it, not through
 * `expectedSchemaVersion`, which would resolve a relative folder against the parent of this
 * module's directory rather than the working directory drizzle uses.
 */
async function assertSetApplied(
  db: Pick<Database, "execute">,
  set: VenueMigrationOptions,
): Promise<void> {
  // `MigrationOptions` carries no set NAME, only a folder and a table, so the table names the set
  // here and in the thrown params.
  const migrationSet = {
    name: set.migrationsTable,
    table: set.migrationsTable,
    from: set.migrationsFolder,
  };
  const applied = await appliedSchemaVersion(db, migrationSet);
  const journal = JSON.parse(
    readFileSync(join(set.migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  const expected = journal.entries.length;
  if (applied < expected) {
    throw new AppError("migrations.incomplete", {
      set: set.migrationsTable,
      applied,
      expected,
    });
  }
}
