import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/layouts real-Postgres tier and
 * migrates the single `core_identity` template its suites clone (~26ms each) instead of booting and
 * migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite here migrates exactly the same pair — CORE then
 * IDENTITY. `@waitron/layouts` owns no migrations of its own: its tables (`canvases`, `tenant_themes`,
 * `tenant_receipts`) and their FORCE-RLS/policy/grant lines live in `CORE_MIGRATIONS`, and the stores'
 * `authorizeManager` gate reads identity's `persons`/`management_sessions`, so IDENTITY has to be
 * present too. Core migrates first (identity's schema builds on it) — that ordering is the runtime's
 * responsibility and nothing enforces it across packages, so it is explicit here. The suites clone it
 * with `useTemplateDb({ template: "core_identity" })`. apps/server, packages/identity and packages/core
 * also name a template `core_identity` (CORE + IDENTITY) in their own globalSetups — that is not a
 * collision: each handle is provided/injected within its own package's run, so the key is scoped to
 * this package.
 *
 * NO `roles` here, unlike the RLS-probe packages (credentials, workforce-es, db). Those create a
 * non-superuser LOGIN role per suite and connect AS it (`pg.connectAs`); layouts' one real-PG suite
 * instead reaches the non-superuser path with `asAppUser(tx)`, which `SET ROLE`s the admin connection
 * to the `app_user` GROUP role that CORE's `0001_tenancy_rls.sql` already creates inside the template.
 * A superuser that has `SET ROLE`d to non-superuser `app_user` is itself subject to FORCE ROW LEVEL
 * SECURITY — the very thing the cross-tenant isolation assertion verifies — so no additional cluster
 * LOGIN role has to be created.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/layouts suite (its hermetic unit files, errors/validate, included) with it, not only the
 * real-PG suite — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: `store.rls.test.ts` proves the
 * store honours the tenant-isolation policy under the app role (a cross-tenant read returns defaults,
 * never the other tenant's layout) and runs the whole authorize→upsert path as a genuine RLS subject —
 * both of which a PGlite superuser, bypassing FORCE ROW LEVEL SECURITY and the policy, would turn into
 * a false pass. CLAUDE.md §4 documents that this repo's real-Postgres test tier needs a local Docker
 * daemon (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw testcontainers daemon
 * error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/layouts's real-Postgres suite requires a running Docker daemon. It cannot be " +
      "skipped: PGlite runs every connection as a superuser, which bypasses FORCE ROW LEVEL " +
      "SECURITY and the tenant-isolation policy this suite proves the store honours under the app " +
      "role (see store.rls.test.ts).",
    templates: {
      core_identity: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
