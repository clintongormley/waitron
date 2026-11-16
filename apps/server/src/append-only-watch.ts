import { sql } from "drizzle-orm";
import { openVenueDatabase, type Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { appendOnlyTriggers, triggerFaults, type ExpectedTrigger } from "@waitron/store";
import "./errors.js";
import type { Logger } from "./logger.js";
import { refusedWhileRunning, updateRecoveryState, type RecoveryStore } from "./recovery-state.js";
import type { JobDefinition } from "./job-runner.js";

type Faults = ReturnType<typeof triggerFaults>;

export const APPEND_ONLY_CHECK_MS = 10_000;

export function assertAppendOnlyIntact(
  db: Database,
  tables: readonly string[],
  expectedTriggers: readonly ExpectedTrigger[] = [],
): void {
  const { missing, altered } = triggerFaults(db, [
    ...appendOnlyTriggers(tables),
    ...expectedTriggers,
  ]);
  if (missing.length > 0 || altered.length > 0) {
    throw new AppError("append_only.triggers_changed", { missing, altered });
  }
}

/**
 * A table the migration is about to create has no trigger to restore yet.
 */
export async function missingBeforeMigration(
  venueDir: string,
  tables: readonly string[],
  expectedTriggers: readonly ExpectedTrigger[] = [],
): Promise<string[]> {
  const probe = await openVenueDatabase(venueDir);
  try {
    const triggers = [...appendOnlyTriggers(tables), ...expectedTriggers];
    const existing = new Set(
      existingAppendOnlyTables(
        probe.venue,
        triggers.map((trigger) => trigger.table),
      ).map((table) => table.toLowerCase()),
    );
    return triggerFaults(
      probe.venue,
      triggers.filter((trigger) => existing.has(trigger.table.toLowerCase())),
    ).missing;
  } finally {
    await probe.close();
  }
}

function existingAppendOnlyTables(db: Database, tables: readonly string[]): string[] {
  const existing = new Set(
    db
      .execute<{ name: string }>(
        sql`select lower(name) as name from sqlite_master where type = 'table'`,
      )
      .rows.map((row) => row.name),
  );
  return tables.filter((table) => existing.has(table.toLowerCase()));
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
  expectedTriggers?: readonly ExpectedTrigger[];
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
        faults = triggerFaults(deps.db, [
          ...appendOnlyTriggers(deps.tables),
          ...(deps.expectedTriggers ?? []),
        ]);
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
