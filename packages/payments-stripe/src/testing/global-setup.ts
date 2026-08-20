import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/payments-stripe real-Postgres tier and
 * migrates the single `core_payments` template its suites clone (~26ms each) instead of booting and
 * migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly the same pair — CORE
 * then PAYMENTS (this package stores through `@waitron/payments`'s tables; it ships no schema of its
 * own). That ordering (core first, since payments' schema builds on it) is the runtime's
 * responsibility and nothing enforces it across packages, so it is explicit here; the now-removed
 * per-file `startRealPostgres` ran the same pair. Suites clone it with
 * `useTemplateDb({ template: "core_payments" })`. The `@waitron/payments` package also names a
 * template `core_payments` (CORE + PAYMENTS) in its own globalSetup — that is not a collision: each
 * handle is provided/injected within its own package's run, so the key is scoped to this package.
 *
 * The four RLS probe roles are the only cluster roles any suite here creates, one per RLS suite
 * (`rls_probe_device` for device.rls, `rls_probe_hosted` for hosted.rls, `rls_probe_reconcile` for
 * reconcile.rls, `rls_probe` for stripe.rls). They are created ONCE here, idempotently, in place of
 * the per-file `probeRole` those four suites passed to `useRealPostgres`. Roles are CLUSTER-global: a
 * shared container is one cluster, and every suite clones its own DATABASE from the template but
 * shares that cluster's roles, so all four coexist. That is why the names have to be distinct: a
 * per-file `CREATE ROLE` is non-idempotent (`probeRoleStatement` emits a bare `create role …`), so
 * the moment two files created a role of the same name against the shared cluster the second would
 * fail `role … already exists` — and `useTemplateDb` offers no per-file `probeRole` at all. The four
 * suites already used distinct names (reconcile.rls.test.ts's own comment picked its unique name for
 * grep-ability), so those names are now literally load-bearing. Each inherits `app_user`'s grants via
 * `inRole`; `app_user` exists by the time the roles run because CORE's `0001_tenancy_rls.sql` creates
 * it and `startSharedContainer` runs `roles` AFTER the templates migrate.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/payments-stripe suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suites — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: its four RLS suites need a
 * non-superuser role, which PGlite cannot provide (its every connection is a superuser and bypasses
 * FORCE ROW LEVEL SECURITY, the very grants and tenant-isolation policies they verify). They reach
 * Docker through `useTemplateDb` and cannot run under PGlite. CLAUDE.md §4 documents that this repo's
 * real-Postgres test tier needs a local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`);
 * `dockerRequired` turns the raw testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/payments-stripe's real-Postgres suites require a running Docker daemon. They cannot " +
      "be skipped: PGlite's superuser bypasses row-level security, so it cannot exercise the grants " +
      "and tenant-isolation policies the RLS suites exist to verify (see stripe.rls.test.ts).",
    templates: {
      core_payments: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS]),
    },
    roles: [
      // Non-superuser LOGIN roles — being non-superuser is what makes FORCE ROW LEVEL SECURITY apply
      // to them, which is the whole point of the RLS suites they drive. (Which role serves which
      // suite, and why the names must be distinct, is in the docblock above.)
      { name: "rls_probe_device", password: "probe", inRole: "app_user" },
      { name: "rls_probe_hosted", password: "probe", inRole: "app_user" },
      { name: "rls_probe_reconcile", password: "probe", inRole: "app_user" },
      { name: "rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
