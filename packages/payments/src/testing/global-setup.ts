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
 * The three RLS probe roles are the only cluster roles any suite here creates, one per RLS suite
 * (`rls_probe` for payments.rls, `rls_probe_policy` for payment-policy.rls, `reconcile_rls_probe`
 * for reconcile.rls). They are created ONCE here, idempotently, in place of the per-file `probeRole`
 * those three suites passed to `useRealPostgres`. Roles are CLUSTER-global: a shared container is one
 * cluster and every suite clones its own DATABASE from a template but shares that cluster's roles, so
 * all three now coexist. That is why the names have to be distinct — and they already were, because a
 * per-file `CREATE ROLE` is non-idempotent (`probeRoleStatement` emits a bare `create role …`), so
 * the moment two files created a role of the same name against a shared cluster the second would fail
 * `role … already exists`; the suites hand-picked distinct names for exactly this reason (see
 * payment-policy.rls.test.ts's own comment), and `useTemplateDb` offers no per-file `probeRole` at
 * all. Each inherits `app_user`'s grants via `inRole`; `app_user` exists by the time the roles run
 * because CORE's `0001_tenancy_rls.sql` creates it and roles run AFTER the templates migrate.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/payments suite (its PGlite-only and hermetic files included) with it, not only the real-PG
 * suites — a real broadening of what needs Docker, the same one db and apps/server accepted. What
 * makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all — its RLS and concurrency suites — needs Docker regardless:
 * they reach it through `useTemplateDb` and cannot run under PGlite, whose superuser bypasses the
 * row-level security they exist to verify. CLAUDE.md §4 documents that this repo's real-Postgres test
 * tier needs a local Docker daemon (plus TESTCONTAINERS_RYUK_DISABLED); `dockerRequired` turns the raw
 * testcontainers daemon error into guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/payments's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite's superuser bypasses row-level security, so it cannot exercise the grants " +
      "and tenant-isolation policies the RLS suites exist to verify (see payments.rls.test.ts).",
    templates: {
      core_payments: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS]),
    },
    roles: [
      // Non-superuser LOGIN roles — being non-superuser is what makes FORCE ROW LEVEL SECURITY
      // apply to them, which is the whole point of the RLS suites they drive. (Which role serves
      // which suite, and why the names must be distinct, is in the docblock above.)
      { name: "rls_probe", password: "probe", inRole: "app_user" },
      { name: "rls_probe_policy", password: "probe", inRole: "app_user" },
      { name: "reconcile_rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
