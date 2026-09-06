import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { WORKFORCE_ES_MIGRATIONS } from "../migrations.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/workforce-es real-Postgres tier and
 * migrates the single `core_identity_workforce_es` template its suites clone (~26ms each) instead of booting
 * and migrating a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * One template, `core_identity_workforce_es` — the FULL CORE → IDENTITY → WORKFORCE → WORKFORCE_ES stack, in
 * that order. workforce-es's `convenio_config` builds on the workforce schema, which builds on
 * identity, which builds on core, so all four sets are migrated, core first (that ordering is the
 * runtime's responsibility and nothing enforces it across packages, so it is explicit here). Worth
 * noting: `convenio_config`'s own foreign keys reach ONLY core (`tenants`/`locations`), and the sole
 * real-PG suite this package ever had seeded only a tenant and a location — never a workforce or
 * identity row — so the IDENTITY and WORKFORCE sets are present not because that suite's rows needed
 * them but because the workforce-es PACKAGE depends on `@waitron/workforce` (this and `convenio.ts`
 * import from it) and workforce's own FKs target identity's `persons`; the template therefore
 * migrates workforce-es's full package stack, exactly as the now-removed per-file
 * `startRealPostgres` did.
 *
 * No extra probe roles are needed. The table grants are pinned in
 * `packages/fiscal-verifactu/src/privileges.expected.ts`; defaults and enum rejection are in
 * `migrations.test.ts`.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * **NOTHING IN THIS PACKAGE CURRENTLY CLONES THE TEMPLATE** — see the paragraph above. The wiring is
 * left standing, so a Docker-absent run still dies HERE, taking the WHOLE @waitron/workforce-es suite
 * (its PGlite-only and hermetic files included) with it. Whether this package keeps a real-Postgres
 * tier at all is the per-suite target review's call
 * (docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §4, "PGlite
 * where RLS was the only reason"), not this one's. CLAUDE.md §4 documents that this repo's
 * real-Postgres test tier
 * needs a local Docker daemon (plus `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw
 * testcontainers daemon error into that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/workforce-es's vitest globalSetup still boots a shared PostgreSQL container, so a " +
      "running Docker daemon is required even though no suite here clones it any more. See that " +
      "file's header: removing the tier is the per-suite target review's call — see " +
      "docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §4.",
    templates: {
      core_identity_workforce_es: (uri) =>
        runMigrationSets(uri, [
          CORE_MIGRATIONS,
          IDENTITY_MIGRATIONS,
          WORKFORCE_MIGRATIONS,
          WORKFORCE_ES_MIGRATIONS,
        ]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
