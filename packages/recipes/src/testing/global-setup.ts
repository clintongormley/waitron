import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/recipes real-Postgres tier and
 * migrates the single `core` template its suites clone (~26ms each) instead of booting and migrating
 * a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly one set — CORE.
 * `@waitron/recipes` owns no migrations of its own: the `ingredients`/`recipe_lines` tables and their
 * FORCE-RLS/grant lines live in `CORE_MIGRATIONS` (`0039_recipes_rls.sql`), so `CORE_MIGRATIONS` is
 * the whole set and no cross-package ordering has to be stated; the now-removed per-file
 * `startRealPostgres` ran that same single set. `core` is the established key for a CORE-only template
 * — packages/db, apps/server and reporting all name theirs `core`. Suites clone it with
 * `useTemplateDb({ template: "core" })`.
 *
 * ONE role, `rls_probe`, created ONCE here idempotently in place of the per-file `probeRole` both RLS
 * suites passed to `useRealPostgres`. Both `ingredients.rls.test.ts` and `recipe-lines.rls.test.ts`
 * connect AS this SAME role (`pg.connectAs`) — it is one non-superuser LOGIN subject shared by both,
 * not one per suite. Under the old per-file model each file booted its OWN container, so the shared
 * name lived in two separate clusters and never met; now the two suites share ONE cluster (a shared
 * container is one cluster, even though each clones its own DATABASE from the template), so the single
 * central role here is exactly what lets both use it without a collision — and `useTemplateDb` offers
 * no per-file `probeRole` in any case. It inherits `app_user`'s grants via `inRole`; `app_user` exists
 * by the time it runs because CORE's `0001_tenancy_rls.sql` creates it and `startSharedContainer` runs
 * `roles` AFTER the templates migrate.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/recipes suite (its PGlite-only and hermetic files included) with it, not only the real-PG
 * suites — a real broadening of what needs Docker, the same one db and apps/server accepted. What
 * makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: its two RLS suites need a
 * non-superuser role, which PGlite cannot provide (its every connection is a superuser and bypasses
 * FORCE ROW LEVEL SECURITY, the very tenant-isolation policies and per-privilege grants —
 * SELECT/INSERT/UPDATE on `ingredients` with NO DELETE, and DELETE additionally on `recipe_lines` —
 * that these suites exist to verify). CLAUDE.md §4 documents that this repo's real-Postgres test tier
 * needs a local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw
 * testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/recipes's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite's superuser bypasses row-level security, so it cannot exercise the " +
      "tenant-isolation policies and the SELECT/INSERT/UPDATE (no DELETE) grants on the ingredient " +
      "tables (see ingredients.rls.test.ts).",
    templates: {
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    },
    roles: [
      // ONE non-superuser LOGIN role inheriting app_user's grants, SHARED by both RLS suites
      // (ingredients.rls and recipe-lines.rls each connect as it). Being non-superuser is what makes
      // FORCE ROW LEVEL SECURITY apply to it, which is the whole point of those suites.
      { name: "rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
