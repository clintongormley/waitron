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
import { confirmsVenue, refuseIfArchiveSourceLive, restoreFromStream } from "./restore-stream.js";
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
const FROM_BUCKET = "--from-bucket";
const CONFIRM_VENUE = "--confirm-venue";
const clock = (): Date => new Date();

/**
 * The codes `decryptArtifact`/`unpackArchive` throw. Each restore path (the archive and the
 * bucket) collapses them into one message of its own: telling "wrong recovery key" from "corrupt
 * artifact" would hand someone holding a stolen artifact an oracle to guess the recovery key against.
 */
const DECRYPT_PHASE_CODES: ReadonlySet<string> = new Set([
  "recovery.passphrase_invalid",
  "backup.artifact_invalid",
  "backup.archive_invalid",
]);

/**
 * `waitron-restore restore <artifact-path>` restores one backup artifact; `restore --from-bucket
 * <kit-file>` rebuilds from the venue's bucket copy instead. The recovery key comes from
 * `WAITRON_BACKUP_RECOVERY_KEY` or the kit file, never argv: an argv element leaks into `ps`.
 *
 * Returns a process exit code: 0 on success, 1 on a failure, 2 on a usage error.
 */
export async function runRestore(deps: CommandDeps): Promise<number> {
  const args = parseArgs(deps.argv);
  if (args === null) {
    deps.out(
      "usage: waitron-restore restore <artifact-path> [--confirm-old-box-gone] | restore --from-bucket <kit-file> [--confirm-venue <tax-id>] [--confirm-old-box-gone]",
    );
    return 2;
  }
  if ("kitPath" in args) return runBucketRestore(deps, args);
  const { artifactPath, oldBoxGone } = args;

  const recoveryKey = deps.env.WAITRON_BACKUP_RECOVERY_KEY;
  if (isUnset(recoveryKey)) {
    deps.out("WAITRON_BACKUP_RECOVERY_KEY must be set to the backup's recovery key");
    return 1;
  }

  let artifact: Uint8Array;
  try {
    artifact = await readFile(artifactPath);
  } catch {
    deps.out(`cannot read artifact file: ${artifactPath}`);
    return 1;
  }

  const target = resolveRestoreTarget(deps);
  if (typeof target === "number") return target;
  const restoreDeps: RestoreDeps = {
    ...target,
    artifact,
    recoveryKey,
    checkSourceLive: (validated) =>
      refuseIfArchiveSourceLive({
        validated,
        stateDir: target.stateDir,
        oldBoxGone,
        now: clock,
        openStore: boundedOpener(deps),
      }),
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

type ParsedArgs =
  | { artifactPath: string; oldBoxGone: boolean }
  | { kitPath: string; confirmedTaxId: string | undefined; oldBoxGone: boolean };

/**
 * Each form takes exactly its own flags, each once: `<artifact-path> [--confirm-old-box-gone]`, or
 * `--from-bucket <kit-file> [--confirm-old-box-gone] [--confirm-venue <tax-id>]`, in any order.
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
    } else if (arg === FROM_BUCKET || arg === CONFIRM_VENUE) {
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
  if (kitPath !== undefined) {
    return artifactPath === undefined ? { kitPath, confirmedTaxId, oldBoxGone } : null;
  }
  return artifactPath !== undefined && confirmedTaxId === undefined
    ? { artifactPath, oldBoxGone }
    : null;
}

type RestoreTarget = Pick<
  RestoreDeps,
  "stateDir" | "venueDir" | "stagingDir" | "migrationsRoot" | "modules" | "environment" | "log"
>;

/**
 * Where the restore goes and under which environment, from the same variables and defaults as
 * `loadConfig` (`config.ts`); an exit code, with the reason printed, when `WAITRON_ENV` is invalid.
 * `modules` is every module, never an enabled subset: a restore hook must run for every module
 * whose tables are in the backup.
 */
function resolveRestoreTarget(deps: CommandDeps): RestoreTarget | number {
  let environment: DeploymentEnvironment;
  try {
    environment = deploymentEnvironment(deps.env);
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

/** The words for a refusal only the archive path words its own way; null for any other. */
function archiveRefusal(err: AppError): string | null {
  if (DECRYPT_PHASE_CODES.has(err.code))
    return "restore failed: wrong recovery key or corrupt artifact";
  return sourceLiveRefusal(err, "the server this backup came from");
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
  const target = resolveRestoreTarget(deps);
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
