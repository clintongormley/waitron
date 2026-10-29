import "./errors.js";
import { open, writeFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { syncFolder } from "./folder-sync.js";

/** Where {@link stageFile} writes `path`'s working copy. */
export function stagedPath(path: string): string {
  return `${path}.tmp`;
}

/**
 * Write `data` to `${path}.tmp` (same directory, so a later `rename` onto `path` is atomic on POSIX)
 * and return that working path; `path` itself is untouched.
 *
 * Any stale `${path}.tmp` is REMOVED first, because `writeFile` applies `mode` only when it CREATES
 * the file: a reused stale tmp would carry its old, possibly broader permissions onto a secret.
 */
export async function stageFile(
  path: string,
  data: string | Uint8Array,
  mode: number,
): Promise<string> {
  const tmp = stagedPath(path);
  await rm(tmp, { force: true });
  await writeFile(tmp, data, { mode, flag: "w" });
  return tmp;
}

/**
 * {@link stageFile}, then rename the working copy onto `path`, so a reader sees `path` absent or
 * whole. Atomic VISIBILITY only: it does not fsync.
 */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  mode: number,
): Promise<void> {
  await rename(await stageFile(path, data, mode), path);
}

const folderSyncFailures = new WeakSet<object>();

/** Whether `error` came from {@link writeFileDurable}'s folder sync, after the file was in place. */
export function failedAtFolderSync(error: unknown): boolean {
  return typeof error === "object" && error !== null && folderSyncFailures.has(error);
}

/** {@link writeFileAtomic}, also syncing the working copy before the rename and the folder after
 * it. A failed sync is thrown; a failure before the rename removes the working copy. */
export async function writeFileDurable(
  path: string,
  data: string | Uint8Array,
  mode: number,
): Promise<void> {
  const tmp = stagedPath(path);
  try {
    await rm(tmp, { force: true });
    const handle = await open(tmp, "w", mode);
    let failed = false;
    try {
      await handle.writeFile(data);
      await handle.sync();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await handle.close().catch((error: unknown) => {
        if (!failed) throw error;
      });
    }
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  try {
    await syncFolder(dirname(path));
  } catch (error) {
    if (typeof error === "object" && error !== null) folderSyncFailures.add(error);
    throw error;
  }
}
