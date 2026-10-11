import type { Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { appendOnlyTriggerFaults } from "@waitron/store";
import "./errors.js";
import type { Logger } from "./logger.js";
import { refusedWhileRunning, updateRecoveryState, type RecoveryStore } from "./recovery-state.js";
import { unrefTimer, type Timer } from "./unref-timer.js";

type Faults = ReturnType<typeof appendOnlyTriggerFaults>;

export const APPEND_ONLY_CHECK_MS = 10_000;

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

/**
 * Re-reads `tables`' append-only triggers every `intervalMs`, first one interval after start (boot
 * has just checked). A fault stops the checking and goes to `refuse`; a read that throws is logged
 * and tried again next interval.
 */
export function startAppendOnlyWatch(deps: {
  db: Database;
  tables: readonly string[];
  intervalMs: number;
  refuse: (faults: Faults) => Promise<void>;
  log: Logger;
  timer?: (ms: number, fn: () => void) => Timer;
}): { stop: () => void } {
  const timer = deps.timer ?? unrefTimer;
  let stopped = false;
  let armed = timer(deps.intervalMs, check);

  function check(): void {
    if (stopped) return;
    let faults: Faults;
    try {
      faults = appendOnlyTriggerFaults(deps.db, deps.tables);
    } catch (error) {
      deps.log("warn", "append_only.check_failed", { errorCode: codeOf(error) });
      armed = timer(deps.intervalMs, check);
      return;
    }
    if (faults.missing.length > 0 || faults.altered.length > 0) {
      void deps.refuse(faults);
      return;
    }
    armed = timer(deps.intervalMs, check);
  }

  return {
    stop: () => {
      stopped = true;
      armed.cancel();
    },
  };
}
