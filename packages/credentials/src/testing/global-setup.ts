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
 * One template, because the one real-PG suite here migrates exactly the same pair — CORE then
 * CREDENTIALS. That ordering (core first, since `tenant_credentials` carries a foreign key onto core's
 * `tenants`) is the runtime's responsibility and nothing enforces it across packages, so it is
 * explicit here; the now-removed per-file `startRealPostgres` ran the same pair. The suite clones it
 * with `useTemplateDb({ template: "core_credentials" })`.
 *
 * ONE role, `credentials_rls_probe`, created ONCE here idempotently in place of the per-file
 * `probeRole` that `credentials.rls.test.ts` passed to `useRealPostgres`. That suite connects AS it
 * (`pg.connectAs`); being non-superuser is what makes FORCE ROW LEVEL SECURITY apply to it, which is
 * the whole point of the suite. Roles are CLUSTER-global — a shared container is one cluster, and every
 * suite clones its own DATABASE from the template but shares that cluster's roles. It inherits
 * `app_user`'s grants via `inRole`; `app_user` exists by the time it runs because CORE's
 * `0001_tenancy_rls.sql` creates it and `startSharedContainer` runs `roles` AFTER the templates
 * migrate.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/credentials suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suite — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: `credentials.rls.test.ts` needs a
 * non-superuser role, which PGlite cannot provide (its every connection is a superuser and bypasses
 * FORCE ROW LEVEL SECURITY — so the tenant-isolation policy, the fail-closed null-GUC read, the
 * SELECT/INSERT/UPDATE/DELETE grants on `tenant_credentials`, and the SECURITY DEFINER
 * `credential_tenants` cross-tenant seam it verifies are all a false pass under PGlite, not a weak
 * one). CLAUDE.md §4 documents that this repo's real-Postgres test tier needs a local Docker daemon
 * (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw testcontainers daemon error
 * into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/credentials's real-Postgres suite requires a running Docker daemon. It cannot be " +
      "skipped: PGlite runs every connection as a superuser, which bypasses FORCE ROW LEVEL " +
      "SECURITY and cannot exercise the tenant-isolation policy, grants, or the SECURITY DEFINER " +
      "seam this suite exists to verify (see credentials.rls.test.ts).",
    templates: {
      core_credentials: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS]),
    },
    roles: [
      // A non-superuser LOGIN role inheriting app_user's grants — being non-superuser is what makes
      // FORCE ROW LEVEL SECURITY apply to it, which is the whole point of credentials.rls.test.ts.
      { name: "credentials_rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
