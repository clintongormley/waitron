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
import { readArtifactFileHeader } from "./artifact-cipher-file.js";
import { DEFAULT_DESTINATION_TIMEOUT_MS } from "./backup-config.js";
import { headerOpeningKey } from "./backup-file-key.js";
import { DEFAULT_MIGRATIONS_ROOT, DEFAULT_STATE_ROOT } from "./boot.js";
import { boundObjectStore } from "./bounded-store.js";
import { deploymentEnvironment, resolveConfigDir, type DeploymentEnvironment } from "./config.js";
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
  /** Holds the venue folder from resolving the target to exit. Default {@link lockRestoreTarget}. */
  lockVenue?: (venueDir: string) => Promise<VenueLock>;
  /** Absent, the box's own boot reading. */
  readBoot?: () => BootReading;
}

const CONFIRM_OLD_BOX_GONE = "--confirm-old-box-gone";
const CONFIRM_SOLE_RECOVERY = "--confirm-sole-recovery";
const FROM_BUCKET = "--from-bucket";
const CONFIRM_VENUE = "--confirm-venue";
const FROM_ARCHIVE = "--from-archive";
const ARCHIVE_KEY = "--archive-key";
const MASTER_KEY_FILE = "--master-key-file";
const VALUED_FLAGS: ReadonlySet<string> = new Set([
  FROM_BUCKET,
  CONFIRM_VENUE,
  FROM_ARCHIVE,
  ARCHIVE_KEY,
  MASTER_KEY_FILE,
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
 * `waitron-restore restore <artifact-path>` restores one backup artifact; `restore --from-bucket
 * <pack-or-kit-file>` rebuilds from the venue's bucket copy instead, and `restore --from-archive
 * <pack-pdf-or-archive-pack-file> --archive-key <name>` downloads one archive and restores it as the
 * first form does. A backup file opens with the master key, from `--master-key-file` or
 * `WAITRON_MASTER_KEY`; a Waitron Cloud copy (version 1) with `WAITRON_BACKUP_RECOVERY_KEY`. No key
 * is ever taken from argv: an argv element leaks into `ps`.
 *
 * Returns a process exit code: 0 on success, 1 on a failure, 2 on a usage error.
 */
export async function runRestore(deps: CommandDeps): Promise<number> {
  const args = parseArgs(deps.argv);
  if (args === null) {
    deps.out(
      "usage: waitron-restore restore <artifact-path> [--master-key-file <path>] [--confirm-old-box-gone] [--confirm-sole-recovery] | restore --from-bucket <pack-or-kit-file> [--confirm-venue <tax-id>] [--confirm-old-box-gone] [--confirm-sole-recovery] | restore --from-archive <pack-pdf-or-archive-pack-file> --archive-key <name> [--confirm-old-box-gone] [--confirm-sole-recovery]",
    );
    return 2;
  }
  if ("kitPath" in args) return runBucketRestore(deps, args);
  if ("packPath" in args) return runPackRestore(deps, args);
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
      opening.key,
      authorising,
      oldBoxGone,
      soleRecovery,
      {
        keyDoesNotOpen: opening.underMasterKey
          ? BACKUP_FILE_DAMAGED
          : "restore failed: wrong recovery key or corrupt artifact",
      },
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

/**
 * The archive restore chain both file forms share; false once the refusal is printed.
 * `keyDoesNotOpen` is the one line for every {@link DECRYPT_PHASE_CODES} refusal.
 */
async function restoreArtifact(
  deps: CommandDeps,
  target: RestoreTarget,
  artifactPath: string,
  recoveryKey: string,
  masterKey: string | undefined,
  oldBoxGone: boolean,
  soleRecovery: boolean,
  words: { keyDoesNotOpen: string },
): Promise<boolean> {
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
      kitPath: string;
      confirmedTaxId: string | undefined;
      oldBoxGone: boolean;
      soleRecovery: boolean;
    }
  | { packPath: string; archiveKey: string; oldBoxGone: boolean; soleRecovery: boolean };

function parseArgs(argv: readonly string[]): ParsedArgs | null {
  const [cmd, ...rest] = argv;
  if (cmd !== "restore") return null;
  const valued: Record<string, string | undefined> = {};
  let artifactPath: string | undefined;
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
  const masterKeyFile = valued[MASTER_KEY_FILE];
  if (masterKeyFile !== undefined && artifactPath === undefined) return null;
  if (packPath !== undefined || archiveKey !== undefined) {
    return packPath !== undefined &&
      archiveKey !== undefined &&
      kitPath === undefined &&
      confirmedTaxId === undefined &&
      artifactPath === undefined
      ? { packPath, archiveKey, oldBoxGone, soleRecovery }
      : null;
  }
  if (kitPath !== undefined) {
    return artifactPath === undefined
      ? { kitPath, confirmedTaxId, oldBoxGone, soleRecovery }
      : null;
  }
  return artifactPath !== undefined && confirmedTaxId === undefined
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
    source = await sourceText(await readFile(masterKeyFile), "masterKey");
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
    if (err.params.reason === "key_or_access")
      return `${failed}the recovery pack does not match this copy, or the bucket login cannot read it; use the pack matching this copy, or correct the bucket access and try again`;
    return err.params.reason === "signature"
      ? `${failed}the copy in the bucket was not signed by the key in this kit, so it is not trusted; check that the kit is this venue's newest`
      : `${failed}the bucket's record of its newest copy names a different venue from this kit`;
  }
  const words: Partial<Record<string, string>> = {
    "restore.stream_disk_full":
      "the disk filled while the copy was downloading; nothing on this server changed. Free some space and run it again",
    "restore.stream_pointer_missing":
      "the bucket holds no copy for the venue this kit names; check that the kit is this venue's",
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
  const { kitPath, confirmedTaxId, oldBoxGone, soleRecovery } = args;
  let source: Source;
  try {
    source = await sourceText(await readFile(kitPath), "bucketCode");
  } catch {
    deps.out(`cannot read recovery pack or kit file: ${kitPath}`);
    return 1;
  }
  if ("refused" in source) {
    deps.out(source.refused);
    return 1;
  }
  const kitText = source.text;
  let kit: RecoveryKit;
  try {
    kit = parseRecoveryKit(kitText);
  } catch (err) {
    deps.out(
      hasCode(err as AppError, "backup.stream_kit_invalid") &&
        (err as AppError<"backup.stream_kit_invalid">).params.reason === "not_found"
        ? "restore failed: backup.stream_kit_invalid — the file holds no recovery kit; give the recovery pack PDF or kit file saved for this venue"
        : hasCode(err as AppError, "backup.stream_kit_invalid") &&
            (err as AppError<"backup.stream_kit_invalid">).params.reason === "version"
          ? "restore failed: backup.stream_kit_invalid — this bucket recovery code was made before this version of Waitron and cannot be used; choose a newer recovery pack, or restore an archive backup"
          : "restore failed: backup.stream_kit_invalid — the recovery kit in the file is incomplete or damaged, perhaps cut short when it was copied; use the whole kit file as it was saved",
    );
    return 1;
  }
  const masterKey = envMasterKey(deps);
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
        kit,
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
    deps.out(`restored from the bucket named in ${kitPath}`);
    return 0;
  } finally {
    hold.release();
  }
}

