import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createPostgresDb, readNodeMembership, withTenant, type Database } from "@waitron/db";
import { servingPrimaryNodeId } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { readDrainProgress, type DrainProgress } from "@waitron/sync";
import { DEFAULT_MEDIA_ROOT, DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { deploymentEnvironment, resolveConfigDir, type DeploymentEnvironment } from "./config.js";
import { dropAndCreateDatabase } from "./db-wipe.js";
import { isUnset } from "./env-value.js";
import { createLogger } from "./logger.js";
import { ALL_MODULES, ALL_SYNC_ENROLMENTS } from "./modules.js";
import { rejoinAsSecondary, type RejoinDeps, type RejoinResult } from "./rejoin.js";
import { restoreFromArtifact, type RestoreDeps } from "./restore.js";
import { tryLoadTillConfig } from "./till-config.js";
import "./errors.js";

type Env = NodeJS.ProcessEnv;

/**
 * The decrypt+unpack-phase `AppError` codes (shared with `runRestore`) that must be collapsed into one
 * generic message rather than reported by code: distinguishing "wrong recovery key" from "corrupt
 * artifact" would hand an operator (or an attacker running this CLI against a stolen artifact — a
 * whole-database backup) an oracle to guess the recovery key against. The reasoning is identical to
 * `restore-command.ts`'s `DECRYPT_PHASE_CODES`; rejoin reaches the same decrypt phase because
 * `rejoinAsSecondary` drives `restoreFromArtifact` on the same artifact.
 */
const DECRYPT_PHASE_CODES: ReadonlySet<string> = new Set([
  "recovery.passphrase_invalid",
  "backup.artifact_invalid",
  "backup.archive_invalid",
]);

/**
 * `waitron-rejoin rejoin <artifact-path>` — WIPE this fenced, fully-drained ex-primary's local
 * database and RESTORE the carrier's baseline, so a returned node rejoins the cluster as a clean
 * secondary (spec §4). Assembles the real dependencies and hands them to `rejoinAsSecondary`
 * (`rejoin.ts`), which runs the ordered guard ladder (`not_fenced` → `no_carrier` → `not_drained`)
 * BEFORE anything irreversible, then closes our pre-wipe pools, wipes, and restores.
 *
 * Modelled on `restore-command.ts`: secrets and privileged connection strings come from the
 * environment, NEVER argv (they leak into `ps` otherwise), and each fails CLOSED on an empty value via
 * `isUnset` — "an empty connection string is a valid connection string" (CLAUDE.md §3), so a blank
 * value must refuse rather than silently resolve to localhost.
 *
 * Env contract:
 *  - `DATABASE_URL` — the app pool. Holds the pre-wipe `node_membership` read (both here, to key the
 *    drain reader on the carrier, and inside `rejoinAsSecondary`, for the standing guards). Closed by
 *    `closePreWipe` BEFORE the wipe — the `WITH (FORCE)` drop terminates any lingering backend.
 *  - `WAITRON_SYNC_DATABASE_URL` — the sync_tailer pool. Carries the carrier-keyed drain read
 *    (`withTenant` + `readDrainProgress`). Also closed by `closePreWipe`.
 *  - `WAITRON_MAINTENANCE_DATABASE_URL` — a privileged connection to a DIFFERENT (maintenance)
 *    database (e.g. `postgres`); `dropAndCreateDatabase` cannot drop the database it is connected to.
 *  - `WAITRON_RESTORE_DATABASE_URL` — the privileged connection to the freshly-created target db for
 *    `pg_restore` (reused from BR-3). The target db NAME is parsed from this URL's path — the single
 *    source of truth; a socket/opaque form with no db name is refused.
 *  - `WAITRON_BACKUP_RECOVERY_KEY` — the artifact's recovery key (reused from BR-3).
 *  - `WAITRON_TILL_*_ID` — via `tryLoadTillConfig` → the node's `nodeId`/`tenantId`. Absent = an
 *    unprovisioned box, which `rejoin` is a misuse of, so it is refused.
 *  - `WAITRON_MEDIA_DIR`/`WAITRON_STATE_DIR`/`WAITRON_MIGRATIONS_DIR`/`WAITRON_ENV` — resolved exactly
 *    as `restore-command.ts` does (`restoreFromArtifact` runs with `skipSecrets: true`: R3 keeps this
 *    node's OWN identity secrets, restoring only the ledger + media).
 *
 * Seams (all defaulted to the real wiring, injected by tests so the flow is unit-tested without a
 * container): `connect` (`createPostgresDb`) opens the app/sync/maintenance pools, `restore`
 * (`restoreFromArtifact`) runs the baseline restore, and `rejoin` (`rejoinAsSecondary`) is the
 * orchestrator. `bin-rejoin.ts` supplies `process.argv`/`process.env` and exits on the returned code.
 *
 * Returns a process exit code: 0 on success, 1 on an expected disaster-recovery failure (a missing or
 * empty env var, an unprovisioned box, an unreadable artifact, an invalid `WAITRON_ENV`, a restore URL
 * with no db name, or ANY error out of the orchestrator — a `rejoin.*`/`restore.*`/`recovery.*`/
 * `backup.*` `AppError` reported by code, a decrypt-phase code collapsed to one non-oracle message, and
 * anything else reported generically), 2 on a usage error. The orchestrator's error is NEVER rethrown
 * and its `.message` is NEVER printed: `bin-rejoin.ts`'s `.then(process.exit)` has no `.catch`, so a
 * raw rejection here would dump a message that could carry the admin connection string straight to
 * stderr — the same second-layer defence `runRestore` documents.
 */
export async function runRejoin(deps: {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  rejoin?: (d: RejoinDeps) => Promise<RejoinResult>;
  connect?: (url: string) => Promise<Database>;
  restore?: (args: RestoreDeps) => Promise<void>;
}): Promise<number> {
  const [cmd, artifactPath] = deps.argv;
  if (cmd !== "rejoin" || artifactPath === undefined) {
    deps.out("usage: waitron-rejoin rejoin <artifact-path>");
    return 2;
  }

  // Report an `AppError` code to the operator and return exit 1, never echoing a raw `.message` (no
  // secret rides in a code) — shared by the till/env-resolution catches and the orchestrator catch.
  const reportCode = (code: string): number => {
    deps.out(`rejoin failed: ${code}`);
    return 1;
  };

  const recoveryKey = deps.env.WAITRON_BACKUP_RECOVERY_KEY;
  if (isUnset(recoveryKey)) {
    deps.out("WAITRON_BACKUP_RECOVERY_KEY must be set to the backup's recovery key");
    return 1;
  }

  const databaseUrl = deps.env.WAITRON_RESTORE_DATABASE_URL;
  if (isUnset(databaseUrl)) {
    deps.out(
      "WAITRON_RESTORE_DATABASE_URL must be set to a privileged connection for the restore target",
    );
    return 1;
  }

  const appDbUrl = deps.env.DATABASE_URL;
  if (isUnset(appDbUrl)) {
    deps.out("DATABASE_URL must be set to the app pool for the pre-wipe membership read");
    return 1;
  }

  const syncDbUrl = deps.env.WAITRON_SYNC_DATABASE_URL;
  if (isUnset(syncDbUrl)) {
    deps.out("WAITRON_SYNC_DATABASE_URL must be set to the sync pool for the drain read");
    return 1;
  }

  const maintenanceUrl = deps.env.WAITRON_MAINTENANCE_DATABASE_URL;
  if (isUnset(maintenanceUrl)) {
    deps.out(
      "WAITRON_MAINTENANCE_DATABASE_URL must be set to a privileged connection to a maintenance database",
    );
    return 1;
  }

  // The node's own fiscal identity. `tryLoadTillConfig` throws `server.config_invalid` for a
  // half-configured (partial) set — reported by code — and returns `undefined` for a wholly
  // unprovisioned box, which `rejoin` is a misuse of.
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
  // Capture into a `const` so the non-undefined narrowing survives inside the async closures below —
  // TS re-widens a captured `let` to its full (undefined-including) type in a closure.
  const cfg = till;

  let artifact: Uint8Array;
  try {
    artifact = await readFile(artifactPath);
  } catch {
    // Missing/unreadable artifact file (ENOENT etc) — a bad path from the operator. Name the path; no
    // secret is in a filename.
    deps.out(`cannot read artifact file: ${artifactPath}`);
    return 1;
  }

  // Resolve the target environment and CATCH its one throw (`server.config_invalid` for a `WAITRON_ENV`
  // that is not production/preproduction/dev), reporting by code — never letting it reject raw past
  // `bin-rejoin.ts`'s catch-less `.then(process.exit)`.
  let environment: DeploymentEnvironment;
  try {
    environment = deploymentEnvironment(deps.env);
  } catch (err) {
    return reportCode((err as AppError).code);
  }

  // The target db name is the single source of truth for `dropAndCreateDatabase`, parsed from the
  // restore URL's path. A socket/opaque form (or a URL with no path) names no database and is refused.
  let dbName: string;
  try {
    dbName = new URL(databaseUrl).pathname.replace(/^\//, "");
  } catch {
    dbName = "";
  }
  if (dbName === "") {
    deps.out("WAITRON_RESTORE_DATABASE_URL must name the target database in its path");
    return 1;
  }

  const mediaDir = deps.env.WAITRON_MEDIA_DIR;
  const stateDir = deps.env.WAITRON_STATE_DIR;
  const migrationsDir = deps.env.WAITRON_MIGRATIONS_DIR;
  // Computed once so `stagingDir` joins onto the SAME resolved root the returned `stateDir` carries.
  const resolvedStateDir = resolveConfigDir(stateDir, DEFAULT_STATE_ROOT);

  const log = createLogger(
    (line) => deps.out(line.trimEnd()),
    () => new Date(),
  );

  const connect = deps.connect ?? createPostgresDb;
  const restoreImpl = deps.restore ?? restoreFromArtifact;
  const rejoin = deps.rejoin ?? rejoinAsSecondary;

  // Open the pre-wipe pools and read the held chart ONCE here to key the drain reader on the carrier —
  // the same read `rejoinAsSecondary` makes for its guards (the doc is read twice; there is no
  // stale-carrier gap because both reads see the one held document). These stay OPEN through the guard
  // phase: `rejoinAsSecondary` reads `node_membership` from `appDb` and the drain snapshot from
  // `syncDb`, then calls `closePreWipe` after the last guard and before the wipe — so we must NOT close
  // them in a `finally` that races the FORCE drop; the orchestrator owns the ordering.
  //
  // A `pg` connect/read failure (a bad connection string, a server that is down, a permission error)
  // rejects with an error whose `.message` can carry the connection string; report it GENERICALLY here
  // rather than letting it reject raw out of `runRejoin`, the same no-leak, never-reject-raw posture
  // the orchestrator catch below (and `runRestore`) keep. `appDb` is closed if the `syncDb` open or the
  // held read then fails, so a half-open pair does not leak before we return.
  let appDb: Database;
  let syncDb: Database;
  let held: Awaited<ReturnType<typeof readNodeMembership>>;
  try {
    appDb = await connect(appDbUrl);
  } catch {
    deps.out("rejoin failed");
    return 1;
  }
  try {
    syncDb = await connect(syncDbUrl);
  } catch {
    await appDb.close();
    deps.out("rejoin failed");
    return 1;
  }
  try {
    held = await readNodeMembership(appDb);
  } catch {
    await Promise.all([appDb.close(), syncDb.close()]);
    deps.out("rejoin failed");
    return 1;
  }

  const carrier = held === null ? undefined : servingPrimaryNodeId(held);
  const drainReader =
    carrier === undefined
      ? undefined
      : /* v8 ignore next 8 -- the withTenant + sync_tailer + readDrainProgress path needs a real PG
           role and the sync tables; exercised by Task 3's real-DB integration, not this unit suite */
        (): Promise<DrainProgress> =>
          withTenant(syncDb, cfg.tenantId, (tx) =>
            readDrainProgress(tx, {
              selfNodeId: cfg.nodeId,
              carrierNodeId: carrier,
              enrolments: ALL_SYNC_ENROLMENTS,
            }),
          );

  const rejoinDeps: RejoinDeps = {
    appDb,
    nodeId: cfg.nodeId,
    readDrainProgress: drainReader,
    // Close BOTH pre-wipe pools. `Database` is closed with `.close()`, NEVER `.driver.end()`
    // (`.driver` is a string tag, not a pool) — client.ts. The orchestrator awaits this after the last
    // guard and before the wipe.
    closePreWipe: () => Promise.all([appDb.close(), syncDb.close()]).then(() => {}),
    wipeDatabase: async () => {
      const admin = await connect(maintenanceUrl);
      try {
        await dropAndCreateDatabase({ admin, database: dbName });
      } finally {
        await admin.close();
      }
    },
    restore: () =>
      restoreImpl({
        artifact,
        recoveryKey,
        databaseUrl,
        mediaDir: resolveConfigDir(mediaDir, DEFAULT_MEDIA_ROOT),
        stateDir: resolvedStateDir,
        stagingDir: join(resolvedStateDir, "restore-staging"),
        migrationsRoot: isUnset(migrationsDir) ? DEFAULT_MIGRATIONS_ROOT : migrationsDir,
        modules: ALL_MODULES,
        environment,
        skipSecrets: true,
        log,
      }),
    log,
  };

  try {
    const result = await rejoin(rejoinDeps);
    deps.out(`restored ${artifactPath} (streaming from ${result.carrierNodeId})`);
    return 0;
  } catch (err) {
    if (err instanceof AppError) {
      if (DECRYPT_PHASE_CODES.has(err.code)) {
        deps.out("rejoin failed: wrong recovery key or corrupt artifact");
        return 1;
      }
      if (
        err.code.startsWith("rejoin.") ||
        err.code.startsWith("restore.") ||
        err.code.startsWith("recovery.") ||
        err.code.startsWith("backup.")
      ) {
        return reportCode(err.code);
      }
    }
    // Anything else — an AppError outside those namespaces, or a non-AppError — NEVER propagates raw
    // and NEVER echoes `err.message`/`String(err)`: a failed `pg_restore` (bad perms, a non-fresh
    // target, a full disk) or an unrelated throw could carry the admin connection string. This is the
    // independent second layer behind `pg-restore.ts`'s own password-stripping.
    deps.out("rejoin failed");
    return 1;
  }
}
