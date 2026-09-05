import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "../migrations.js";
import { runMigrationSets } from "./postgres.js";
import { startSharedContainer } from "./shared-container.js";

/**
 * Boots ONE shared PostgreSQL container for the whole `@waitron/db` real-Postgres tier and migrates
 * a single `core` template (`CORE_MIGRATIONS`) that every real-PG suite here clones (~26ms) instead
 * of booting and migrating its own container. Before this, `describeEachTarget` booted a container
 * per suite (16 files) and migrated CORE per test, and the 12 `useRealPostgres` suites each booted
 * and migrated their own container — the bulk of this shard's ~357s on CI. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because `CORE_MIGRATIONS` is the only migration set in this package and every real-PG
 * suite migrates exactly it (`describeEachTarget`'s `migrated()` and each `useRealPostgres` `migrate`
 * both run `[CORE_MIGRATIONS]`).
 *
 * No cluster `roles` are declared. The three provisioner LOGIN roles that lived here existed for the
 * `tenant_provisioner` and `nodes.public_key` suites, both retired with the RLS suites; a suite that
 * needs a non-superuser LOGIN again declares it in `roles` here (never per-file — a per-file
 * `create role` collides on the second file against a shared cluster).
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * A Docker-absent run dies HERE, which makes the WHOLE package require Docker like apps/server — not
 * only the real-PG suites but the PGlite-only and hermetic files too (a filtered `pnpm --filter
 * @waitron/db test tenancy` no longer degrades to a PGlite run). That is a real broadening, accepted
 * because every dev machine and CI runner has Docker (CLAUDE.md §4) and this package's container
 * suites reach Docker through `useTemplateDb` and fail without it regardless (they had no `runIf`
 * gate before this either). It supersedes `describeEachTarget`'s local degrade-to-PGlite
 * (`resolveTargets`' warn path), which now survives only for its own unit tests: `resolveTargets` is
 * unchanged and still exercised as a pure function (its warn and fatal branches included); the
 * globalSetup just gates the run on Docker one step earlier, with the same friendly message.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/db's real-Postgres suites require a running Docker daemon. They cannot be skipped: " +
      "the real-Postgres target is the only one that can observe lock contention and a trigger " +
      "firing against a role that holds the privilege, so a run without it proves neither.",
    templates: {
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
