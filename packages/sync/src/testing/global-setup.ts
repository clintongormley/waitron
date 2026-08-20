import type { GlobalSetupContext } from "vitest/node";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/sync real-Postgres tier and migrates
 * the single `manifest` template its seven gate suites clone (~26ms each) instead of booting and
 * migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template — the FULL migration manifest, through the SAME bare
 * `runMigrationSets(uri, migrationOptionsFor(manifestSets(), null))` path the removed per-file
 * `startMigratedPostgres` ran (NOT apps/server's advisory-locked `applyMigrations`; the two produce
 * the same schema but are not interchangeable, so preserving sync's existing choice is what keeps
 * this a behaviour-preserving refactor). Every sync gate suite migrates the whole manifest — the
 * package's own capture triggers attach to tables owned by @waitron/db and @waitron/payments, so
 * every enrolled table has to exist first — and clones this template with
 * `useTemplateDb({ template: "manifest" })`.
 *
 * The five cluster roles are created ONCE here, idempotently, in place of the per-file `probeRole` /
 * `setup` role creation the seven suites used. A shared container is one cluster, so a role created
 * per file would collide on the SECOND file with `role … already exists` (the plan's "role
 * collisions are the crux") — which is the whole reason they move here. They are the UNION of the
 * roles the seven suites created:
 *  - `app_login` — writes through `app_user` (capture / origin / source gates).
 *  - `sync_reader` — reads through `sync_tailer`, the sanctioned per-tenant read path (source gate).
 *  - `sync_applier` — the apply worker: writes as `app_user` AND reads sync_cursor as `sync_tailer`,
 *    so it carries BOTH memberships via the inRole array (pull / apply / redelivery gates).
 *  - `sync_pruner` — prunes as a `sync_retention` member (retention gate).
 *  - `tailer_login` — a `sync_tailer` member: retention gate uses it to prove the retention policy did
 *    NOT leak into sync_tailer, and capture gate uses it as the per-tenant reader (the FORCE-RLS
 *    control).
 * `app_user` is created by CORE's `0001_tenancy_rls.sql`; `sync_tailer` and `sync_retention` by the
 * sync migration (`0000_sync_outbox.sql` / `0001_sync_retention.sql`) inside the `manifest` template.
 * Roles are created AFTER the templates migrate, so all three group roles exist when these five —
 * which each depend on one of them via `inRole` — are created. Each inherits its group's grants and
 * is never widened by hand (CLAUDE.md §3 "never widen").
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/sync suite (its hermetic non-Postgres unit files included) with it, not only the seven gate
 * suites — a real broadening of what needs Docker, the same one db, apps/server and payments
 * accepted. What makes it acceptable is not an assumption that every machine has Docker, but that
 * this package's reason to be in the real-PG tier at all — its FORCE-RLS / non-superuser gate suites
 * — needs Docker regardless: they reach it through `useTemplateDb` and cannot run under PGlite, whose
 * superuser bypasses the FORCE ROW LEVEL SECURITY and the per-role tenant-isolation and retention
 * policies they exist to verify. CLAUDE.md §4 documents that this repo's real-Postgres test tier
 * needs a local Docker daemon (plus TESTCONTAINERS_RYUK_DISABLED); `dockerRequired` turns the raw
 * testcontainers daemon error into guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/sync's real-Postgres gate suites require a running Docker daemon. They cannot be " +
      "skipped: PGlite connects as a superuser and bypasses FORCE ROW LEVEL SECURITY, so it cannot " +
      "exercise the non-superuser capture, source-read, apply and retention paths — or the per-role " +
      "tenant-isolation and retention policies — these suites exist to verify (CLAUDE.md §4).",
    templates: {
      manifest: (uri) => runMigrationSets(uri, migrationOptionsFor(manifestSets(), null)),
    },
    roles: [
      // The UNION of the seven gate suites' per-file roles; which suite drives which is in the
      // docblock above. `sync_applier` needs membership in BOTH app_user (to write the enrolled
      // tables) and sync_tailer (to read sync_cursor), expressed as an inRole array.
      { name: "app_login", password: "app_pw", inRole: "app_user" },
      { name: "sync_reader", password: "rp", inRole: "sync_tailer" },
      { name: "sync_applier", password: "ap", inRole: ["app_user", "sync_tailer"] },
      { name: "sync_pruner", password: "pp", inRole: "sync_retention" },
      { name: "tailer_login", password: "tp", inRole: "sync_tailer" },
    ],
  });
  provide("sharedPg", handle);
  return teardown;
}
