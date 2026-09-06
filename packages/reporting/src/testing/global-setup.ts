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
 * NO `roles` here, unlike the probe-role packages (payments-stripe, identity, db). Those create a
 * non-superuser LOGIN role per suite and connect AS it (`pg.connectAs`); reporting's two real-PG
 * suites instead reach the non-superuser path with `asAppUser(tx)`, which `SET ROLE`s the admin
 * connection to the `app_user` GROUP role that CORE's `0001_tenancy_rls.sql` already creates inside
 * the template — enough for the grants those suites depend on, so no additional cluster LOGIN role
 * has to be created.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/reporting suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suites — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: `record-daily-close.pg.test.ts`
 * proves a single-writer `FOR UPDATE` lock and a concurrent `close.already_closed`, which PGlite —
 * serialising every query onto one backend — cannot stage (a false pass, not a weak one); and
 * `verify-daily-close-chain.pg.test.ts` tampers with a committed chain via a superuser-only
 * `session_replication_role = replica`, which has no PGlite analogue. (Two further real-PG suites
 * here, over `computeInputVat` and `computeVatReturn`, were pure cross-tenant isolation and went
 * with the RLS drop — the arithmetic they controlled lives in `input-vat.test.ts` and
 * `vat-return.test.ts`.) CLAUDE.md §4
 * documents that this repo's real-Postgres test tier needs a local Docker daemon (plus
 * `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw testcontainers daemon error into
 * that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/reporting's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite serialises every query onto one backend, so it cannot stage the single-writer " +
      "lock and concurrent close record-daily-close.pg.test.ts exists to prove, and it has no " +
      "analogue for the superuser-only tamper verify-daily-close-chain.pg.test.ts needs.",
    templates: {
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
