import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * Boots ONE shared PostgreSQL container for the whole apps/server real-Postgres tier and migrates
 * the templates its suites clone (~26ms each) instead of booting and migrating a container per file.
 * See the plan at `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * Three templates, matching the three migration paths this package's suites use:
 *  - `manifest` — the FULL manifest through this host's OWN production path, the same
 *    `applyMigrations(uri, migrationOptionsFor(manifestSets(), null))` that `testing/postgres.ts`'s
 *    `startRealPostgres` runs. Cloned by the api / boot / sync suites (`useTemplateDb({ template:
 *    "manifest" })`).
 *  - `core` — CORE only, via the bare `runMigrationSets` those suites used directly. Cloned by
 *    `clear-table-status.rls.test.ts`.
 *  - `core_identity` — CORE + IDENTITY. Cloned by `service-statuses.rls.test.ts`.
 *
 * The cluster roles are created ONCE here, idempotently, in place of the per-file `probeRole` /
 * `setup` role creation the converted suites used — a shared container is one cluster, so a role
 * created per file would collide on the second file (the plan's "role collisions are the crux").
 * `rls_probe` serves both `till-api` and `till-sale-integrated` (they shared the name). `sync_applier`
 * needs membership in BOTH `app_user` and `sync_tailer`, expressed as an `inRole` array. `sync_tailer`
 * itself is created by the sync migration inside the `manifest` template, and roles run after the
 * templates migrate, so it is present when `sync_reader`/`sync_applier` are created.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the whole
 * apps/server suite (hermetic files included) with it — so `dockerRequired` carries the same
 * message `testing/postgres.ts` used, turning a raw testcontainers daemon error into guidance.
 * PGlite is not a fallback: it runs every connection as a superuser and cannot show the
 * non-superuser deployment role these suites exist to exercise.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "apps/server's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite runs every connection as a superuser, so it cannot show whether this " +
      "host works as the non-superuser deployment role.",
    templates: {
      manifest: (uri) => applyMigrations(uri, migrationOptionsFor(manifestSets(), null)),
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
      core_identity: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS]),
    },
    roles: [
      // The per-file roles the converted suites created before the shared container: the probe roles
      // for pass / webhook / till-api + till-sale-integrated (which share `rls_probe`), plus boot's
      // two (`server_boot_probe` via its `probeRole`, `server_boot_runtime_probe` via a raw `create
      // role` in its own `beforeAll`). Each inherits `app_user`'s grants.
      { name: "server_pass_probe", password: "probe", inRole: "app_user" },
      { name: "rls_probe", password: "probe", inRole: "app_user" },
      { name: "server_webhook_probe", password: "probe", inRole: "app_user" },
      { name: "server_boot_probe", password: "probe", inRole: "app_user" },
      { name: "server_boot_runtime_probe", password: "probe", inRole: "app_user" },
      // The sync suites' roles. `app_login` writes through `app_user`; `sync_reader` reads through
      // `sync_tailer`; `sync_applier` writes as `app_user` AND reads as `sync_tailer`, so it carries
      // both memberships via the inRole array.
      { name: "app_login", password: "app_pw", inRole: "app_user" },
      { name: "sync_reader", password: "rp", inRole: "sync_tailer" },
      { name: "sync_applier", password: "ap", inRole: ["app_user", "sync_tailer"] },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
