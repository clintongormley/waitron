import { readFile, readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { lockVenueDatabase, type VenueLock } from "@waitron/db";
import {
  beginEnvironmentMove,
  deleteBackupRoomNote,
  environmentMoveInventory,
  environmentMovePiecePath,
  finishEnvironmentMove,
  resumeEnvironmentMove,
} from "@waitron/provisioning";
import { codeOf } from "@waitron/server-kit";
import { hasCode, isAppError } from "@waitron/shared";
import { REPLACED_RESET_FILE, SCRATCH_DIR, STATE_LAYOUT, TLS_DIR } from "@waitron/store";
import { errnoOf } from "./errno.js";
import { requestTunnelKeyRotation } from "./cloud-tunnel.js";
import { syncFolderHolding, writeFileDurable } from "./fs-atomic.js";
import { clearSelectedCopy } from "./handover-copy-selection.js";
import { removeJoinedTls } from "./reset-request.js";
import type { Logger } from "./logger.js";
import { reachDisk } from "./sync-path.js";

export interface ReplacedResetMarker {
  phase: "wiping" | "set_aside_refused";
  setAside: boolean;
}

export interface ReplacedResetDeps {
  stateDir: string;
  venueDir: string;
  /** The mounted backups folder, whose contents the reset removes; null empties none. */
  backupsDir: string | null;
  tunnelDir?: string;
  log: Logger;
}

export async function writeReplacedResetMarker(
  stateDir: string,
  marker: ReplacedResetMarker,
): Promise<void> {
  await writeFileDurable(join(stateDir, REPLACED_RESET_FILE), JSON.stringify(marker), 0o600);
}

export async function readReplacedResetMarker(
  stateDir: string,
): Promise<ReplacedResetMarker | null> {
  try {
    return JSON.parse(
      await readFile(join(stateDir, REPLACED_RESET_FILE), "utf8"),
    ) as ReplacedResetMarker;
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return null;
    throw error;
  }
}

export async function readReplacedResetPhase(
  stateDir: string,
): Promise<ReplacedResetMarker["phase"] | null> {
  return (await readReplacedResetMarker(stateDir))?.phase ?? null;
}

/** For a restore: the next start's reset would otherwise delete or move what the restore placed. */
export async function removeReplacedResetMarker(stateDir: string): Promise<void> {
  const path = join(stateDir, REPLACED_RESET_FILE);
  try {
    await unlink(path);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return;
    throw error;
  }
  await syncFolderHolding(path);
}

async function emptyFolder(path: string | null): Promise<void> {
  if (path === null) return;
  let names: string[];
  try {
    names = await readdir(path);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") return;
    throw error;
  }
  for (const name of names) await rm(join(path, name), { recursive: true, force: true });
  await reachDisk(path);
}

const RESET_PREFIXES = STATE_LAYOUT.filter(
  (entry) => entry.kind === "prefix" && entry.reset === "deleted",
).map((entry) => entry.name);

/** Removes the state entries a plain reset deletes by name prefix, which the Move's list misses. */
export async function removeResetPrefixEntries(stateDir: string): Promise<void> {
  for (const name of await readdir(stateDir))
    if (RESET_PREFIXES.some((prefix) => name.startsWith(prefix)))
      await rm(join(stateDir, name), { recursive: true, force: true });
}

/** Deletes the environment Move's list; `scratch/` is left for the start's `emptyScratch`. */
async function deleteAll(deps: ReplacedResetDeps): Promise<void> {
  // A tunnel volume fault must leave the venue's files intact for the next start.
  await requestTunnelKeyRotation(deps.tunnelDir);
  await deleteBackupRoomNote(deps.stateDir);
  await clearSelectedCopy(deps.stateDir);
  for (const piece of await environmentMoveInventory(deps)) {
    if (piece.root === "state" && (piece.path === SCRATCH_DIR || piece.path === TLS_DIR)) continue;
    await rm(environmentMovePiecePath(deps, piece), { recursive: true, force: true });
  }
  await removeResetPrefixEntries(deps.stateDir);
  await removeJoinedTls(deps.stateDir);
  await emptyFolder(deps.backupsDir);
}

/**
 * Moves the list into one set-aside folder through the environment Move: already resumed from its
 * record when `resumed`, otherwise begun here under the caller's venue lock. `recovery.json` is
 * never cleared here, unlike the mismatch Move's own finish. Returns false, with the marker at
 * `set_aside_refused`, when the rename test refuses the layout (before the record, so nothing has
 * moved); any other failure goes up, and a later start tries again.
 */
async function setAsideAll(deps: ReplacedResetDeps, resumed: boolean): Promise<boolean> {
  const roots = { stateDir: deps.stateDir, venueDir: deps.venueDir };
  if (!resumed)
    try {
      await beginEnvironmentMove(roots);
    } catch (error) {
      if (!(isAppError(error) && hasCode(error, "setup.start_again_set_aside_unavailable")))
        throw error;
      await writeReplacedResetMarker(deps.stateDir, { phase: "set_aside_refused", setAside: true });
      deps.log("warn", "replaced-reset.set_aside_unavailable", { errorCode: codeOf(error) });
      return false;
    }
  await finishEnvironmentMove(deps.stateDir);
  await removeResetPrefixEntries(deps.stateDir);
  await emptyFolder(deps.backupsDir);
  return true;
}

/**
 * Finishes a box's reset once its marker reads `wiping`; the checks ran before the
 * marker was saved, so none run here. Every step tolerates a re-run, and the marker goes last, so
 * a start cut short finishes the job at the next. Returns whether it reset the box.
 *
 * The marker is read again under the venue lock, which is held through the Move's resume and the
 * marker's removal: a restore removes the marker under that lock before placing its database.
 */
export async function finishReplacedReset(
  deps: ReplacedResetDeps,
  lock: (venueDir: string) => Promise<VenueLock> = lockVenueDatabase,
): Promise<boolean> {
  if ((await readReplacedResetPhase(deps.stateDir)) !== "wiping") return false;
  const hold = await lock(deps.venueDir);
  try {
    const marker = await readReplacedResetMarker(deps.stateDir);
    if (marker?.phase !== "wiping") return false;
    // A set-aside reset comes from the restricted start, which serves no page that begins a Move.
    const resumed =
      marker.setAside &&
      (await resumeEnvironmentMove({ stateDir: deps.stateDir, venueDir: deps.venueDir })) !== null;
    if (marker.setAside === false) await deleteAll(deps);
    else if (!(await setAsideAll(deps, resumed))) return false;
    await reachDisk(deps.venueDir);
    await reachDisk(deps.stateDir);
    await rm(join(deps.stateDir, REPLACED_RESET_FILE));
    await reachDisk(deps.stateDir);
    return true;
  } finally {
    hold.release();
  }
}
