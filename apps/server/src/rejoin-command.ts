import { createPostgresDb, readNodeMembership, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { INSTANCE_MIGRATOR_ROLE, withDatabase, withRole } from "@waitron/provisioning";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { DEFAULT_STATE_ROOT } from "./boot.js";
import { deploymentEnvironment, resolveConfigDir } from "./config.js";
import { dropAndCreateDatabase } from "./db-wipe.js";
import { isUnset } from "./env-value.js";
import { createLogger } from "./logger.js";
import { rejoinAsSecondary, type RejoinDeps, type RejoinResult } from "./rejoin.js";
import { clearTradingEnv } from "./trading-config.js";
import { tryLoadTillConfig } from "./till-config.js";
import "./errors.js";

type Env = NodeJS.ProcessEnv;

/** The database NAME `DATABASE_URL` points at — what the wipe drops and recreates. `null` when the
 * string is not a standard URL or names no database in its path; on this irreversible path that must
 * refuse (fail closed) rather than guess. */
function parseDbName(url: string): string | null {
  try {
    const database = new URL(url).pathname.replace(/^\//, "");
    return database === "" ? null : database;
  } catch {
    return null;
  }
}

/**
 * `waitron-rejoin rejoin [--accept-loss]` — WIPE this fenced ex-primary's local database, recreate +
 * re-migrate it migrator-owned, and clear `trading.env` so the next boot enters SETUP mode and the
 * operator re-adopts from the connect screen (spec §4). There is NO artifact restore (Ruling I3).
 *
 * `--accept-loss` waives nothing today — see `RejoinDeps.acceptLoss`; the drain confirmation it used to
 * waive went with the PostgreSQL replication machinery. The flag still records the operator's explicit
 * acknowledgement in the log.
 *
 * Secrets and privileged connection strings come from the environment, NEVER argv (they leak into `ps`),
 * and each fails CLOSED on an empty value via `isUnset` — "an empty connection string is a valid
 * connection string" (CLAUDE.md §3). Env contract:
 *  - `DATABASE_URL` — the app pool. The pre-wipe `node_membership` read threaded into
 *    `rejoinAsSecondary`. Its path names the TARGET database the wipe recreates, so the guards and the
 *    wipe always inspect one database. Closed by `closePreWipe` before the FORCE drop.
 *  - `WAITRON_MAINTENANCE_DATABASE_URL` — a `createdb createrole` admin connected to a DIFFERENT
 *    (maintenance) database. The wipe DROPs as the migrator-owner via `withRole` (probe F) and CREATEs as
 *    this plain admin holding CREATEDB, which the migrator lacks (probe A).
 *  - `WAITRON_TILL_*_ID` — via `tryLoadTillConfig` → the node's `nodeId`. Absent = an
 *    unprovisioned box, which `rejoin` is a misuse of.
 *  - `WAITRON_STATE_DIR` / `WAITRON_ENV` — the state dir whose `trading.env` is cleared, and the target
 *    environment (gates `deploymentEnvironment`).
 *
 * Returns a process exit code: 0 on success, 1 on an expected failure (a missing/empty env var, an
 * unprovisioned box, an invalid `WAITRON_ENV`, or ANY error out of the
 * orchestrator — a `rejoin.*` `AppError` reported by code, anything else reported generically), 2 on a
 * usage error. The orchestrator's error is NEVER rethrown and its `.message` is NEVER printed:
 * `bin-rejoin.ts`'s `.then(process.exit)` has no `.catch`, so a raw rejection here would dump a message
 * that could carry the admin connection string straight to stderr.
 */
export async function runRejoin(deps: {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  rejoin?: (d: RejoinDeps) => Promise<RejoinResult>;
  connect?: (url: string) => Promise<Database>;
  migrate?: (connectionString: string) => Promise<void>;
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

  const appDbUrl = deps.env.DATABASE_URL;
  if (isUnset(appDbUrl)) {
    deps.out("DATABASE_URL must be set to the app pool for the pre-wipe membership read");
    return 1;
  }
  const maintenanceUrl = deps.env.WAITRON_MAINTENANCE_DATABASE_URL;
  if (isUnset(maintenanceUrl)) {
    deps.out(
      "WAITRON_MAINTENANCE_DATABASE_URL must be set to a privileged admin on a maintenance database",
    );
    return 1;
  }

  // The db the wipe drops and recreates is the one the guards read — both come from `DATABASE_URL`.
  // Fail CLOSED on an unparseable URL rather than guess a name on an irreversible path.
  // `WAITRON_MAINTENANCE_DATABASE_URL` deliberately names a DIFFERENT db on the same server.
  const dbName = parseDbName(appDbUrl);
  if (dbName === null) {
    deps.out("DATABASE_URL must be a standard libpq URL naming a target database");
    return 1;
  }

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
  const log = createLogger(
    (line) => deps.out(line.trimEnd()),
    () => new Date(),
  );

  const connect = deps.connect ?? createPostgresDb;
  const migrate =
    deps.migrate ??
    ((connectionString: string) =>
      applyMigrations(connectionString, migrationOptionsFor(manifestSets(), null)));
  const rejoin = deps.rejoin ?? rejoinAsSecondary;

  // Open the app pool and read the held chart ONCE — the chart `rejoinAsSecondary` runs its standing
  // guards against. A `pg` connect/read failure can carry the connection string, so report it
  // GENERICALLY here rather than letting it reject raw.
  let appDb: Database;
  let held: Awaited<ReturnType<typeof readNodeMembership>>;
  try {
    appDb = await connect(appDbUrl);
  } catch {
    return failGeneric();
  }
  try {
    held = await readNodeMembership(appDb);
  } catch {
    await appDb.close();
    return failGeneric();
  }

  let poolsClosed = false;
  const rejoinDeps: RejoinDeps = {
    held,
    nodeId: cfg.nodeId,
    acceptLoss,
    closePreWipe: () =>
      appDb.close().then(() => {
        poolsClosed = true;
      }),
    // The whole wipe (Ruling I3 / probe F): DROP as the migrator-owner, CREATE as the plain maintenance
    // admin holding CREATEDB, re-migrate the fresh db migrator-owned, then clear trading.env so the next
    // boot enters setup mode.
    wipeDatabase: async () => {
      const dropAs = await connect(withRole(maintenanceUrl, INSTANCE_MIGRATOR_ROLE));
      const createAs = await connect(maintenanceUrl);
      try {
        await dropAndCreateDatabase({
          dropAs,
          createAs,
          database: dbName,
          owner: INSTANCE_MIGRATOR_ROLE,
        });
      } finally {
        await Promise.all([dropAs.close(), createAs.close()]);
      }
      await migrate(withRole(withDatabase(maintenanceUrl, dbName), INSTANCE_MIGRATOR_ROLE));
      await clearTradingEnv(stateDir);
    },
    log,
  };

  try {
    const result = await rejoin(rejoinDeps);
    deps.out(`wiped ${dbName}; next boot is setup mode — re-adopt from ${result.carrierNodeId}`);
    return 0;
  } catch (err) {
    if (err instanceof AppError && err.code.startsWith("rejoin.")) {
      return reportCode(err.code);
    }
    // Anything else — an AppError outside the namespace, or a non-AppError — NEVER propagates raw and
    // NEVER echoes `.message`: a failed migrate (bad perms, full disk) could carry the admin string.
    return failGeneric();
  } finally {
    // On a guard refusal the orchestrator throws before `closePreWipe`, so the pre-wipe pool is still
    // open — close it here (idempotent via `poolsClosed`, so the success/wipe path never double-closes
    // across the FORCE drop).
    if (!poolsClosed) await appDb.close().catch(() => {});
  }
}