type Source = { text: string } | { refused: string };

const NO_CODE: Record<"bucketCode" | "archiveCode" | "masterKey", string> = {
  bucketCode:
    "restore failed: the recovery pack holds no bucket copy code — the box that made the pack had no bucket copy then; give a pack made after the bucket copy was set up, or the recovery kit file",
  archiveCode:
    "restore failed: the recovery pack holds no archive code — the box that made the pack kept no backup archive in a bucket then; give a pack made after archives were set up, or the archive recovery pack file",
  masterKey:
    "restore failed: the recovery pack PDF does not hold the master key; give the pack that holds it, or a file with the key",
};

/**
 * A kit or pack text file as it is; a recovery pack PDF answers the one code this path needs,
 * read from its attached file — never from its drawn text, where a long code wraps.
 */
async function sourceText(bytes: Uint8Array, code: keyof typeof NO_CODE): Promise<Source> {
  if (!looksLikePdf(bytes)) return { text: Buffer.from(bytes).toString("utf8") };
  let pack: RecoveryPackFile;
  try {
    pack = await readRecoveryPackPdf(bytes);
  } catch (err) {
    return {
      refused:
        err instanceof RecoveryPackFileError && err.reason === "not_a_pack"
          ? "restore failed: the PDF is not a Waitron recovery pack; give the venue's recovery pack PDF, or the kit or pack file saved for this venue"
          : "restore failed: the recovery pack PDF is damaged, or was changed after it was made; use the pack PDF as it was saved",
    };
  }
  const text = pack[code];
  return text === null ? { refused: NO_CODE[code] } : { text };
}

