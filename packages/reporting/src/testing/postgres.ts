import { CORE_MIGRATIONS } from "@waitron/db";
import {
  runMigrationSets,
  startMigratedPostgres,
  type RealPostgres,
} from "@waitron/db/testing/postgres.js";

export type { RealPostgres };

/**
 * The setup budget a container suite needs, passed to `useRealPostgres`'s `timeoutMs`. It restates
 * vitest.config.ts's own `hookTimeout` (180s) because `useRealPostgres` gives its `beforeAll` no
 * default, and the per-hook argument wins over the config value — so a suite passing nothing would
 * silently drop to vitest's 5s default. Same reasoning as workforce/fiscal-verifactu's copies.
 */
export const CONTAINER_SETUP_TIMEOUT_MS = 180_000;

/**
 * Starts a real PostgreSQL server and runs the core migration set against it — reporting reads and
 * writes only core tables (`sales`, `tenders`, `daily_closes`, `daily_close_chain`), so CORE_MIGRATIONS
 * (which includes 0033, the frozen-daily-close ledger and its chain head) is the whole set. Ordering
 * across packages is the runtime's responsibility; a single set needs none stated.
 */
export function startRealPostgres(): Promise<RealPostgres> {
  return startMigratedPostgres({
    dockerRequired:
      "The daily-close record concurrency suite requires a running Docker daemon. It cannot be " +
      "skipped: PGlite serialises every query onto ONE backend, so the single-writer FOR UPDATE " +
      "lock and the concurrent close.already_closed this suite exists to prove cannot be exercised " +
      "there at all — a false pass, not a weak one (CLAUDE.md §4).",
    migrate: (uri) => runMigrationSets(uri, [CORE_MIGRATIONS]),
  });
}
