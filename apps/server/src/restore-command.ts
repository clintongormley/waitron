import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, hasCode } from "@waitron/shared";
import {
  createS3ObjectStore,
  type S3FileStore,
  parseRecoveryKit,
  resolveLitestreamBin,
  type BucketConfig,
  type ObjectStore,
  type RecoveryKit,
} from "@waitron/stream";
import { downloadArchive, type DownloadedArchive } from "./archive-download.js";
import { decodeArchiveRecoveryPack, type ArchiveRecoveryPack } from "./archive-recovery-pack.js";
import { DEFAULT_DESTINATION_TIMEOUT_MS } from "./backup-config.js";
import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { boundObjectStore } from "./bounded-store.js";
import { deploymentEnvironment, resolveConfigDir, type DeploymentEnvironment } from "./config.js";
import { isUnset } from "./env-value.js";
import { createLogger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import {
  RESTORE_STAGING_DIR,
  restoreFromArtifactFile,
  type RestoreFileDeps,
  type RestoreOperationRunner,
} from "./restore.js";
import { confirmsVenue, refuseIfArchiveSourceLive, restoreFromStream } from "./restore-stream.js";
import "./errors.js";
import {
  createRecoveryRestoreRunner,
  readRecoveryOperationFile,
} from "./recovery-module-operation.js";

type Env = NodeJS.ProcessEnv;
type RestoreStream = (deps: Parameters<typeof restoreFromStream>[0]) => Promise<void>;

interface CommandDeps {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  restore?: (args: RestoreFileDeps) => Promise<void>;
  restoreStream?: RestoreStream;
  /** Opens the bucket; every call on what it returns is bounded. Default {@link createS3ObjectStore}. */
  openStore?: (bucket: BucketConfig) => ObjectStore;
  bucketTimeoutMs?: number;
  /** Opens the archive's bucket for `--from-archive`. Default `createS3FileStore`. */
  openArchiveFiles?: (bucket: BucketConfig) => S3FileStore;
  /** How long the `--from-archive` download may take. Default {@link DEFAULT_DESTINATION_TIMEOUT_MS}. */
  archiveTimeoutMs?: number;
  withModuleOperations?: RestoreOperationRunner;
}

const CONFIRM_OLD_BOX_GONE = "--confirm-old-box-gone";
const FROM_BUCKET = "--from-bucket";
const CONFIRM_VENUE = "--confirm-venue";
const FROM_ARCHIVE = "--from-archive";
const ARCHIVE_KEY = "--archive-key";
const VALUED_FLAGS: ReadonlySet<string> = new Set([
  FROM_BUCKET,
  CONFIRM_VENUE,
  FROM_ARCHIVE,
  ARCHIVE_KEY,
]);
const clock = (): Date => new Date();

/**
 * The codes `decryptArtifact`/`unpackArchive` throw. Each restore form collapses them into one
 * message of its own: telling "wrong recovery key" from "corrupt
 * artifact" would hand someone holding a stolen artifact an oracle to guess the recovery key against.
 */
const DECRYPT_PHASE_CODES: ReadonlySet<string> = new Set([
  "recovery.passphrase_invalid",
  "backup.artifact_invalid",
  "backup.archive_invalid",
]);

/**
 * `waitron-restore restore <artifact-path>` restores one backup artifact; `restore --from-bucket
 * <kit-file>` rebuilds from the venue's bucket copy instead, and `restore --from-archive <pack-file>
 * --archive-key <name>` downloads one archive and restores it as the first form does. The
 * recovery key comes from `WAITRON_BACKUP_RECOVERY_KEY`, the kit file or the pack file, never
 * argv: an argv element leaks into `ps`.
 *
 * Returns a process exit code: 0 on success, 1 on a failure, 2 on a usage error.
 */
export async function runRestore(deps: CommandDeps): Promise<number> {
  const args = parseArgs(deps.argv);
  if (args === null) {
    deps.out(
      "usage: waitron-restore restore <artifact-path> [--confirm-old-box-gone] | restore --from-bucket <kit-file> [--confirm-venue <tax-id>] [--confirm-old-box-gone] | restore --from-archive <pack-file> --archive-key <name> [--confirm-old-box-gone]",
    );
    return 2;
  }
  if ("kitPath" in args) return runBucketRestore(deps, args);
  if ("packPath" in args) return runPackRestore(deps, args);
  const { artifactPath, oldBoxGone } = args;

  const recoveryKey = deps.env.WAITRON_BACKUP_RECOVERY_KEY;
  if (isUnset(recoveryKey)) {
    deps.out("WAITRON_BACKUP_RECOVERY_KEY must be set to the backup's recovery key");
    return 1;
  }

  try {
    const file = await open(artifactPath, "r");
    try {
      if (!(await file.stat()).isFile()) throw new Error("not a file");
    } finally {
      await file.close();
    }
  } catch {
    deps.out(`cannot read artifact file: ${artifactPath}`);
    return 1;
  }

  const target = await resolveRestoreTarget(deps);
  if (typeof target === "number") return target;
  deps.out(COLD_RESTORE_NOTICE);
  const restored = await restoreArtifact(deps, target, artifactPath, recoveryKey, oldBoxGone, {
    keyDoesNotOpen: "restore failed: wrong recovery key or corrupt artifact",
  });
  if (!restored) return 1;
  deps.out(`restored ${artifactPath}`);
  return 0;
}

const COLD_RESTORE_NOTICE =
  "cold restore: use only when no peer (mirror or local secondary) survived — a survivor holds more history and is promoted, not overwritten";

/**
 * The archive restore chain both file forms share; false once the refusal is printed.
 * `keyDoesNotOpen` is the one line for every {@link DECRYPT_PHASE_CODES} refusal.
 */
async function restoreArtifact(
  deps: CommandDeps,
  target: RestoreTarget,
  artifactPath: string,
  recoveryKey: string,
  oldBoxGone: boolean,
  words: { keyDoesNotOpen: string },
): Promise<boolean> {
  try {
    await (deps.restore ?? restoreFromArtifactFile)({
      ...target,
      artifactPath,
      recoveryKey,
      checkSourceLive: (validated) =>
        refuseIfArchiveSourceLive({
          validated,
          stateDir: target.stateDir,
          oldBoxGone,
          now: clock,
          openStore: boundedOpener(deps),
        }),
    });
    return true;
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "ENOSPC") deps.out(RESTORE_DISK_FULL);
    else if (err instanceof AppError && DECRYPT_PHASE_CODES.has(err.code)) {
      deps.out(words.keyDoesNotOpen);
    } else {
      deps.out(
        (err instanceof AppError && sourceLiveRefusal(err, "the server this backup came from")) ||
          sharedRefusal(err),
      );
    }
    return false;
  }
}

