import { SCRATCH_DIR } from "@waitron/store";
import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
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
