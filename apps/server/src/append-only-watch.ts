import type { Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { appendOnlyTriggerFaults } from "@waitron/store";
import "./errors.js";
import type { Logger } from "./logger.js";
import { refusedWhileRunning, updateRecoveryState, type RecoveryStore } from "./recovery-state.js";

type Faults = ReturnType<typeof appendOnlyTriggerFaults>;

/** Throws `append_only.triggers_changed` when any of `tables`' append-only triggers is missing or altered. */
export function assertAppendOnlyIntact(db: Database, tables: readonly string[]): void {
  const { missing, altered } = appendOnlyTriggerFaults(db, tables);
  if (missing.length > 0 || altered.length > 0) {
    throw new AppError("append_only.triggers_changed", { missing, altered });
  }
}

export interface RefuseTradingDeps {
  stateDir: string;
  now: () => Date;
  log: Logger;
  kill: () => void;
  store: RecoveryStore;
}

/**
 * What the running server does on finding a fault: record the refusal so the next start serves the
 * recovery page at once, then stop. The stop happens even when the record cannot be written.
 */
export function refuseTrading(deps: RefuseTradingDeps): (faults: Faults) => Promise<void> {
  return async (faults) => {
    deps.log("error", "append_only.triggers_changed", faults);
    try {
      await updateRecoveryState(deps.store, deps.stateDir, (current) =>
        refusedWhileRunning(current, "append_only.triggers_changed", deps.now()),
      );
    } catch (error) {
      deps.log("warn", "recovery.state_write_failed", { errorCode: codeOf(error) });
    }
    deps.kill();
  };
}
