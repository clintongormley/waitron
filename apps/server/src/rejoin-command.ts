import { createPostgresDb, readFenceLsn, readNodeMembership, type Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { readSlotDrain, subscriptionName, type SlotDrain } from "@waitron/sync";
import { INSTANCE_MIGRATOR_ROLE, withDatabase, withRole } from "@waitron/provisioning";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { servingPrimaryNodeId } from "@waitron/membership";
import { DEFAULT_STATE_ROOT } from "./boot.js";
import { deploymentEnvironment, resolveConfigDir, type DeploymentEnvironment } from "./config.js";
import { dropAndCreateDatabase } from "./db-wipe.js";
import { isUnset } from "./env-value.js";
import { createLogger } from "./logger.js";
import { rejoinAsSecondary, type RejoinDeps, type RejoinResult } from "./rejoin.js";
import { clearTradingEnv } from "./trading-config.js";
import { tryLoadTillConfig } from "./till-config.js";
import "./errors.js";

type Env = NodeJS.ProcessEnv;

/** The comparable target a libpq URL names, for the `DATABASE_URL` vs `WAITRON_MIGRATIONS_DATABASE_URL`
 * same-database check and to derive the target db NAME the wipe recreates. `null` when the string is not
 * a standard URL or names no database in its path — either way uncomparable, which on this irreversible
 * path must refuse (fail closed). The port defaults to libpq's `5432` so an explicit `:5432` and an
 * omitted port compare equal. Username/password are NOT compared — the app pool and the migrator
 * legitimately connect as different roles to the same database. */
function parseDbTarget(url: string): { host: string; port: string; database: string } | null {
  try {
    const u = new URL(url);
    const database = u.pathname.replace(/^\//, "");
    if (database === "") return null;
    return { host: u.hostname, port: u.port || "5432", database };
  } catch {
    return null;
  }
}

/**
 * `waitron-rejoin rejoin [--accept-loss]` — WIPE this fenced, fully-drained ex-primary's local database,
 * recreate + re-migrate it migrator-owned, and clear `trading.env` so the next boot enters SETUP mode and
 * the operator re-adopts from the connect screen (spec §4). There is NO artifact restore (Ruling I3): the
 * tail is already on the carrier, and the wiped box re-adopts the carrier's baseline natively. The wipe's
 * `DROP DATABASE … WITH (FORCE)` reclaims the target's INACTIVE replication slot for free (probe F), so
 * rejoin does no slot drop of its own.
 *
 * The drain guard (Ruling C2) is the fence-LSN watermark: `confirmed_flush_lsn >= deployment.fence_lsn`
 * AND the carrier's subscription slot no longer `active`, both monotone. A DEAD box that cannot prove its
 * drain (no fence LSN, or the carrier unreachable) takes `--accept-loss`: the operator forces the wipe,
 * accepting any un-shipped tail (spec §4.2 step 2).
 *
 * Secrets and privileged connection strings come from the environment, NEVER argv (they leak into `ps`),
 * and each fails CLOSED on an empty value via `isUnset` — "an empty connection string is a valid
 * connection string" (CLAUDE.md §3). Env contract:
 *  - `DATABASE_URL` — the app pool. The pre-wipe `node_membership` read (whose result keys the drain
 *    reader on the carrier AND is threaded into `rejoinAsSecondary`) and the `deployment.fence_lsn` read.
 *    Its path names the TARGET database the wipe recreates. Closed by `closePreWipe` before the FORCE drop.
 *  - `WAITRON_MIGRATIONS_DATABASE_URL` — the migrator/owner pool. Reads the carrier's slot on this node
 *    (`pg_replication_slots`, unmasked to a non-superuser, probe B). MUST name the same host+port+database
 *    as `DATABASE_URL`, or the slot read and the guards would inspect a different db than the one wiped.
 *  - `WAITRON_MAINTENANCE_DATABASE_URL` — a `createdb createrole` admin connected to a DIFFERENT
 *    (maintenance) database. The wipe DROPs as the migrator-owner via `withRole` (probe F) and CREATEs as
 *    this plain admin holding CREATEDB, which the migrator lacks (probe A).
 *  - `WAITRON_TILL_*_ID` — via `tryLoadTillConfig` → the node's `nodeId`/`tenantId`. Absent = an
 *    unprovisioned box, which `rejoin` is a misuse of.
 *  - `WAITRON_STATE_DIR` / `WAITRON_ENV` — the state dir whose `trading.env` is cleared, and the target
 *    environment (names the publication/subscription and gates `deploymentEnvironment`).
 *
 * Returns a process exit code: 0 on success, 1 on an expected failure (a missing/empty env var, an
 * unprovisioned box, an invalid `WAITRON_ENV`, mismatched target URLs, or ANY error out of the
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
    deps.out("DATABASE_URL must be set to the app pool for the pre-wipe membership + fence read");
    return 1;
  }
  const migrationsUrl = deps.env.WAITRON_MIGRATIONS_DATABASE_URL;
  if (isUnset(migrationsUrl)) {
    deps.out(
      "WAITRON_MIGRATIONS_DATABASE_URL must be set to the migrator/owner pool for the slot read",
    );
    return 1;
  }
  const maintenanceUrl = deps.env.WAITRON_MAINTENANCE_DATABASE_URL;
  if (isUnset(maintenanceUrl)) {
    deps.out(
      "WAITRON_MAINTENANCE_DATABASE_URL must be set to a privileged admin on a maintenance database",
    );
    return 1;
  }

  // TARGET INVARIANT: `DATABASE_URL` (the guards + fence read) and `WAITRON_MIGRATIONS_DATABASE_URL` (the
  // slot read, and the db the wipe recreates) MUST name the same database, or the guards and slot vouch
  // for one db while another is dropped. Fail CLOSED on an unparseable URL. `WAITRON_MAINTENANCE_DATABASE_URL`
  // deliberately names a DIFFERENT db on the same server, so it is not compared.
  const appTarget = parseDbTarget(appDbUrl);
  const migrationsTarget = parseDbTarget(migrationsUrl);
  if (appTarget === null || migrationsTarget === null) {
    deps.out(
      "DATABASE_URL and WAITRON_MIGRATIONS_DATABASE_URL must be standard libpq URLs naming a target database",
    );
    return 1;
  }
  if (
    appTarget.host !== migrationsTarget.host ||
    appTarget.port !== migrationsTarget.port ||
    appTarget.database !== migrationsTarget.database
  ) {
    deps.out(
      "DATABASE_URL and WAITRON_MIGRATIONS_DATABASE_URL must name the same host, port and database",
    );
    return 1;
  }
  const dbName = appTarget.database;

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

  let environment: DeploymentEnvironment;
  try {
    environment = deploymentEnvironment(deps.env);
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

  // Open the pre-wipe pools and read the held chart + fence LSN ONCE. The held document is BOTH what keys
  // the slot reader on the carrier AND what `rejoinAsSecondary` runs its standing guards against. A `pg`
  // connect/read failure can carry the connection string, so report it GENERICALLY here rather than
  // letting it reject raw. `appDb` is closed if a later open/read fails, so a half-open set does not leak.
  let appDb: Database;
  let migrationsDb: Database;
  let held: Awaited<ReturnType<typeof readNodeMembership>>;
  let fenceLsn: string | null;
  try {
    appDb = await connect(appDbUrl);
  } catch {
    return failGeneric();
  }
  try {
    migrationsDb = await connect(migrationsUrl);
  } catch {
    await appDb.close();
    return failGeneric();
  }
  try {
    held = await readNodeMembership(appDb);
    fenceLsn = await readFenceLsn(appDb);
  } catch {
    await Promise.all([appDb.close(), migrationsDb.close()]);
    return failGeneric();
  }

  // The carrier keys the slot reader on this node's publisher-side slot (named by the carrier, C1). A
  // held chart with no serving-primary → no reader → `rejoin.no_carrier`, which `--accept-loss` does
  // NOT waive (it waives only the drain guards, `carrier_attached`/`not_drained`).
  const carrierNodeId = held === null ? undefined : servingPrimaryNodeId(held);
  const readSlotDrainReader: (() => Promise<SlotDrain>) | undefined =
    carrierNodeId === undefined
      ? undefined
      : () => readSlotDrain(migrationsDb, subscriptionName(environment, carrierNodeId));

  let poolsClosed = false;
  const rejoinDeps: RejoinDeps = {
    held,
    nodeId: cfg.nodeId,
    readSlotDrain: readSlotDrainReader,
    fenceLsn,
    acceptLoss,
    closePreWipe: () =>
      Promise.all([appDb.close(), migrationsDb.close()]).then(() => {
        poolsClosed = true;
      }),
    // The whole wipe (Ruling I3 / probe F): DROP as the migrator-owner (reclaims the inactive slot),
    // CREATE as the plain maintenance admin holding CREATEDB, re-migrate the fresh db migrator-owned, then
    // clear trading.env so the next boot enters setup mode. No slot drop, no migrator→repl grant.
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
    // On a guard refusal the orchestrator throws before `closePreWipe`, so the two pre-wipe pools are
    // still open — close them here (idempotent via `poolsClosed`, so the success/wipe path never
    // double-closes across the FORCE drop).
    if (!poolsClosed) await Promise.all([appDb.close(), migrationsDb.close()]).catch(() => {});
  }
}
