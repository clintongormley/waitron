import * as fs from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseBackupArchiveKey } from "./backup-keys.js";
import type { DeviceOf } from "./disk-usage.js";
import { errnoOf } from "./errno.js";
import type { StorageBackend } from "./storage-backend.js";

/** A local backup folder on the disk that holds the run's working folder, by its real path. */
export interface BackupFolder {
  destination: string;
  dir: string;
}

export interface DeletableArchive {
  destination: string;
  dir: string;
  key: string;
  bytes: number;
  takenAt: Date;
}

/**
 * The archives the box may delete to make room, oldest first (ties by key): regular files named as
 * archives, taken strictly after the current installation began, never the newest in their folder.
 * An unknown installation start offers nothing.
 */
export async function listDeletableArchives(
  folders: readonly BackupFolder[],
  installationStartedAt: Date | null,
): Promise<DeletableArchive[]> {
  if (installationStartedAt === null) return [];
  const out: DeletableArchive[] = [];
  for (const { destination, dir } of folders) {
    const archives = await archivesIn(destination, dir);
    archives.sort(byAgeThenKey);
    archives.pop();
    out.push(...archives.filter((a) => a.takenAt.getTime() > installationStartedAt.getTime()));
  }
  return out.sort(byAgeThenKey);
}

function byAgeThenKey(a: DeletableArchive, b: DeletableArchive): number {
  const age = a.takenAt.getTime() - b.takenAt.getTime();
  if (age !== 0) return age;
  return Number(a.key > b.key) - Number(a.key < b.key);
}

async function archivesIn(destination: string, dir: string): Promise<DeletableArchive[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    // A folder that cannot be read offers nothing to delete.
    return [];
  }
  const out: DeletableArchive[] = [];
  for (const key of names) {
    const parsed = parseBackupArchiveKey(key);
    if (parsed === null) continue;
    let info;
    try {
      // `lstat`, so a link named like an archive is never followed, listed or counted as the newest.
      info = await fs.lstat(join(dir, key));
    } catch {
      continue;
    }
    if (!info.isFile()) continue;
    out.push({ destination, dir, key, bytes: info.size, takenAt: parsed.timestamp });
  }
  return out;
}

/**
 * The local backup folders on the working folder's disk. `folders` holds each real folder once, for
 * listing archives; `copies` counts every local destination on the disk, because the run copies to
 * all of them at once and each copy holds a whole working copy before its rename. A folder whose
 * disk cannot be read is counted but never listed.
 */
export async function foldersOnDisk(
  backends: readonly Pick<StorageBackend, "id" | "localDir">[],
  stagingDir: string,
  deviceOf: DeviceOf = async (path) => (await fs.stat(path)).dev,
): Promise<{ folders: BackupFolder[]; copies: number }> {
  const staging = await realOrNearest(stagingDir);
  const stagingDevice = await deviceOf(staging.existing);
  const folders: BackupFolder[] = [];
  let copies = 0;
  for (const { id, localDir } of backends) {
    if (localDir === undefined) continue;
    let real: string;
    let device: number;
    try {
      const found = await realOrNearest(localDir);
      real = found.real;
      device = await deviceOf(found.existing);
    } catch {
      copies += 1;
      continue;
    }
    if (device !== stagingDevice) continue;
    copies += 1;
    if (!folders.some((f) => f.dir === real)) folders.push({ destination: id, dir: real });
  }
  return { folders, copies };
}

/** A folder's real path, or for one not made yet, its nearest existing parent's real path with the
 * rest appended: the folder copy creates it there. */
async function realOrNearest(path: string): Promise<{ real: string; existing: string }> {
  let current = resolve(path);
  const rest: string[] = [];
  for (;;) {
    try {
      const existing = await fs.realpath(current);
      return { real: join(existing, ...rest), existing };
    } catch (error) {
      const parent = dirname(current);
      if (errnoOf(error) !== "ENOENT" || parent === current) throw error;
      rest.unshift(basename(current));
      current = parent;
    }
  }
}
