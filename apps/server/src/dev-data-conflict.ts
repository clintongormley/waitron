import { sqlStateOf } from "@waitron/shared";
import type { Logger } from "./logger.js";

/**
 * The SQLSTATEs that mean "rows already in this table do not satisfy a rule the migration is
 * adding". A pinned membership list, never a class-`23` prefix match, for the same reason
 * `boot-failure.ts` pins its two: each entry has to be unambiguously about EXISTING DATA, because
 * the action this file names is "wipe the development database".
 */
export const DEV_DATA_CONFLICT_SQL_STATES: readonly string[] = [
  "23502", // not_null_violation — ADD COLUMN ... NOT NULL over rows that exist
  "23503", // foreign_key_violation — a new FK the current rows do not satisfy
  "23505", // unique_violation — a new unique index over rows that are already duplicates
  "23514", // check_violation — a new CHECK the current rows fail
  "23P01", // exclusion_violation
];

const DATA_CONFLICT = new Set(DEV_DATA_CONFLICT_SQL_STATES);

/**
 * Runs the boot migrations, and when they fail in DEV because data already in the database cannot
 * take the new schema, says so in one line before failing exactly as it would have.
 *
 * Why this is worth a line: migrations here are written for an empty database on purpose (CLAUDE.md
 * §3 — schema changes drop and recreate until Waitron is in production), while the development
 * Postgres is one shared, seeded volume that every worktree boots against and that `wa-wt` wipes
 * only when the target changes. So a branch carrying a migration like
 * `packages/db/drizzle/0020_category_names.sql` ("ADD COLUMN name jsonb NOT NULL" over ten seeded
 * categories) dies at boot with a raw driver stack trace, and the browser shows nothing but a
 * failure to reach a server that never started.
 *
 * DEV ONLY, because the remedy named here — `wa-wt reset` — exists nowhere else. On a real box the
 * same SQLSTATE means something else entirely and wiping the database would be actively wrong
 * advice, which is why `devMode` gates the line rather than being mentioned inside it. The box's own
 * classification of a failed boot is `classifyBootFailure` (`boot-failure.ts`), a different audience
 * with a different remedy; these two deliberately share no table.
 *
 * The error is re-thrown untouched, so every caller above still sees the original failure with its
 * original stack: this adds a log line and changes nothing else.
 */
export async function withDevDataConflictHint(
  log: Logger,
  devMode: boolean,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    // `sqlStateOf` returns the first SQLSTATE-SHAPED code in the cause chain, so a driver failure
    // wrapped in something that itself carries such a code reports the outer one and says nothing
    // here. Staying quiet is the safe direction: the raw failure still reaches the log either way.
    const sqlState = devMode ? sqlStateOf(error) : null;
    if (sqlState !== null && DATA_CONFLICT.has(sqlState)) {
      log("error", "migrations.dev_data_conflict", {
        sqlState,
        remedy: "wa-wt reset demo <worktree-name>",
      });
    }
    throw error;
  }
}
