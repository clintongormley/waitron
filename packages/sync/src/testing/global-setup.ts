import type { GlobalSetupContext } from "vitest/node";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * Boots one shared PostgreSQL container and migrates the whole manifest with runMigrationSets.
 * Suites clone the `manifest` template once per file and manage each case's fixture state.
 *
 * Roles are cluster-wide, so the LOGIN fixtures are created once after migration. Each inherits
 * app_user: app_login captures, sync_reader and tailer_login read, sync_applier applies rows and
 * cursors, and sync_pruner prunes. Creating the same role in each suite would collide.
 *
 * PostgreSQL exercises these paths as non-superuser callers; PGlite's superuser connections cannot
 * check the caller's table grants. Docker is required even for a unit-only selection because this
 * setup precedes the workers. Returning teardown stops the container when the run finishes.
 * See docs/superpowers/plans/2026-08-19-shared-test-container.md.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/sync's real-Postgres suites require Docker to exercise capture, read, apply and " +
      "retention through non-superuser callers and their table grants.",
    templates: {
      manifest: (uri) => runMigrationSets(uri, migrationOptionsFor(manifestSets(), null)),
    },
    roles: [
      { name: "app_login", password: "app_pw", inRole: "app_user" },
      { name: "sync_reader", password: "rp", inRole: "app_user" },
      { name: "sync_applier", password: "ap", inRole: "app_user" },
      { name: "sync_pruner", password: "pp", inRole: "app_user" },
      { name: "tailer_login", password: "tp", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
