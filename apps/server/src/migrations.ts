import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { createPostgresDb, runMigrations, type MigrationOptions } from "@waitron/db";
import { AppError } from "@waitron/shared";
import manifest from "../migrations.manifest.json" with { type: "json" };
import "./errors.js";

export interface MigrationSet {
  name: string;
  table: string;
  /** Source folder, relative to `apps/server` — used when running from source (tests, dev). */
  from: string;
}

/**
 * A fixed key, not `hashtext` of a string: an advisory lock is only a lock if every host computes
 * the same number, and a hash function's stability across Postgres versions is not something to
 * lean on for that.
 */
const MIGRATION_LOCK_KEY = 8_474_103;

export function manifestSets(): MigrationSet[] {
  // A fresh array of fresh objects on every call: `manifest` is the parsed JSON module's own
  // array, shared across every import of this module. Returning it directly would let one
  // caller's mutation (a test fixture doing `sets[0].table = "x"`, say) leak into every other
  // caller's view of the manifest.
  return (manifest as MigrationSet[]).map((set) => ({ ...set }));
}

/**
 * Where each set's SQL actually lives.
 *
 * `root === null` means "running from source": resolve each `from` against this package. Otherwise
 * every set lives at `<root>/<name>` — an ABSOLUTE `root` is used as-is; a RELATIVE one resolves
 * against this package's own directory (`apps/server`), the same base the from-source branch uses,
 * never the process's current working directory. `scripts/copy-migrations.mjs` always builds an
 * absolute `dist/drizzle` beside the bundle, so the relative case only matters for a caller passing
 * `WAITRON_MIGRATIONS_DIR` as a relative path — supported deliberately, not rejected, but worth
 * stating precisely: a wrong assumption here resolves silently into the wrong folder rather than
 * failing loud.
 *
 * The indirection is not taste. Every `*_MIGRATIONS` descriptor computes `migrationsFolder` from its
 * own `import.meta.url`; esbuild collapses all five modules into one file, so all five resolve to
 * `dist/../drizzle` — a folder that does not exist. Using the descriptors directly therefore works
 * in development and fails at boot in the shipped artefact, which is the worst available failure
 * mode. Only the `migrationsTable` names come from the packages, and `migrations.test.ts` pins them.
 */
export function migrationOptionsFor(
  sets: readonly MigrationSet[],
  root: string | null,
): MigrationOptions[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return sets.map((set) => {
    const migrationsFolder =
      root === null
        ? resolve(here, "..", set.from)
        : join(isAbsolute(root) ? root : resolve(here, "..", root), set.name);
    // One check collapses two distinct filesystem states into the same rejection: the folder is
    // absent, or the folder exists but carries no `meta/_journal.json` (empty, or populated with
    // something else). That collapse is deliberate — Drizzle's own migrator only rejects the
    // absent case on its own; an empty folder reads to it as "zero migrations", which would boot
    // clean against an unmigrated database and fail later, somewhere else. This check refuses both
    // up front, before Drizzle ever sees either.
    if (!existsSync(join(migrationsFolder, "meta", "_journal.json"))) {
      throw new AppError("server.migrations_missing", { name: set.name, folder: migrationsFolder });
    }
    return { migrationsFolder, migrationsTable: set.table };
  });
}

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
