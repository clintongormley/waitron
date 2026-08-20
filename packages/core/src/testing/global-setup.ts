import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/core real-Postgres tier and migrates
 * the single `core_identity` template its suites clone (~26ms each) instead of booting and migrating a
 * container per file. See the plan at `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly the same pair — CORE
 * then IDENTITY. `packages/core` owns no module tables of its own, but its privileged write paths
 * (`recordCorrection`, `recordSubstitution`) call `authorize`, which reads identity's
 * `sessions`/`persons`, and identity's tables carry a foreign key onto core's `tenants`/`tills`, so
 * core must migrate first and the identity schema must be present. That ordering is the runtime's
 * responsibility and nothing enforces it across packages, so it is explicit here; the now-removed
 * per-file `startRealPostgres` ran the same pair. Suites clone it with
 * `useTemplateDb({ template: "core_identity" })`. apps/server and packages/identity also name a
 * template `core_identity` (CORE + IDENTITY) in their own globalSetups — that is not a collision: each
 * handle is provided/injected within its own package's run, so the key is scoped to this package.
 *
 * NO `roles` here, unlike the RLS-probe packages (payments-stripe, identity, db). Those create a
 * non-superuser LOGIN role per suite and connect AS it (`pg.connectAs`); core's three real-PG suites
 * instead reach the non-superuser path with `asAppUser(tx)`, which `SET ROLE`s the admin connection to
 * the `app_user` GROUP role that CORE's `0001_tenancy_rls.sql` already creates inside the template. A
 * superuser that has `SET ROLE`d to non-superuser `app_user` is itself subject to FORCE ROW LEVEL
 * SECURITY — the very thing the cross-tenant `not_found` assertions verify — so no additional cluster
 * LOGIN role has to be created. `settle-sale.test.ts`'s two-backend settlement race opens its extra
 * backends with `pg.connect()` (superuser connections to the clone) and applies `asAppUser` inside
 * each, so it needs no probe role either.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/core suite (its PGlite-only and hermetic files included) with it, not only the real-PG
 * suites — a real broadening of what needs Docker, the same one db and apps/server accepted. What
 * makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: `record-correction.rls` and
 * `record-substitution.rls` prove that a cross-tenant original/ticket lookup carrying NO tenant
 * predicate is hidden by FORCE ROW LEVEL SECURITY alone — which a PGlite superuser would defeat by
 * returning the row and turning `not_found` into a wrong answer — and `settle-sale.test.ts` needs both
 * that FORCE-RLS `not_found` path and a settlement race across two distinct backends, neither of which
 * PGlite (one superuser backend, every query serialised) can stage. CLAUDE.md §4 documents that this
 * repo's real-Postgres test tier needs a local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`);
 * `dockerRequired` turns the raw testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/core's real-Postgres suites require a running Docker daemon. They cannot be skipped: " +
      "PGlite's superuser bypasses FORCE ROW LEVEL SECURITY (so the cross-tenant not_found paths in " +
      "record-correction.rls / record-substitution.rls / settle-sale prove nothing) and it serialises " +
      "every query onto one backend (so settle-sale's settlement race is a false pass) — see " +
      "settle-sale.test.ts and the design's §7.",
    templates: {
      core_identity: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
