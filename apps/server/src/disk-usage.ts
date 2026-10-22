import { lstat, readdir, stat, statfs as nodeStatfs } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";

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
}): Promise<DiskUsage> {
  const statfs = deps.statfs ?? nodeStatfs;
  const deviceOf = deps.deviceOf ?? (async (path: string) => (await stat(path)).dev);
  let disk: Awaited<ReturnType<DiskStatfs>>;
  try {
    disk = await statfs(deps.venueDir);
  } catch {
    return UNREADABLE;
  }
  const freeBytes = disk.bavail * disk.frsize;
  const totalBytes = disk.blocks * disk.frsize;
  const usedBytes = (disk.blocks - disk.bfree) * disk.frsize;

  const venueDir = resolve(deps.venueDir);
  let venueDevice: number;
  try {
    venueDevice = await deviceOf(venueDir);
  } catch {
    return { ...UNREADABLE, freeBytes, totalBytes };
  }

  const counted: string[] = [];
  const measure = async (dir: string): Promise<number | null> => {
    const root = resolve(dir);
    if (counted.some((earlier) => isWithin(root, earlier))) return 0;
    const skip = [...counted];
    counted.push(root);
    let device: number;
    try {
      device = await deviceOf(root);
    } catch (error) {
      return isMissing(error) ? 0 : null;
    }
    if (device !== venueDevice) return null;
    try {
      return await folderBytes(root, venueDevice, skip);
    } catch {
      return null;
    }
  };

  const databaseBytes = await measure(venueDir);
  let backupsBytes = 0;
  for (const dir of deps.backupDirs) {
    // A backup folder on another disk takes nothing from this one.
    backupsBytes += (await measure(dir)) ?? 0;
  }
  const logBytes = await measure(deps.logDir);

  const otherBytes = Math.max(0, usedBytes - (databaseBytes ?? 0) - backupsBytes - (logBytes ?? 0));
  return { freeBytes, totalBytes, databaseBytes, backupsBytes, logBytes, otherBytes };
}

/** Regular files under `dir`, never following a link or leaving `device`, skipping `skip`'s folders. */
async function folderBytes(dir: string, device: number, skip: readonly string[]): Promise<number> {
  let total = 0;
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const info = await lstat(path);
    if (info.dev !== device) continue;
    if (info.isFile()) total += info.size;
    else if (info.isDirectory() && !skip.includes(path))
      total += await folderBytes(path, device, skip);
  }
  return total;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isWithin(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
