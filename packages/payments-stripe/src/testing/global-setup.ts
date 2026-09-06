import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/payments-stripe real-Postgres tier and
 * migrates the single `core_payments` template its suites clone (~26ms each) instead of booting and
 * migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly the same pair — CORE
 * then PAYMENTS (this package stores through `@waitron/payments`'s tables; it ships no schema of its
 * own). That ordering (core first, since payments' schema builds on it) is the runtime's
 * responsibility and nothing enforces it across packages, so it is explicit here; the now-removed
 * per-file `startRealPostgres` ran the same pair. Suites clone it with
 * `useTemplateDb({ template: "core_payments" })`. The `@waitron/payments` package also names a
 * template `core_payments` (CORE + PAYMENTS) in its own globalSetup — that is not a collision: each
 * handle is provided/injected within its own package's run, so the key is scoped to this package.
 *
 * THREE probe roles are the only cluster roles any suite here creates, one per real-PG suite
 * (`rls_probe_device` for device.test.ts, `rls_probe_hosted` for hosted.test.ts, `rls_probe` for
 * stripe.test.ts). They are created ONCE here, idempotently, in place of the per-file `probeRole`
 * those suites passed to `useRealPostgres`. Roles are CLUSTER-global: a
 * shared container is one cluster, and every suite clones its own DATABASE from the template but
 * shares that cluster's roles, so all three coexist. That is why the names have to be distinct: a
 * per-file `CREATE ROLE` is non-idempotent (`probeRoleStatement` emits a bare `create role …`), so
 * the moment two files created a role of the same name against the shared cluster the second would
 * fail `role … already exists` — and `useTemplateDb` offers no per-file `probeRole` at all. Each
 * inherits `app_user`'s grants via
 * `inRole`; `app_user` exists by the time the roles run because CORE's `0001_tenancy_rls.sql` creates
 * it and `startSharedContainer` runs `roles` AFTER the templates migrate. (A fourth,
 * `rls_probe_reconcile`, went with the reconcile suite it served — the sweep's behaviour is
 * @waitron/payments-stripe's own `reconciler.test.ts` and its grants are the privilege matrix's.)
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/payments-stripe suite (its PGlite-only and hermetic files included) with it, not only the
 * real-PG suites — a real broadening of what needs Docker, the same one db and apps/server accepted.
 * What makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: its three adapter suites drive
 * `collect`/`forward`/`refund`/`initiate` through a non-superuser member of `app_user`, which PGlite
 * cannot provide — its every connection is a superuser holding every grant, so a missing GRANT on
 * `payments` is invisible there. They reach Docker through `useTemplateDb` and cannot run under
 * PGlite. Whether that still warrants a container once there are no policies left is the per-suite
 * target review's question
 * (docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §4). CLAUDE.md
 * §4 documents that this repo's
 * real-Postgres test tier needs a local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`);
 * `dockerRequired` turns the raw testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/payments-stripe's real-Postgres suites require a running Docker daemon. They cannot " +
      "be skipped: PGlite connects as a superuser holding every grant, so it cannot show that the " +
      "adapters' writes land as an app_user member (see stripe.test.ts).",
    templates: {
      core_payments: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS]),
    },
    roles: [
      // Non-superuser LOGIN roles inheriting app_user's grants — what the adapter suites connect as.
      // (Which role serves which suite, and why the names must be distinct, is in the docblock.)
      { name: "rls_probe_device", password: "probe", inRole: "app_user" },
      { name: "rls_probe_hosted", password: "probe", inRole: "app_user" },
      { name: "rls_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
