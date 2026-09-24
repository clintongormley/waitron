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

/**
 * The pre-wipe membership read's handle: the VENUE file of this node's own venue directory.
 *
 * `applyMigrations` applies every set to the venue handle and leaves the node file empty
 * (`packages/migrations/src/apply.ts`), so the venue handle is where `node_membership`'s row is.
 * `close` closes BOTH files — `openVenueDatabase` opens `node.db` beside `venue.db`, and a handle
 * left open would hold a directory this command is about to empty.
 */
async function openVenue(directory: string): Promise<{ db: Database; close(): Promise<void> }> {
  const store = await openVenueDatabase(directory);
  return { db: store.venue, close: () => store.close() };
}

/**
 * `waitron-rejoin rejoin [--accept-loss]` — WIPE this fenced ex-primary's local database, re-migrate
 * it, and clear `trading.env` so the next boot enters SETUP mode and the operator re-adopts from the
 * connect screen (spec §4). There is NO artifact restore (Ruling I3).
 *
 * `--accept-loss` waives nothing today — see `RejoinDeps.acceptLoss`; the drain confirmation it used to
 * waive went with the PostgreSQL replication machinery. The flag still records the operator's explicit
 * acknowledgement in the log.
 *
 * Configuration comes from the environment, NEVER argv, and the two directory settings follow
 * `config.ts`'s own resolution — an unset OR EMPTY value takes the default, never `resolve("")`,
 * which is the working directory ("an empty value is a valid value", CLAUDE.md §3). Env contract:
 *  - `WAITRON_STATE_DIR` — the state root whose `trading.env` is cleared, and the base the venue
 *    directory defaults under. Unset or empty = `DEFAULT_STATE_ROOT`.
 *  - `WAITRON_VENUE_DIR` — the directory holding `venue.db` and `node.db`: what the pre-wipe
 *    membership read opens, what the wipe empties, and what the re-migrate rebuilds, so all three
 *    always name one venue. Unset or empty = `<stateDir>/venue`.
 *  - `WAITRON_TILL_*_ID` — via `tryLoadTillConfig` → the node's `nodeId`. Absent = an
 *    unprovisioned box, which `rejoin` is a misuse of.
 *  - `WAITRON_ENV` — the target environment (gates `deploymentEnvironment`).
 *
 * Returns a process exit code: 0 on success, 1 on an expected failure (a missing/empty env var, an
 * unprovisioned box, an invalid `WAITRON_ENV`, or ANY error out of the
 * orchestrator — a `rejoin.*` `AppError` reported by code, anything else reported generically), 2 on a
 * usage error. The orchestrator's error is NEVER rethrown and its `.message` is NEVER printed:
 * `bin-rejoin.ts`'s `.then(process.exit)` has no `.catch`, so a raw rejection here would reach stderr
 * as whatever words the failure happened to carry. A box operator has no terminal and no way to read
 * around such a line, so everything this command prints is text it composed itself, keyed by code.
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
  // The only positional beyond the flag is disallowed — `rejoin [--accept-loss]` takes no artifact now.
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
  // The same resolution `config.ts` does for `venueDir`, against the state root that won above.
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

  const open = deps.openDb ?? openVenue;
  const migrate =
    deps.migrate ??
    ((directory: string) => applyMigrations(directory, migrationOptionsFor(manifestSets(), null)));
  const rejoin = deps.rejoin ?? rejoinAsSecondary;

  // Open the venue and read the held chart ONCE — the chart `rejoinAsSecondary` runs its standing
  // guards against. Report an open/read failure GENERICALLY: whatever the engine says about a
  // directory it could not open is not text this command composed.
  let opened: { db: Database; close(): Promise<void> };
  let held: Awaited<ReturnType<typeof readNodeMembership>>;
  try {
    opened = await open(venueDir);
  } catch {
    lock.release();
    return failGeneric();
  }
  try {
    held = await readNodeMembership(opened.db);
  } catch {
    await opened.close();
    lock.release();
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
    // The whole wipe (Ruling I3): remove both database files and their write-ahead sidecars,
    // re-migrate the directory from scratch, then clear trading.env so the next boot enters setup
    // mode. `applyMigrations` recreates both files and takes the directory's own migration lock,
    // which is why our handle is closed first rather than held across this.
    wipeDatabase: async () => {
      await wipeVenueDatabases(venueDir);
      await migrate(venueDir);
      await clearTradingEnv(stateDir);
    },
    log,
  };

  try {
    const result = await rejoin(rejoinDeps);
    deps.out(`wiped ${venueDir}; next boot is setup mode — re-adopt from ${result.carrierNodeId}`);
    return 0;
  } catch (err) {
    if (err instanceof AppError && err.code.startsWith("rejoin.")) {
      return reportCode(err.code);
    }
    // Anything else — an AppError outside the namespace, or a non-AppError — NEVER propagates raw and
    // NEVER echoes `.message`: a failed migrate arrives as whatever the driver wrote.
    return failGeneric();
  } finally {
    // On a guard refusal the orchestrator throws before `closePreWipe`, so the pre-wipe handle is
    // still open — close it here (idempotent via `closed`, so the success/wipe path never closes
    // twice).
    if (!closed) await opened.close().catch(() => {});
    lock.release();
  }
}
