import type { GlobalSetupContext } from "vitest/node";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/fiscal-verifactu real-Postgres tier
 * and migrates the single `manifest` template its suites clone (~26ms each) instead of booting
 * and migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template — the FULL migration manifest (`migrationOptionsFor(manifestSets(), null)`), the same
 * path @waitron/sync's globalSetup uses. It used to migrate just the CORE + FISCAL pair, but SP-3a
 * gave fiscal a capture migration (`0014_fiscal_sync_capture.sql`) that installs `sync_capture()`
 * triggers on fiscal's own tables — and `sync_capture()` is defined by @waitron/sync's
 * `0000_sync_outbox.sql`. So the fiscal set no longer migrates standalone: sync (and therefore its
 * own prerequisites, identity + payments) must exist first. Rather than hand-list that dependency
 * chain here — a cross-package list that goes stale the moment the graph changes (CLAUDE.md §2) —
 * the template migrates the whole manifest, which orders fiscal last (the topo resolver / manifest
 * put sync before fiscal), exactly as production does. Suites clone it with
 * `useTemplateDb({ template: "manifest" })`. `inmutabilidad.test.ts` is not in this tier —
 * it is PGlite-only (`usePgliteDb`) and migrates its own set — but it still runs under this
 * globalSetup (see the Docker paragraph below).
 *
 * `drain_probe` is the only cluster role any suite here creates: a non-superuser LOGIN inheriting
 * `app_user`'s grants, used by drain.concurrency.test.ts to run a whole drain — including
 * `tenantsWithWork`'s enumeration, which is outside any transaction and so cannot be covered by
 * `asAppUser` — as the deployment role rather than the owner. It is declared here rather than per
 * file because roles are CLUSTER-global: a shared container is one cluster and every suite clones
 * its own DATABASE from the template but shares that cluster's roles, and `probeRoleStatement` emits
 * a bare `create role …`, so a second file naming the same role would fail `role … already exists`.
 * `app_user` exists by the time the roles run because CORE's `0001_tenancy_rls.sql` creates it and
 * roles run AFTER the templates migrate.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/fiscal-verifactu suite (its PGlite-only `inmutabilidad.test.ts` and hermetic files
 * included) with it, not only the real-PG suites — a real broadening of what needs Docker, the same
 * one db and apps/server accepted. What makes it acceptable is not an assumption that every machine
 * has Docker, but that this package's reason to be in the real-PG tier at all — its chain/SIF
 * concurrency suites, its e2e write paths and the privilege matrix — needs Docker regardless: they
 * reach it through `useTemplateDb` and cannot run under PGlite, which serialises every query onto
 * one backend (so a contention test is a false pass) and whose every connection is a superuser
 * holding every grant (so a privilege check is one too). CLAUDE.md §4 documents that this repo's
 * real-Postgres test tier needs a local Docker daemon (plus TESTCONTAINERS_RYUK_DISABLED);
 * `dockerRequired` turns the raw testcontainers daemon error into guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/fiscal-verifactu's real-Postgres suites require a running Docker daemon. They cannot " +
      "be skipped: PGlite serialises every query onto one backend, so it cannot exercise the " +
      "chain/SIF lock contention the concurrency suites prove (see " +
      "chain.pglite-cannot-test-contention.test.ts), and its every connection is a superuser holding " +
      "every grant, so it cannot answer the privilege matrix privileges.test.ts pins.",
    templates: {
      manifest: (uri) => runMigrationSets(uri, migrationOptionsFor(manifestSets(), null)),
    },
    roles: [
      // A non-superuser LOGIN role holding exactly `app_user`'s grants, so a suite can drive a query
      // as the deployment role rather than as the owner. (Docblock above: why it is declared here
      // and not per file.)
      { name: "drain_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
