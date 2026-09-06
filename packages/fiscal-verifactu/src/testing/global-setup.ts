import type { GlobalSetupContext } from "vitest/node";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * Migrate the whole manifest once: fiscal capture triggers depend on sync_capture().
 * Suites clone the template per file. The shared LOGIN fixture inherits app_user and lets
 * drain.concurrency.test.ts exercise enumeration outside a transaction using the app grants.
 * Roles are cluster-wide, so setup creates the fixture once after core creates app_user.
 * Docker is required before any worker starts; returning teardown stops the container.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/fiscal-verifactu's real-Postgres suites require a running Docker daemon. They cannot " +
      "be skipped: PGlite serialises every query onto one backend, so it cannot exercise the " +
      "chain/SIF lock contention the concurrency suites prove (see " +
      "chain.pglite-cannot-test-contention.test.ts), and its every connection is a superuser holding " +
      "every grant, so it cannot answer the privilege matrix privileges.test.ts pins.",
    templates: {
      manifest: (uri) => runMigrationSets(uri, migrationOptionsFor(manifestSets(), null)),
    },
    roles: [
      // A non-superuser LOGIN role holding exactly `app_user`'s grants, so a suite can drive a query
      // as the deployment role rather than as the owner. (Docblock above: why it is declared here
      // and not per file.)
      { name: "drain_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
