import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/purchasing real-Postgres tier and
 * migrates the single `core` template its suites clone (~26ms each) instead of booting and migrating
 * a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because the one real-PG suite here migrates exactly one set — CORE.
 * `@waitron/purchasing` owns no migrations of its own: the `purchase_invoices`/`purchase_invoice_vat`
 * tables and their FORCE-RLS/policy/grant lines live in `CORE_MIGRATIONS` (0041/0042), so
 * `CORE_MIGRATIONS` is the whole set and no cross-package ordering has to be stated; the now-removed
 * per-file `startRealPostgres` ran that same single set. `core` is the established key for a CORE-only
 * template — packages/db, apps/server and reporting all name theirs `core`. The one suite clones it
 * with `useTemplateDb({ template: "core" })`.
 *
 * ONE role, `rls_probe`, created ONCE here idempotently in place of the per-file `probeRole` that
 * `purchase-invoices.rls.test.ts` passed to `useRealPostgres`. That suite connects AS it
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
 * @waitron/purchasing suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suite — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: `purchase-invoices.rls.test.ts`
 * needs a non-superuser role, which PGlite cannot provide (its every connection is a superuser and
 * bypasses FORCE ROW LEVEL SECURITY, the very tenant-isolation policies and SELECT/INSERT/UPDATE/DELETE
 * grants on the purchase-invoice tables it verifies). CLAUDE.md §4 documents that this repo's
 * real-Postgres test tier needs a local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`);
 * `dockerRequired` turns the raw testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/purchasing's real-Postgres suite requires a running Docker daemon. It cannot be " +
      "skipped: PGlite's superuser bypasses row-level security, so it cannot exercise the " +
      "tenant-isolation policies or the SELECT/INSERT/UPDATE/DELETE grants on the purchase-invoice " +
      "tables (see purchase-invoices.rls.test.ts).",
    templates: {
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    },
    roles: [
      // A non-superuser LOGIN role inheriting app_user's grants — being non-superuser is what makes
      // FORCE ROW LEVEL SECURITY apply to it, which is the whole point of purchase-invoices.rls.test.ts.
      { name: "rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
