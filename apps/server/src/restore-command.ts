import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, hasCode } from "@waitron/shared";
import {
  createS3ObjectStore,
  parseRecoveryKit,
  resolveLitestreamBin,
  type BucketConfig,
  type ObjectStore,
  type RecoveryKit,
} from "@waitron/stream";
import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { boundObjectStore } from "./bounded-store.js";
import { deploymentEnvironment, resolveConfigDir, type DeploymentEnvironment } from "./config.js";
import { isUnset } from "./env-value.js";
import { createLogger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { RESTORE_STAGING_DIR, restoreFromArtifact, type RestoreDeps } from "./restore.js";
import { refuseIfArchiveSourceLive, restoreFromStream } from "./restore-stream.js";
import "./errors.js";

type Env = NodeJS.ProcessEnv;
type RestoreStream = (deps: Parameters<typeof restoreFromStream>[0]) => Promise<void>;

interface CommandDeps {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  restore?: (args: RestoreDeps) => Promise<void>;
  restoreStream?: RestoreStream;
  /** Opens the bucket; every call on what it returns is bounded. Default {@link createS3ObjectStore}. */
  openStore?: (bucket: BucketConfig) => ObjectStore;
  bucketTimeoutMs?: number;
}

const CONFIRM_OLD_BOX_GONE = "--confirm-old-box-gone";
const clock = (): Date => new Date();

/**
 * The `AppError` codes `decryptArtifact`/`unpackArchive` throw — in `restoreFromArtifact`'s
 * decrypt+unpack phase, and when the bucket path unlocks the copy's locked secrets with the kit's
 * recovery key (`unsealNodeState`). Each path collapses them into ONE generic message, for the
 * reason `runRecoveryUnpack` gives for its own decrypt phase (`recovery-unpack-command.ts`): telling
 * an operator (or an attacker who has stolen the artifact and is running this CLI) "wrong recovery
 * key" versus "corrupt artifact" would hand them an oracle to guess the recovery key against.
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
 * `restore --from-bucket <kit-file>` rebuilds from the venue's bucket copy instead
 * (`runBucketRestore` below); its recovery key comes from the kit file, never argv either.
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
 * an unreadable artifact file, an invalid `WAITRON_ENV`, or ANY error out of the orchestrator — a
 * few codes have their own message (see the catch below), any other `restore.*`/`recovery.*`/
 * `backup.*` code is reported by code, and anything else as `restore failed`), 2 on a usage error.
 *
 * The orchestrator's error is NEVER rethrown and its `.message` is NEVER printed, unlike
 * `runRecoveryUnpack`'s posture of rethrowing an unrecognised error. The reason is no longer a
 * subprocess — there is none — it is that this is a disaster-recovery CLI whose failure path is the
 * one an operator is most likely to see and to paste somewhere, and the messages that reach it come
 * from outside this function: a filesystem error names the path it failed on, and any bug anywhere
 * in `restoreFromArtifact`'s chain throws whatever its thrower wrote. Reporting a CODE carries no
 * value from outside the image; reporting a message carries whatever the thrower put in it.
 */
export async function runRestore(deps: CommandDeps): Promise<number> {
  const [cmd, artifactPath] = deps.argv;
  const bucketFlag = deps.argv.indexOf("--from-bucket", 1);
  const kitPath = bucketFlag === -1 ? undefined : deps.argv[bucketFlag + 1];
  if (
    cmd !== "restore" ||
    artifactPath === undefined ||
    (bucketFlag !== -1 && (kitPath === undefined || kitPath.startsWith("--")))
  ) {
    deps.out(
      "usage: waitron-restore restore <artifact-path> [--confirm-old-box-gone] | restore --from-bucket <kit-file> [--confirm-venue <tax-id>] [--confirm-old-box-gone]",
    );
    return 2;
  }
  if (bucketFlag !== -1) return runBucketRestore(deps, kitPath!);

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

  // `deploymentEnvironment` throws `server.config_invalid` for a bad `WAITRON_ENV`; caught here so
  // runRestore never rejects with a raw error.
  let environment: DeploymentEnvironment;
  try {
    environment = deploymentEnvironment(deps.env);
  } catch (err) {
    deps.out(`restore failed: ${(err as AppError).code}`);
    return 1;
  }

  const restoreDeps: RestoreDeps = {
    artifact,
    recoveryKey,
    // The same resolution `config.ts` does for `venueDir`, against the state root that won above:
    // unset or EMPTY takes `<stateDir>/venue`, never `resolve("")` — which is the working directory.
    venueDir: resolveConfigDir(deps.env.WAITRON_VENUE_DIR, join(resolvedStateDir, "venue")),
    stateDir: resolvedStateDir,
    stagingDir: join(resolvedStateDir, RESTORE_STAGING_DIR),
    migrationsRoot: isUnset(migrationsDir) ? DEFAULT_MIGRATIONS_ROOT : migrationsDir,
    modules: ALL_MODULES,
    environment,
    checkSourceLive: (validated) =>
      refuseIfArchiveSourceLive({
        validated,
        stateDir: resolvedStateDir,
        oldBoxGone: deps.argv.includes(CONFIRM_OLD_BOX_GONE),
        now: clock,
        openStore: boundedOpener(deps),
      }),
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
    deps.out((err instanceof AppError && archiveRefusal(err)) || sharedRefusal(err));
    return 1;
  }

  deps.out(`restored ${artifactPath}`);
  return 0;
}

/** The words for a refusal only the archive path words its own way; null for any other. */
function archiveRefusal(err: AppError): string | null {
  if (DECRYPT_PHASE_CODES.has(err.code))
    return "restore failed: wrong recovery key or corrupt artifact";
  if (hasCode(err, "restore.stream_source_live")) {
    return `restore failed: restore.stream_source_live — the server this backup came from wrote to its bucket at ${err.params.lastChangeAt} and may still be selling; if it is switched off for good, re-run with ${CONFIRM_OLD_BOX_GONE}`;
  }
  if (hasCode(err, "restore.stream_source_unchecked")) {
    return `restore failed: restore.stream_source_unchecked — whether the server this backup came from is still writing to its bucket could not be checked; if it is switched off for good, re-run with ${CONFIRM_OLD_BOX_GONE}`;
  }
  return null;
}

/**
 * The words both paths share. Anything outside the known codes is the fixed `restore failed`, never
 * `err.message`: a filesystem error names the path it failed on, and any bug in the restore's chain
 * throws whatever its thrower wrote, while a box operator's only window is this terminal.
 */
function sharedRefusal(err: unknown): string {
  if (!(err instanceof AppError)) return "restore failed";
  if (err.code === "provisioning.database_in_use") {
    return "restore failed: provisioning.database_in_use — another process, usually the Waitron server, is using this venue folder; stop it first (docker compose stop app)";
  }
  if (hasCode(err, "restore.hook_failed")) {
    return `restore failed: restore.hook_failed (module ${err.params.module}: ${err.params.code})`;
  }
  if (/^(restore|recovery|backup)\./.test(err.code)) return `restore failed: ${err.code}`;
  return "restore failed";
}

function boundedOpener(deps: CommandDeps): (bucket: BucketConfig) => ObjectStore {
  return (bucket) =>
    boundObjectStore((deps.openStore ?? createS3ObjectStore)(bucket), deps.bucketTimeoutMs);
}

const KEY_DOES_NOT_OPEN =
  "restore failed: the recovery key in this kit does not open the copy's locked secrets, or they are damaged";

/** The words for a refusal of the bucket path; null for one it reports as the archive path does. */
function bucketRefusal(err: AppError): string | null {
  if (DECRYPT_PHASE_CODES.has(err.code)) return KEY_DOES_NOT_OPEN;
  const failed = `restore failed: ${err.code} — `;
  if (hasCode(err, "restore.stream_venue_unconfirmed")) {
    return err.params.taxId === ""
      ? `${failed}the copy in the bucket names no business tax id, so it cannot be confirmed or restored`
      : `${failed}if ${err.params.legalName} (tax id ${err.params.taxId}) is your business, re-run with --confirm-venue ${err.params.taxId}`;
  }
  if (hasCode(err, "restore.stream_source_live")) {
    return `${failed}the old server wrote to the bucket at ${err.params.lastChangeAt}; if it is switched off for good, re-run with ${CONFIRM_OLD_BOX_GONE}`;
  }
  if (hasCode(err, "restore.stream_pointer_unverified")) {
    return err.params.reason === "signature"
      ? `${failed}the copy in the bucket was not signed by the key in this kit, so it is not trusted; check that the kit is this venue's newest`
      : `${failed}the bucket's record of its newest copy names a different venue from this kit`;
  }
  const words: Partial<Record<string, string>> = {
    "restore.stream_source_unchecked": `whether the old server is still writing to the bucket could not be checked; if it is switched off for good, re-run with ${CONFIRM_OLD_BOX_GONE}`,
    "restore.stream_disk_full":
      "the disk filled while the copy was downloading; nothing on this server changed. Free some space and run it again",
    "restore.stream_pointer_missing":
      "the bucket holds no copy for the venue this kit names; check that the kit is this venue's",
    "restore.stream_integrity_failed": "the copy downloaded from the bucket is damaged",
    "restore.stream_state_missing":
      "the copy in the bucket does not hold the old server's locked secrets, so it cannot be restored",
    "provisioning.database_ahead":
      "the copy in the bucket was made by newer Waitron software than this server has; update this server first",
    "backup.stream_restore_failed":
      "the copy could not be downloaded from the bucket; check this server's network and the bucket, then run it again",
    "backup.stream_request_failed":
      "the bucket did not answer, or refused the kit's key; check this server's network and that the bucket and its key still exist",
  };
  const said = words[err.code];
  return said === undefined ? null : failed + said;
}

/**
 * `restore --from-bucket <kit-file>`: rebuilds this box from the venue's bucket copy
 * ({@link restoreFromStream}). The recovery key and the bucket's secret come from the kit, so the
 * environment holds neither, and no printed line carries the kit's text.
 */
async function runBucketRestore(deps: CommandDeps, kitPath: string): Promise<number> {
  let kitText: string;
  try {
    kitText = await readFile(kitPath, "utf8");
  } catch {
    deps.out(`cannot read kit file: ${kitPath}`);
    return 1;
  }
  let kit: RecoveryKit;
  try {
    kit = parseRecoveryKit(kitText);
  } catch (err) {
    deps.out(
      hasCode(err as AppError, "backup.stream_kit_invalid") &&
        (err as AppError<"backup.stream_kit_invalid">).params.reason === "not_found"
        ? "restore failed: backup.stream_kit_invalid — the file holds no recovery kit; give the recovery kit file saved for this venue"
        : "restore failed: backup.stream_kit_invalid — the recovery kit in the file is incomplete or damaged, perhaps cut short when it was copied; use the whole kit file as it was saved",
    );
    return 1;
  }
  let environment: DeploymentEnvironment;
  try {
    environment = deploymentEnvironment(deps.env);
  } catch (err) {
    deps.out(`restore failed: ${(err as AppError).code}`);
    return 1;
  }
  const venueFlag = deps.argv.indexOf("--confirm-venue");
  const confirmedTaxId = venueFlag === -1 ? undefined : deps.argv[venueFlag + 1];
  const stateDir = resolveConfigDir(deps.env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  const migrationsDir = deps.env.WAITRON_MIGRATIONS_DIR;
  deps.out(
    "cold restore from the bucket: use only when the old server is gone — two servers selling from one database cannot be reconciled",
  );
  try {
    await (deps.restoreStream ?? restoreFromStream)({
      kit,
      oldBoxGone: deps.argv.includes(CONFIRM_OLD_BOX_GONE),
      environment,
      stateDir,
      venueDir: resolveConfigDir(deps.env.WAITRON_VENUE_DIR, join(stateDir, "venue")),
      stagingDir: join(stateDir, RESTORE_STAGING_DIR),
      migrationsRoot: isUnset(migrationsDir) ? DEFAULT_MIGRATIONS_ROOT : migrationsDir,
      modules: ALL_MODULES,
      litestreamBin: resolveLitestreamBin(deps.env),
      openStore: boundedOpener(deps),
      now: clock,
      confirmVenue: (venue) => {
        deps.out(
          `the copy in the bucket is: ${venue.legalName}, tax id ${venue.taxId}, location ${venue.locationName}`,
        );
        return venue.taxId !== "" && confirmedTaxId === venue.taxId;
      },
      log: createLogger(
        (line) => deps.out(line.trimEnd()),
        () => new Date(),
      ),
    });
  } catch (err) {
    deps.out((err instanceof AppError && bucketRefusal(err)) || sharedRefusal(err));
    return 1;
  }
  deps.out(`restored from the bucket named in ${kitPath}`);
  return 0;
}
