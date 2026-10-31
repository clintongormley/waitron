import * as fs from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { parseBackupArchiveKey } from "./backup-keys.js";
import type { ClockStepHold } from "./backup-sweep.js";
import type { DeviceOf } from "./disk-usage.js";
import { errnoOf } from "./errno.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import type { Logger } from "./logger.js";
import type { StorageBackend } from "./storage-backend.js";
import "./errors.js";

/** A local backup folder on the disk being made room on, by its real path. */
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
 * An unknown installation start offers nothing. An archive `held` by a clock step (see
 * {@link heldByStep}) is offered only after every other, and "the newest" is then the newest one not
 * held, or the newest held one when every archive in the folder is held. `"everything"` offers
 * nothing.
 */
export async function listDeletableArchives(
  folders: readonly BackupFolder[],
  installationStartedAt: Date | null,
  readdir: (dir: string) => Promise<string[]> = (dir) => fs.readdir(dir),
  held?: ClockStepHold | "everything",
): Promise<DeletableArchive[]> {
  if (installationStartedAt === null || held === "everything") return [];
  const order = (a: DeletableArchive, b: DeletableArchive) =>
    Number(heldByStep(held, a.takenAt.getTime())) - Number(heldByStep(held, b.takenAt.getTime())) ||
    byAgeThenKey(a, b);
  const out: DeletableArchive[] = [];
  for (const { destination, dir } of folders) {
    const archives = await archivesIn(destination, dir, readdir);
    const free = archives.filter((a) => !heldByStep(held, a.takenAt.getTime()));
    const newest = (free.length > 0 ? free : archives).sort(byAgeThenKey).at(-1);
    out.push(
      ...archives.filter(
        (a) => a !== newest && a.takenAt.getTime() > installationStartedAt.getTime(),
      ),
    );
  }
  return out.sort(order);
}

/** Whether a clock step's hold covers an archive stamped at `ms`: before the step, or more than a
 * minute ahead of the clock when the hold was read (see `clockStepHold`). */
export function heldByStep(held: ClockStepHold | undefined, ms: number): boolean {
  return held !== undefined && (ms < held.fromMs || ms > held.toMs);
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
 * The local backup folders on `dir`'s disk. `folders` holds each folder once (by device
 * and inode, so two real paths to one folder are one), for listing archives; `copies` counts every
 * local destination on the disk, because the run copies to all of them at once and each copy holds a
 * whole working copy before its rename. A destination whose real path or disk cannot be read is
 * counted but never listed: counting a copy too many can only make the run ask for more room.
 */
export async function foldersOnDisk(
  backends: readonly Pick<StorageBackend, "id" | "localDir">[],
  dir: string,
  deviceOf?: DeviceOf,
): Promise<{ folders: BackupFolder[]; copies: number }> {
  const staging = await realOrNearest(dir);
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

/** The installation start, or null when there is no reader or it throws (logged
 * `backup.installation_start_unreadable`), so nothing is deleted. */
export async function installationStartOrNull(
  read: (() => Promise<Date | null>) | undefined,
  log: Logger,
): Promise<Date | null> {
  if (!read) return null;
  try {
    return await read();
  } catch (err) {
    log("warn", "backup.installation_start_unreadable", {
      errorCode: codeOf(err),
      errno: errnoOf(err),
    });
    return null;
  }
}

/** Records the deletion alert; a failure is logged `backup.archives_deleted_alert_failed`, never
 * thrown. */
export async function reportArchivesDeleted(
  record: ((deleted: readonly DeletableArchive[], at: Date) => Promise<void>) | undefined,
  deleted: readonly DeletableArchive[],
  at: Date,
  log: Logger,
): Promise<void> {
  if (!record) return;
  try {
    await record(deleted, at);
  } catch (err) {
    log("warn", "backup.archives_deleted_alert_failed", {
      errorCode: codeOf(err),
      errno: errnoOf(err),
    });
  }
}

export interface MakeRoomOptions {
  neededBytes: number;
  floorBytes: number;
  aimBytes: number;
  /** The folder whose disk is read. */
  dir: string;
  statfs?: Statfs;
  folders: readonly BackupFolder[];
  /** Asked only when free space is under the aim, so a step with room never waits for it. */
  installationStartedAt: () => Promise<Date | null>;
  /** The clock step's hold, asked as `installationStartedAt` is; absent, nothing is held. */
  clockStepHold?: () => Promise<ClockStepHold | "everything" | undefined>;
  signal: AbortSignal;
  log: Logger;
  /** Logged with each deletion. */
  reason: "backup_room" | "space_low" | "start_room";
  /** What to delete toward when free space plus every deletable archive falls short of the aim:
   * the floor, or the aim anyway, which deletes every deletable archive. */
  outOfReach: "floor" | "aim";
  /** Called once, before the step returns or throws, whenever it deleted anything. Its failure is
   * the caller's to log; it never replaces the step's own outcome. */
  onDeleted: (deleted: readonly DeletableArchive[]) => Promise<void>;
  /** DI for tests; defaults to `node:fs/promises`'s `unlink`. */
  unlink?: (path: string) => Promise<void>;
}

/**
 * Makes `neededBytes` plus `aimBytes` free at `dir` by deleting the oldest deletable archives, or
 * plus `floorBytes` when the aim cannot be reached and `outOfReach` is `"floor"` (an aim below the
 * floor counts as the floor).
 * Refuses with `backup.staging_space_low` (`afterDeleting: false`), deleting nothing, when free
 * space plus every deletable archive's size falls short of the floor. Free space is read again after
 * each deletion or skipped entry, and deleting stops when that reading reaches the goal or the
 * deleted archives' sizes cover the shortfall first read, whichever comes first. An archive can free
 * less than its size (a hard link, a sparse file), so a step can delete and still be refused: only
 * the reading decides success. A refusal on the reading after deleting, or after a failed deletion
 * stopped it, carries `afterDeleting: true`.
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
  let free = await freeBytes(opts.dir, opts.statfs);
  if (free === null || free >= aim) return;
  const archives = await listDeletableArchives(
    opts.folders,
    await opts.installationStartedAt(),
    undefined,
    await opts.clockStepHold?.(),
  );
  const offered = archives.reduce((sum, a) => sum + a.bytes, 0);
  if (free + offered < floor)
    throw new AppError("backup.staging_space_low", {
      neededBytes: floor,
      availableBytes: free,
      afterDeleting: false,
    });
  const goal = free + offered >= aim || opts.outOfReach === "aim" ? aim : floor;
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
            reason: opts.reason,
          });
        }
      } catch (error) {
        opts.log("warn", "backup.archive_delete_failed", {
          destination: archive.destination,
          key: archive.key,
          errorCode: codeOf(error),
          errno: errnoOf(error) ?? null,
        });
        free = await freeBytes(opts.dir, opts.statfs);
        break;
      }
      free = await freeBytes(opts.dir, opts.statfs);
      if (free === null) return;
    }
    if (free !== null && free < floor)
      throw new AppError("backup.staging_space_low", {
        neededBytes: floor,
        availableBytes: free,
        afterDeleting: true,
      });
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
