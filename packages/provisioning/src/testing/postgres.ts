import {
  startMigratedPostgres,
  startPostgresContainer,
  type RealPostgres,
  type StartedContainer,
} from "@waitron/db/testing/postgres.js";

export type { RealPostgres, StartedContainer };
export { roleUrl } from "@waitron/db/testing/postgres.js";

const DOCKER_REQUIRED =
  "The provisioning suite requires a running Docker daemon. It cannot be skipped: `instance` " +
  "creates databases and roles and reads pg_roles attributes, none of which PGlite's bundled " +
  "single-superuser server can reproduce at all.";

/**
 * A container with NOTHING applied — no migrations, no roles beyond the container's own default
 * superuser. `instance` is the thing under test and it is what migrates; a pre-migrated container
 * would test the re-run path only and never the empty-database one, which is the case
 * `apps/server/README.md` admits is hand-verified rather than tested.
 */
export async function startBarePostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({ dockerRequired: DOCKER_REQUIRED, migrate: async () => {} });
}

export { startPostgresContainer };
