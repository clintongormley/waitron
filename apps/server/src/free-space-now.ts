import type { Stats } from "node:fs";
import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { BACKUP_ENCRYPT_DIR_PREFIX } from "./backup-keys.js";
import type { StagingTurn } from "./backup-staging-turn.js";
import type { DiskFullState } from "./disk-full-state.js";
import { errnoOf } from "./errno.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import type { FreeSpaceState } from "./free-space-watch.js";
import type { Logger } from "./logger.js";
import {
  BACKUP_STAGING_DIR,
  CRASH_REPORT,
  CRASH_REPORT_KEEP_MS,
  ROTATED_LOG,
  STAGED_DUMP,
} from "./start-space.js";

export interface LeftoverDeps {
  logDir: string;
  stateDir: string;
  now: () => Date;
  staging: Pick<StagingTurn, "ifNoBackup" | "backupRunning">;
  log: Logger;
  /** Defaults to `node:fs/promises`' `rm`; tests inject a refusal. */
  remove?: (path: string, options: { recursive: boolean }) => Promise<void>;
  /** Defaults to `node:fs/promises`' `lstat`; tests hold one to overlap a survey with a deletion. */
  lstat?: typeof fs.lstat;
  /** Defaults to `node:fs/promises`' `readdir`; tests make a folder vanish. */
  readdir?: (path: string) => Promise<string[]>;
}

/** What a deletion would free now. Takes no turn: staging's size is best-effort while a run may
 * be writing there, and is left out while a backup run holds the turn. */
export interface LeftoverSurvey {
  bytes: number;
  backupRunning: boolean;
}

export interface LeftoverRemoval {
  freedBytes: number;
  deleted: number;
  failed: number;
  backupRunning: boolean;
}

interface Leftover {
  path: string;
  bytes: number;
  recursive: boolean;
}

interface Walk {
  deps: LeftoverDeps;
  lstat: typeof fs.lstat;
  readdir: (path: string) => Promise<string[]>;
  /** The deletion reports a skipped or unreadable folder; the survey, run on every refresh, does not. */
  report: boolean;
}

export async function surveyLeftovers(deps: LeftoverDeps): Promise<LeftoverSurvey> {
  const walk = walkFor(deps, false);
  const backupRunning = deps.staging.backupRunning();
  const found = [
    ...(backupRunning ? [] : await stagingLeftovers(walk)),
    ...(await logLeftovers(walk)),
  ];
  return { bytes: sum(found), backupRunning };
}

/** Deletes decision 6's set, staging first, staging inside `ifNoBackup`; never throws for a file. */
export async function deleteLeftovers(deps: LeftoverDeps): Promise<LeftoverRemoval> {
  const walk = walkFor(deps, true);
  const remove = deps.remove ?? ((path, options) => fs.rm(path, options));
  const result: LeftoverRemoval = { freedBytes: 0, deleted: 0, failed: 0, backupRunning: false };
  const removeAll = async (found: Leftover[]) => {
    for (const leftover of found) {
      try {
        // No `force`: a refusal must be seen, and a vanished file is told apart by its ENOENT.
        await remove(leftover.path, { recursive: leftover.recursive });
        result.deleted += 1;
        result.freedBytes += leftover.bytes;
      } catch (error) {
        if (errnoOf(error) === "ENOENT") continue;
        result.failed += 1;
        failed(deps, error);
      }
    }
  };
  const staged = await deps.staging.ifNoBackup(async () => removeAll(await stagingLeftovers(walk)));
  result.backupRunning = !staged.ran;
  await removeAll(await logLeftovers(walk));
  return result;
}

export interface FreedSpace extends LeftoverRemoval {
  /** The venue folder's free space after the deletion; null where it cannot be read. */
  freeBytes: number | null;
}

/** A call while a deletion is under way answers that deletion's promise. */
export function createSpaceFreer(
  deps: LeftoverDeps & {
    venueDir: string;
    space: Pick<FreeSpaceState, "record">;
    disk: Pick<DiskFullState, "noted" | "full">;
    statfs?: Statfs;
    /** Called once after each deletion settles, so boot can start a fresh disk usage walk. */
    onFreed?: () => void;
  },
): (personId: string) => Promise<FreedSpace> {
  let running: Promise<FreedSpace> | null = null;

  async function run(personId: string): Promise<FreedSpace> {
    const removal = await deleteLeftovers(deps);
    const free = await freeBytes(deps.venueDir, deps.statfs);
    deps.space.record(free, deps.now());
    // The fresh reading lets a noted full-disk stop lift now rather than at the next watch tick.
    if (deps.disk.noted()) await deps.disk.full();
    deps.log("info", "storage.space_freed", { ...removal, personId });
    return { ...removal, freeBytes: free };
  }

  return (personId) => {
    running ??= run(personId).finally(() => {
      running = null;
      deps.onFreed?.();
    });
    return running;
  };
}

