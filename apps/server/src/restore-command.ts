import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { DEFAULT_MEDIA_ROOT, DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
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
 * (`restoreFromArtifact`, `restore.ts`) onto a FRESH target database, then its media and state
 * secrets, then run every module's (empty, in v1) restore hook. Secrets come from the environment,
 * NEVER argv: the recovery key (`WAITRON_BACKUP_RECOVERY_KEY` — the SAME variable a backup was
 * encrypted under, `backup-config.ts`) and the privileged admin connection to the restore target
 * (`WAITRON_RESTORE_DATABASE_URL`) both leak into the process table (`ps`) if passed as an argv
 * element, the same reason `waitron-recovery`/`waitron-break-glass` read theirs from env.
 *
 * `WAITRON_RESTORE_DATABASE_URL` fails CLOSED on an empty value via `isUnset`, never
 * `new Client({connectionString: ""})`'s silent localhost fallback — "an empty connection string is
 * a valid connection string" (CLAUDE.md §3): a blank value here must refuse outright rather than
 * quietly restore onto whatever answers on this box's default Postgres port.
 *
 * Resolves `mediaDir`/`stateDir`/`migrationsRoot`/`environment` exactly as `boot.ts`'s `loadConfig`
 * does — the same `WAITRON_MEDIA_DIR`/`WAITRON_STATE_DIR`/`WAITRON_MIGRATIONS_DIR`/`WAITRON_ENV`
 * variables, the same `DEFAULT_MEDIA_ROOT`/`DEFAULT_STATE_ROOT`/`DEFAULT_MIGRATIONS_ROOT` defaults
 * (imported from `boot.ts` rather than recomputed, so the two can never drift) and the same
 * `isUnset`-gated `resolve()`-only-a-real-value shape. `migrationsRoot` is stored VERBATIM when
 * overridden — no `resolve()` — mirroring `config.ts`'s own `loadConfig` exactly. `stagingDir` is
 * `<stateDir>/restore-staging`, the restore-side twin of `boot.ts`'s `<stateDir>/backup-staging`.
 * `modules` is always `ALL_MODULES`, never an enabled subset — matching how `boot.ts` wires the
 * backup sweep: the restore-hook seat is empty in v1 (`restore.ts`'s `invokeRestoreHooks`), so there
 * is nothing to narrow yet, and a future hook must run for a module this box does not currently trade
 * with just as readily as one it does.
 *
 * Exported so the flow is unit-tested without a real `pg_restore`/Postgres connection: `deps.restore`
 * is the orchestrator seam (defaults to {@link restoreFromArtifact}), injected by tests as a fake that
 * never touches a database. `bin-restore.ts` is a thin wrapper that supplies
 * `process.argv`/`process.env` and exits on the returned code. Returns a process exit code: 0 on
 * success, 1 on an expected disaster-recovery failure (missing recovery key, empty target connection,
 * an unreadable artifact file, an invalid `WAITRON_ENV`, or ANY error out of the orchestrator — a `restore.*`/`recovery.*`/
 * `backup.*` `AppError` (a decrypt, gate or guard failure) is reported by code, and literally anything
 * else is reported with a generic `restore failed`), 2 on a usage error.
 *
 * The orchestrator's error is NEVER rethrown and its `.message` is NEVER printed, unlike
 * `runRecoveryUnpack`'s posture of rethrowing an unrecognised error: a failed `pg_restore` (bad
 * perms, a non-fresh target, a full disk — all plausible real outcomes, not edge cases) rejects with
 * an error built from its own argv by Node's `promisify(execFile)`, and `pg-restore.ts`'s
 * `stripPassword` keeps the admin connection's password out of that argv — but this function is the
 * SECOND, independent layer: it must not echo a raw message even if some other, unrelated bug
 * upstream throws one carrying a secret, because `bin-restore.ts`'s `.then(process.exit)` has no
 * `.catch` of its own — an uncaught rejection here would print the raw message straight to stderr.
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

  const databaseUrl = deps.env.WAITRON_RESTORE_DATABASE_URL;
  if (isUnset(databaseUrl)) {
    deps.out(
      "WAITRON_RESTORE_DATABASE_URL must be set to a privileged connection for the restore target",
    );
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

  const mediaDir = deps.env.WAITRON_MEDIA_DIR;
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
    databaseUrl,
    mediaDir: resolveConfigDir(mediaDir, DEFAULT_MEDIA_ROOT),
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
  try {
    await restore(restoreDeps);
  } catch (err) {
    if (err instanceof AppError) {
      if (DECRYPT_PHASE_CODES.has(err.code)) {
        deps.out("restore failed: wrong recovery key or corrupt artifact");
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
    // NEVER propagates raw and NEVER echoes `err.message`/`String(err)`. A failed `pg_restore`
    // (bad perms, a non-fresh target, a full disk — all plausible real outcomes) rejects with an
    // error whose `.message` is built from its own argv by `promisify(execFile)`; `pg-restore.ts`
    // now keeps the password out of that argv (the root fix), but this is the load-bearing SECOND
    // layer — an unrelated bug anywhere else in `restoreFromArtifact`'s chain that throws a raw
    // driver/fs error carrying `databaseUrl` (or anything else sensitive) in its message must not
    // reach an operator's terminal either. Unlike `runRecoveryUnpack` (which rethrows anything
    // outside its two known codes, since none of its failure modes can embed a secret), a rethrow
    // here would let `bin-restore.ts`'s uncaught rejection print the raw message to stderr.
    deps.out("restore failed");
    return 1;
  }

  deps.out(`restored ${artifactPath}`);
  return 0;
}