/**
 * No "nothing changed": the last secrets write runs after the database is placed
 * (`placeValidated`, `restore.ts`).
 */
const RESTORE_DISK_FULL =
  "restore failed: the disk filled during the restore; free some space and run it again";

type ParsedArgs =
  | { artifactPath: string; oldBoxGone: boolean }
  | { kitPath: string; confirmedTaxId: string | undefined; oldBoxGone: boolean }
  | { packPath: string; archiveKey: string; oldBoxGone: boolean };

/**
 * Each form takes exactly its own flags, each once: `<artifact-path> [--confirm-old-box-gone]`,
 * `--from-bucket <kit-file> [--confirm-old-box-gone] [--confirm-venue <tax-id>]`, or
 * `--from-archive <pack-file> --archive-key <name> [--confirm-old-box-gone]`, in any order.
 * A flag's value may not itself start with `--`. Null for anything else.
 */
function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const [cmd, ...rest] = argv;
  if (cmd !== "restore") return null;
  const valued: Record<string, string | undefined> = {};
  let artifactPath: string | undefined;
  let oldBoxGone = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === CONFIRM_OLD_BOX_GONE) {
      if (oldBoxGone) return null;
      oldBoxGone = true;
    } else if (VALUED_FLAGS.has(arg)) {
      const value = rest[++i];
      if (value === undefined || value.startsWith("--") || arg in valued) return null;
      valued[arg] = value;
    } else if (arg.startsWith("--") || artifactPath !== undefined) {
      return null;
    } else {
      artifactPath = arg;
    }
  }
  const kitPath = valued[FROM_BUCKET];
  const confirmedTaxId = valued[CONFIRM_VENUE];
  const packPath = valued[FROM_ARCHIVE];
  const archiveKey = valued[ARCHIVE_KEY];
  if (packPath !== undefined || archiveKey !== undefined) {
    return packPath !== undefined &&
      archiveKey !== undefined &&
      kitPath === undefined &&
      confirmedTaxId === undefined &&
      artifactPath === undefined
      ? { packPath, archiveKey, oldBoxGone }
      : null;
  }
  if (kitPath !== undefined) {
    return artifactPath === undefined ? { kitPath, confirmedTaxId, oldBoxGone } : null;
  }
  return artifactPath !== undefined && confirmedTaxId === undefined
    ? { artifactPath, oldBoxGone }
    : null;
}

type RestoreTarget = Pick<
  RestoreFileDeps,
  | "stateDir"
  | "venueDir"
  | "stagingDir"
  | "migrationsRoot"
  | "modules"
  | "environment"
  | "log"
  | "withModuleOperations"
>;

/**
 * Where the restore goes and under which environment, from the same variables and defaults as
 * `loadConfig` (`config.ts`); an exit code, with the reason printed, when `WAITRON_ENV` is invalid.
 * `modules` is every module, never an enabled subset: a restore hook must run for every module
 * whose tables are in the backup.
 */
