import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";

export type { RealPostgres };

/**
 * The setup budget the container suite needs (image pull on a cold runner), passed to
 * `useRealPostgres`'s `timeoutMs`; without it the per-hook argument would drop to Vitest's 5s
 * default. Mirrors packages/recipes/reporting's own copies.
 */
export const CONTAINER_SETUP_TIMEOUT_MS = 180_000;

/**
 * Starts a real PostgreSQL server and applies `@waitron/db`'s core migrations against it.
 *
 * `@waitron/purchasing` owns no migrations of its own — the `purchase_invoices`/`purchase_invoice_vat`
 * tables and their FORCE-RLS/policy/grant lines live in `CORE_MIGRATIONS` (0041/0042), so this suite
 * needs only that one set, exactly as `packages/recipes`'s helper does. Real Postgres (not PGlite)
 * because the isolation suite this feeds probes RLS under a non-superuser role, which PGlite's
 * superuser connection bypasses (CLAUDE.md §4).
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The purchasing RLS suite requires a running Docker daemon. It cannot be skipped: PGlite's " +
      "superuser bypasses row-level security, so it cannot exercise the tenant-isolation policies " +
      "or the SELECT/INSERT/UPDATE/DELETE grants on the purchase-invoice tables.",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
  });
}
