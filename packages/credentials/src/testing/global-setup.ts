import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { CREDENTIALS_MIGRATIONS } from "../migrations.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/credentials real-Postgres tier and
 * migrates the single `core_credentials` template its suites clone (~26ms each) instead of booting and
 * migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because the one real-PG suite here migrates exactly the pair — CORE then
 * CREDENTIALS. That ordering (core first, since `tenant_credentials` carries a foreign key onto core's
 * `tenants`) is the runtime's responsibility and nothing enforces it across packages, so it is
 * explicit here; the now-removed per-file `startRealPostgres` ran the same pair. The suite clones it
 * with `useTemplateDb({ template: "core_credentials" })`.
 *
 * ONE role, `credentials_rls_probe`, created ONCE here idempotently in place of the per-file
 * `probeRole` that the suite passed to `useRealPostgres` before the shared container.
 * `credentials.test.ts` connects AS it (`pg.connectAs`) so `credential_tenants` — a SECURITY DEFINER
 * function owned by a different role — is called by a caller whose own privileges are the app's, not
 * the owner's. Roles are CLUSTER-global — a shared container is one cluster, and every
 * suite clones its own DATABASE from the template but shares that cluster's roles. It inherits
 * `app_user`'s grants via `inRole`; `app_user` exists by the time it runs because CORE's
 * `0001_tenancy_rls.sql` creates it and `startSharedContainer` runs `roles` AFTER the templates
 * migrate. (The role keeps its `_rls_` name: renaming it means touching this file and the suite for
 * a cosmetic gain, and the per-suite target review
 * (docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §4) may retire
 * it outright.)
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/credentials suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suite — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What is left on this side of the line after the RLS drop is `credentials.test.ts`'s four
 * `credentialTenants` cases, which run on the real function as a non-superuser caller. Whether they
 * still NEED a container once there are no policies to cross is the per-suite target review's
 * (docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §4)
 * question, unmeasured here. CLAUDE.md §4 documents that this repo's real-Postgres test tier needs a
 * local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw
 * testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/credentials's real-Postgres suite requires a running Docker daemon. It exercises " +
      "the SECURITY DEFINER `credential_tenants` seam through a non-superuser caller (see " +
      "credentials.test.ts and this file's header).",
    templates: {
      core_credentials: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS]),
    },
    roles: [
      // A non-superuser LOGIN role inheriting app_user's grants — the caller `credentials.test.ts`
      // reaches `credential_tenants` as.
      { name: "credentials_rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