/** The words for a refusal only the pack path words its own way; null for any other. */
function packRefusal(err: AppError): string | null {
  const words: Partial<Record<string, string>> = {
    "restore.archive_key_invalid":
      "that is not the name of a backup archive; give the archive's file name exactly as the bucket lists it, such as waitron-20261001T030000Z-<node-id>-<nonce>.backup.enc",
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
  "the downloaded archive could not be removed; the next server start tries to remove it";

/**
 * The recovery key and the bucket's secret come from the pack, never the environment; no printed
 * line carries the pack's text.
 */
async function runPackRestore(
  deps: CommandDeps,
  args: Extract<ParsedArgs, { packPath: string }>,
): Promise<number> {
  const { packPath, archiveKey, oldBoxGone, soleRecovery } = args;
  let source: Source;
  try {
    source = await sourceText(await readFile(packPath), "archiveCode");
  } catch {
    deps.out(`cannot read pack file: ${packPath}`);
    return 1;
  }
  if ("refused" in source) {
    deps.out(source.refused);
    return 1;
  }
  const packText = source.text;
  let pack: ArchiveRecoveryPack;
  try {
    pack = decodeArchiveRecoveryPack(packText);
  } catch (err) {
    const reason = hasCode(err as AppError, "backup.archive_recovery_pack_invalid")
      ? (err as AppError<"backup.archive_recovery_pack_invalid">).params.reason
      : undefined;
    deps.out(
      reason === "not_found"
        ? "restore failed: backup.archive_recovery_pack_invalid — the file holds no archive recovery pack; give the recovery pack PDF or archive recovery pack file saved for this venue"
        : reason === "several"
          ? "restore failed: backup.archive_recovery_pack_invalid — the file holds more than one archive recovery pack; give a file holding only the pack for the archive you want"
          : "restore failed: backup.archive_recovery_pack_invalid — the archive recovery pack in the file is incomplete or damaged, perhaps cut short when it was copied; use the whole pack file as it was saved",
    );
    return 1;
  }
  const masterKey = envMasterKey(deps);
  const resolved = await resolveRestoreTarget(deps, masterKey);
  if (typeof resolved === "number") return resolved;
  const { target, hold } = resolved;
  try {
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
      restored = await restoreArtifact(
        deps,
        target,
        downloaded.path,
        pack.recoveryKey,
        masterKey,
        oldBoxGone,
        soleRecovery,
        {
          keyDoesNotOpen: PACK_KEY_DOES_NOT_OPEN,
        },
      );
      if (restored) deps.out(`restored archive ${archiveKey} from the bucket named in ${packPath}`);
    } finally {
      await downloaded.dispose().catch(() => deps.out(DOWNLOAD_LEFT_BEHIND));
    }
    return restored ? 0 : 1;
  } finally {
    hold.release();
  }
}
