import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { SCHEDULER_MIGRATIONS } from "../migrations.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/scheduler real-Postgres tier and
 * migrates the single `core_scheduler` template its suites clone (~26ms each) instead of booting and
 * migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly the same pair — CORE
 * then SCHEDULER. That ordering (core first, since `scheduled_runs` carries a foreign key onto core's
 * `tenants`) is the runtime's responsibility and nothing enforces it across packages, so it is
 * explicit here; the now-removed per-file `startRealPostgres` ran the same pair. `store.concurrency.test.ts`
 * clones it with `useTemplateDb({ template: "core_scheduler" })`.
 *
 * No `roles`: the `scheduler_rls_probe` login this file created existed for `scheduler.rls.test.ts`
 * alone, and that suite was retired with the RLS drop — its two isolation cases had no meaning under
 * one tenant per database, and its claim/run/complete round trip was `scheduled_runs: "SIU"` in
 * `packages/fiscal-verifactu/src/privileges.expected.ts` over behaviour `run.test.ts` already pins.
 * `store.concurrency.test.ts`, the one real-PG suite left, opens its racing backends with plain
 * `pg.connect()` (superuser connections to the clone) and needs no probe role.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/scheduler suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suites — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: `store.concurrency.test.ts` needs
 * two claim-racing writers on distinct backends, which PGlite — serialising every query onto one
 * backend — cannot stage (a false pass, not a weak one). CLAUDE.md §4 documents that this repo's real-Postgres test tier needs a local Docker daemon
 * (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw testcontainers daemon error
 * into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/scheduler's real-Postgres suite requires a running Docker daemon. It cannot be " +
      "skipped: PGlite serialises every query onto one backend, so store.concurrency.test.ts's " +
      "claim races are a false pass there — CLAUDE.md §4.",
    templates: {
      core_scheduler: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
