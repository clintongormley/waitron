import { lstat, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";

export const RESTORE_STAGING_DIR = "restore-staging";
/** Inside `RESTORE_STAGING_DIR`; each copy in it is a decrypted venue database. */
export const STAGED_RECOVERY_DIR = "staged-recovery";
export const STREAM_RESTORE_PREFIX = "stream-restore-";
export const RESTORE_ENTRY_PREFIX = "restore-entry-";
export const ARCHIVE_DOWNLOAD_PREFIX = "archive-download-";
export const ARCHIVE_VALIDATE_PREFIX = "archive-validate-";
export const RESTORE_ADMISSION_PREFIX = "restore-admission-";
/** Working folders a restore makes directly in the state folder. */
export const STATE_SCRATCH_PREFIXES = [STREAM_RESTORE_PREFIX, RESTORE_ENTRY_PREFIX] as const;
/** Working folders a restore makes inside `RESTORE_STAGING_DIR`. */
export const STAGING_SCRATCH_PREFIXES = [
  ARCHIVE_DOWNLOAD_PREFIX,
  ARCHIVE_VALIDATE_PREFIX,
  RESTORE_ADMISSION_PREFIX,
] as const;

/**
 * Full paths of the working folders a restore leaves behind when it is killed. Only real folders are
 * listed, and nothing inside a `RESTORE_STAGING_DIR` that is a symbolic link, because a deletion
 * there would land in its target. Only safe to delete while this process holds the venue folder:
 * every maker of these folders holds it too.
 */
export async function restoreLeftovers(stateDir: string): Promise<string[]> {
  const found = await foldersIn(stateDir, (name) =>
    STATE_SCRATCH_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
  const staging = join(stateDir, RESTORE_STAGING_DIR);
  const linked = await lstat(staging).then(
    (entry) => entry.isSymbolicLink(),
    () => true,
  );
  if (linked) return found;
  return found.concat(
    await foldersIn(
      staging,
      (name) =>
        name === STAGED_RECOVERY_DIR ||
        STAGING_SCRATCH_PREFIXES.some((prefix) => name.startsWith(prefix)),
    ),
  );
}

/** Removes every {@link restoreLeftovers} folder; never throws. */
export async function clearRestoreLeftovers(stateDir: string, log: Logger): Promise<void> {
  for (const path of await restoreLeftovers(stateDir)) {
    const folder = relative(stateDir, path);
    try {
      await rm(path, { recursive: true, force: true });
      log("info", "restore.leftover_removed", { folder });
    } catch (error) {
      log("warn", "restore.leftover_kept", { folder, errno: errnoOf(error) ?? null });
    }
  }
}

async function foldersIn(dir: string, wanted: (name: string) => boolean): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && wanted(entry.name))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}
