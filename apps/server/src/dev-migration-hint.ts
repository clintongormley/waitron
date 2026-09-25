import { sqliteFailureOf } from "@waitron/shared";
import type { Logger } from "./logger.js";

/**
 * The result codes for rows failing a constraint a migration asks for. A pinned list, never a test
 * of the low byte, because the line below names an action. A trigger's `raise(abort)` (1811) is
 * deliberately absent: it is a rule the schema enforces, not row data meeting a new constraint, and
 * `ON DELETE RESTRICT` shares its number (`packages/db/src/sql-state.ts`).
 *
 * Shares no result code with `boot-failure.ts`'s `UNREACHABLE_RESULT_CODES`.
 */
export const MIGRATION_CONSTRAINT_RESULT_CODES: readonly number[] = [
  275, // CHECK
  787, // FOREIGN KEY
  1299, // NOT NULL
  1555, // PRIMARY KEY
  2067, // UNIQUE index
];

const CONSTRAINT = new Set(MIGRATION_CONSTRAINT_RESULT_CODES);

/**
 * Runs the boot migrations and, when they fail in dev on a constraint, logs the reset as a remedy
 * before re-throwing the error untouched (even if the log sink throws).
 *
 * The remedy is CONDITIONAL: a constraint violation does not say whether the offending rows were
 * already in the table or were inserted by this migration, and a reset fixes only the first.
 * Dev only, because `wa-wt reset` exists nowhere else.
 * `wa-wt` lives outside this repository, so nothing here checks that the command below is still
 * spelled this way.
 * Receipt: `docs/developers/workflow-guide.md`.
 */
export async function withDevMigrationHint(
  log: Logger,
  devMode: boolean,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    // The OUTERMOST layer carrying an `errcode` decides, which may fire this line or silence it.
    const failure = devMode ? sqliteFailureOf(error) : null;
    if (failure !== null && CONSTRAINT.has(failure.errcode)) {
      try {
        log("error", "migrations.dev_constraint_violation", {
          errcode: failure.errcode,
          remedyIfStaleDatabase: "wa-wt reset demo <worktree-name>",
        });
      } catch {
        // A failing sink must not replace the migration failure.
      }
    }
    throw error;
  }
}
