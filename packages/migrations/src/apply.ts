import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openVenueDatabase, runMigrations, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { installAppendOnlyTriggers } from "@waitron/store";
import type { VenueMigrationOptions } from "./manifest.js";
import { appliedSchemaVersion } from "./schema-version.js";
import "./errors.js";

/**
 * The file two migrating processes queue on, beside the two database files it protects.
 *
 * **Why a lock is still needed, measured rather than assumed.** Two Node processes were run
 * against one venue directory, each opening it with `openVenueDatabase` and applying the first
 * three manifest sets, released from a shared start instant. Fifteen races on a virgin directory,
 * 2026-09-21, Node v26.7.0: thirteen ended with both processes reporting success and exactly one
 * journal row per set, and two ended with one process throwing "table `locations` already exists"
 * / "table `content_languages` already exists" — errcode 1, raised inside drizzle's own migration
 * transaction. SQLite's file locking and `packages/store`'s 5s busy timeout serialise the WRITES,
 * and that is not enough: drizzle reads the journal to decide what is pending
 * (`drizzle-orm@0.45.2/sqlite-core/dialect.js:654`) OUTSIDE the transaction it then writes in, so
 * the loser plans from a snapshot the winner is about to invalidate, waits out the write lock, and
 * replays what the winner already applied. Forty races through this function WITH the lock, same
 * day, same machine: no failure and no extra journal row.
 *
 * **The lock is taken before the venue file is opened**, because two migrators collide there too:
 * in an earlier run of the same probe, which did not yet retry the open, 3 of 8 races ended with
 * one process refused `database is locked` (errcode 5) by `openVenueStore`'s
 * `pragma journal_mode = wal` — before any statement of ours had run at all.
 *
 * **Why a SQLite file rather than an exclusively-created lock file.** Measured the same day: a
 * second PROCESS is refused `begin immediate` with errcode 5 while this one holds it, and acquires
 * it once released — a waiter given a 10s busy timeout acquired 697ms into a 600ms hold. A holder
 * killed with SIGKILL releases it, and so does closing the connection with the transaction still
 * open. An `open(..., "wx")` lock file would survive the crash and wedge every later boot.
 */
const LOCK_FILE = "migrations.lock";

/**
 * How long a second migrator waits before SQLite refuses it with `database is locked`.
 *
 * `pg_advisory_lock` waited forever; a busy timeout is the nearest this engine offers, so the
 * number is a bound on the longest migration a box can run rather than a preference. Two minutes
 * against the 40ms or so three sets took against a virgin directory when the race above was
 * measured — the full manifest has not been timed, so the headroom is the point, not the ratio.
 */
const LOCK_WAIT_MS = 120_000;

/**
 * Applies every set in order to the venue file under `directory`.
 *
 * **A directory, not a connection string.** The engine is a file now, so there is no role to
 * migrate under and no second connection string to keep in step with the one the host serves
 * requests over — both of which the PostgreSQL body existed to reconcile.
 *
 * **Every set goes to the VENUE handle, and the node file stays empty**, for the reason
 * `packages/db/src/testing/venue-db.ts` states on `useVenueDb`.
 *
 * **It also installs the append-only triggers**, set by set, from each set's `appendOnlyTables`. This
 * is where they go because it is the one place that knows a set's tables now exist: boot, the cold
 * restore, `rejoin-command`, `dev-setup` and `dev-onboard` all migrate through here, so none of them
 * can forget. What a caller that hands over no `appendOnlyTables` gets is a migrated
 * database with no triggers on it, which is the hedge `VenueMigrationOptions` states.
 */
