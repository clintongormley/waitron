import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll } from "vitest";
import { installAppendOnlyTriggers } from "@waitron/store";
import { openVenueDatabase, type Database, type VenueDatabase } from "../client.js";
import { runMigrations, type MigrationOptions } from "../migrate.js";
import { assertSafeIdentifier } from "./identifiers.js";

/** Setup budget for opening the files and applying the migration sets. */
const DEFAULT_SETUP_TIMEOUT_MS = 60_000;

/**
 * A migration set a suite hands over: what drizzle needs, plus what the set's own module declared
 * append-only. A caller omitting `appendOnlyTables` gets a database where a ledger row can be
 * rewritten.
 */
export type VenueMigrationSet = MigrationOptions & {
  readonly appendOnlyTables?: readonly string[];
};

export interface VenueDbOptions {
  /** Migration sets, applied in order. Cross-package ordering is the caller's to state. */
  migrations: VenueMigrationSet[];
  /** Extra setup once migrated — installing a fake backend, seeding a fixture. */
  setup?: (db: Database) => Promise<void>;
  /** Override when a suite's own setup is slower than the default. */
  timeoutMs?: number;
  /**
   * Empty every data table after each test so the suite is order-independent. Default `true`.
   *
   * Set `false` for a suite that seeds shared rows ONCE — in `setup` or its own `beforeAll` — and
   * reads them across several `it`s; a per-test reset would wipe that fixture out from under the
   * second test. Schema always survives; only DATA is cleared, and the append-only triggers come
   * back exactly as they were found (see {@link buildResetPlan}).
   */
  resetPerTest?: boolean;
}

export interface VenueDb {
  /** The migrated database. Throws if read before `beforeAll` has run. */
  readonly db: Database;
}

/**
 * What one reset runs, captured once because the schema is stable after `setup`.
 *
 * Three lists rather than one because the ORDER between them is the whole mechanism: EVERY trigger
 * in `sqlite_master` is dropped, then every table is emptied, then each trigger is recreated from
 * the exact `CREATE TRIGGER` text SQLite stored for it. SQLite has no
 * `ALTER TABLE … DISABLE TRIGGER` to reach for instead.
 *
 * **Every trigger, not only the append-only ones — do not narrow this query.** An append-only
 * trigger's `RAISE(ABORT)` on a `BEFORE DELETE` refuses the reset's own `delete` outright. A
 * change-feed trigger (`../change-feed.ts`) INSERTS into `change_log` on every delete, and
 * `deletes` runs in name order, so the later deletes would fill `change_log` up again after it was
 * emptied.
 */
interface ResetPlan {
  /** `drop trigger "<name>"`, one per trigger. */
  drops: readonly string[];
  /** `delete from "<table>"`, one per data table, plus the identity-counter table if it exists. */
  deletes: readonly string[];
  /** Each trigger's own statement, read back out of `sqlite_master`. */
  creates: readonly string[];
}

/**
 * Every table some migration created, in name order, the engine's own bookkeeping and the journals
 * aside — the migration state has to outlive the data.
 *
 * `glob` rather than `like` for the two exclusions: GLOB treats `_` as an ordinary character where
 * LIKE treats it as a wildcard needing an `escape` clause.
 */
export function migratedTableNames(db: Database): string[] {
  return db
    .all<{ name: string }>(
      sql`
        select name from sqlite_master
        where type = 'table'
          and name not glob 'sqlite_*'
          and name not glob '__drizzle_migrations*'
        order by name`,
    )
    .map((row) => row.name);
}

/**
 * One migration set applied, then the append-only triggers that set declared — immediately after
 * THIS set migrated, as `packages/migrations/src/apply.ts` does. This pairing is what makes a
 * suite's database refuse what the box refuses, since a suite does not go through
 * `applyMigrations`.
 */
export async function applyMigrationSet(db: Database, set: VenueMigrationSet): Promise<void> {
  await runMigrations(db, set);
  installAppendOnlyTriggers(db, set.appendOnlyTables ?? []);
}

/**
 * Reads the plan off the catalogue.
 *
 * `sqlite_sequence` holds the AUTOINCREMENT counters, exists only once some table declares one, and
 * is emptied with the rest. It is matched by the `sqlite_*` exclusion, so it is added back by name.
 *
 * Table and trigger names are validated rather than escaped, the shape `CLAUDE.md` §3 asks for when
 * a statement cannot bind. A trigger's stored text is replayed verbatim, never built.
 */
