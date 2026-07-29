import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startMigratedPostgres, type RealPostgres } from "@waitron/db/testing/postgres.js";

// Re-exported rather than re-implemented: `boot.test.ts` needs the connection STRING (to hand a
// spawned process its `DATABASE_URL`), not just a live `Database`.
export { roleUrl } from "@waitron/db/testing/postgres.js";
export type { RealPostgres };

/**
 * Starts a real PostgreSQL server and migrates it through this host's OWN production path —
 * `applyMigrations` over `migrationOptionsFor(manifestSets(), null)`, advisory lock and manifest
 * included — rather than by running descriptor sets directly. That is the point: this package's
 * capstone suite exercises the composition the shipped artefact uses, so a manifest that drifts
 * from the packages' own migration folders fails here rather than at a customer's first boot.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "apps/server's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite runs every connection as a superuser, so it cannot show whether this " +
      "host works as the non-superuser deployment role.",
    // `applyMigrations` opens and closes its own connection from `uri` — see its doc comment in
    // `@waitron/migrations`'s `apply.ts` — so there is no separate migrator `Database` to open or
    // close here.
    migrate: (uri) => applyMigrations(uri, migrationOptionsFor(manifestSets(), null)),
  });
}
