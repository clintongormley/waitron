import type { GlobalSetupContext } from "vitest/node";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";

/**
 * Boots ONE shared PostgreSQL container for the whole apps/server real-Postgres tier and migrates a
 * single `manifest` template through this host's OWN production path — the same
 * `applyMigrations(uri, migrationOptionsFor(manifestSets(), null))` that
 * `testing/postgres.ts`'s `startRealPostgres` runs per file. Suites converted to
 * `useTemplateDb({ template: "manifest" })` clone that template (~26ms) instead of booting and
 * migrating their own container. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the whole
 * apps/server suite (hermetic files included) with it — so `dockerRequired` carries the same
 * message `testing/postgres.ts` used, turning a raw testcontainers daemon error into guidance.
 * PGlite is not a fallback: it runs every connection as a superuser and cannot show the
 * non-superuser deployment role these suites exist to exercise.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "apps/server's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite runs every connection as a superuser, so it cannot show whether this " +
      "host works as the non-superuser deployment role.",
    templates: {
      manifest: (uri) => applyMigrations(uri, migrationOptionsFor(manifestSets(), null)),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
