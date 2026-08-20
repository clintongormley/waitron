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
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    templates: {
      manifest: (uri) => applyMigrations(uri, migrationOptionsFor(manifestSets(), null)),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