async function resolveRestoreTarget(deps: CommandDeps): Promise<RestoreTarget | number> {
  let environment: DeploymentEnvironment;
  let withModuleOperations = deps.withModuleOperations;
  try {
    environment = deploymentEnvironment(deps.env);
    const path = deps.env.WAITRON_RECOVERY_OPERATION_FILE;
    if (!isUnset(path)) {
      withModuleOperations = createRecoveryRestoreRunner(
        ALL_MODULES,
        await readRecoveryOperationFile(path),
        deps.env.WAITRON_NODE_RECOVERY_KEY,
      );
    }
  } catch (err) {
    deps.out(`restore failed: ${(err as AppError).code}`);
    return 1;
  }
  const migrationsDir = deps.env.WAITRON_MIGRATIONS_DIR;
  const stateDir = resolveConfigDir(deps.env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  return {
    stateDir,
    // Unset or EMPTY takes `<stateDir>/venue`, never `resolve("")` — which is the working directory.
    venueDir: resolveConfigDir(deps.env.WAITRON_VENUE_DIR, join(stateDir, "venue")),
    stagingDir: join(stateDir, RESTORE_STAGING_DIR),
    migrationsRoot: isUnset(migrationsDir) ? DEFAULT_MIGRATIONS_ROOT : migrationsDir,
    modules: ALL_MODULES,
    environment,
    ...(withModuleOperations === undefined ? {} : { withModuleOperations }),
    log: createLogger(
      (line) => deps.out(line.trimEnd()),
      () => new Date(),
    ),
  };
}

function sourceLiveRefusal(err: AppError, subject: string): string | null {
  const goAhead = `if it is switched off for good, re-run with ${CONFIRM_OLD_BOX_GONE}`;
  if (hasCode(err, "restore.stream_source_live")) {
    return `restore failed: restore.stream_source_live — ${subject} wrote to its bucket at ${err.params.lastChangeAt} and may still be selling; ${goAhead}`;
  }
  if (hasCode(err, "restore.stream_source_unchecked")) {
    return `restore failed: restore.stream_source_unchecked — whether ${subject} is still writing to its bucket could not be checked; ${goAhead}`;
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
  if (err.code === "promotion.break_glass_invalid")
    return "restore failed: promotion.break_glass_invalid — use the selected backup's node recovery key";
  if (err.code === "provisioning.database_in_use") {
    return "restore failed: provisioning.database_in_use — another process, usually the Waitron server, is using this venue folder; stop it first (docker compose stop app)";
  }
  if (hasCode(err, "restore.hook_failed")) {
    return `restore failed: restore.hook_failed (module ${err.params.module}: ${err.params.code})`;
  }
  if (hasCode(err, "restore.placement_failed")) {
    const failed =
      "restore failed: restore.placement_failed — the restored database could not be put in place";
    return err.params.kept === "previous"
      ? `${failed}; this server's previous database is unchanged`
      : `${failed}, and the previous database could not all be put back: what was not is in the folder ${err.params.folder} inside the venue folder; move everything in it back into the venue folder before starting the server`;
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
  const sourceLive = sourceLiveRefusal(err, "the old server");
  if (sourceLive !== null) return sourceLive;
  const failed = `restore failed: ${err.code} — `;
  if (hasCode(err, "restore.stream_venue_unconfirmed")) {
    return err.params.taxId === ""
      ? `${failed}the copy in the bucket names no business tax id, so it cannot be confirmed or restored`
      : `${failed}if ${err.params.legalName} (tax id ${err.params.taxId}) is your business, re-run with --confirm-venue ${err.params.taxId}`;
  }
  if (hasCode(err, "restore.stream_pointer_unverified")) {
    return err.params.reason === "signature"
      ? `${failed}the copy in the bucket was not signed by the key in this kit, so it is not trusted; check that the kit is this venue's newest`
      : `${failed}the bucket's record of its newest copy names a different venue from this kit`;
  }
  const words: Partial<Record<string, string>> = {
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
      "the copy could not be downloaded from the bucket, for a reason on this server, on its network or at the bucket; check this server's network, the bucket, and that this server's disk and state folder can be written, then run it again",
    "backup.stream_request_failed":
      "the bucket did not answer, or refused the kit's key; check this server's network and that the bucket and its key still exist",
  };
  const said = words[err.code];
  return said === undefined ? null : failed + said;
}

/** The recovery key and the bucket's secret come from the kit; no printed line carries its text. */
async function runBucketRestore(
  deps: CommandDeps,
  args: Extract<ParsedArgs, { kitPath: string }>,
): Promise<number> {
  const { kitPath, confirmedTaxId, oldBoxGone } = args;
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
  const target = await resolveRestoreTarget(deps);
  if (typeof target === "number") return target;
  deps.out(
    "cold restore from the bucket: use only when the old server is gone — two servers selling from one database cannot be reconciled",
  );
  try {
    await (deps.restoreStream ?? restoreFromStream)({
      ...target,
      kit,
      oldBoxGone,
      litestreamBin: resolveLitestreamBin(deps.env),
      openStore: boundedOpener(deps),
      now: clock,
      confirmVenue: (venue) => {
        deps.out(
          `the copy in the bucket is: ${venue.legalName}, tax id ${venue.taxId}, location ${venue.locationName}`,
        );
        return confirmsVenue(venue, confirmedTaxId);
      },
    });
  } catch (err) {
    deps.out((err instanceof AppError && bucketRefusal(err)) || sharedRefusal(err));
    return 1;
  }
  deps.out(`restored from the bucket named in ${kitPath}`);
  return 0;
}

/** The words for a refusal only the pack path words its own way; null for any other. */
function packRefusal(err: AppError): string | null {
  const words: Partial<Record<string, string>> = {
    "restore.archive_key_invalid":
      "that is not the name of a backup archive; give the archive's file name exactly as the bucket lists it, such as waitron-20261001T030000Z-<id>.backup.enc",
    "restore.archive_missing":
      "the bucket holds no archive by that name in this venue's archive folder; check the name and that the pack is this venue's",
    "restore.archive_disk_full":
      "there is not enough free disk space to download the archive; nothing on this server changed. Free some space and run it again",
    "restore.archive_download_failed":
      "the archive could not be downloaded from the bucket, for a reason on this server, on its network or at the bucket; check this server's network, the bucket and its key, and that this server's disk and state folder can be written, then run it again",
  };
  const said = words[err.code];
  return said === undefined ? null : `restore failed: ${err.code} — ${said}`;
}

const PACK_KEY_DOES_NOT_OPEN =
  "restore failed: the recovery key in this pack does not open the archive, or the archive is damaged";

/** Fixed words: the error would name the path and its cause. */
const DOWNLOAD_LEFT_BEHIND =
  "the downloaded archive could not be removed: once no restore is running, delete the archive-download-* folder inside the state folder's restore-staging folder by hand";

/**
 * The recovery key and the bucket's secret come from the pack, never the environment; no printed
 * line carries the pack's text.
 */
async function runPackRestore(
  deps: CommandDeps,
  args: Extract<ParsedArgs, { packPath: string }>,
): Promise<number> {
  const { packPath, archiveKey, oldBoxGone } = args;
  let packText: string;
  try {
    packText = await readFile(packPath, "utf8");
  } catch {
    deps.out(`cannot read pack file: ${packPath}`);
    return 1;
  }
  let pack: ArchiveRecoveryPack;
  try {
    pack = decodeArchiveRecoveryPack(packText);
  } catch (err) {
    const reason = hasCode(err as AppError, "backup.archive_recovery_pack_invalid")
      ? (err as AppError<"backup.archive_recovery_pack_invalid">).params.reason
      : undefined;
    deps.out(
      reason === "not_found"
        ? "restore failed: backup.archive_recovery_pack_invalid — the file holds no archive recovery pack; give the archive recovery pack file saved for this venue"
        : reason === "several"
          ? "restore failed: backup.archive_recovery_pack_invalid — the file holds more than one archive recovery pack; give a file holding only the pack for the archive you want"
          : "restore failed: backup.archive_recovery_pack_invalid — the archive recovery pack in the file is incomplete or damaged, perhaps cut short when it was copied; use the whole pack file as it was saved",
    );
    return 1;
  }
  const target = await resolveRestoreTarget(deps);
  if (typeof target === "number") return target;
  deps.out(COLD_RESTORE_NOTICE);
  let downloaded: DownloadedArchive;
  try {
    downloaded = await downloadArchive({
      pack,
      key: archiveKey,
      stagingDir: target.stagingDir,
      signal: AbortSignal.timeout(deps.archiveTimeoutMs ?? DEFAULT_DESTINATION_TIMEOUT_MS),
      openFiles: deps.openArchiveFiles,
    });
  } catch (err) {
    deps.out((err instanceof AppError && packRefusal(err)) || sharedRefusal(err));
    return 1;
  }
  let restored: boolean;
  try {
    restored = await restoreArtifact(deps, target, downloaded.path, pack.recoveryKey, oldBoxGone, {
      keyDoesNotOpen: PACK_KEY_DOES_NOT_OPEN,
    });
    if (restored) deps.out(`restored archive ${archiveKey} from the bucket named in ${packPath}`);
  } finally {
    await downloaded.dispose().catch(() => deps.out(DOWNLOAD_LEFT_BEHIND));
  }
  return restored ? 0 : 1;
}
