import { SCRATCH_DIR } from "@waitron/store";
import { lstat, readdir, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { isWithin } from "./disk-usage.js";
import "./errors.js";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";

export async function listScratch(stateDir: string, log: Logger): Promise<string[] | null> {
  const path = join(stateDir, SCRATCH_DIR);
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      log("warn", "storage.start_cleanup_skipped", { folder: SCRATCH_DIR });
      return null;
    }
    return await readdir(path);
  } catch (error) {
    if (errnoOf(error) !== "ENOENT")
      log("warn", "storage.start_cleanup_failed", { errno: errnoOf(error) ?? null });
    return null;
  }
}

export async function deleteScratchEntries(
  stateDir: string,
  names: readonly string[],
  log: Logger,
): Promise<number> {
  let deleted = 0;
  for (const name of names) {
    try {
      await rm(join(stateDir, SCRATCH_DIR, name), { recursive: true, force: true });
      deleted += 1;
    } catch (error) {
      log("warn", "storage.start_cleanup_failed", { errno: errnoOf(error) ?? null });
    }
  }
  return deleted;
}

export async function emptyScratch(stateDir: string, log: Logger): Promise<number> {
  return deleteScratchEntries(stateDir, (await listScratch(stateDir, log)) ?? [], log);
}

export function inScratch(stateDir: string, path: string): boolean {
  return isWithin(physicalPath(path), physicalPath(join(stateDir, SCRATCH_DIR)));
}

export function assertOutsideScratch(stateDir: string, path: string, variable: string): void {
  if (inScratch(stateDir, path))
    throw new AppError("server.config_invalid", {
      variable,
      reason: "scratch_is_temporary_choose_a_folder_outside_scratch",
    });
}

// Resolve existing parents too: a new destination can sit behind an existing link.
function physicalPath(path: string): string {
  let current = resolve(path);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...tail);
    } catch (error) {
      if (errnoOf(error) !== "ENOENT" && errnoOf(error) !== "ENOTDIR") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      tail.unshift(basename(current));
      current = parent;
    }
  }
}