function walkFor(deps: LeftoverDeps, report: boolean): Walk {
  return {
    // A trailing separator would make `lstat` describe a linked log folder's target, not the link.
    deps: { ...deps, logDir: resolve(deps.logDir) },
    lstat: deps.lstat ?? fs.lstat,
    readdir: deps.readdir ?? ((path) => fs.readdir(path)),
    report,
  };
}

async function stagingLeftovers(walk: Walk): Promise<Leftover[]> {
  const dir = join(walk.deps.stateDir, BACKUP_STAGING_DIR);
  const found: Leftover[] = [];
  for (const name of (await list(walk, dir, BACKUP_STAGING_DIR)) ?? []) {
    const path = join(dir, name);
    const info = await entry(walk, path);
    if (info === null) continue;
    if (STAGED_DUMP.test(name) && info.isFile()) {
      found.push({ path, bytes: info.size, recursive: false });
    } else if (name.startsWith(BACKUP_ENCRYPT_DIR_PREFIX) && info.isDirectory()) {
      found.push({ path, bytes: await folderBytes(walk, path), recursive: true });
    }
  }
  return found;
}

/** Rotated logs, highest number first, then crash reports, oldest first. */
async function logLeftovers(walk: Walk): Promise<Leftover[]> {
  const logDir = walk.deps.logDir;
  const names = await list(walk, logDir, "logs");
  // A log folder that is a link is skipped whole, crash reports included, as the start skips it.
  if (names === null) return [];
  const logs: (Leftover & { n: number })[] = [];
  for (const name of names) {
    const match = ROTATED_LOG.exec(name);
    if (match === null || Number(match[1]) < 2) continue;
    const path = join(logDir, name);
    const info = await entry(walk, path);
    if (info?.isFile())
      logs.push({ path, bytes: info.size, recursive: false, n: Number(match[1]) });
  }
  logs.sort((a, b) => b.n - a.n);

  const crashDir = join(logDir, "crash-reports");
  const cutoff = walk.deps.now().getTime() - CRASH_REPORT_KEEP_MS;
  const reports: (Leftover & { mtimeMs: number })[] = [];
  for (const name of (await list(walk, crashDir, "crash-reports")) ?? []) {
    if (!CRASH_REPORT.test(name)) continue;
    const path = join(crashDir, name);
    const info = await entry(walk, path);
    if (info?.isFile() && info.mtimeMs < cutoff) {
      reports.push({ path, bytes: info.size, recursive: false, mtimeMs: info.mtimeMs });
    }
  }
  reports.sort((a, b) => a.mtimeMs - b.mtimeMs);

  return [...logs, ...reports].map(({ path, bytes, recursive }) => ({ path, bytes, recursive }));
}

/** A folder's names; null when it is missing, unreadable or a symbolic link, whose listing and
 * deletions would land in its target. */
async function list(walk: Walk, dir: string, folder: string): Promise<string[] | null> {
  try {
    if ((await walk.lstat(dir)).isSymbolicLink()) {
      if (walk.report) walk.deps.log("warn", "storage.free_space_skipped", { folder });
      return null;
    }
    return await walk.readdir(dir);
  } catch (error) {
    unreadable(walk, error);
    return null;
  }
}

/** An entry's own description, never its link target's; null when it has gone or cannot be read. */
async function entry(walk: Walk, path: string): Promise<Stats | null> {
  try {
    return await walk.lstat(path);
  } catch (error) {
    unreadable(walk, error);
    return null;
  }
}

/** The regular files under a real folder, no link followed. */
async function folderBytes(walk: Walk, dir: string): Promise<number> {
  let bytes = 0;
  let names: string[];
  try {
    names = await walk.readdir(dir);
  } catch (error) {
    unreadable(walk, error);
    return 0;
  }
  for (const name of names) {
    const path = join(dir, name);
    const info = await entry(walk, path);
    if (info?.isFile()) bytes += info.size;
    else if (info?.isDirectory()) bytes += await folderBytes(walk, path);
  }
  return bytes;
}

/** Something gone during the walk counts as nothing: the survey takes no turn, so a deletion can
 * run under it. */
function unreadable(walk: Walk, error: unknown): void {
  if (walk.report && errnoOf(error) !== "ENOENT") failed(walk.deps, error);
}

function failed(deps: LeftoverDeps, error: unknown): void {
  deps.log("warn", "storage.free_space_failed", { errno: errnoOf(error) ?? null });
}

function sum(found: Leftover[]): number {
  return found.reduce((total, leftover) => total + leftover.bytes, 0);
}
