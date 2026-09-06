import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/reporting real-Postgres tier and
 * migrates the single `core` template its suites clone (~26ms each) instead of booting and migrating
 * a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly one set — CORE.
 * Reporting reads and writes only core tables (`sales`, `tenders`, `daily_closes`,
 * `daily_close_chain`), so `CORE_MIGRATIONS` (which includes the frozen-daily-close ledger and its
 * chain head) is the whole set; the now-removed per-file `startRealPostgres` ran that same single
 * set. `core` is the established key for a CORE-only template — packages/db and apps/server both name
 * theirs `core`. Suites clone it with `useTemplateDb({ template: "core" })`.
 *
 * No additional LOGIN roles are needed: the suites use `asAppUser(tx)` to SET ROLE to the
 * non-owner application role created by the core baseline.
 *
 * Docker is required for `record-daily-close.pg.test.ts`: concurrent transactions contend on
 * the chain's FOR UPDATE lock and one close receives `close.already_closed`. PGlite serialises
 * queries on one backend and cannot stage that contention. The real-PG verifier suite also checks
 * a committed chain corrupted by its owner with the named immutability trigger disabled inside
 * the mutation transaction, then restored to ALWAYS.
 *
 * globalSetup runs for every package test, so Docker is required even for filtered PGlite cases.
 * Returning teardown stops the shared container when the run finishes.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/reporting's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite serialises every query onto one backend, so it cannot stage the single-writer " +
      "lock and concurrent close record-daily-close.pg.test.ts exists to prove.",
    templates: {
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
