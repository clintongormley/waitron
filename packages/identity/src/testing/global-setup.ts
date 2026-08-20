import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { IDENTITY_MIGRATIONS } from "../migrations.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/identity real-Postgres tier and
 * migrates the single `core_identity` template its suites clone (~26ms each) instead of booting and
 * migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite in this package migrates exactly the same pair — CORE
 * then IDENTITY. That ordering (core first, since identity's schema builds on it) matters and nothing
 * enforces it across packages, so it is explicit here; the now-removed per-file `startRealPostgres`
 * ran the same pair. Suites clone the template with `useTemplateDb({ template: "core_identity" })`.
 * apps/server also names a template `core_identity` (CORE + IDENTITY) in its own globalSetup — that is
 * not a collision: each handle is provided/injected within its own package's run, so the key is scoped
 * to this package.
 *
 * The four RLS probe roles are the only cluster roles any suite here creates, one per RLS suite
 * (`identity_webauthn_probe` for webauthn.rls, `identity_rls_probe` for persons.rls,
 * `identity_sessions_probe` for sessions.rls, `identity_mgmt_sessions_probe` for
 * management-sessions.rls). They are created ONCE here, idempotently, in place of the per-file
 * `probeRole` those four suites passed to `useRealPostgres`. Roles are CLUSTER-global: a shared
 * container is one cluster, and every suite clones its own DATABASE from a template but shares that
 * cluster's roles, so all four coexist. That is why the names have to be distinct: a per-file
 * `CREATE ROLE` is non-idempotent (`probeRoleStatement` emits a bare `create role …`), so the moment
 * two files created a role of the same name against the shared cluster the second would fail
 * `role … already exists` — and `useTemplateDb` offers no per-file `probeRole` at all. The four
 * suites already used distinct names, so those names are now literally load-bearing. Each inherits
 * `app_user`'s grants via `inRole`; `app_user` exists by the time the roles run because CORE's
 * `0001_tenancy_rls.sql` creates it and `startSharedContainer` runs `roles` AFTER the templates
 * migrate.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/identity suite (its PGlite-only and hermetic files included) with it, not only the real-PG
 * suites — a real broadening of what needs Docker, the same one db and apps/server accepted. What
 * makes it acceptable is not an assumption that every machine has Docker, but that this package's
 * reason to be in the real-PG tier at all needs Docker regardless: the four RLS suites need a
 * non-superuser role, which PGlite cannot provide (its every connection is a superuser and bypasses
 * FORCE ROW LEVEL SECURITY, the very thing they verify), and `passkey.concurrency.test.ts` needs two
 * distinct backends whose row locks actually contend, which PGlite — serialising every query onto one
 * backend — cannot stage. CLAUDE.md §4 documents that this repo's real-Postgres test tier needs a
 * local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw
 * testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/identity's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite's every connection is a superuser and bypasses FORCE ROW LEVEL SECURITY, so " +
      "it cannot exercise the tenant-isolation policies and exact grants the RLS suites verify " +
      "(see persons.rls.test.ts), and it serialises every query onto one backend, so it cannot stage " +
      "the two-backend row-lock race passkey.concurrency.test.ts exists to prove.",
    templates: {
      core_identity: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS, IDENTITY_MIGRATIONS]),
    },
    roles: [
      // Non-superuser LOGIN roles — being non-superuser is what makes FORCE ROW LEVEL SECURITY apply
      // to them, which is the whole point of the RLS suites they drive. (Which role serves which
      // suite, and why the names must be distinct, is in the docblock above.)
      { name: "identity_webauthn_probe", password: "probe", inRole: "app_user" },
      { name: "identity_rls_probe", password: "probe", inRole: "app_user" },
      { name: "identity_sessions_probe", password: "probe", inRole: "app_user" },
      { name: "identity_mgmt_sessions_probe", password: "probe", inRole: "app_user" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
