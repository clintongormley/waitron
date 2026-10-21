import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { LOG_FILE_NAME, isVenueHolderFresh, type VenueHolder } from "@waitron/db";
import { errnoOf } from "./errno.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import type { Logger } from "./logger.js";

export const START_FREE_SPACE_FLOOR = 256 * 1024 * 1024;
export const CRASH_REPORT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const BACKUP_STAGING_DIR = "backup-staging";

const ROTATED_LOG = new RegExp(`^${LOG_FILE_NAME.replaceAll(".", "\\.")}\\.(\\d+)$`);
const CRASH_REPORT = /^holder-frozen-.*\.json$/;

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
  /** Delete whatever the free space: a start whose failure was a full disk. */
  force?: boolean;
  now: () => Date;
  statfs?: Statfs;
  readVenueHolder: (venueDir: string) => VenueHolder | null;
  log: Logger;
}

/**
 * Below `floor` (or when forced), deletes what a start can make again: rotated logs but the newest,
 * crash reports older than {@link CRASH_REPORT_KEEP_MS}, and backup staging unless the venue
 * folder's holder heartbeat is fresh. Never throws.
 */
export async function freeSpaceAtStart(
  deps: StartSpaceDeps,
): Promise<{ freeBytes: number | null; belowFloor: boolean }> {
  const dirs = [deps.stateDir, deps.venueDir];
  const before = await lowestFreeBytes(dirs, deps.statfs);
  if (!deps.force && (before === null || before >= deps.floor)) {
    return { freeBytes: before, belowFloor: false };
  }
  const now = deps.now();
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

  for (const name of await entries(deps.logDir, failed)) {
    const match = ROTATED_LOG.exec(name);
    if (match !== null && Number(match[1]) >= 2) await remove(join(deps.logDir, name), false);
  }

  const crashDir = join(deps.logDir, "crash-reports");
  for (const name of await entries(crashDir, failed)) {
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

  const holder = deps.readVenueHolder(deps.venueDir);
  if (holder === null || !isVenueHolderFresh(holder, now)) {
    const stagingDir = join(deps.stateDir, BACKUP_STAGING_DIR);
    for (const name of await entries(stagingDir, failed)) {
      await remove(join(stagingDir, name), true);
    }
  }

  const after = await lowestFreeBytes(dirs, deps.statfs);
  deps.log("warn", "storage.start_space_low", {
    freeBytesBefore: before,
    freeBytesAfter: after,
    deleted,
    floor: deps.floor,
  });
  return { freeBytes: after, belowFloor: after !== null && after < deps.floor };
}

async function entries(dir: string, failed: (error: unknown) => void): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (errnoOf(error) !== "ENOENT") failed(error);
    return [];
  }
}
