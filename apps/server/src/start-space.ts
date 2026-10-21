import { lstat, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { LOG_FILE_NAME, isVenueHolderFresh, type VenueHolder, type VenueLock } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { BACKUP_ENCRYPT_DIR_PREFIX, BACKUP_KEY_PREFIX } from "./backup-keys.js";
import { errnoOf } from "./errno.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import type { Logger } from "./logger.js";

export const START_FREE_SPACE_FLOOR = 256 * 1024 * 1024;
export const CRASH_REPORT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const BACKUP_STAGING_DIR = "backup-staging";

const ROTATED_LOG = new RegExp(`^${LOG_FILE_NAME.replaceAll(".", "\\.")}\\.(\\d+)$`);
const CRASH_REPORT = /^holder-frozen-.*\.json$/;
/** `dumpFileName`'s copy, and the `.partial` name `archiveTo` writes it under first
 *  (`packages/store/src/archive.ts`). */
const STAGED_DUMP = new RegExp(`^${BACKUP_KEY_PREFIX}\\d{8}T\\d{6}Z\\.dump(\\.partial)?$`);

/** The lowest free space among `dirs` that can report; null when none can. */
export async function lowestFreeBytes(
  dirs: readonly string[],
  statfs?: Statfs,
): Promise<number | null> {
  let lowest: number | null = null;
  for (const dir of dirs) {
    const free = await freeBytes(dir, statfs);
    if (free !== null && (lowest === null || free < lowest)) lowest = free;
  }
  return lowest;
}

export interface StartSpaceDeps {
  stateDir: string;
  venueDir: string;
  logDir: string;
  floor: number;
  /** Delete logs and crash reports whatever the free space: a start whose failure was a full disk. */
  force?: boolean;
  /** This process holds the venue folder's lock for the whole call, so no other process can. */
  venueHeld?: boolean;
  now: () => Date;
  statfs?: Statfs;
  /** Refused with `provisioning.database_in_use` while another process holds the venue folder. */
  lockVenue: (venueDir: string) => Promise<VenueLock>;
  /** Asked only when the lock fails for another reason. */
  readVenueHolder: (venueDir: string) => VenueHolder | null;
  log: Logger;
}

/**
 * Every call deletes the dumps and `backup-encrypt-*` folders a backup run leaves in backup staging,
 * unless another process holds the venue folder's lock — or, when the lock cannot be taken for any
 * other reason, the folder's holder heartbeat is fresh. Below `floor` (or when forced) it also
 * deletes rotated logs but the newest and crash reports older than {@link CRASH_REPORT_KEEP_MS}. A
 * folder that is a symbolic link is skipped. A filesystem or lock failure is logged, never thrown.
 */
export async function freeSpaceAtStart(
  deps: StartSpaceDeps,
): Promise<{ freeBytes: number | null; belowFloor: boolean }> {
  const dirs = [deps.stateDir, deps.venueDir];
  const before = await lowestFreeBytes(dirs, deps.statfs);
  const failed = (error: unknown) =>
    deps.log("warn", "storage.start_cleanup_failed", { errno: errnoOf(error) ?? null });
  let deleted = 0;
  const remove = async (path: string, recursive: boolean) => {
    try {
      await rm(path, { recursive });
      deleted += 1;
    } catch (error) {
      failed(error);
    }
  };
  const deleteBackupStaging = async () => {
    const stagingDir = join(deps.stateDir, BACKUP_STAGING_DIR);
    for (const name of (await entries(stagingDir, BACKUP_STAGING_DIR, deps.log, failed)) ?? []) {
      if (STAGED_DUMP.test(name)) await remove(join(stagingDir, name), false);
      else if (name.startsWith(BACKUP_ENCRYPT_DIR_PREFIX))
        await remove(join(stagingDir, name), true);
    }
  };
  // The backup run that writes staging runs inside the process holding the venue folder's lock.
  const removeBackupStaging = async () => {
    // Taking the lock would create a missing venue folder; with none, no process can hold it.
    if (deps.venueHeld === true || (await missing(deps.venueDir))) return deleteBackupStaging();
    let hold: VenueLock;
    try {
      hold = await deps.lockVenue(deps.venueDir);
    } catch (error) {
      if (isAppError(error) && error.code === "provisioning.database_in_use") return;
      failed(error);
      const holder = deps.readVenueHolder(deps.venueDir);
      // The time is read again: the deletions before this can outlast VENUE_HOLDER_STALE_MS, and a
      // live heartbeat judged against the start of them reads as one from the future.
      if (holder !== null && isVenueHolderFresh(holder, deps.now())) return;
      return deleteBackupStaging();
    }
    try {
      await deleteBackupStaging();
    } finally {
      hold.release();
    }
  };

  if (!deps.force && (before === null || before >= deps.floor)) {
    await removeBackupStaging();
    if (deleted > 0) deps.log("info", "storage.start_backup_leftovers_deleted", { deleted });
    return { freeBytes: before, belowFloor: false };
  }
  const now = deps.now();

  const logs = await entries(deps.logDir, "logs", deps.log, failed);
  for (const name of logs ?? []) {
    const match = ROTATED_LOG.exec(name);
    if (match !== null && Number(match[1]) >= 2) await remove(join(deps.logDir, name), false);
  }

  const crashDir = join(deps.logDir, "crash-reports");
  const crashReports =
    logs === null ? [] : await entries(crashDir, "crash-reports", deps.log, failed);
  for (const name of crashReports ?? []) {
    if (!CRASH_REPORT.test(name)) continue;
    const path = join(crashDir, name);
    try {
      const { mtimeMs } = await stat(path);
      if (now.getTime() - mtimeMs <= CRASH_REPORT_KEEP_MS) continue;
    } catch (error) {
      failed(error);
      continue;
    }
    await remove(path, false);
  }

  await removeBackupStaging();

  const after = await lowestFreeBytes(dirs, deps.statfs);
  deps.log("warn", "storage.start_space_low", {
    freeBytesBefore: before,
    freeBytesAfter: after,
    deleted,
    floor: deps.floor,
  });
  return { freeBytes: after, belowFloor: after !== null && after < deps.floor };
}

async function missing(dir: string): Promise<boolean> {
  try {
    await lstat(dir);
    return false;
  } catch (error) {
    return errnoOf(error) === "ENOENT";
  }
}

/**
 * A clean-up folder's names; null when it is missing, cannot be listed, or is not a real folder. A
 * symbolic link is skipped, because its listing and every deletion would land in its target.
 */
async function entries(
  dir: string,
  folder: string,
  log: Logger,
  failed: (error: unknown) => void,
): Promise<string[] | null> {
  try {
    if ((await lstat(dir)).isSymbolicLink()) {
      log("warn", "storage.start_cleanup_skipped", { folder });
      return null;
    }
    return await readdir(dir);
  } catch (error) {
    if (errnoOf(error) !== "ENOENT") failed(error);
    return null;
  }
}
