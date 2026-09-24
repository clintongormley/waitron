import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, hasCode } from "@waitron/shared";
import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { deploymentEnvironment, resolveConfigDir, type DeploymentEnvironment } from "./config.js";
import { isUnset } from "./env-value.js";
import { createLogger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { restoreFromArtifact, type RestoreDeps } from "./restore.js";
import "./errors.js";

type Env = NodeJS.ProcessEnv;

/**
 * The `AppError` codes thrown by the decrypt+unpack phase (`decryptArtifact`/`unpackArchive` inside
 * `restoreFromArtifact`), before the compatibility gate or the entry-name guard ever runs. Collapsed
 * into ONE generic message below — the same reasoning `runRecoveryUnpack` applies to its own decrypt
 * phase (`recovery-unpack-command.ts`): telling an operator (or an attacker who has stolen the
 * artifact and is running this CLI) "wrong recovery key" versus "corrupt artifact" would hand them an
 * oracle to guess the recovery key against, and this artifact is a whole-database backup — a far
 * higher-value target than the recovery bundle `runRecoveryUnpack` protects the same way.
 */
const DECRYPT_PHASE_CODES: ReadonlySet<string> = new Set([
  "recovery.passphrase_invalid",
  "backup.artifact_invalid",
  "backup.archive_invalid",
]);

/**
 * `waitron-restore restore <artifact-path>` — decrypt and restore one BR-3 backup artifact
 * (`restoreFromArtifact`, `restore.ts`): validate → set aside any existing identity → database →
 * migrate → hooks (one transaction) → secrets (identity last). The target database must be FRESH.
 * The recovery key comes from the environment, NEVER argv (`WAITRON_BACKUP_RECOVERY_KEY` — the SAME
 * variable a backup was encrypted under, `backup-config.ts`): an argv element leaks into the process
 * table (`ps`), the same reason `waitron-recovery`/`waitron-break-glass` read theirs from env.
 *
 * Resolves `stateDir`/`venueDir`/`migrationsRoot`/`environment` exactly as `boot.ts`'s `loadConfig`
 * does — the same `WAITRON_STATE_DIR`/`WAITRON_VENUE_DIR`/`WAITRON_MIGRATIONS_DIR`/`WAITRON_ENV`
 * variables, the same `DEFAULT_STATE_ROOT`/`DEFAULT_MIGRATIONS_ROOT` defaults
 * (imported from `boot.ts` rather than recomputed, so the two can never drift) and the same
 * `isUnset`-gated `resolve()`-only-a-real-value shape. `migrationsRoot` is stored VERBATIM when
 * overridden — no `resolve()` — mirroring `config.ts`'s own `loadConfig` exactly. `stagingDir` is
 * `<stateDir>/restore-staging`, the restore-side twin of `boot.ts`'s `<stateDir>/backup-staging`.
 * `modules` is always `ALL_MODULES`, never an enabled subset — matching how `boot.ts` wires the
 * backup sweep: a restore hook must run for every module whose tables are in the backup, and the
 * descriptor list is that set.
 *
 * `WAITRON_VENUE_DIR` replaces the retired `WAITRON_RESTORE_DATABASE_URL`, and it keeps that
 * variable's fail-closed rule in the shape a DIRECTORY needs it. The connection string failed
 * closed because an empty one is a VALID connection string that silently resolves to this box's own
 * localhost server; the equivalent for a path is that `resolve("")` is the process's working
 * directory, so an empty value with no guard would put `venue.db` wherever the operator happened to
 * be standing. `resolveConfigDir` is the one `config.ts` uses for exactly this — an unset OR empty
 * value takes the default under the state root, and only a real value is `resolve`d.
 *
 * Exported so the flow is unit-tested without touching a venue directory: `deps.restore`
 * is the orchestrator seam (defaults to {@link restoreFromArtifact}), injected by tests as a fake that
 * never touches a database. `bin-restore.ts` is a thin wrapper that supplies
 * `process.argv`/`process.env` and exits on the returned code. Returns a process exit code: 0 on
 * success, 1 on an expected disaster-recovery failure (missing recovery key,
 * an unreadable artifact file, an invalid `WAITRON_ENV`, or ANY error out of the orchestrator — a `restore.*`/`recovery.*`/
 * `backup.*` `AppError` (a decrypt, gate or guard failure) is reported by code, and literally anything
 * else is reported with a generic `restore failed`), 2 on a usage error.
 *
 * The orchestrator's error is NEVER rethrown and its `.message` is NEVER printed, unlike
 * `runRecoveryUnpack`'s posture of rethrowing an unrecognised error. The reason is no longer a
 * subprocess — there is none — it is that this is a disaster-recovery CLI whose failure path is the
 * one an operator is most likely to see and to paste somewhere, and the messages that reach it come
 * from outside this function: a filesystem error names the path it failed on, and any bug anywhere
 * in `restoreFromArtifact`'s chain that throws a raw error is printed verbatim by
 * `bin-restore.ts`'s catch-less `.then(process.exit)`. Reporting a CODE carries no value from
 * outside the image; reporting a message carries whatever the thrower put in it.
 */
export async function runRestore(deps: {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  restore?: (args: RestoreDeps) => Promise<void>;
}): Promise<number> {
  const [cmd, artifactPath] = deps.argv;
  if (cmd !== "restore" || artifactPath === undefined) {
    deps.out("usage: waitron-restore restore <artifact-path>");
    return 2;
  }

  // Report an `AppError` code to the operator and return the exit-1 code, the shape both the
  // WAITRON_ENV-resolution catch and the orchestrator catch below share (never echoing a raw
  // `.message` — no secret rides in a code).
  const reportCode = (code: string): number => {
    deps.out(`restore failed: ${code}`);
    return 1;
  };

  const recoveryKey = deps.env.WAITRON_BACKUP_RECOVERY_KEY;
  if (isUnset(recoveryKey)) {
    deps.out("WAITRON_BACKUP_RECOVERY_KEY must be set to the backup's recovery key");
    return 1;
  }

  let artifact: Uint8Array;
  try {
    artifact = await readFile(artifactPath);
  } catch {
    // Missing/unreadable artifact file (ENOENT etc) — the operator gave a bad path. Name the path;
    // no secret is in a filename.
    deps.out(`cannot read artifact file: ${artifactPath}`);
    return 1;
  }

  const stateDir = deps.env.WAITRON_STATE_DIR;
  const migrationsDir = deps.env.WAITRON_MIGRATIONS_DIR;
  // Computed once so `stagingDir` below joins onto the SAME resolved root the returned `stateDir`
  // carries, exactly the reasoning `config.ts`'s `resolvedStateDir` documents for `logDir`.
  const resolvedStateDir = resolveConfigDir(stateDir, DEFAULT_STATE_ROOT);

  // Resolve the target environment BEFORE building `restoreDeps`, and CATCH its one possible throw.
  // `deploymentEnvironment` raises `server.config_invalid` for a `WAITRON_ENV` that is neither
  // production/preproduction/dev — that is its ONLY throw. It used to be evaluated inline in the
  // `restoreDeps` literal below, OUTSIDE the try that wraps the restore, so a bad value rejected RAW
  // out of runRestore — past `bin-restore.ts`'s catch-less `.then(process.exit)` and contradicting
  // that file's "runRestore never rejects with a raw error" note. Reporting it here by code and
  // returning exit 1 — as every other bad env var above does — restores that guarantee.
  let environment: DeploymentEnvironment;
  try {
    environment = deploymentEnvironment(deps.env);
  } catch (err) {
    return reportCode((err as AppError).code);
  }

  const restoreDeps: RestoreDeps = {
    artifact,
    recoveryKey,
    // The same resolution `config.ts` does for `venueDir`, against the state root that won above:
    // unset or EMPTY takes `<stateDir>/venue`, never `resolve("")` — which is the working directory.
    venueDir: resolveConfigDir(deps.env.WAITRON_VENUE_DIR, join(resolvedStateDir, "venue")),
    stateDir: resolvedStateDir,
    stagingDir: join(resolvedStateDir, "restore-staging"),
    migrationsRoot: isUnset(migrationsDir) ? DEFAULT_MIGRATIONS_ROOT : migrationsDir,
    modules: ALL_MODULES,
    environment,
    log: createLogger(
      (line) => deps.out(line.trimEnd()),
      () => new Date(),
    ),
  };

  const restore = deps.restore ?? restoreFromArtifact;
  deps.out(
    "cold restore: use only when no peer (mirror or local secondary) survived — a survivor holds more history and is promoted, not overwritten (promotion runbook §5d)",
  );
  try {
    await restore(restoreDeps);
  } catch (err) {
    if (err instanceof AppError) {
      if (err.code === "provisioning.database_in_use") {
        deps.out(
          "restore failed: provisioning.database_in_use — another process, usually the Waitron server, is using this venue folder; stop it first (docker compose stop app)",
        );
        return 1;
      }
      if (DECRYPT_PHASE_CODES.has(err.code)) {
        deps.out("restore failed: wrong recovery key or corrupt artifact");
        return 1;
      }
      if (hasCode(err, "restore.hook_failed")) {
        deps.out(
          `restore failed: restore.hook_failed (module ${err.params.module}: ${err.params.code})`,
        );
        return 1;
      }
      if (
        err.code.startsWith("restore.") ||
        err.code.startsWith("recovery.") ||
        err.code.startsWith("backup.")
      ) {
        return reportCode(err.code);
      }
    }
    // Anything else — an AppError outside those three namespaces, or a non-AppError entirely —
    // NEVER propagates raw and NEVER echoes `err.message`/`String(err)`. Every plausible failure
    // here now carries a message this function did not compose: a full disk or a bad permission on
    // the venue directory rejects with an `fs` error naming the path, and any bug elsewhere in
    // `restoreFromArtifact`'s chain throws whatever its thrower wrote. Unlike `runRecoveryUnpack`
    // (which rethrows anything outside its two known codes), a rethrow here would let
    // `bin-restore.ts`'s uncaught rejection print that message straight to stderr, where a box
    // operator's only window is this terminal and curated code-keyed text is the whole posture.
    deps.out("restore failed");
    return 1;
  }

  deps.out(`restored ${artifactPath}`);
  return 0;
}
