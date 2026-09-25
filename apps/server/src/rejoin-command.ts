import { join } from "node:path";
import {
  lockVenueDatabase,
  openVenueDatabase,
  readNodeMembership,
  type Database,
  type VenueLock,
} from "@waitron/db";
import { AppError, isAppError } from "@waitron/shared";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { DEFAULT_STATE_ROOT } from "./boot.js";
import { deploymentEnvironment, resolveConfigDir } from "./config.js";
import { wipeVenueDatabases } from "./db-wipe.js";
import { createLogger } from "./logger.js";
import { rejoinAsSecondary, type RejoinDeps, type RejoinResult } from "./rejoin.js";
import { clearTradingEnv } from "./trading-config.js";
import { tryLoadTillConfig } from "./till-config.js";
import "./errors.js";

type Env = NodeJS.ProcessEnv;

/** `close` closes both files: an open handle would hold the directory this command empties. */
async function openVenue(directory: string): Promise<{ db: Database; close(): Promise<void> }> {
  const store = await openVenueDatabase(directory);
  return { db: store.venue, close: () => store.close() };
}

/**
 * `waitron-rejoin rejoin [--accept-loss]` — wipes this fenced ex-primary's venue directory,
 * re-migrates it and clears `trading.env`, so the next boot is setup mode. Configuration comes from
 * the environment, never argv.
 *
 * Returns 0 on success, 2 on a usage error, and 1 otherwise. Every failure is reported by text this
 * command composed; no caught error's `.message` is printed, because a box operator has no terminal
 * to read around it.
 */
export async function runRejoin(deps: {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  rejoin?: (d: RejoinDeps) => Promise<RejoinResult>;
  openDb?: (directory: string) => Promise<{ db: Database; close(): Promise<void> }>;
  migrate?: (venueDir: string) => Promise<void>;
  lockVenue?: (directory: string) => Promise<VenueLock>;
}): Promise<number> {
  const [cmd, ...rest] = deps.argv;
  const acceptLoss = rest.includes("--accept-loss");
  const extras = rest.filter((a) => a !== "--accept-loss");
  if (cmd !== "rejoin" || extras.length > 0) {
    deps.out("usage: waitron-rejoin rejoin [--accept-loss]");
    return 2;
  }

  const reportCode = (code: string): number => {
    deps.out(`rejoin failed: ${code}`);
    return 1;
  };
  const failGeneric = (): number => {
    deps.out("rejoin failed");
    return 1;
  };

  let till: ReturnType<typeof tryLoadTillConfig>;
  try {
    till = tryLoadTillConfig(deps.env);
  } catch (err) {
    return reportCode((err as AppError).code);
  }
  if (till === undefined) {
    deps.out(
      "WAITRON_TILL_*_ID must be set: rejoin is for a provisioned node, not an unprovisioned box",
    );
    return 1;
  }
  const cfg = till;

  // Validated, not kept: an unreadable or wrong `WAITRON_ENV` must refuse before the wipe, even though
  // nothing on this path now needs the value itself.
  try {
    deploymentEnvironment(deps.env);
  } catch (err) {
    return reportCode((err as AppError).code);
  }

  const stateDir = resolveConfigDir(deps.env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  const venueDir = resolveConfigDir(deps.env.WAITRON_VENUE_DIR, join(stateDir, "venue"));
  const log = createLogger(
    (line) => deps.out(line.trimEnd()),
    () => new Date(),
  );

  // Held from before the pre-wipe read to the end: the wipe empties the folder a running server
  // would be serving. The migrate inside shares the hold.
  let lock: VenueLock;
  try {
    lock = await (deps.lockVenue ?? lockVenueDatabase)(venueDir);
  } catch (err) {
    if (isAppError(err) && err.code === "provisioning.database_in_use") {
      deps.out(
        "rejoin failed: provisioning.database_in_use — another process, usually the Waitron server, is using this venue folder; stop it first",
      );
      return 1;
    }
    return failGeneric();
  }

  try {
    const open = deps.openDb ?? openVenue;
    const migrate =
      deps.migrate ??
      ((directory: string) =>
        applyMigrations(directory, migrationOptionsFor(manifestSets(), null)));
    const rejoin = deps.rejoin ?? rejoinAsSecondary;

    // Read once: this is the chart the guards run against.
    let opened: { db: Database; close(): Promise<void> };
    let held: Awaited<ReturnType<typeof readNodeMembership>>;
    try {
      opened = await open(venueDir);
    } catch {
      return failGeneric();
    }
    try {
      held = await readNodeMembership(opened.db);
    } catch {
      await opened.close().catch(() => {});
      return failGeneric();
    }

    let closed = false;
    const rejoinDeps: RejoinDeps = {
      held,
      nodeId: cfg.nodeId,
      acceptLoss,
      closePreWipe: () =>
        opened.close().then(() => {
          closed = true;
        }),
      wipeDatabase: async () => {
        await wipeVenueDatabases(venueDir);
        await migrate(venueDir);
        await clearTradingEnv(stateDir);
      },
      log,
    };

    try {
      const result = await rejoin(rejoinDeps);
      deps.out(
        `wiped ${venueDir}; next boot is setup mode — re-adopt from ${result.carrierNodeId}`,
      );
      return 0;
    } catch (err) {
      if (err instanceof AppError && err.code.startsWith("rejoin.")) {
        return reportCode(err.code);
      }
      // A failed migrate arrives as whatever the driver wrote.
      return failGeneric();
    } finally {
      // A guard refusal throws before `closePreWipe`, leaving the handle open.
      if (!closed) await opened.close().catch(() => {});
    }
  } finally {
    lock.release();
  }
}
