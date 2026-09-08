import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * Migrate the two templates the real-Postgres suites clone once, per file:
 *
 *  - `manifest` = the whole manifest in order: the schema, verb-CAS, privilege, routes and
 *    migration-split (has-bookings) suites. Bookings FKs into `core`, so the fixtures apply the full
 *    chain (core … bookings), exactly as `@waitron/fiscal-verifactu` does.
 *  - `core` = [core] alone: the migration-split proof that core carries no `bookings` relation.
 *
 * Docker is required before any worker starts; the real-PG suites cannot degrade to a skip (PGlite is
 * a superuser holding every grant and serialises onto one backend, so it answers neither the privilege
 * matrix nor the two-backend CAS race). Returning `teardown` stops the container.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/bookings's real-Postgres suites require a running Docker daemon: PGlite connects as a " +
      "superuser (so it cannot answer the app_user privilege matrix) and serialises every query onto " +
      "one backend (so it cannot stage the seat CAS race).",
    templates: {
      manifest: (uri) => runMigrationSets(uri, migrationOptionsFor(manifestSets(), null)),
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
