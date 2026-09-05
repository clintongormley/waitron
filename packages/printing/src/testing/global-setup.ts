import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/printing real-Postgres tier and
 * migrates the single `core` template its suites clone (~26ms each) instead of booting and migrating
 * a container per file. See the plan at `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, because every real-PG suite here migrates exactly `CORE_MIGRATIONS` — the print
 * tables (`print_agents`, `print_agent_pairing_codes`, `printers`, `print_jobs`) ship in CORE's
 * `0062_printing.sql`/`0063_printing_rls.sql`, so there is no printing-specific migration set to
 * layer on top. Suites clone it with `useTemplateDb({ template: "core" })`.
 *
 * NO cluster `roles` are provided: the enrol/auth suites drive the real deployment role by switching
 * to it inside a superuser transaction (`withTenant` + `asAppUser`, i.e. `set local role app_user`),
 * exactly as packages/db's own printing.test.ts does — they need no separate LOGIN probe role.
 * `app_user` itself exists by the time any clone is used: CORE's `0001_tenancy_rls.sql` creates it.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes. Because globalSetup runs before every worker, a Docker-absent run dies HERE,
 * taking the whole package with it — accepted for the same reason db/identity accept it: this
 * package's suites exist to prove the single-use enrol race, which needs two distinct backends whose
 * row locks actually contend, something PGlite (one serialised backend) cannot stage (CLAUDE.md §4).
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/printing's real-Postgres suites require a running Docker daemon. They cannot be " +
      "skipped: the single-use pairing-code redemption is a CONCURRENCY property enforced by a " +
      "row-locking DELETE … RETURNING, and PGlite serialises every query onto one backend, so two " +
      "concurrent enrolments never truly overlap there — a PGlite run would be a false pass.",
    templates: {
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
