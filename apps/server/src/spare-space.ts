import { constants } from "node:fs";
import { lstat, open as openFile, unlink as unlinkFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import { isAppError } from "@waitron/shared";
import {
  ABANDONABLE_BACKUP_PHASES,
  SPARE_SPACE_FILE,
  SPARE_SPACE_RELEASED_FILE,
  createFirstSetupBackupWorkspace,
  isEmptiedTombstone,
  type FirstSetupRoots,
} from "@waitron/provisioning";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import type { Statfs } from "./free-bytes.js";
import { lowestFreeBytes } from "./start-space.js";
import { START_AGAIN_ROUTES } from "./setup-first-fiscal-api.js";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";

export const SPARE_SPACE_BYTES = 8 * 1024 * 1024;

const CHUNK_BYTES = 1024 * 1024;

export interface SpareHandle {
  stat(): Promise<{ size: number }>;
  write(chunk: Buffer): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export type OpenSpare = (path: string, flags: number, mode: number) => Promise<SpareHandle>;

type Unlink = (path: string) => Promise<void>;

/**
 * Appends random bytes to the box's spare file until it holds `bytes`; random so a compressing
 * filesystem cannot store it in less room (design M5b). A link or folder at its path
 * is left alone. `hasRoom` is asked only when the spare is not already a full-size file, and
 * nothing is written or logged when it answers false. Once the spare is whole, or with room a link
 * or folder stands at its path (it can never be whole), the release marker is deleted. Nothing is
 * thrown.
 */
export async function topUpSpare(options: {
  stateDir: string;
  bytes: number;
  log: Logger;
  hasRoom?: () => Promise<boolean>;
  open?: OpenSpare;
  unlink?: Unlink;
}): Promise<void> {
  const { stateDir, bytes, log, hasRoom = async () => true, open = openFile } = options;
  const path = join(stateDir, SPARE_SPACE_FILE);
  const clearMarker = (restored = true) =>
    deleteMarker(stateDir, restored ? bytes : null, log, options.unlink ?? unlinkFile);
  try {
    const info = await lstat(path).catch((error: unknown) => {
      if (errnoOf(error) === "ENOENT") return null;
      throw error;
    });
    if (info?.isFile() && info.size >= bytes) return await clearMarker();
    if (!(await hasRoom())) return;
    if (info && !info.isFile()) {
      log("warn", "storage.spare_unusable", { kind: kindOf(info) });
      return await clearMarker(false);
    }
    const { O_WRONLY, O_APPEND, O_CREAT, O_NOFOLLOW } = constants;
    const handle = await open(path, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, 0o600);
    try {
      // The size is read again before every chunk so two starts topping up at once overshoot
      // the cap by at most a chunk, not by a whole spare.
      for (let size = (await handle.stat()).size; size < bytes; size = (await handle.stat()).size)
        await handle.write(randomBytes(Math.min(CHUNK_BYTES, bytes - size)));
      await handle.sync();
    } finally {
      await handle.close();
    }
    const folder = await open(stateDir, constants.O_RDONLY | constants.O_DIRECTORY, 0);
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
    await clearMarker();
  } catch (error) {
    log("warn", "storage.spare_write_failed", { errno: errnoOf(error) ?? null });
  }
}

/** `restored` is the whole spare's size, or null when the marker goes without one. */
async function deleteMarker(
  stateDir: string,
  restored: number | null,
  log: Logger,
  unlink: Unlink,
): Promise<void> {
  try {
    await unlink(join(stateDir, SPARE_SPACE_RELEASED_FILE));
    if (restored !== null) log("info", "storage.spare_restored", { bytes: restored });
  } catch (error) {
    const errno = errnoOf(error);
    if (errno !== "ENOENT")
      log("warn", "storage.spare_marker_delete_failed", { errno: errno ?? null });
  }
}

/** Whether the release marker is a regular file in `stateDir`; an unreadable one answers true. */
export async function spareReleased(stateDir: string, log: Logger): Promise<boolean> {
  try {
    return (await lstat(join(stateDir, SPARE_SPACE_RELEASED_FILE))).isFile();
  } catch (error) {
    const errno = errnoOf(error);
    if (errno === "ENOENT") return false;
    log("warn", "storage.spare_marker_unread", { errno: errno ?? null });
    return true;
  }
}

/**
 * The running box's write-back: only while the marker exists (otherwise every booted server with
 * room would write the spare), and only with the spare plus 16 MiB free in both folders. A call
 * while one is under way answers that one's promise, so two callers cannot both write.
 */
export function spareRestorer(options: {
  stateDir: string;
  venueDir: string;
  bytes: number;
  log: Logger;
  statfs?: Statfs;
}): () => Promise<void> {
  const { stateDir, venueDir, bytes, log, statfs } = options;
  let running: Promise<void> | null = null;
  async function restore(): Promise<void> {
    if (!(await spareReleased(stateDir, log))) return;
    await topUpSpare({
      stateDir,
      bytes,
      log,
      hasRoom: async () => {
        const lowest = await lowestFreeBytes([stateDir, venueDir], statfs);
        return lowest !== null && lowest >= bytes + FULL_DISK_BYTES;
      },
    });
  }
  return () =>
    (running ??= restore().finally(() => {
      running = null;
    }));
}

async function writeMarker(stateDir: string, log: Logger, open: OpenSpare): Promise<void> {
  try {
    const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW } = constants;
    const path = join(stateDir, SPARE_SPACE_RELEASED_FILE);
    const handle = await open(path, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o600);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    const folder = await open(stateDir, constants.O_RDONLY | constants.O_DIRECTORY, 0);
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
  } catch (error) {
    log("warn", "storage.spare_marker_write_failed", { errno: errnoOf(error) ?? null });
  }
}

function kindOf(info: { isSymbolicLink(): boolean; isDirectory(): boolean }): string {
  return info.isSymbolicLink() ? "link" : info.isDirectory() ? "folder" : "other";
}

/**
 * Deletes the box's spare file so a nearly full disk has room to start or to take a venue folder's
 * lock; answers the bytes it held. A spare that held bytes leaves the release marker behind it (a
 * marker that cannot be written is logged). A link or folder at its path is left alone. Nothing is
 * thrown.
 */
export async function releaseSpare(
  stateDir: string,
  log: Logger,
  fs: { unlink?: Unlink; open?: OpenSpare } = {},
): Promise<number> {
  const { unlink = unlinkFile, open = openFile } = fs;
  const path = join(stateDir, SPARE_SPACE_FILE);
  try {
    const info = await lstat(path);
    if (!info.isFile()) {
      log("warn", "storage.spare_unusable", { kind: kindOf(info) });
      return 0;
    }
    await unlink(path);
    if (info.size > 0) {
      log("warn", "storage.spare_released", { bytes: info.size });
      await writeMarker(stateDir, log, open);
    }
    return info.size;
  } catch (error) {
    const errno = errnoOf(error);
    if (errno !== "ENOENT") log("warn", "storage.spare_release_failed", { errno: errno ?? null });
    return 0;
  }
}

const START_AGAIN_STEPS = new Set(
  Object.values(START_AGAIN_ROUTES).map(({ method, path }) => `${method} ${path}`),
);

/**
 * Before each step of the repair page's Start-again flow, deletes the box's spare file on a nearly
 * full disk when the journal names a recovery Start again would discard and none runs in this
 * process, so the venue locks Start again takes have room. Always serves the request.
 */
export function releaseSpareBeforeStartAgain(options: {
  stateDir: string;
  roots: FirstSetupRoots;
  statfs?: Statfs;
  recovery: { runningInMemory(): boolean };
  log: Logger;
}): MiddlewareHandler {
  const { stateDir, roots, statfs, recovery, log } = options;
  return async (c, next) => {
    if (START_AGAIN_STEPS.has(`${c.req.method} ${c.req.path}`) && !recovery.runningInMemory()) {
      try {
        const free = await lowestFreeBytes([roots.stateDir, roots.venueDir], statfs);
        if (free !== null && free < FULL_DISK_BYTES && (await discardable(roots)))
          await releaseSpare(stateDir, log);
      } catch (error) {
        log("warn", "storage.spare_release_skipped", {
          errno: errnoOf(error) ?? null,
          errorCode: isAppError(error) ? error.code : null,
        });
      }
    }
    await next();
  };
}

async function discardable(roots: FirstSetupRoots): Promise<boolean> {
  const last = (await createFirstSetupBackupWorkspace(roots).readChain()).at(-1);
  if (last === undefined) return false;
  if (ABANDONABLE_BACKUP_PHASES.includes(last.phase)) return true;
  return last.phase === "abandoned" && !(await isEmptiedTombstone(roots, last.target.recoveryId));
}
