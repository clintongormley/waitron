import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { SCHEDULER_MIGRATIONS } from "../migrations.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/scheduler real-Postgres tier and
 * migrates the single `core_scheduler` template its suites clone (~26ms each) instead of booting and
 * migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly the same pair — CORE
 * then SCHEDULER. That ordering (core first, since `scheduled_runs` carries a foreign key onto core's
 * `tenants`) is the runtime's responsibility and nothing enforces it across packages, so it is
 * explicit here; the now-removed per-file `startRealPostgres` ran the same pair. Suites clone it with
 * `useTemplateDb({ template: "core_scheduler" })`.
 *
 * ONE role, `scheduler_rls_probe`, created ONCE here idempotently in place of the per-file `probeRole`
 * that `scheduler.rls.test.ts` passed to `useRealPostgres`. It is the only suite here that connects as
 * a non-superuser (`pg.connectAs`); being non-superuser is what makes FORCE ROW LEVEL SECURITY apply
 * to it, which is the whole point of that suite. Roles are CLUSTER-global — a shared container is one
 * cluster, and every suite clones its own DATABASE from the template but shares that cluster's roles —
 * so it exists for the whole run and needs creating only once. It inherits `app_user`'s grants via
 * `inRole`; `app_user` exists by the time it runs because CORE's `0001_tenancy_rls.sql` creates it and
 * `startSharedContainer` runs `roles` AFTER the templates migrate. `store.concurrency.test.ts`, the
 * other real-PG suite, opens its racing backends with plain `pg.connect()` (superuser connections to
 * the clone) and needs no probe role.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/scheduler suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suites — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: `scheduler.rls.test.ts` needs a
 * non-superuser role for which FORCE ROW LEVEL SECURITY is not bypassed (PGlite's every connection is
 * a superuser, so it cannot exercise the tenant-isolation policy or the per-privilege grants runDue
 * relies on), and `store.concurrency.test.ts` needs two claim-racing writers on distinct backends,
 * which PGlite — serialising every query onto one backend — cannot stage (a false pass, not a weak
 * one). CLAUDE.md §4 documents that this repo's real-Postgres test tier needs a local Docker daemon
 * (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw testcontainers daemon error
 * into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/scheduler's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite runs every connection as a superuser, which bypasses FORCE ROW LEVEL " +
      "SECURITY (so scheduler.rls.test.ts cannot exercise the tenant-isolation policy or grants it " +
      "verifies) and serialises every query onto one backend (so store.concurrency.test.ts's claim " +
      "races are a false pass) — CLAUDE.md §4.",
    templates: {
      core_scheduler: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, SCHEDULER_MIGRATIONS]),
    },
    roles: [
      // A non-superuser LOGIN role inheriting app_user's grants — being non-superuser is what makes
      // FORCE ROW LEVEL SECURITY apply to it, which is the whole point of scheduler.rls.test.ts.
      { name: "scheduler_rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
