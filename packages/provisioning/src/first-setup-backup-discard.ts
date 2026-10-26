import { constants } from "node:fs";
import { lstat, open, readdir, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { lockVenueDatabase } from "@waitron/db";
import { AppError, isUuid } from "@waitron/shared";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import { canonicalFirstSetupDirectory } from "./first-setup-resolution.js";
import { createFirstSetupBackupWorkspace } from "./first-setup-backup-workspace.js";
import { readDurableHostJson } from "./durable-host-json.js";
import "./errors.js";

type Remove = (path: string, kind: "file" | "folder") => Promise<void>;
type Lock = (directory: string) => Promise<{ release(): void }>;

const NAMESPACE = join("first-setup-resolutions", "backup-recovery");
const RECORD = /^\d+\.json$/;
// never unlinked: CLAUDE.md §3; a lock taken beside its holder is no lock. A held lock has a
// `-journal` beside it, and the holder file is written through `.partial`.
const KEPT_IN_TARGET =
  /^((venue|migrations|recovery)\.lock(-journal)?|venue\.holder\.json(\.partial)?)$/;

const missing = (error: unknown) =>
  error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";

async function syncFolder(path: string): Promise<void> {
  const folder = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
  );
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}

async function removeAndSync(path: string, kind: "file" | "folder"): Promise<void> {
  if (kind === "file") await unlink(path);
  else await rmdir(path);
  await syncFolder(dirname(path));
}

async function canonical(anchor: FirstSetupRoots, recoveryId: string): Promise<FirstSetupRoots> {
  if (!isUuid(recoveryId)) throw new AppError("setup.attempt_conflict", {});
  return {
    venueDir: await canonicalFirstSetupDirectory(anchor.venueDir),
    stateDir: await canonicalFirstSetupDirectory(anchor.stateDir),
  };
}

/**
 * What emptying would remove under the recovery's folder, deepest first; `null` when the folder
 * is missing. A symlink, or anything that is neither a file nor a folder, is refused.
 */
async function removals(base: string): Promise<{ path: string; kind: "file" | "folder" }[] | null> {
  const out: { path: string; kind: "file" | "folder" }[] = [];
  async function walk(directory: string, inTarget: boolean, removable: boolean): Promise<boolean> {
    let kept = false;
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink() || !(info.isFile() || info.isDirectory()))
        throw new AppError("setup.attempt_uncertain", {});
      if (info.isDirectory()) {
        const childKept = await walk(
          path,
          inTarget || (directory === base && name === "target"),
          true,
        );
        kept ||= childKept;
        continue;
      }
      if (directory === base ? RECORD.test(name) : inTarget && KEPT_IN_TARGET.test(name)) {
        kept = true;
        continue;
      }
      out.push({ path, kind: "file" });
    }
    if (removable && !kept) out.push({ path: directory, kind: "folder" });
    return kept;
  }
  try {
    const info = await lstat(base);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new AppError("setup.attempt_uncertain", {});
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  await walk(base, false, false);
  return out;
}

/** True when the venue folder's pointer is its own file and names this recovery. */
async function venuePointerNames(anchor: FirstSetupRoots, recoveryId: string): Promise<boolean> {
  if (anchor.venueDir === anchor.stateDir) return false;
  const pointer = await readDurableHostJson(
    join(anchor.venueDir, NAMESPACE, "current.json"),
    131072,
  );
  if (pointer === null) return false;
  const named =
    typeof pointer === "object" &&
    "target" in pointer &&
    typeof pointer.target === "object" &&
    pointer.target !== null &&
    "recoveryId" in pointer.target
      ? pointer.target.recoveryId
      : undefined;
  return !(typeof named === "string" && isUuid(named) && named !== recoveryId);
}

/**
 * True only when the recovery's folder holds nothing but its records and its target's lock files,
 * and the venue folder's pointer no longer names it.
 */
export async function isEmptiedTombstone(
  anchor: FirstSetupRoots,
  recoveryId: string,
): Promise<boolean> {
  const roots = await canonical(anchor, recoveryId);
  const base = join(roots.stateDir, NAMESPACE, recoveryId);
  const left = await removals(base);
  if (left === null || left.length !== 0) return false;
  if (!(await readdir(base)).some((name) => RECORD.test(name))) return false;
  return !(await venuePointerNames(roots, recoveryId));
}

/**
 * Deletes everything an abandoned recovery left but its records and its target's lock files, then
 * the venue folder's pointer to it; the state folder's pointer stays. Holds the box's venue folder
 * and then the target's while it deletes; a lock's failure is thrown unchanged.
 */
export async function emptyAbandonedBackupRecovery(
  anchor: FirstSetupRoots,
  recoveryId: string,
  lock: Lock = lockVenueDatabase,
  remove: Remove = removeAndSync,
): Promise<void> {
  const roots = await canonical(anchor, recoveryId);
  const last = (await createFirstSetupBackupWorkspace(roots).read()).at(-1);
  if (last?.phase !== "abandoned" || last.target.recoveryId !== recoveryId)
    throw new AppError("setup.attempt_conflict", {});
  const holds: { release(): void }[] = [];
  try {
    holds.push(await lock(roots.venueDir));
    holds.push(await lock(last.target.target.venueDir));
    const base = join(roots.stateDir, NAMESPACE, recoveryId);
    for (const item of (await removals(base)) ?? []) await remove(item.path, item.kind);
    // With one folder for both, the venue folder's pointer is the state folder's, which stays.
    if (roots.venueDir === roots.stateDir) return;
    if (await venuePointerNames(roots, recoveryId))
      await remove(join(roots.venueDir, NAMESPACE, "current.json"), "file");
    for (const folder of [
      join(roots.venueDir, NAMESPACE),
      join(roots.venueDir, "first-setup-resolutions"),
    ]) {
      let names: string[];
      try {
        names = await readdir(folder);
      } catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      if (names.length !== 0) break;
      await remove(folder, "folder");
    }
  } finally {
    for (const hold of holds.reverse()) hold.release();
  }
}
