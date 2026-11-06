import "./errors.js";
import { mkdir, open, realpath, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { syncFolder } from "./folder-sync.js";

/** Where {@link stageFile} and {@link stageFileDurable} write `path`'s working copy. */
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

/** Sync the folder holding `path`, following it when it is a link: a box's `tls` folder may be one,
 * and syncing a folder writes nothing to it. */
export async function syncFolderHolding(path: string): Promise<void> {
  const folder = dirname(path);
  try {
    await syncFolder(folder);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOTDIR" && code !== "ELOOP") throw error;
    await syncFolder(await realpath(folder));
  }
}

/** Sync the folder holding each folder that a recursive `mkdir` of `deepest` created, `first` being
 * what that `mkdir` returned: a new folder's own entry lives in the folder above it, so a file
 * written durably inside it is guaranteed to survive a crash only once that entry is synced too. */
export async function syncNewFolders(first: string | undefined, deepest: string): Promise<void> {
  if (first === undefined) return;
  let folder = resolve(first);
  await syncFolderHolding(folder);
  for (const part of relative(folder, resolve(deepest)).split(sep).filter(Boolean)) {
    folder = join(folder, part);
    await syncFolderHolding(folder);
  }
}

/** A recursive `mkdir` of `path`, then {@link syncNewFolders} for the folders it created. */
export async function mkdirDurable(path: string, mode: number): Promise<void> {
  await syncNewFolders(await mkdir(path, { recursive: true, mode }), path);
}

/** Whether `error` came from {@link writeFileDurable}'s folder sync, after the file was in place. */
export function failedAtFolderSync(error: unknown): boolean {
  return typeof error === "object" && error !== null && folderSyncFailures.has(error);
}

/** {@link stageFile}, also syncing the working copy to disk before returning its path. A failure
 * at any step removes the working copy and is thrown. */
export async function stageFileDurable(
  path: string,
  data: string | Uint8Array,
  mode: number,
): Promise<string> {
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
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return tmp;
}

/** {@link stageFileDurable}, then rename the working copy onto `path` and sync the folder. A failed
 * sync is thrown; a failure before the rename removes the working copy. */
export async function writeFileDurable(
  path: string,
  data: string | Uint8Array,
  mode: number,
): Promise<void> {
  const tmp = await stageFileDurable(path, data, mode);
  try {
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  try {
    await syncFolderHolding(path);
  } catch (error) {
    if (typeof error === "object" && error !== null) folderSyncFailures.add(error);
    throw error;
  }
}
