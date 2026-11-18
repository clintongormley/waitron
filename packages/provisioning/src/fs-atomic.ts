import "./errors.js";
import { link, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { syncFolder } from "./folder-sync.js";

/** Where {@link stageFileDurable} writes `path`'s working copy. */
export function stagedPath(path: string): string {
  return `${path}.tmp`;
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

export interface DurableFileOptions {
  exactMode?: boolean;
  overwrite?: boolean;
}

/** Writes and syncs a working copy. Exclusive creation leaves a staging file owned by another call intact. */
export async function stageFileDurable(
  path: string,
  data: string | Uint8Array,
  mode: number,
  options: DurableFileOptions = {},
): Promise<string> {
  const tmp = stagedPath(path);
  let created = false;
  try {
    if (options.overwrite !== false) await rm(tmp, { force: true });
    const handle = await open(tmp, options.overwrite === false ? "wx" : "w", mode);
    created = true;
    let failed = false;
    try {
      if (options.exactMode) await handle.chmod(mode);
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
    if (created || options.overwrite !== false)
      await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  return tmp;
}

/** Publishes an owned, completed file whose bytes were written incrementally. */
export async function publishFileDurable(source: string, target: string): Promise<void> {
  const file = await open(source, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(source, target);
  await syncFolderHolding(target);
}

/** Publishes flushed bytes by replacement, or exclusively by hard link, then syncs the folder. */
export async function writeFileDurable(
  path: string,
  data: string | Uint8Array,
  mode: number,
  options: DurableFileOptions = {},
): Promise<void> {
  const tmp = await stageFileDurable(path, data, mode, options);
  try {
    if (options.overwrite === false) await link(tmp, path);
    else await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  let cleanupFailure: { error: unknown } | undefined;
  try {
    if (options.overwrite === false) await rm(tmp);
  } catch (error) {
    cleanupFailure = { error };
  }
  try {
    await syncFolderHolding(path);
  } catch (error) {
    if (cleanupFailure === undefined) {
      if (typeof error === "object" && error !== null) folderSyncFailures.add(error);
      throw error;
    }
  }
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
}
