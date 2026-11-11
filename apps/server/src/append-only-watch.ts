import { sql } from "drizzle-orm";
import { openVenueDatabase, type Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { appendOnlyTriggerFaults } from "@waitron/store";
import "./errors.js";
import type { Logger } from "./logger.js";
import { refusedWhileRunning, updateRecoveryState, type RecoveryStore } from "./recovery-state.js";
import type { JobDefinition } from "./job-runner.js";

type Faults = ReturnType<typeof appendOnlyTriggerFaults>;

export const APPEND_ONLY_CHECK_MS = 10_000;

/** Throws `append_only.triggers_changed` when any of `tables`' append-only triggers is missing or altered. */
export function assertAppendOnlyIntact(db: Database, tables: readonly string[]): void {
  const { missing, altered } = appendOnlyTriggerFaults(db, tables);
  if (missing.length > 0 || altered.length > 0) {
    throw new AppError("append_only.triggers_changed", { missing, altered });
  }
}

/**
 * The append-only triggers of `tables` missing from `venueDir` before migrating, counting only
 * tables that already exist: a table the migration is about to create has no trigger yet.
 */
export async function missingBeforeMigration(
  venueDir: string,
  tables: readonly string[],
): Promise<string[]> {
  const probe = await openVenueDatabase(venueDir);
  try {
    const existing = new Set(
      probe.venue
        .execute<{ name: string }>(
          sql`select lower(name) as name from sqlite_master where type = 'table'`,
        )
        .rows.map((row) => row.name),
    );
    return appendOnlyTriggerFaults(
      probe.venue,
      tables.filter((table) => existing.has(table.toLowerCase())),
    ).missing;
  } finally {
    await probe.close();
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
        refusedWhileRunning(current, "append_only.triggers_changed", deps.now(), {
          missing: [...faults.missing],
          altered: [...faults.altered],
        }),
      );
    } catch (error) {
      deps.log("warn", "recovery.state_write_failed", { errorCode: codeOf(error) });
    }
    deps.kill();
  };
}

export function tamperWatchJob(deps: {
  db: Database;
  tables: readonly string[];
  intervalMs: number;
  refuse: (faults: Faults) => Promise<void>;
  log: Logger;
}): JobDefinition {
  return {
    name: "fiscal.tamper_watch",
    applies: () => true,
    firstPassAfterMs: deps.intervalMs,
    minSleepMs: deps.intervalMs,
    maxSleepMs: deps.intervalMs,
    backoff: { firstMs: deps.intervalMs, maxMs: deps.intervalMs },
    async pass() {
      let faults: Faults;
      try {
        faults = appendOnlyTriggerFaults(deps.db, deps.tables);
      } catch (error) {
        deps.log("warn", "append_only.check_failed", { errorCode: codeOf(error) });
        throw error;
      }
      if (faults.missing.length > 0 || faults.altered.length > 0) {
        await deps.refuse(faults);
        return { nextDueAt: null, finished: true };
      }
      return { nextDueAt: null };
    },
  };
}
