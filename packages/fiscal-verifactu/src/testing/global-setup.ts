import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { FISCAL_MIGRATIONS } from "../migrations.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/fiscal-verifactu real-Postgres tier
 * and migrates the single `core_fiscal` template its suites clone (~26ms each) instead of booting
 * and migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly the same pair — CORE
 * then FISCAL. That ordering (core first, since the fiscal schema builds on it) is the runtime's
 * responsibility and nothing enforces it, so it is spelled out here exactly as the now-removed
 * per-file `startRealPostgres` did (and as migrations.test.ts documents). Suites clone the template
 * with `useTemplateDb({ template: "core_fiscal" })`. `inmutabilidad.test.ts` is not in this tier —
 * it is PGlite-only (`usePgliteDb`) and migrates its own set — but it still runs under this
 * globalSetup (see the Docker paragraph below).
 *
 * The four RLS probe roles are the only cluster roles any suite here creates. They are created ONCE
 * here, idempotently, in place of the per-file `probeRole` those suites passed to `useRealPostgres`.
 * Roles are CLUSTER-global: a shared container is one cluster and every suite clones its own DATABASE
 * from the template but shares that cluster's roles, so all four coexist. That is why a per-file
 * `CREATE ROLE` cannot stay — `probeRoleStatement` emits a bare `create role …`, so the moment two
 * files created a role of the same name against the shared cluster the second would fail
 * `role … already exists`. Three of the RLS suites already share ONE name, `rls_probe`
 * (rectificativa-columns / pending-count / canje-columns — the apps/server `rls_probe` pattern), so
 * it is created a single time here and those three all `pg.connectAs("rls_probe", "probe")`; the
 * other three suites each use a distinct name. Each role inherits `app_user`'s grants via `inRole`;
 * `app_user` exists by the time the roles run because CORE's `0001_tenancy_rls.sql` creates it and
 * roles run AFTER the templates migrate.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/fiscal-verifactu suite (its PGlite-only `inmutabilidad.test.ts` and hermetic files
 * included) with it, not only the real-PG suites — a real broadening of what needs Docker, the same
 * one db and apps/server accepted. What makes it acceptable is not an assumption that every machine
 * has Docker, but that this package's reason to be in the real-PG tier at all — its chain/SIF
 * concurrency suites and its RLS suites — needs Docker regardless: they reach it through
 * `useTemplateDb` and cannot run under PGlite, which serialises every query onto one backend (so a
 * contention test is a false pass) and whose superuser bypasses the row-level security the RLS suites
 * exist to verify. CLAUDE.md §4 documents that this repo's real-Postgres test tier needs a local
 * Docker daemon (plus TESTCONTAINERS_RYUK_DISABLED); `dockerRequired` turns the raw testcontainers
 * daemon error into guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/fiscal-verifactu's real-Postgres suites require a running Docker daemon. They cannot " +
      "be skipped: PGlite serialises every query onto one backend, so it cannot exercise the " +
      "chain/SIF lock contention the concurrency suites prove, and its superuser bypasses the " +
      "row-level security the RLS suites exist to verify (see chain.pglite-cannot-test-contention.test.ts).",
    templates: {
      core_fiscal: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, FISCAL_MIGRATIONS]),
    },
    roles: [
      // Non-superuser LOGIN roles — being non-superuser is what makes FORCE ROW LEVEL SECURITY
      // apply to them, which is the whole point of the RLS suites they drive. (Which role serves
      // which suite, and why `rls_probe` is created once for three suites, is in the docblock above.)
      { name: "reconcile_rls_probe", password: "probe", inRole: "app_user" },
      { name: "acks_rls_probe", password: "probe", inRole: "app_user" },
      { name: "drain_probe", password: "probe", inRole: "app_user" },
      // Shared by rectificativa-columns.rls / pending-count.rls / canje-columns.rls.
      { name: "rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
