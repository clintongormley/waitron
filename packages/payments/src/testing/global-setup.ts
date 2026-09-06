import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/payments real-Postgres tier and
 * migrates the single `core_payments` template its suites clone (~26ms each) instead of booting and
 * migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly the same pair — CORE
 * then PAYMENTS. That ordering (core first, since payments' schema builds on it) is documented in
 * migrations.test.ts; the now-removed per-file `startRealPostgres` ran the same pair. Suites clone
 * the template with `useTemplateDb({ template: "core_payments" })`.
 *
 * ONE probe role, `rls_probe`, is the only cluster role any suite here creates: `payments.test.ts`
 * connects AS it (`pg.connectAs`) so its writes go through `app_user`'s grants rather than the
 * container superuser's. It is created ONCE here, idempotently, in place of the per-file `probeRole`
 * that suite passed to `useRealPostgres`. Roles are CLUSTER-global: a shared container is one
 * cluster and every suite clones its own DATABASE from a template but shares that cluster's roles.
 * That is why per-suite names have to be distinct — a per-file `CREATE ROLE` is non-idempotent
 * (`probeRoleStatement` emits a bare `create role …`), so the moment two files created a role of the
 * same name against a shared cluster the second would fail `role … already exists`, and
 * `useTemplateDb` offers no per-file `probeRole` at all. It inherits `app_user`'s grants via
 * `inRole`; `app_user` exists by the time the roles run
 * because CORE's `0001_tenancy_rls.sql` creates it and roles run AFTER the templates migrate.
 * (`rls_probe_policy` and `reconcile_rls_probe` went with the two suites they served: those suites'
 * grant facts are the privilege matrix's now, and their behaviour is policy.test.ts / store.test.ts /
 * reconcile.test.ts.)
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/payments suite (its PGlite-only and hermetic files included) with it, not only the real-PG
 * suites — a real broadening of what needs Docker, the same one db and apps/server accepted. What
 * makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all — five concurrency suites racing two backend processes
 * against one row — needs Docker regardless: PGlite serialises every query onto one backend, so a
 * contention test there is a false pass (CLAUDE.md §4). CLAUDE.md §4 documents that this repo's real-Postgres test
 * tier needs a local Docker daemon (plus TESTCONTAINERS_RYUK_DISABLED); `dockerRequired` turns the raw
 * testcontainers daemon error into guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/payments's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite serialises every query onto one backend, so the concurrency suites' races " +
      "are false passes there (see reconcile.concurrency.test.ts).",
    templates: {
      core_payments: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS]),
    },
    roles: [
      // The non-superuser LOGIN role payments.test.ts connects as, inheriting app_user's grants.
      { name: "rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
