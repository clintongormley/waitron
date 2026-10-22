import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { errnoOf } from "./errno.js";

export type DiskStatfs = (
  path: string,
) => Promise<{ bavail: number; bfree: number; blocks: number; frsize: number }>;

export type DeviceOf = (path: string) => Promise<number>;

export interface DiskUsage {
  freeBytes: number | null;
  totalBytes: number | null;
  databaseBytes: number | null;
  backupsBytes: number | null;
  logBytes: number | null;
  otherBytes: number | null;
}

interface Walk {
  lstat: (path: string) => Promise<Stats>;
  readdir: (path: string) => Promise<string[]>;
  device: number;
}

const OFF_DISK = Symbol("off this disk");

const UNREADABLE: DiskUsage = {
  freeBytes: null,
  totalBytes: null,
  databaseBytes: null,
  backupsBytes: null,
  logBytes: null,
  otherBytes: null,
};

/** The venue folder's disk, and how much of it Waitron's folders take. */
export async function readDiskUsage(deps: {
  venueDir: string;
  logDir: string;
  backupDirs: readonly string[];
  statfs?: DiskStatfs;
  deviceOf?: DeviceOf;
  lstat?: (path: string) => Promise<Stats>;
  readdir?: (path: string) => Promise<string[]>;
  realpath?: (path: string) => Promise<string>;
}): Promise<DiskUsage> {
  const statfs = deps.statfs ?? fs.statfs;
  const deviceOf = deps.deviceOf ?? (async (path: string) => (await fs.stat(path)).dev);
  let disk: Awaited<ReturnType<DiskStatfs>>;
  try {
    disk = await statfs(deps.venueDir);
  } catch {
    return UNREADABLE;
  }
  const freeBytes = disk.bavail * disk.frsize;
  const totalBytes = disk.blocks * disk.frsize;
  const usedBytes = (disk.blocks - disk.bfree) * disk.frsize;

  // Each folder is counted by its real path, so a folder listed again through a link, or one
  // inside a counted folder through a link, is not counted twice.
  const realpath = deps.realpath ?? fs.realpath;
  let venueDir: string;
  let venueDevice: number;
  try {
    venueDir = await realpath(resolve(deps.venueDir));
    venueDevice = await deviceOf(venueDir);
  } catch {
    return { ...UNREADABLE, freeBytes, totalBytes };
  }

  const walk: Walk = {
    lstat: deps.lstat ?? fs.lstat,
    readdir: deps.readdir ?? ((path) => fs.readdir(path)),
    device: venueDevice,
  };
  const walkOrNull = async (root: string, skip: readonly string[]): Promise<number | null> => {
    try {
      return await folderBytes(walk, root, skip);
    } catch {
      return null;
    }
  };
  const databaseBytes = await walkOrNull(venueDir, []);
  const counted = [venueDir];
  const measure = async (dir: string): Promise<number | null | typeof OFF_DISK> => {
    let root: string;
    let device: number;
    try {
      root = await realpath(resolve(dir));
      device = await deviceOf(root);
    } catch (error) {
      return errnoOf(error) === "ENOENT" ? 0 : null;
    }
    if (counted.some((earlier) => isWithin(root, earlier))) return 0;
    const skip = [...counted];
    counted.push(root);
    return device === venueDevice ? await walkOrNull(root, skip) : OFF_DISK;
  };

  let backupsBytes: number | null = 0;
  for (const dir of deps.backupDirs) {
    const bytes = await measure(dir);
    if (bytes === null) backupsBytes = null;
    // A backup folder on another disk takes nothing from this one.
    else if (backupsBytes !== null && bytes !== OFF_DISK) backupsBytes += bytes;
  }
  const log = await measure(deps.logDir);
  const logBytes = log === OFF_DISK ? null : log;

  const otherBytes = Math.max(
    0,
    usedBytes - (databaseBytes ?? 0) - (backupsBytes ?? 0) - (logBytes ?? 0),
  );
  return { freeBytes, totalBytes, databaseBytes, backupsBytes, logBytes, otherBytes };
}

/** Regular files under `dir`, never following a link or leaving the walk's device, skipping `skip`'s
 * folders. An entry gone mid-walk counts as nothing: the walk takes no turn, so SQLite, log rotation,
 * the backup sweep and a free-space deletion all remove files under it. */
async function folderBytes(walk: Walk, dir: string, skip: readonly string[]): Promise<number> {
  const names = await unlessGone(walk.readdir(dir));
  let total = 0;
  for (const name of names ?? []) {
    const path = join(dir, name);
    const info = await unlessGone(walk.lstat(path));
    if (!info || info.dev !== walk.device) continue;
    if (info.isFile()) total += info.size;
    else if (info.isDirectory() && !skip.includes(path))
      total += await folderBytes(walk, path, skip);
  }
  return total;
}

async function unlessGone<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return null;
    throw error;
  }
}

export function isWithin(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
