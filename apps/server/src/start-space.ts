import { lstat, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { LOG_FILE_NAME, isVenueHolderFresh, type VenueHolder, type VenueLock } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { BACKUP_KEY_PREFIX } from "./backup-keys.js";
import { errnoOf } from "./errno.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import type { Logger } from "./logger.js";
import {
  assertOutsideScratch,
  deleteScratchEntries,
  emptyScratch,
  listScratch,
} from "./scratch.js";

export const START_FREE_SPACE_FLOOR = 256 * 1024 * 1024;
export const CRASH_REPORT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export const ROTATED_LOG = new RegExp(`^${LOG_FILE_NAME.replaceAll(".", "\\.")}\\.(\\d+)$`);
export const CRASH_REPORT = /^holder-frozen-.*\.json$/;
/** `dumpFileName`'s copy, and the `.partial` name `archiveTo` writes it under first
 *  (`packages/store/src/archive.ts`). */
export const STAGED_DUMP = new RegExp(`^${BACKUP_KEY_PREFIX}\\d{8}T\\d{6}Z\\.dump(\\.partial)?$`);

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
  /** Null when another call cleans this start's logs. */
  logDir: string | null;
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
 * Scratch is swept only with the venue lock, a missing venue folder, or no fresh holder when
 * taking the lock fails. Old crash reports go on every start; rotated logs go below the floor.
 */
export async function freeSpaceAtStart(
  deps: StartSpaceDeps,
): Promise<{ freeBytes: number | null; belowFloor: boolean }> {
  assertOutsideScratch(deps.stateDir, deps.venueDir, "WAITRON_VENUE_DIR");
  if (deps.logDir !== null) assertOutsideScratch(deps.stateDir, deps.logDir, "WAITRON_LOG_DIR");
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
  // On a box, only the server runs a backup or stages a recovery copy, and only a process holding
  // the venue folder's lock runs a restore; each holds that lock while it does.
  const removeStagingLeftovers = async () => {
    if (deps.venueHeld === true)
      return void (deleted += await emptyScratch(deps.stateDir, deps.log));
    // Taking the lock would create a missing venue folder; with none, no process can hold it. A
    // restore makes that folder before its first working folder, so one still missing after the
    // listing means nothing listed is a live restore's.
    if (await missing(deps.venueDir)) {
      const listed = await listScratch(deps.stateDir, deps.log);
      if (await missing(deps.venueDir))
        return void (deleted += await deleteScratchEntries(deps.stateDir, listed ?? [], deps.log));
    }
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
      return void (deleted += await emptyScratch(deps.stateDir, deps.log));
    }
    try {
      deleted += await emptyScratch(deps.stateDir, deps.log);
    } finally {
      hold.release();
    }
  };

  const now = deps.now();
  const logs = deps.logDir === null ? null : await entries(deps.logDir, "logs", deps.log, failed);
  if (deps.logDir !== null && logs !== null) {
    const crashDir = join(deps.logDir, "crash-reports");
    for (const name of (await entries(crashDir, "crash-reports", deps.log, failed)) ?? []) {
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
  }
  if (!deps.force && (before === null || before >= deps.floor)) {
    await removeStagingLeftovers();
    if (deleted > 0) deps.log("info", "storage.start_leftovers_deleted", { deleted });
    return { freeBytes: before, belowFloor: false };
  }
  if (deps.logDir !== null) {
    for (const name of logs ?? []) {
      const match = ROTATED_LOG.exec(name);
      if (match !== null && Number(match[1]) >= 2) await remove(join(deps.logDir, name), false);
    }
  }

  await removeStagingLeftovers();

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

export { BACKUP_STAGING_DIR } from "@waitron/store";