function buildResetPlan(db: Database): ResetPlan {
  const tables = migratedTableNames(db);
  const counters = db
    .all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'sqlite_sequence'`,
    )
    .map((row) => row.name);
  // `sql` is never null for a trigger — it is the text SQLite needs to rebuild it — so there is no
  // filter here. A null would fail the reset loudly rather than drop a trigger quietly.
  const triggers = db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master where type = 'trigger' order by name`,
  );
  return {
    drops: triggers.map((row) => `drop trigger "${assertSafeIdentifier("trigger", row.name)}"`),
    deletes: [...tables, ...counters].map(
      (name) => `delete from "${assertSafeIdentifier("table", name)}"`,
    ),
    creates: triggers.map((row) => row.sql),
  };
}

/**
 * Empties the data, in ONE transaction, on the handle's own write queue — `withWriteLock` issues
 * `begin immediate` and `commit` around the body, so nothing here issues a `begin` of its own.
 *
 * Two things follow from being one transaction:
 *
 * - `pragma defer_foreign_keys = on` holds only until that transaction ends, and it is what lets
 *   the tables be emptied in NAME order: the foreign-key check runs at `commit`, by which time both
 *   sides are empty.
 * - There is no `finally` restoring the triggers. A failure rolls the whole reset back, and the
 *   rollback puts the dropped triggers back; a `finally` would try to CREATE a trigger that already
 *   exists.
 */
async function applyReset(db: Database, plan: ResetPlan): Promise<void> {
  if (plan.deletes.length === 0) return;
  await db.withWriteLock(() => {
    db.run(sql`pragma defer_foreign_keys = on`);
    for (const statement of [...plan.drops, ...plan.deletes, ...plan.creates]) {
      db.run(sql.raw(statement));
    }
    return Promise.resolve();
  });
}

/**
 * One SQLite venue database for the calling suite, with the hooks that own it.
 *
 * **A real directory under `os.tmpdir()`, never `:memory:`**, opened through
 * {@link openVenueDatabase}, so a suite's handle is the one the product's own opener hands out: the
 * write-ahead mode, the file locking, the pragmas and the per-file write queue included.
 *
 * **Every migration set is applied to the VENUE handle, and the node file stays empty**, as
 * `applyMigrations` does (`packages/migrations/src/apply.ts`).
 *
 * The accessor throws rather than returning `undefined` when read before `beforeAll` has run, since
 * `undefined` turns a setup failure into `Cannot read properties of undefined` two frames from the
 * real error. The message names none of this repository's functions — a function name in a thrown
 * message is a claim about the call site, and the next rename or replacement falsifies it
 * silently, which is the opposite of what a loud throw is for.
 */
export function useVenueDb(options: VenueDbOptions): VenueDb {
  let directory: string | undefined;
  let store: VenueDatabase | undefined;
  let db: Database | undefined;
  let resetPlan: ResetPlan | undefined;
  const resetPerTest = options.resetPerTest ?? true;

  // The directory and the store are each assigned the instant they exist, BEFORE migrations or
  // setup can throw, so a failed suite's `afterAll` still closes and removes them.
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "waitron-venue-db-"));
    store = await openVenueDatabase(directory);
    db = store.venue;
    for (const migrations of options.migrations) await applyMigrationSet(db, migrations);
    if (options.setup !== undefined) await options.setup(db);
    // After setup so a fake backend's tables are in the delete set; the plan records only names and
    // trigger text, so setup's own seeded rows do not affect it.
    if (resetPerTest) resetPlan = buildResetPlan(db);
  }, options.timeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS);

  afterEach(async () => {
    if (resetPerTest && db !== undefined && resetPlan !== undefined)
      await applyReset(db, resetPlan);
  });

  // Guarded independently and in order: the files are closed before the directory holding them is
  // removed, and a suite whose `openVenueDatabase` threw still removes the directory it made.
  afterAll(async () => {
    const opened = store;
    const created = directory;
    store = undefined;
    db = undefined;
    directory = undefined;
    if (opened !== undefined) await opened.close();
    if (created !== undefined) await rm(created, { recursive: true, force: true });
  });

  return {
    get db(): Database {
      if (db === undefined) {
        throw new Error("test database not started: the accessor was read before beforeAll ran");
      }
      return db;
    },
  };
}
