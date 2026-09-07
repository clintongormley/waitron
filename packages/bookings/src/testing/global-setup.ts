import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { BOOKINGS_MIGRATIONS } from "../migrations.js";

/**
 * Migrate the three templates the real-Postgres suites clone once, per file:
 *
 *  - `core_bookings` = [core, bookings]: the schema, verb-CAS and privilege suites, and the
 *    migration-split proof (bookings + its four FKs exist).
 *  - `core` = [core] alone: the migration-split proof that core carries no `bookings` relation.
 *  - `manifest` = the whole manifest: the routes suite, which needs identity's `persons` /
 *    `management_sessions` for `authorizeManager` alongside core and bookings.
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
      core_bookings: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, BOOKINGS_MIGRATIONS]),
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      manifest: (uri) => runMigrationSets(uri, migrationOptionsFor(manifestSets(), null)),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
