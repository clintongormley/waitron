import { sqliteFailureOf } from "@waitron/shared";
import type { Logger } from "./logger.js";

/**
 * What the engine reports when a migration asks for something the rows already in a table do not
 * satisfy. Each is `SQLITE_CONSTRAINT` (19) with the reason in the high byte, and each was taken
 * from a real refusal on Node v26.7.0, 2026-09-22.
 *
 * A pinned membership list, never a test of the low byte, for the same reason `boot-failure.ts`
 * pins its list: the line below names an ACTION, so each entry has to be unambiguously about rows
 * failing a constraint. A trigger's own `raise(abort)` (1811) is deliberately absent — it is a rule
 * this schema chose to enforce, not row data meeting a new constraint, and `ON DELETE RESTRICT`
 * arrives under the same number (`packages/db/src/sql-state.ts` carries that collision).
 *
 * Shares no code with the list in `boot-failure.ts`, which a test pins rather than a comment
 * asserting it: that file's advice for a schema mismatch is to RESTORE the database, and sending a
 * reader to wipe one instead is the failure worth a guard.
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
 * Runs the boot migrations, and when they fail in DEV on a constraint, says so in one line before
 * failing exactly as it would have.
 *
 * Why this is worth a line: migrations here are written with no data-preservation code on purpose
 * (CLAUDE.md §3 — schema changes drop and recreate until Waitron is in production), while the
 * development database is one shared, seeded venue directory that every worktree boots against, and
 * moving between worktrees does not normally wipe it (`wa-wt` decides when it does; the guide says where).
 * So a migration that adds a column no existing row can fill dies at boot with a raw driver stack
 * trace, while the dashboard still loads and shows nothing until someone tries to sign in.
 * `docs/developers/workflow-guide.md` works the case through.
 *
 * WHAT THE LINE MAY AND MAY NOT CLAIM. A constraint violation says a rule was broken; it does not
 * say whether the offending rows were already in the table or were inserted by this same migration.
 * So the line reports the failure as fact and offers the reset as a CONDITIONAL remedy — naming it
 * outright would send a developer to wipe a healthy database over a broken migration, and then to
 * wipe it again. `docs/developers/workflow-guide.md` carries the receipt and the comparison with
 * how `boot-failure.ts` answered the same ambiguity.
 *
 * DEV ONLY, because the remedy named is `wa-wt reset`, which exists nowhere else; on a real box the
 * same refusal means something else and wiping would be wrong advice. It is a separate seam from
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
    // `sqliteFailureOf` reports the FIRST layer of the cause chain carrying a result code, so an
    // outer layer decides: a driver failure wrapped in something carrying its own `errcode` is
    // judged on the outer one, which may fire this line or silence it. Either way the raw failure
    // still reaches the log.
    const failure = devMode ? sqliteFailureOf(error) : null;
    if (failure !== null && CONSTRAINT.has(failure.errcode)) {
      try {
        log("error", "migrations.dev_constraint_violation", {
          errcode: failure.errcode,
          remedyIfStaleDatabase: "wa-wt reset demo <worktree-name>",
        });
      } catch {
        // A sink that cannot write must not replace the failure the reader is here for.
      }
    }
    throw error;
  }
}
