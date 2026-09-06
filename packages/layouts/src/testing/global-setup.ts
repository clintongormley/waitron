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
 * reason to be in the real-PG tier at all needs Docker regardless: the four store suites
 * (`canvas-store.pg.test.ts`, `device-profile-store.pg.test.ts`, `theme-store.test.ts`,
 * `receipt-store.test.ts`) run the whole authorize→write path as a non-superuser member of
 * `app_user`, which a PGlite connection — superuser, holding every grant — cannot be; and
 * `device-profile-store.pg.test.ts` exercises the tenant-consistent composite FK
 * `device_profiles_canvas_fk`. Whether the first reason still warrants a container is the per-suite target review's
 * question (docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §4).
 * CLAUDE.md §4 documents that this repo's real-Postgres test tier needs a local Docker
 * daemon (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw testcontainers daemon
 * error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/layouts's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite runs every connection as a superuser holding every grant, so the stores' " +
      "authorize→write path as an app_user member is a false pass there (see " +
      "canvas-store.pg.test.ts and its three siblings).",
    templates: {
      core_identity: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
