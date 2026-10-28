import { constants } from "node:fs";
import { lstat, open as openFile, unlink as unlinkFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { MiddlewareHandler } from "hono";
import {
  SPARE_SPACE_FILE,
  createFirstSetupBackupWorkspace,
  isEmptiedTombstone,
  type FirstSetupRoots,
} from "@waitron/provisioning";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import type { Statfs } from "./free-bytes.js";
import { lowestFreeBytes } from "./start-space.js";
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

/**
 * Appends random bytes to the box's spare file until it holds `bytes`; random so a compressing
 * filesystem cannot store it in less room (design M5b). A link or folder at its path
 * is left alone. Nothing is thrown.
 */
export async function topUpSpare(options: {
  stateDir: string;
  bytes: number;
  log: Logger;
  open?: OpenSpare;
}): Promise<void> {
  const { stateDir, bytes, log, open = openFile } = options;
  const path = join(stateDir, SPARE_SPACE_FILE);
  try {
    const info = await lstat(path).catch((error: unknown) => {
      if (errnoOf(error) === "ENOENT") return null;
      throw error;
    });
    if (info && !info.isFile()) {
      log("warn", "storage.spare_unusable", { kind: kindOf(info) });
      return;
    }
    if (info && info.size >= bytes) return;
    const { O_WRONLY, O_APPEND, O_CREAT, O_NOFOLLOW } = constants;
    const handle = await open(path, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, 0o600);
    try {
      let size = (await handle.stat()).size;
      while (size < bytes) {
        const chunk = randomBytes(Math.min(CHUNK_BYTES, bytes - size));
        const { bytesWritten } = await handle.write(chunk);
        size += bytesWritten;
      }
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
    log("warn", "storage.spare_write_failed", { errno: errnoOf(error) ?? null });
  }
}

function kindOf(info: { isSymbolicLink(): boolean; isDirectory(): boolean }): string {
  return info.isSymbolicLink() ? "link" : info.isDirectory() ? "folder" : "other";
}

/**
 * Deletes the box's spare file so a nearly full disk has room to take a venue folder's lock; answers
 * the bytes it held. A link or folder at its path is left alone. Nothing is thrown.
 */
export async function releaseSpare(
  stateDir: string,
  log: Logger,
  fs: { unlink: (path: string) => Promise<void> } = { unlink: unlinkFile },
): Promise<number> {
  const path = join(stateDir, SPARE_SPACE_FILE);
  try {
    const info = await lstat(path);
    if (!info.isFile()) {
      log("warn", "storage.spare_unusable", { kind: kindOf(info) });
      return 0;
    }
    await fs.unlink(path);
    if (info.size > 0) log("warn", "storage.spare_released", { bytes: info.size });
    return info.size;
  } catch (error) {
    const errno = errnoOf(error);
    if (errno !== "ENOENT") log("warn", "storage.spare_release_failed", { errno: errno ?? null });
    return 0;
  }
}

const START_AGAIN_STEPS = new Set([
  "GET /setup-api/first-setup/resolution",
  "POST /setup-api/first-setup/resolution/recover",
  "POST /setup-api/first-setup/resolution/start-again/summary",
  "POST /setup-api/first-setup/resolution/start-again",
]);

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
        log("warn", "storage.spare_release_skipped", { errno: errnoOf(error) ?? null });
      }
    }
    await next();
  };
}

async function discardable(roots: FirstSetupRoots): Promise<boolean> {
  const last = (await createFirstSetupBackupWorkspace(roots).readChain()).at(-1);
  if (last === undefined) return false;
  if (["prepared", "placement-started", "restored"].includes(last.phase)) return true;
  return last.phase === "abandoned" && !(await isEmptiedTombstone(roots, last.target.recoveryId));
}