export async function applyMigrations(
  directory: string,
  options: readonly VenueMigrationOptions[],
): Promise<void> {
  // Before the venue file is opened, not after: two migrators also collide on the OPEN, where
  // `pragma journal_mode = wal` is refused `database is locked` (errcode 5).
  await mkdir(directory, { recursive: true });
  const lock = new DatabaseSync(join(directory, LOCK_FILE));
  try {
    // The timeout is set FIRST, because a statement issued before it has none and fails at once.
    lock.exec(`pragma busy_timeout = ${LOCK_WAIT_MS}`);
    lock.exec("begin immediate");
    await migrateEverySet(directory, options);
  } finally {
    // No commit: nothing was written, and closing releases the lock. Measured on Node v26.7.0 —
    // with the transaction left open, `close()` frees it for the next acquirer, and so does
    // SIGKILL of the holding process. That is the whole reason the lock is a SQLite file rather
    // than an exclusively-created lock FILE, which a crash would leave behind forever.
    lock.close();
  }
}

async function migrateEverySet(
  directory: string,
  options: readonly VenueMigrationOptions[],
): Promise<void> {
  const store = await openVenueDatabase(directory);
  try {
    // Sets apply in the order the caller passes. Boot derives it from each module's declared
    // `requires` (`orderedMigrationSets`, which refuses a missing dependency or a cycle). Core must
    // come before media, whose triggers are on core's `products`.
    for (const set of options) {
      await runMigrations(store.venue, set);
      await assertSetApplied(store.venue, set);
      // Inside the loop, immediately after this set migrated — not once at the end. A set whose
      // tables already exist is then protected even when a LATER set aborts the run. Measured on
      // this tree: core followed by a set whose journal names a file the folder does not ship (so
      // drizzle throws mid-run), `select name from sqlite_master where tbl_name='sales'` afterwards
      // reads both triggers with the call here and an empty list with it moved below the loop.
      installAppendOnlyTriggers(store.venue, set.appendOnlyTables ?? []);
    }
  } finally {
    await store.close();
  }
}

/**
 * Refuses a set that reported success with fewer migrations applied than its folder ships.
 *
 * Drizzle decides what to apply from `max(created_at)` alone — never a journal index
 * (`drizzle-orm@0.45.2/sqlite-core/dialect.js:654-660`, the same arithmetic the PostgreSQL
 * dialect carried) — so a migration whose `when` sits below a value
 * the database already recorded is skipped, and nothing is raised. Counting the journal is the only
 * way to notice; a host that boots on a half-migrated schema fails later, somewhere unrelated.
 *
 * `applied < expected`, not `!==`: a journal holding MORE rows than this image ships is a database
 * migrated by a NEWER image, which is a different fault with its own name
 * (`provisioning.database_ahead`) and its own remedy. Reporting it as "incomplete" would put a
 * misleading count in front of the one reader who cannot debug it.
 *
 * `expected` is the journal's own `entries.length`, read from `set.migrationsFolder` exactly as
 * drizzle's migrator reads it — `${migrationsFolder}/meta/_journal.json`, joined and never
 * `path.resolve`d (`drizzle-orm@0.45.2/migrator.js:6`). So the count compared here is taken from the
 * very file the migration it is checking was driven from, whatever that folder's shape.
 *
 * `expectedSchemaVersion` would be the reuse, and it is NOT wrong today: it routes the folder
 * through `resolveMigrationsFolder(set, null)` → `resolve(<pkg>, "..", from)`, and `path.resolve`
 * returns a final ABSOLUTE segment unchanged (measured), which is what `migrationOptionsFor` always
 * builds. It is declined because the agreement is incidental to two functions rather than stated by
 * either: a RELATIVE `migrationsFolder` — discouraged by `MigrationOptions`'s own doc comment, not
 * refused by it — would send drizzle to the working directory and that call to `packages/migrations`,
 * counting a DIFFERENT set's journal and reporting a confident wrong number. It would also need a
 * fabricated `MigrationSet.name`, since `MigrationOptions` carries none.
 */
async function assertSetApplied(
  db: Pick<Database, "execute">,
  set: VenueMigrationOptions,
): Promise<void> {
  // `MigrationOptions` carries no set NAME, only a folder and a table, so the table names the set
  // here and in the thrown params. It is also what `appliedSchemaVersion` validates against the
  // drizzle journal-table pattern before interpolating it as an identifier.
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
