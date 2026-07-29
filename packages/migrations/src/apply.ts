import { Client } from "pg";
import { createPostgresDb, runMigrations, type MigrationOptions } from "@waitron/db";

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
 * `connectionString` is `config.migrationsDatabaseUrl` (`config.ts`), not necessarily the pool the
 * rest of the host runs its duties over: a deployment may run migrations under a privileged role
 * while `DATABASE_URL` stays the least-privileged one spec §10 requires, and those can be two
 * different roles entirely. That is why this function opens and closes its OWN `Database` here
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
        for (const set of options) await runMigrations(migrationDb, set);
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
