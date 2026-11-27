import { venueDirOf } from "@waitron/store";
import {
  assertNoStartAgainDeletion,
  assertVenueFirstSetupAllowed,
  inspectFirstSetupMarker,
  readRestoreFlowPhase,
} from "@waitron/provisioning";
import type { VenueLock } from "@waitron/db";
import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { looksLikePdf, RecoveryPackFileError, type RecoveryPackFile } from "@waitron/recovery-pack";
import { readRecoveryPackPdf } from "@waitron/recovery-pack/src/read-pack-pdf.js";
import { AppError, diskFullIn, hasCode, readVariable } from "@waitron/shared";
import {
  createS3FolderStore,
  readBucketConfig,
  resolveLitestreamBin,
  type BucketConfig,
  type ObjectStore,
  type S3ObjectStore,
} from "@waitron/stream";
import { readArtifactFileHeader } from "./artifact-cipher-file.js";
import { headerOpeningKey } from "./backup-file-key.js";
import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { boundObjectStore } from "./bounded-store.js";
import { deploymentEnvironment, resolveConfigDir, type DeploymentEnvironment } from "./config.js";
import { parseEnvFile } from "./env-file.js";
import { isUnset } from "./env-value.js";
import { createLogger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import { RESTORE_STAGING_DIR } from "./restore-staging-dirs.js";
import {
  lockRestoreTarget,
  restoreFromArtifactFile,
  validateArtifactFile,
  type RestoreFileDeps,
  type RestoreOperationRunner,
  type ValidatedArtifact,
} from "./restore.js";
import { confirmsVenue, refuseIfArchiveSourceLive, restoreFromStream } from "./restore-stream.js";
import type { BootReading } from "./boot-reader.js";
import "./errors.js";
import {
  createRecoveryRestoreRunner,
  readRecoveryOperationFile,
  type RecoveryOperationInput,
} from "./recovery-module-operation.js";

import { createRecoveryEntryRunner } from "./recovery-entry.js";

type Env = NodeJS.ProcessEnv;
type RestoreStream = (deps: Parameters<typeof restoreFromStream>[0]) => Promise<void>;
type BucketLocation = Omit<BucketConfig, "accessKeyId" | "secretAccessKey">;
type RestoreBucketStore = ObjectStore & Partial<Pick<S3ObjectStore, "listFolders">>;

interface CommandDeps {
  argv: string[];
  env: Env;
  out: (line: string) => void;
  restore?: (args: RestoreFileDeps) => Promise<void>;
  restoreStream?: RestoreStream;
  /** Opens the bucket; every call on what it returns is bounded. */
  openStore?: (bucket: BucketConfig) => RestoreBucketStore;
  bucketTimeoutMs?: number;
  withModuleOperations?: RestoreOperationRunner;
  /** Holds the venue folder from resolving the target to exit. Default {@link lockRestoreTarget}. */
  lockVenue?: (venueDir: string) => Promise<VenueLock>;
  /** Absent, the box's own boot reading. */
  readBoot?: () => BootReading;
}

const CONFIRM_OLD_BOX_GONE = "--confirm-old-box-gone";
const CONFIRM_SOLE_RECOVERY = "--confirm-sole-recovery";
const FROM_BUCKET = "--from-bucket";
const CONFIRM_VENUE = "--confirm-venue";
const MASTER_KEY_FILE = "--master-key-file";
const BUCKET_FILE = "--bucket-credentials-file";
const BUCKET_OPTIONS = ["--bucket", "--region", "--prefix", "--endpoint", BUCKET_FILE];
const VALUED_FLAGS: ReadonlySet<string> = new Set([
  CONFIRM_VENUE,
  MASTER_KEY_FILE,
  ...BUCKET_OPTIONS,
]);
const clock = (): Date => new Date();

/**
 * Each restore form words these as one message of its own. A version 1 file names no key, so a
 * wrong key and a damaged file are not told apart there. A version 2 file's header names its master
 * key's id, which anyone can compute from a candidate key, and `headerOpeningKey` refuses a key that
 * does not match it before decrypting; a refusal here under a matching key is a damaged file.
 */
const DECRYPT_PHASE_CODES: ReadonlySet<string> = new Set([
  "recovery.passphrase_invalid",
  "backup.artifact_invalid",
  "backup.archive_invalid",
  "backup.archive_key_invalid",
]);

/**
 * A backup file or bucket copy opens with the master key. A Waitron Cloud copy (version 1) opens
 * with `WAITRON_BACKUP_RECOVERY_KEY`. Keys stay out of argv because argv is visible in `ps`.
 *
 * Returns a process exit code: 0 on success, 1 on a failure, 2 on a usage error.
 */
export async function runRestore(deps: CommandDeps): Promise<number> {
  const args = parseArgs(deps.argv);
  if (args === null) {
    deps.out(
      "usage: waitron-restore restore <artifact-path> [--master-key-file <path>] [--confirm-old-box-gone] [--confirm-sole-recovery] | restore --from-bucket --bucket <name> --region <region> [--endpoint <url>] [--prefix <folder>] [--bucket-credentials-file <path>] [--master-key-file <path>] [--confirm-venue <tax-id>] [--confirm-old-box-gone] [--confirm-sole-recovery]",
    );
    return 2;
  }
  if ("bucket" in args) return runBucketRestore(deps, args);
  const { artifactPath, masterKeyFile, oldBoxGone, soleRecovery } = args;

  const masterKey = await readMasterKey(deps, masterKeyFile);
  if (masterKey === null) return 1;
  const cloudKey = readVariable(deps.env, "WAITRON_BACKUP_RECOVERY_KEY");
  if (masterKey === undefined && isUnset(cloudKey)) {
    deps.out(
      "restore failed: give the master key: set WAITRON_MASTER_KEY or give --master-key-file (a Waitron Cloud copy opens with WAITRON_BACKUP_RECOVERY_KEY)",
    );
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

  const opening = await fileOpeningKey(artifactPath, masterKey, cloudKey);
  if ("refused" in opening) {
    deps.out(opening.refused);
    return 1;
  }

  // The master key from a file also authorises the restore, as WAITRON_MASTER_KEY would.
  const authorising = masterKeyFile === undefined ? envMasterKey(deps) : masterKey;
  const resolved = await resolveRestoreTarget(deps, authorising);
  if (typeof resolved === "number") return resolved;
  const { target, hold } = resolved;
  try {
    deps.out(COLD_RESTORE_NOTICE);
    const restored = await restoreArtifact(
      deps,
      target,
      artifactPath,
      opening,
      authorising,
      oldBoxGone,
      soleRecovery,
    );
    if (!restored) return 1;
    deps.out(`restored ${artifactPath}`);
    return 0;
  } finally {
    hold.release();
  }
}

const COLD_RESTORE_NOTICE =
  "cold restore: use only when no peer (mirror or local secondary) survived — a survivor holds more history and is promoted, not overwritten";

/** The file restore; false once the refusal is printed. */
async function restoreArtifact(
  deps: CommandDeps,
  target: RestoreTarget,
  artifactPath: string,
  opening: { key: string; underMasterKey: boolean },
  masterKey: string | undefined,
  oldBoxGone: boolean,
  soleRecovery: boolean,
): Promise<boolean> {
  const recoveryKey = opening.key;
  try {
    const withModuleOperations = soleRecovery
      ? await archiveRecoveryRunner(deps, target, artifactPath, recoveryKey, masterKey, oldBoxGone)
      : target.withModuleOperations;
    await (deps.restore ?? restoreFromArtifactFile)({
      ...target,
      withModuleOperations,
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
      deps.out(
        opening.underMasterKey
          ? BACKUP_FILE_DAMAGED
          : "restore failed: wrong recovery key or corrupt artifact",
      );
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
 * No "nothing changed": a disk that fills after the database is placed (the migration, the hooks)
 * leaves the restored database in place (`placeValidated`, `restore.ts`).
 */
const RESTORE_DISK_FULL =
  "restore failed: the disk filled during the restore; free some space and run it again";

const BACKUP_FILE_DAMAGED =
  "restore failed: the backup file is damaged, or was changed after it was made; choose another backup";

type ParsedArgs =
  | {
      artifactPath: string;
      masterKeyFile: string | undefined;
      oldBoxGone: boolean;
      soleRecovery: boolean;
    }
  | {
      bucket: BucketLocation;
      credentialsFile: string | undefined;
      masterKeyFile: string | undefined;
      confirmedTaxId: string | undefined;
      oldBoxGone: boolean;
      soleRecovery: boolean;
    };

function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const [cmd, ...rest] = argv;
  if (cmd !== "restore") return null;
  const valued: Record<string, string | undefined> = {};
  let artifactPath: string | undefined;
  let fromBucket = false;
  let oldBoxGone = false;
  let soleRecovery = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === CONFIRM_OLD_BOX_GONE) {
      if (oldBoxGone) return null;
      oldBoxGone = true;
    } else if (arg === CONFIRM_SOLE_RECOVERY) {
      if (soleRecovery) return null;
      soleRecovery = true;
    } else if (arg === FROM_BUCKET) {
      if (fromBucket) return null;
      fromBucket = true;
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
  const confirmedTaxId = valued[CONFIRM_VENUE];
  const masterKeyFile = valued[MASTER_KEY_FILE];
  if (fromBucket) {
    const bucket = valued["--bucket"];
    const region = valued["--region"];
    if (artifactPath !== undefined || !bucket || !region) return null;
    return {
      bucket: { bucket, region, endpoint: valued["--endpoint"], prefix: valued["--prefix"] ?? "" },
      credentialsFile: valued[BUCKET_FILE],
      masterKeyFile,
      confirmedTaxId,
      oldBoxGone,
      soleRecovery,
    };
  }
  return artifactPath !== undefined &&
    confirmedTaxId === undefined &&
    !BUCKET_OPTIONS.some((flag) => flag in valued)
    ? { artifactPath, masterKeyFile, oldBoxGone, soleRecovery }
    : null;
}

function envMasterKey(deps: CommandDeps): string | undefined {
  return readVariable(deps.env, "WAITRON_MASTER_KEY");
}

/**
 * The master key's text from `--master-key-file` (a text file, or the recovery pack PDF's
 * `masterKey`) or `WAITRON_MASTER_KEY`; `undefined` when neither is given, `null` once a refusal
 * is printed. No printed line carries the file's text.
 */
async function readMasterKey(
  deps: CommandDeps,
  masterKeyFile: string | undefined,
): Promise<string | undefined | null> {
  const fromEnv = envMasterKey(deps);
  if (masterKeyFile === undefined) return isUnset(fromEnv) ? undefined : fromEnv;
  if (!isUnset(fromEnv)) {
    deps.out(
      "restore failed: give the master key once: --master-key-file or WAITRON_MASTER_KEY, not both",
    );
    return null;
  }
  let source: Source;
  try {
    source = await sourceText(await readFile(masterKeyFile));
  } catch {
    deps.out(
      "cannot read the master key file: give a readable file holding the master key, or the recovery pack PDF",
    );
    return null;
  }
  if ("refused" in source) {
    deps.out(source.refused);
    return null;
  }
  return source.text.trim();
}

/**
 * The key text the restore opens the file with: a version 2 file's backup key, derived from the
 * master key; any other file's `WAITRON_BACKUP_RECOVERY_KEY`, as a Waitron Cloud copy needs.
 * `underMasterKey` says which.
 */
async function fileOpeningKey(
  artifactPath: string,
  masterKey: string | undefined,
  cloudKey: string | undefined,
): Promise<{ key: string; underMasterKey: boolean } | { refused: string }> {
  const header = await readArtifactFileHeader(artifactPath).catch(() => undefined);
  if (header?.version === 2) {
    if (masterKey === undefined)
      return {
        refused:
          "restore failed: this backup file opens with the master key; set WAITRON_MASTER_KEY or give --master-key-file",
      };
    try {
      return { key: headerOpeningKey(header, masterKey), underMasterKey: true };
    } catch (err) {
      return {
        refused: hasCode(err as AppError, "promotion.break_glass_invalid")
          ? sharedRefusal(err)
          : BACKUP_FILE_DAMAGED,
      };
    }
  }
  if (isUnset(cloudKey))
    return {
      refused:
        header?.version === 1
          ? "restore failed: this file is a Waitron Cloud copy, which opens with its recovery key; set WAITRON_BACKUP_RECOVERY_KEY to it"
          : "restore failed: this file is not a Waitron backup file, or it is damaged; choose another backup",
    };
  return { key: cloudKey, underMasterKey: false };
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
async function resolveRestoreTarget(
  deps: CommandDeps,
  masterKey: string | undefined,
): Promise<{ target: RestoreTarget; hold: VenueLock } | number> {
  let environment: DeploymentEnvironment;
  let withModuleOperations = deps.withModuleOperations;
  try {
    environment = deploymentEnvironment(deps.env);
    const path = readVariable(deps.env, "WAITRON_RECOVERY_OPERATION_FILE");
    if (!isUnset(path)) {
      withModuleOperations = createRecoveryRestoreRunner(
        ALL_MODULES,
        await readRecoveryOperationFile(path),
        masterKey,
      );
    }
  } catch (err) {
    deps.out(`restore failed: ${(err as AppError).code}`);
    return 1;
  }
  const migrationsDir = readVariable(deps.env, "WAITRON_MIGRATIONS_DIR");
  const stateDir = resolveConfigDir(
    readVariable(deps.env, "WAITRON_STATE_DIR"),
    DEFAULT_STATE_ROOT,
  );
  const venueDir = venueDirOf(deps.env, stateDir);
  const setupRefusal = (error: unknown) =>
    deps.out(
      error instanceof AppError && error.code === "restore.request_waiting"
        ? sharedRefusal(error)
        : error instanceof AppError
          ? `restore failed: ${error.code}`
          : "restore failed",
    );
  try {
    await assertNoStartAgainDeletion(venueDir);
  } catch (error) {
    setupRefusal(error);
    return 1;
  }
  let hold: VenueLock;
  try {
    hold = await (deps.lockVenue ?? lockRestoreTarget)(venueDir);
  } catch (error) {
    deps.out(sharedRefusal(error));
    return 1;
  }
  try {
    const phase = await readRestoreFlowPhase(stateDir);
    if (phase === "staged" || phase === "placing")
      throw new AppError("restore.request_waiting", {});
    if ((await inspectFirstSetupMarker(venueDir, stateDir)) !== null)
      await assertVenueFirstSetupAllowed(venueDir, stateDir);
  } catch (error) {
    hold.release();
    setupRefusal(error);
    return 1;
  }
  const target: RestoreTarget = {
    stateDir,
    // Unset or EMPTY takes `<stateDir>/venue`, never `resolve("")` — which is the working directory.
    venueDir,
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
  return { target, hold };
}

async function archiveRecoveryRunner(
  deps: CommandDeps,
  target: RestoreTarget,
  artifactPath: string,
  recoveryKey: string,
  masterKey: string | undefined,
  oldBoxGone: boolean,
): Promise<RestoreOperationRunner> {
  const path = readVariable(deps.env, "WAITRON_RECOVERY_OPERATION_FILE");
  const operation = await readRecoveryOperationFile(path ?? "");
  const copy = await validateArtifactFile({ ...target, artifactPath, recoveryKey });
  try {
    return await selectedRecoveryRunner(
      deps,
      target,
      copy,
      operation,
      masterKey,
      oldBoxGone,
      copy.sourceId,
    );
  } finally {
    await copy.discard();
  }
}

async function selectedRecoveryRunner(
  deps: CommandDeps,
  target: RestoreTarget,
  copy: ValidatedArtifact,
  operation: RecoveryOperationInput,
  masterKey: string | undefined,
  oldBoxGone: boolean,
  sourceId: string,
): Promise<RestoreOperationRunner> {
  return createRecoveryEntryRunner({
    ...target,
    copy,
    operation,
    secret: masterKey,
    context: { selectedSourceId: sourceId, oldBoxGone, soleRecovery: true },
    readBoot: deps.readBoot,
  });
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

const CLOCK_REFUSALS = new Set<unknown>(["second_clock_missing", "clock_unconfirmed"]);

/**
 * The words both paths share. Anything outside the known codes is the fixed `restore failed`, never
 * `err.message`: a filesystem error names the path it failed on, and any bug in the restore's chain
 * throws whatever its thrower wrote, while a box operator's only window is this terminal.
 */
function sharedRefusal(err: unknown): string {
  if (!(err instanceof AppError)) return "restore failed";
  if (err.code === "restore.request_waiting")
    return "restore failed: restore.request_waiting — a restore saved from the setup page is still waiting and this command changed nothing; start the server to run that restore. If it cannot finish, use Retry a normal boot or choose Throw this restore away on the HTTPS recovery page, using an administrator password from the selected backup; after discarding it, run this command again";
  // The series check could not confirm the box's time (`clockRefusal` in fiscal-verifactu's `hour-clock.ts`, and `hour-selection.ts`'s own refusals).
  const reason = (err.params as { reason?: unknown }).reason;
  if (err.code === "sif.allocation_invalid" && CLOCK_REFUSALS.has(reason))
    return `restore failed: sif.allocation_invalid (${String(reason)}) — the box's time is not confirmed, so no invoice series was made; check that timedatectl shows "System clock synchronized: yes", then run this command again`;
  if (err.code === "promotion.break_glass_invalid") {
    const keyName = (err.params as { keyName?: unknown }).keyName;
    return typeof keyName === "string"
      ? `restore failed: promotion.break_glass_invalid — wrong master key; use the one dated ${keyName}`
      : "restore failed: promotion.break_glass_invalid — use the selected backup's master key";
  }
  if (err.code === "provisioning.database_in_use") {
    return "restore failed: provisioning.database_in_use — another process, usually the Waitron server, is using this venue folder; stop it first (docker compose stop app)";
  }
  if (err.code === "provisioning.database_ahead")
    return "restore failed: provisioning.database_ahead — this backup was made by a different version of Waitron, which this server's version cannot restore; this server's database and identity are unchanged. Install that version on this server and run the same command again";
  if (err.code === "migrations.apply_failed") {
    if (diskFullIn(err)) return RESTORE_DISK_FULL;
    return "restore failed: migrations.apply_failed — the backup's database could not be updated to this version of Waitron; install a version that fixes this, then run the same command again: it starts the restore over";
  }
  if (hasCode(err, "restore.manifest_invalid"))
    return err.params.reason === "unsupported"
      ? "restore failed: this backup's manifest version is not supported. Use a Waitron version that supports this backup"
      : "restore failed: the backup's manifest is malformed. Choose another complete backup";
  if (hasCode(err, "restore.archive_resource_limit"))
    return "restore failed: not enough temporary disk space, or the space could not be measured. Free space on this box and try again";
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

function boundedOpener(deps: CommandDeps): (bucket: BucketConfig) => RestoreBucketStore {
  return (bucket) =>
    boundObjectStore((deps.openStore ?? createS3FolderStore)(bucket), deps.bucketTimeoutMs);
}

const KEY_DOES_NOT_OPEN =
  "restore failed: the backup's locked secrets could not be opened; try another backup copy";

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
    if (err.params.reason === "key_or_access")
      return `${failed}check that this copy matches the master key and the storage credentials can read it`;
    return `${failed}the backup's pointer did not pass its signature check; choose another backup`;
  }
  if (hasCode(err, "restore.stream_folder_required")) {
    const advice = `${failed}give the backup's specific folder with --prefix, then run the command again`;
    const folders = err.params.folders.map((folder) => JSON.stringify(folder)).join(", ");
    return folders === "" ? advice : `${advice}. Folders found: ${folders}`;
  }
  const words: Partial<Record<string, string>> = {
    "restore.stream_disk_full":
      "the disk filled while the copy was downloading; nothing on this server changed. Free some space and run it again",
    "restore.stream_pointer_missing": "no backup copy was found; check the bucket and folder",
    "restore.stream_integrity_failed":
      "the downloaded copy did not pass its checks; try again, or choose another backup",
    "restore.stream_state_missing":
      "the copy in the bucket does not hold the old server's locked secrets, so it cannot be restored",
    "restore.identity_unknown":
      "the copy in the bucket does not say which business it belongs to, so it cannot be restored",
    "provisioning.database_ahead":
      "the copy in the bucket was made by a different version of Waitron; this server's version cannot restore it. Install that version on this server and run it again",
    "backup.stream_restore_failed":
      "the copy could not be downloaded from the bucket, for a reason on this server, on its network or at the bucket; check this server's network, the bucket, and that this server's disk and state folder can be written, then run it again",
    "backup.stream_request_failed":
      "the bucket did not answer or refused access; check the network, bucket and storage credentials",
  };
  const said = words[err.code];
  return said === undefined ? null : failed + said;
}

async function commandBucket(
  deps: CommandDeps,
  location: BucketLocation,
  credentialsFile: string | undefined,
): Promise<BucketConfig | null> {
  let environment: Env = deps.env;
  if (credentialsFile !== undefined) {
    try {
      environment = parseEnvFile(await readFile(credentialsFile, "utf8"));
    } catch {
      deps.out("restore failed: give a readable bucket credentials file");
      return null;
    }
  }
  const accessKeyId = readVariable(environment, "WAITRON_RESTORE_BUCKET_ACCESS_KEY_ID");
  const secretAccessKey = readVariable(environment, "WAITRON_RESTORE_BUCKET_SECRET_ACCESS_KEY");
  if (isUnset(accessKeyId) || isUnset(secretAccessKey)) {
    deps.out(
      "restore failed: set WAITRON_RESTORE_BUCKET_ACCESS_KEY_ID and WAITRON_RESTORE_BUCKET_SECRET_ACCESS_KEY in the environment or bucket credentials file",
    );
    return null;
  }
  try {
    return readBucketConfig({ ...location, accessKeyId, secretAccessKey }, (field) => {
      throw new AppError("backup.stream_config_unsafe", { field });
    });
  } catch (error) {
    deps.out(
      error instanceof AppError && hasCode(error, "backup.stream_config_unsafe")
        ? `restore failed: check the bucket setting ${error.params.field}`
        : sharedRefusal(error),
    );
    return null;
  }
}

async function runBucketRestore(
  deps: CommandDeps,
  args: Extract<ParsedArgs, { bucket: BucketLocation }>,
): Promise<number> {
  const { confirmedTaxId, oldBoxGone, soleRecovery } = args;
  const bucket = await commandBucket(deps, args.bucket, args.credentialsFile);
  if (bucket === null) return 1;
  const masterKey = await readMasterKey(deps, args.masterKeyFile);
  if (masterKey === null) return 1;
  if (masterKey === undefined) {
    deps.out("restore failed: set WAITRON_MASTER_KEY or give --master-key-file");
    return 1;
  }
  const resolved = await resolveRestoreTarget(deps, masterKey);
  if (typeof resolved === "number") return resolved;
  const { target, hold } = resolved;
  try {
    deps.out(
      "cold restore from the bucket: use only when the old server is gone — two servers selling from one database cannot be reconciled",
    );
    try {
      await (deps.restoreStream ?? restoreFromStream)({
        ...target,
        bucket,
        masterKey,
        oldBoxGone,
        litestreamBin: resolveLitestreamBin(deps.env),
        openStore: boundedOpener(deps),
        now: clock,
        ...(soleRecovery
          ? {
              prepareModuleOperations: async (copy: ValidatedArtifact, sourceId: string) =>
                selectedRecoveryRunner(
                  deps,
                  target,
                  copy,
                  await readRecoveryOperationFile(
                    readVariable(deps.env, "WAITRON_RECOVERY_OPERATION_FILE") ?? "",
                  ),
                  masterKey,
                  oldBoxGone,
                  sourceId,
                ),
            }
          : {}),
        confirmVenue: (venue) => {
          deps.out(
            `the copy in the bucket is: ${venue.legalName}, tax id ${venue.taxId}, venue ${venue.venueName}`,
          );
          return confirmsVenue(venue, confirmedTaxId);
        },
      });
    } catch (err) {
      deps.out((err instanceof AppError && bucketRefusal(err)) || sharedRefusal(err));
      return 1;
    }
    deps.out("restored from the bucket");
    return 0;
  } finally {
    hold.release();
  }
}

type Source = { text: string } | { refused: string };

/**
 * Read the key from a text file or the PDF's attachment, where it stays whole.
 */
async function sourceText(bytes: Uint8Array): Promise<Source> {
  if (!looksLikePdf(bytes)) return { text: Buffer.from(bytes).toString("utf8") };
  let pack: RecoveryPackFile;
  try {
    pack = await readRecoveryPackPdf(bytes);
  } catch (err) {
    return {
      refused:
        err instanceof RecoveryPackFileError && err.reason === "not_a_pack"
          ? "restore failed: the PDF is not a Waitron recovery pack; give the venue's recovery pack PDF or a file with the master key"
          : "restore failed: the recovery pack PDF is damaged, or was changed after it was made; use the pack PDF as it was saved",
    };
  }
  return pack.masterKey === null
    ? {
        refused:
          "restore failed: the recovery pack PDF does not hold the master key; give the pack that holds it, or a file with the key",
      }
    : { text: pack.masterKey };
}
