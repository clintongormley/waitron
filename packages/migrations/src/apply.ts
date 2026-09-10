import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { createPostgresDb, runMigrations, type Database, type MigrationOptions } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { appliedSchemaVersion } from "./schema-version.js";
import "./errors.js";

/**
 * A fixed key, not `hashtext` of a string: an advisory lock is only a lock if every host computes
 * the same number, and a hash function's stability across Postgres versions is not something to
 * lean on for that.
 */
const MIGRATION_LOCK_KEY = 8_474_103;

/**
 * Applies every set in order, serialised across processes.
 *
 * The lock is held on a DEDICATED `pg.Client`, separate from the connection the migrations
 * themselves run over: `pg_advisory_lock` is session-scoped, and a pool may hand two statements to
 * two different backends — which would take the lock on one connection and release it on another,
 * locking nothing and leaking a lock. `pg_advisory_xact_lock` is not available either, because
 * Drizzle's migrator opens its own transactions and cannot run inside ours.
 *
 * `connectionString` is whatever the caller passes — for `apps/server`, that's
 * `config.migrationsDatabaseUrl` (`apps/server/src/config.ts`), not necessarily the pool the rest of
 * the host runs its duties over: a deployment may run migrations under a privileged role while
 * `DATABASE_URL` stays the least-privileged one spec §10 requires, and those can be two different
 * roles entirely. That is why this function opens and closes its OWN `Database` here
 * rather than accepting the caller's long-lived pool as a parameter — migrating over a caller-
 * supplied pool opened from a DIFFERENT connection string would migrate under the wrong role
 * whenever the two happen to differ, silently correct only when they happen to be equal. Both the
 * lock and the migration work run over the SAME connection string, which is the one property that
 * actually matters: the lock's session-scoping exists to serialise whoever is about to run the
 * migrations, not whoever happens to hold the long-lived pool.
 */
export async function applyMigrations(
  connectionString: string,
  options: readonly MigrationOptions[],
): Promise<void> {
  const lock = new Client({ connectionString });
  await lock.connect();
  try {
    await lock.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      const migrationDb = await createPostgresDb(connectionString);
      try {
        // Ordering is the runtime's responsibility and nothing enforces it — core carries `tenants`,
        // which every other set has a foreign key to. The manifest states that order out loud.
        for (const set of options) {
          await runMigrations(migrationDb, set);
          await assertSetApplied(migrationDb, set);
        }
      } finally {
        await migrationDb.close();
      }
    } finally {
      await lock.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await lock.end();
  }
}

/**
 * Refuses a set that reported success with fewer migrations applied than its folder ships.
 *
 * Drizzle decides what to apply from `max(created_at)` alone — never a journal index
 * (`drizzle-orm@0.45.2/pg-core/dialect.js:56-62`) — so a migration whose `when` sits below a value
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
  set: MigrationOptions,
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
