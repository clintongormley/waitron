import type { GlobalSetupContext } from "vitest/node";
import { CORE_MIGRATIONS } from "@waitron/db";
import { runMigrationSets } from "@waitron/db/testing/postgres.js";
import { startSharedContainer } from "@waitron/db/testing/shared-container.js";

/**
 * Boots ONE shared PostgreSQL container for the whole @waitron/purchasing real-Postgres tier and
 * migrates the single `core` template its suites clone (~26ms each) instead of booting and migrating
 * a container per file. See the plan at
 * `docs/superpowers/plans/2026-08-19-shared-test-container.md`.
 *
 * **NOTHING IN THIS PACKAGE CURRENTLY CLONES IT.** `purchase-invoices.rls.test.ts`, the one suite
 * that ever did, was retired with the RLS drop: its isolation cases had no meaning under one tenant
 * per database, and its DELETE-is-granted case is `purchase_invoices`/`purchase_invoice_vat: "SIUD"`
 * in `packages/fiscal-verifactu/src/privileges.expected.ts` (the cascade it also showed is
 * `operations.test.ts`'s "deletes an invoice and cascades to its VAT lines"). The wiring is left
 * standing — and this package therefore still requires Docker — because whether @waitron/purchasing
 * keeps a real-Postgres tier at all is the per-suite target review's call
 * (docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §4, "PGlite
 * where RLS was the only reason"), not this one's.
 *
 * One template, because the suite that used to clone it migrated exactly one set — CORE.
 * `@waitron/purchasing` owns no migrations of its own: the `purchase_invoices`/`purchase_invoice_vat`
 * tables and their grant lines live in `CORE_MIGRATIONS` (0041/0042), so `CORE_MIGRATIONS` is the
 * whole set and no cross-package ordering has to be stated. `core` is the established key for a
 * CORE-only template — packages/db, apps/server and reporting all name theirs `core`.
 *
 * No `roles`: the `rls_probe` login this file created existed for that one suite alone.
 *
 * A globalSetup's return value is its globalTeardown, so returning `teardown` stops the container
 * once the run finishes.
 *
 * Because globalSetup runs before every worker, a Docker-absent run dies HERE, taking the WHOLE
 * @waitron/purchasing suite (its PGlite-only and hermetic files included) with it. CLAUDE.md §4
 * documents that this repo's real-Postgres test tier needs a local Docker daemon (plus
 * `TESTCONTAINERS_RYUK_DISABLED`); `dockerRequired` turns the raw testcontainers daemon error into
 * that guidance when Docker is absent.
 */
export default async function ({ provide }: GlobalSetupContext) {
  const { handle, teardown } = await startSharedContainer({
    dockerRequired:
      "@waitron/purchasing's vitest globalSetup still boots a shared PostgreSQL container, so a " +
      "running Docker daemon is required even though no suite here clones it any more. See this " +
      "file's header: removing the tier is the per-suite target review's call — see " +
      "docs/superpowers/specs/2026-09-05-drop-rls-squash-and-outbox-deletion-design.md §4.",
    templates: {
      core: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
    },
  });
  provide("sharedPg", handle);
  return teardown;
}
