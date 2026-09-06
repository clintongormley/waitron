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
 * NO `roles` here, unlike the probe-role packages (payments-stripe, identity, db). Those create a
 * non-superuser LOGIN role per suite and connect AS it (`pg.connectAs`); `settle-sale.test.ts`, the
 * one real-PG suite left in this package, reaches the non-superuser path with `asAppUser(tx)`, which
 * `SET ROLE`s the admin connection to the `app_user` GROUP role CORE's `0001_db_baseline_sql.sql` already
 * creates inside the template. Its two-backend settlement race opens its extra backends with
 * `pg.connect()` (superuser connections to the clone) and applies `asAppUser` inside each, so it
 * needs no probe role either.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/core suite (its PGlite-only and hermetic files included) with it, not only the real-PG
 * suites — a real broadening of what needs Docker, the same one db and apps/server accepted. What
 * makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: `settle-sale.test.ts` races a
 * settlement across two DISTINCT backends, which PGlite — one backend, every query serialised —
 * cannot stage at all, so a lock test there is a false pass. (That suite also still carries a
 * cross-tenant `sale.not_found` case; it goes when the schema does.) CLAUDE.md §4 documents that this
 * repo's real-Postgres test tier needs a local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`);
 * `dockerRequired` turns the raw testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/core's real-Postgres suite requires a running Docker daemon. It cannot be skipped: " +
      "PGlite serialises every query onto one backend, so settle-sale's settlement race across two " +
      "distinct backends is a false pass there — see settle-sale.test.ts and the design's §7.",
    templates: {
      core_identity: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
