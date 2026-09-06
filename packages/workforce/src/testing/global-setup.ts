import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "../migrations.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/workforce real-Postgres tier and
 * migrates the single `core_identity_workforce` template its suites clone (~26ms each) instead of
 * booting and migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly the same three sets, in
 * this order: CORE, then IDENTITY, then WORKFORCE. IDENTITY is a genuine dependency, not padding —
 * workforce's schema FKs target identity's `persons`, so the identity migrations must be present
 * before workforce's run. That cross-package ordering is the runtime's responsibility and nothing
 * enforces it, so it is spelled out here exactly as the now-removed per-file `startRealPostgres` did
 * (which migrated the same three sets, in the same order). Suites clone the template with
 * `useTemplateDb({ template: "core_identity_workforce" })`. The template KEY names all three sets
 * beyond nothing — CORE + IDENTITY + WORKFORCE — following the `core_<schema>` convention (#116) and
 * matching apps/server's `core_identity` shape for its larger stack.
 *
 * TWO non-superuser probe roles are the only cluster roles any suite here creates:
 * `workforce_rls_probe` for `rls.test.ts`, and `workforce_clock_probe` for the
 * `clocking.concurrency` TOCTOU suite, where being non-superuser proves the app role is PERMITTED its
 * `FOR NO KEY UPDATE` lock. They are created ONCE
 * here, idempotently, in place of the per-file `probeRole` those suites passed to `useRealPostgres`.
 * Roles are CLUSTER-global: a shared container is one cluster and every suite clones its own DATABASE
 * from the template but shares that cluster's roles, so both coexist. That is why a per-file
 * `CREATE ROLE` cannot stay — `probeRoleStatement` emits a bare `create role …`, so the moment two
 * files created a role of the same name against the shared cluster the second would fail
 * `role … already exists`. (A third, `workforce_planning_rls_probe`, went with
 * `scheduling-planning.rls.test.ts`; `scheduling.rls.test.ts` shared `workforce_rls_probe` and went
 * too — their grant facts are the privilege matrix's now.) Each role inherits `app_user`'s grants via `inRole`;
 * `app_user` exists by the time the roles run because CORE's `0001_tenancy_rls.sql` creates it and
 * roles run AFTER the templates migrate.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/workforce suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suites — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this
 * package's reason to be in the real-PG tier at all — its chain/clocking/scheduling concurrency
 * suites, `rls.test.ts` and `immutability.test.ts` — needs Docker regardless: they reach it through
 * `useTemplateDb` and cannot run under PGlite, which serialises every query onto one backend (so a
 * contention test is a false pass) and whose superuser holds every grant (so the append-only
 * privilege floor is invisible). CLAUDE.md §4
 * documents that this repo's real-Postgres test tier needs a local Docker daemon (plus
 * TESTCONTAINERS_RYUK_DISABLED); `dockerRequired` turns the raw testcontainers daemon error into
 * guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/workforce's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite serialises every query onto one backend, so it cannot exercise the lock " +
      "contention the concurrency suites prove, and its superuser holds every grant, so the " +
      "append-only privilege floor immutability.test.ts verifies is invisible there (see " +
      "chain.pglite-cannot-test-contention.test.ts).",
    templates: {
      core_identity_workforce: (uri) =>
        runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS]),
    },
    roles: [
      // Non-superuser LOGIN roles inheriting app_user's grants. Being non-superuser is the point:
      // for clocking.concurrency (workforce_clock_probe) it proves the app role is PERMITTED its row
      // lock, not merely that it serialises. (Which role serves which suite is in the docblock.)
      { name: "workforce_clock_probe", password: "probe", inRole: "app_user" },
      { name: "workforce_rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
