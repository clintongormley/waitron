import * as fs from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { parseBackupArchiveKey } from "./backup-keys.js";
import type { DeviceOf } from "./disk-usage.js";
import { errnoOf } from "./errno.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import type { Logger } from "./logger.js";
import type { StorageBackend } from "./storage-backend.js";
import "./errors.js";

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
  readdir: (dir: string) => Promise<string[]> = (dir) => fs.readdir(dir),
): Promise<DeletableArchive[]> {
  if (installationStartedAt === null) return [];
  const out: DeletableArchive[] = [];
  for (const { destination, dir } of folders) {
    const archives = await archivesIn(destination, dir, readdir);
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

async function archivesIn(
  destination: string,
  dir: string,
  readdir: (dir: string) => Promise<string[]>,
): Promise<DeletableArchive[]> {
  let names: string[];
  try {
    names = await readdir(dir);
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
 * The local backup folders on the working folder's disk. `folders` holds each folder once (by device
 * and inode, so two real paths to one folder are one), for listing archives; `copies` counts every
 * local destination on the disk, because the run copies to all of them at once and each copy holds a
 * whole working copy before its rename. A destination whose real path or disk cannot be read is
 * counted but never listed: counting a copy too many can only make the run ask for more room.
 */
export async function foldersOnDisk(
  backends: readonly Pick<StorageBackend, "id" | "localDir">[],
  stagingDir: string,
  deviceOf?: DeviceOf,
): Promise<{ folders: BackupFolder[]; copies: number }> {
  const staging = await realOrNearest(stagingDir);
  const stagingDevice = deviceOf
    ? await deviceOf(staging.existing)
    : (await fs.stat(staging.existing)).dev;
  const folders: BackupFolder[] = [];
  const seen = new Set<string>();
  let copies = 0;
  for (const { id, localDir } of backends) {
    if (localDir === undefined) continue;
    let real: string;
    let device: number;
    let identity: string;
    try {
      const found = await realOrNearest(localDir);
      real = found.real;
      const { dev, ino } = await fs.stat(found.existing, { bigint: true });
      device = deviceOf ? await deviceOf(found.existing) : Number(dev);
      identity = `${dev}:${ino}:${relative(found.existing, found.real)}`;
    } catch {
      copies += 1;
      continue;
    }
    if (device !== stagingDevice) continue;
    copies += 1;
    if (seen.has(identity)) continue;
    seen.add(identity);
    folders.push({ destination: id, dir: real });
  }
  return { folders, copies };
}

/** A folder's real path, or for one not made yet, its nearest existing parent's real path with the
 * rest appended. */
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

export interface MakeRoomOptions {
  neededBytes: number;
  floorBytes: number;
  aimBytes: number;
  stagingDir: string;
  statfs?: Statfs;
  folders: readonly BackupFolder[];
  /** Asked only when free space is under the aim, so a step with room never waits for it. */
  installationStartedAt: () => Promise<Date | null>;
  signal: AbortSignal;
  log: Logger;
  /** Called once, before the step returns or throws, whenever it deleted anything. Its failure is
   * the caller's to log; it never replaces the step's own outcome. */
  onDeleted: (deleted: readonly DeletableArchive[]) => Promise<void>;
  /** DI for tests; defaults to `node:fs/promises`'s `unlink`. */
  unlink?: (path: string) => Promise<void>;
}

/**
 * Makes `neededBytes` plus `aimBytes` free at `stagingDir` by deleting the oldest deletable archives,
 * or plus `floorBytes` when the aim cannot be reached (an aim below the floor counts as the floor).
 * Refuses with `backup.staging_space_low`, deleting nothing, when free space plus every deletable
 * archive's size falls short of the floor. Free space is read again after each deletion or skipped
 * entry, and deleting stops when that reading reaches the goal or the deleted archives' sizes cover
 * the shortfall first read, whichever comes first. An archive can free less than its size (a hard
 * link, a sparse file), so a step can delete and still be refused: only the reading decides success.
 * Free space that cannot be read is let through.
 */
export async function makeRoom(opts: MakeRoomOptions): Promise<void> {
  for (const [name, bytes] of [
    ["neededBytes", opts.neededBytes],
    ["floorBytes", opts.floorBytes],
    ["aimBytes", opts.aimBytes],
  ] as const)
    if (!Number.isFinite(bytes) || bytes < 0)
      throw new Error(
        `makeRoom's ${name} must be a finite number of bytes, zero or more, not ${bytes}`,
      );
  const floor = opts.neededBytes + opts.floorBytes;
  const aim = opts.neededBytes + Math.max(opts.aimBytes, opts.floorBytes);
  let free = await freeBytes(opts.stagingDir, opts.statfs);
  if (free === null || free >= aim) return;
  const archives = await listDeletableArchives(opts.folders, await opts.installationStartedAt());
  const offered = archives.reduce((sum, a) => sum + a.bytes, 0);
  if (free + offered < floor)
    throw new AppError("backup.staging_space_low", { neededBytes: floor, availableBytes: free });
  const goal = free + offered >= aim ? aim : floor;
  const shortfall = goal - free;
  const unlink = opts.unlink ?? fs.unlink;
  const deleted: DeletableArchive[] = [];
  let deletedBytes = 0;
  try {
    for (const archive of archives) {
      if (free >= goal || deletedBytes >= shortfall) break;
      opts.signal.throwIfAborted();
      try {
        if (await deleteArchive(archive, unlink)) {
          deleted.push(archive);
          deletedBytes += archive.bytes;
          opts.log("info", "backup.archive_deleted", {
            destination: archive.destination,
            key: archive.key,
            bytes: archive.bytes,
            reason: "backup_room",
          });
        }
      } catch (error) {
        opts.log("warn", "backup.archive_delete_failed", {
          destination: archive.destination,
          key: archive.key,
          errorCode: codeOf(error),
          errno: errnoOf(error) ?? null,
        });
        free = await freeBytes(opts.stagingDir, opts.statfs);
        break;
      }
      free = await freeBytes(opts.stagingDir, opts.statfs);
      if (free === null) return;
    }
    if (free !== null && free < floor)
      throw new AppError("backup.staging_space_low", { neededBytes: floor, availableBytes: free });
  } finally {
    if (deleted.length > 0) {
      try {
        await opts.onDeleted(deleted);
      } catch {
        // The caller's report logs its own failure.
      }
    }
  }
}

/** Deletes one listed archive, or answers false, so it is neither deleted nor reported, when it is
 * gone, is no longer a plain file, or its folder's real path is no longer the one it was listed by. */
async function deleteArchive(
  archive: DeletableArchive,
  unlink: (path: string) => Promise<void>,
): Promise<boolean> {
  const path = join(archive.dir, archive.key);
  try {
    if (!(await fs.lstat(path)).isFile()) return false;
    if ((await fs.realpath(archive.dir)) !== archive.dir) return false;
    await unlink(path);
    return true;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return false;
    throw error;
  }
}
