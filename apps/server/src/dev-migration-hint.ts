import { sqlStateOf } from "@waitron/shared";
import type { Logger } from "./logger.js";

/**
 * The SQLSTATEs PostgreSQL raises when a migration asks for something the rows in a table do not
 * satisfy. A pinned membership list, never a class-`23` prefix match, for the same reason
 * `boot-failure.ts` pins its tables: the line below names an action, so each entry has to be
 * unambiguously about a constraint meeting row data.
 *
 * Shares no code with any table in `boot-failure.ts`, which a test pins rather than a comment
 * asserting it: that file's advice for a schema mismatch is to RESTORE the database, and sending a
 * reader to wipe one instead is the failure worth a guard.
 */
export const MIGRATION_CONSTRAINT_SQL_STATES: readonly string[] = [
  "23502", // not_null_violation
  "23503", // foreign_key_violation
  "23505", // unique_violation
  "23514", // check_violation
  "23P01", // exclusion_violation
];

const CONSTRAINT = new Set(MIGRATION_CONSTRAINT_SQL_STATES);

/**
 * Runs the boot migrations, and when they fail in DEV on a constraint, says so in one line before
 * failing exactly as it would have.
 *
 * Why this is worth a line: migrations here are written with no data-preservation code on purpose
 * (CLAUDE.md §3 — schema changes drop and recreate until Waitron is in production), while the
 * development Postgres is one shared, seeded volume that every worktree boots against, and moving
 * between worktrees on the same target does not wipe it. So a migration that adds a column no
 * existing row can fill dies at boot with a raw driver stack trace, and the browser is left with a
 * generic failure. `docs/developers/workflow-guide.md` works the case through.
 *
 * WHAT THE LINE MAY AND MAY NOT CLAIM. A constraint violation says a rule was broken; it does not
 * say whether the offending rows were already in the table or were inserted by this same migration.
 * So the line reports the failure as fact and offers the reset as a CONDITIONAL remedy — naming it
 * outright would send a developer to wipe a healthy database over a broken migration, and then to
 * wipe it again. `docs/developers/workflow-guide.md` carries the receipt and the comparison with
 * how `boot-failure.ts` answered the same ambiguity.
 *
 * DEV ONLY, because the remedy named is `wa-wt reset`, which exists nowhere else; on a real box the
 * same SQLSTATE means something else and wiping would be wrong advice. It is a separate seam from
 * `classifyBootFailure` (`boot-failure.ts`) — not just a separate table — because that function
 * classifies for the box operator's recovery page and takes no `devMode` to gate on.
 *
 * `wa-wt` lives outside this repository, so nothing here can prove its command line is still
 * spelled this way; the worst a stale string can do is misname a development convenience.
 *
 * The error is re-thrown untouched — including if the log sink throws, since the migration
 * failure is the one the reader needs.
 */
export async function withDevMigrationHint(
  log: Logger,
  devMode: boolean,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    // `sqlStateOf` reports the FIRST SQLSTATE-shaped code in the cause chain, so an outer code
    // decides: a driver failure wrapped in something carrying its own code is judged on the outer
    // one, which may fire this line or silence it. Either way the raw failure still reaches the log.
    const sqlState = devMode ? sqlStateOf(error) : null;
    if (sqlState !== null && CONSTRAINT.has(sqlState)) {
      try {
        log("error", "migrations.dev_constraint_violation", {
          sqlState,
          remedyIfStaleDatabase: "wa-wt reset demo <worktree-name>",
        });
      } catch {
        // A sink that cannot write must not replace the failure the reader is here for.
      }
    }
    throw error;
  }
}
