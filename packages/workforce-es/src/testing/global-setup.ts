import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS } from "../migrations.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/workforce-es real-Postgres tier and
 * migrates the single `core_identity_workforce_es` template its suites clone (~26ms each) instead of booting
 * and migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, `core_identity_workforce_es` — the FULL CORE → IDENTITY → WORKFORCE → WORKFORCE_ES stack, in
 * that order. workforce-es's `convenio_config` builds on the workforce schema, which builds on
 * identity, which builds on core, so all four sets are migrated, core first (that ordering is the
 * runtime's responsibility and nothing enforces it across packages, so it is explicit here). Worth
 * noting: `convenio_config`'s own foreign keys reach ONLY core (`tenants`/`locations`), and the sole
 * real-PG suite seeds only a tenant and a location — never a workforce or identity row — so the
 * IDENTITY and WORKFORCE sets are present not because that suite's rows need them but because the
 * workforce-es PACKAGE depends on `@waitron/workforce` (this and `convenio.ts` import from it) and
 * workforce's own FKs target identity's `persons`; the template therefore migrates workforce-es's full
 * package stack, exactly as the now-removed per-file `startRealPostgres` did. The suite clones it with
 * `useTemplateDb({ template: "core_identity_workforce_es" })`.
 *
 * ONE role, `convenio_es_rls_probe`, created ONCE here idempotently in place of the per-file
 * `probeRole` that `convenio-config.rls.test.ts` passed to `useRealPostgres`. That suite connects AS
 * it (`pg.connectAs`); being non-superuser is what makes FORCE ROW LEVEL SECURITY apply to it, which
 * is the whole point of the suite. Roles are CLUSTER-global — a shared container is one cluster, and
 * every suite clones its own DATABASE from the template but shares that cluster's roles. It inherits
 * `app_user`'s grants via `inRole`; `app_user` exists by the time it runs because CORE's
 * `0001_tenancy_rls.sql` creates it and `startSharedContainer` runs `roles` AFTER the templates
 * migrate.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/workforce-es suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suite — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: `convenio-config.rls.test.ts` needs
 * a non-superuser role, which PGlite cannot provide (its every connection is a superuser and bypasses
 * FORCE ROW LEVEL SECURITY, the very tenant-isolation policy and SELECT/INSERT/UPDATE grants on
 * `convenio_config` it verifies). CLAUDE.md §4 documents that this repo's real-Postgres test tier
 * needs a local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw
 * testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/workforce-es's real-Postgres suite requires a running Docker daemon. It cannot be " +
      "skipped: PGlite runs every connection as a superuser, which bypasses FORCE ROW LEVEL " +
      "SECURITY and cannot prove tenant isolation or the app role's exact privilege set on " +
      "convenio_config (see convenio-config.rls.test.ts).",
    templates: {
      core_identity_workforce_es: (uri) =>
        runMigrationSets(uri, [
          CORE_MIGRATIONS,
          IDENTITY_MIGRATIONS,
          WORKFORCE_MIGRATIONS,
          WORKFORCE_ES_MIGRATIONS,
        ]),
    },
    roles: [
      // A non-superuser LOGIN role inheriting app_user's grants — being non-superuser is what makes
      // FORCE ROW LEVEL SECURITY apply to it, which is the whole point of convenio-config.rls.test.ts.
      { name: "convenio_es_rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
