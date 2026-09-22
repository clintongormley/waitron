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
 * append-only.
 *
 * `appendOnlyTables` is optional because a suite may hand over a folder no module owns — the two
 * suites in this file's own test that pass `migrations: []` and build their tables in `setup` are
 * that case. What a caller omitting it gets is a database where a ledger row can be rewritten,
 * which is why the field is stated here rather than inferred from anything.
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
 * Three lists rather than one because the ORDER between them is the whole mechanism: every
 * append-only trigger is dropped, then every table is emptied, then each trigger is recreated from
 * the exact `CREATE TRIGGER` text SQLite stored for it. `RAISE(ABORT)` in a `BEFORE DELETE` trigger
 * refuses the reset's own `delete` (`1811`, measured 2026-09-21 on Node v26.7.0), and SQLite has no
 * `ALTER TABLE … DISABLE TRIGGER` to reach for instead — so drop and recreate is the only way
 * through, and losing one would let a later test mutate a ledger table (`CLAUDE.md` §5).
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
 * Reads the plan off the catalogue.
 *
 * `glob` rather than `like` for the two exclusions: GLOB treats `_` as an ordinary character where
 * LIKE treats it as a wildcard needing an `escape` clause, and a backslash written inside a
 * template literal is not the backslash that reaches SQLite. `sqlite_%` covers the engine's own
 * tables, `__drizzle_migrations*` the per-package journals — the migration state has to outlive the
 * data, and every set names its own (`packages/db/src/migrations.ts`).
 *
 * `sqlite_sequence` is `restart identity`'s only counterpart here: it holds the AUTOINCREMENT
 * counters, exists only once some table declares one, and is emptied with the rest. It is matched
 * by the `sqlite_*` exclusion, so it is added back by name.
 *
 * Table and trigger names are validated rather than escaped, the shape `CLAUDE.md` §3 asks for when
 * a statement cannot bind — SQLite binds no identifier — and the same choice `probeRoleStatement`
 * beside this file makes. A trigger's stored text is replayed verbatim, never built.
 */
function buildResetPlan(db: Database): ResetPlan {
  const tables = db.all<{ name: string }>(sql`
    select name from sqlite_master
    where type = 'table'
      and name not glob 'sqlite_*'
      and name not glob '__drizzle_migrations*'
    order by name`);
  const counters = db.all<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = 'sqlite_sequence'`,
  );
  // `sql` is never null for a trigger — it is the text SQLite needs to rebuild it — so there is no
  // filter here. A null would fail the reset loudly rather than drop a trigger quietly.
  const triggers = db.all<{ name: string; sql: string }>(
    sql`select name, sql from sqlite_master where type = 'trigger' order by name`,
  );
  return {
    drops: triggers.map((row) => `drop trigger "${assertSafeIdentifier("trigger", row.name)}"`),
    deletes: [...tables, ...counters].map(
      (row) => `delete from "${assertSafeIdentifier("table", row.name)}"`,
    ),
    creates: triggers.map((row) => row.sql),
  };
}

/**
 * Empties the data, in ONE transaction, on the handle's own write queue.
 *
 * `withWriteLock` is what opens that transaction — `packages/store/src/write-queue.ts` issues
 * `begin immediate` and `commit` around the body — so nothing here issues a `begin` of its own, and
 * the reset queues behind any write a test left in flight THROUGH THAT QUEUE. A test that wrote on
 * the handle directly, as most do, is already finished by the time `afterEach` runs.
 *
 * Two things follow from being one transaction, and neither is available outside it:
 *
 * - `pragma defer_foreign_keys = on` holds only until that transaction ends, and it is what lets
 *   the tables be emptied in NAME order. Without it, deleting a parent whose child still holds a
 *   row is refused with `FOREIGN KEY constraint failed` (errcode 787); with it, the same pair
 *   succeeds and the check runs at `commit`, by which time both sides are empty. Measured
 *   2026-09-21 on Node v26.7.0, with the pragma omitted as the control.
 * - There is no `finally` restoring the triggers, unlike the PostgreSQL reset this replaces, where
 *   each `ALTER TABLE … TRIGGER` stood alone. A failure rolls the whole reset back, and the
 *   rollback puts the dropped triggers back: measured, a `drop trigger`, a `delete` and a failing
 *   statement in one transaction, after which `sqlite_master` holds the trigger again and the next
 *   delete is refused with `1811`. A `finally` would try to CREATE a trigger that already exists.
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
 * **A real directory under `os.tmpdir()`, never `:memory:`.** What a suite gets is then the storage
 * the product gets: write-ahead mode with its `-wal` sidecar, the engine's file locking, and the
 * two files `openVenueStore` opens. An in-memory database has none of those, and a suite that
 * passed on one would say nothing about the box.
 *
 * **Opened through {@link openVenueDatabase}** rather than by calling `openVenueStore` directly, so
 * a suite's handle is the one the product's own opener hands out — the pragmas, the schema barrel
 * and the per-file write queue included. A second opener here would be a second thing to keep in
 * step with it.
 *
 * **Every migration set is applied to the VENUE handle, and the node file stays empty.** That is
 * what is true today rather than a prediction: nothing splits a set across the two files, so every
 * table a set creates belongs on the venue side. A set that later creates `local` tables would need
 * this function to learn which handle to migrate — and the node handle is deliberately not exposed
 * until something needs it.
 *
 * The accessor throws rather than returning `undefined` when read before `beforeAll` has run: that
 * is the whole point, since `undefined` turns a setup failure into `Cannot read properties of
 * undefined` two frames from the real error. The message names NO function — a function name in a
 * thrown message is a claim about the call site, and the next rename or replacement falsifies it
 * silently, which is the opposite of what a loud throw is for.
 */
export function useVenueDb(options: VenueDbOptions): VenueDb {
  let directory: string | undefined;
  let store: VenueDatabase | undefined;
  let db: Database | undefined;
  let resetPlan: ResetPlan | undefined;
  const resetPerTest = options.resetPerTest ?? true;

  // The directory and the store are each assigned the instant they exist, BEFORE migrations or
  // setup can throw. Assigning at the end of the hook instead leaves a failed suite holding two
  // open files and a directory nothing removes — a silent leak in place of the noisy error this
  // helper exists to produce. `runMigrations` failing is not hypothetical: it is what a bad
  // migration in a feature branch does.
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "waitron-venue-db-"));
    store = await openVenueDatabase(directory);
    db = store.venue;
    for (const migrations of options.migrations) {
      await runMigrations(db, migrations);
      // Inside the loop, immediately after this set migrated, for the reason
      // `packages/migrations/src/apply.ts` states: `create trigger` needs the table to exist, so a
      // single pass at the end would refuse the first set's tables if a later set threw. This is
      // what makes a suite's database refuse what the box refuses — the product installs the same
      // triggers from the same list in `applyMigrations`, which a suite does not go through.
      installAppendOnlyTriggers(db, migrations.appendOnlyTables ?? []);
    }
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
