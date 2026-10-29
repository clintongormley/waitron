import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { isVenueHolderFresh, type VenueHolder, type VenueLock } from "@waitron/db";
import { BACKUP_ROOM_NOTE_FILE, BACKUP_ROOM_START_DELETED_FILE } from "@waitron/provisioning";
import { codeOf } from "@waitron/server-kit";
import { hasCode, isAppError } from "@waitron/shared";
import { FULL_DISK_BYTES } from "./boot-failure.js";
import {
  archiveDestinations,
  isBackupManagedByEnvironment,
  loadRecoveryKey,
} from "./backup-config.js";
import {
  foldersOnDisk,
  makeRoom,
  type BackupFolder,
  type DeletableArchive,
} from "./backup-room.js";
import { readBackupRoomNote, type BackupRoomNote } from "./backup-room-note.js";
import type { DeviceOf } from "./disk-usage.js";
import { errnoOf } from "./errno.js";
import type { Statfs } from "./free-bytes.js";
import { writeFileAtomic } from "./fs-atomic.js";
import type { Logger } from "./logger.js";
import { RESET_REQUEST_FILE } from "./reset-request.js";
import { RESTORE_REQUEST_FILE } from "./restore-request.js";
import { lowestFreeBytes } from "./start-space.js";

export interface StartBackupRoomDeps {
  stateDir: string;
  venueDir: string;
  /** The raw environment: who manages backups is judged on it alone. */
  baseEnv: NodeJS.ProcessEnv;
  loadBoxEnv: (base: NodeJS.ProcessEnv, stateDir: string) => Promise<NodeJS.ProcessEnv>;
  /** The spare file's size: the step makes room up to it plus {@link FULL_DISK_BYTES}. */
  spareBytes: number;
  /** The start's free-space floor, the step's aim. */
  floor: number;
  statfs?: Statfs;
  /** Refused with `provisioning.database_in_use` while another process holds the venue folder. */
  lockVenue: (venueDir: string) => Promise<VenueLock>;
  /** Asked only when the lock fails for another reason. */
  readVenueHolder: (venueDir: string) => VenueHolder | null;
  now: () => Date;
  log: Logger;
  /** DI for tests. */
  deviceOf?: DeviceOf;
}

const NEVER_ABORTED = new AbortController().signal;

/**
 * Under {@link FULL_DISK_BYTES} free, deletes old backups by §1's rules (design A1167) without
 * opening the venue database, trusting the installation start the backup room note holds. With no
 * note it returns before taking the venue lock or loading the box env. Each refusal is logged once
 * `backup.start_room_skipped` with its `reason`. Nothing is thrown.
 */
export async function deleteOldBackupsAtStart(deps: StartBackupRoomDeps): Promise<void> {
  const free = await lowestFreeBytes([deps.stateDir, deps.venueDir], deps.statfs);
  if (free === null || free >= FULL_DISK_BYTES) return;
  if (!(await present(join(deps.stateDir, BACKUP_ROOM_NOTE_FILE)))) return;
  const skip = (reason: string) => deps.log("warn", "backup.start_room_skipped", { reason });

  // A missing venue folder holds no venue.db, and taking the lock would create it.
  if (!(await present(deps.venueDir))) return skip("venue_db_missing");
  let hold: VenueLock | null = null;
  try {
    hold = await deps.lockVenue(deps.venueDir);
  } catch (error) {
    if (isAppError(error) && error.code === "provisioning.database_in_use")
      return skip("venue_in_use");
    deps.log("warn", "backup.start_room_lock_failed", {
      errorCode: codeOf(error),
      errno: errnoOf(error) ?? null,
    });
    const holder = deps.readVenueHolder(deps.venueDir);
    if (holder !== null && isVenueHolderFresh(holder, deps.now())) return skip("venue_held");
  }
  try {
    const checked = await checks(deps);
    if ("skipped" in checked) return skip(checked.skipped);
    await deleteToFloor(deps, checked.note, checked.folders, skip);
  } catch (error) {
    deps.log("warn", "backup.start_room_failed", {
      errorCode: codeOf(error),
      errno: errnoOf(error) ?? null,
    });
  } finally {
    hold?.release();
  }
}

async function checks(
  deps: StartBackupRoomDeps,
): Promise<{ note: BackupRoomNote; folders: BackupFolder[] } | { skipped: string }> {
  let merged: NodeJS.ProcessEnv;
  try {
    merged = await deps.loadBoxEnv(deps.baseEnv, deps.stateDir);
  } catch {
    return { skipped: "env_unreadable" };
  }
  const read = await readBackupRoomNote({
    stateDir: deps.stateDir,
    venueDir: deps.venueDir,
    // An unset or empty node id matches no note: a note's node id is never empty.
    nodeId: merged.WAITRON_TILL_NODE_ID ?? "",
  });
  if ("skipped" in read) return read;
  const { note } = read;
  // Either request replaces venue.db, after which these backups are from before the installation.
  if (await present(join(deps.stateDir, RESTORE_REQUEST_FILE)))
    return { skipped: "restore_waiting" };
  if (await present(join(deps.stateDir, RESET_REQUEST_FILE))) return { skipped: "reset_waiting" };
  try {
    if (loadRecoveryKey(merged) === undefined) return { skipped: "recovery_key_missing" };
  } catch {
    return { skipped: "recovery_key_unusable" };
  }
  // The raw environment, never `merged`: a dashboard box keeps its recovery key in backup.env.
  const managedByEnvironment = isBackupManagedByEnvironment(deps.baseEnv);
  if (note.managedByEnvironment !== managedByEnvironment) return { skipped: "management_changed" };
  let candidates: BackupFolder[];
  if (managedByEnvironment) {
    try {
      candidates = archiveDestinations({
        managedByEnvironment: true,
        env: merged,
        sealed: null,
        venueId: merged.WAITRON_TILL_LOCATION_ID ?? "",
      }).flatMap((d) => (d.kind === "local-fs" ? [{ destination: d.id, dir: d.dir }] : []));
    } catch {
      return { skipped: "destinations_invalid" };
    }
  } else candidates = note.folders;
  let folders: BackupFolder[];
  try {
    ({ folders } = await foldersOnDisk(
      candidates.map((f) => ({ id: f.destination, localDir: f.dir })),
      deps.venueDir,
      deps.deviceOf,
    ));
  } catch {
    return { skipped: "venue_disk_unreadable" };
  }
  if (folders.length === 0) return { skipped: "no_folders" };
  return { note, folders };
}

async function deleteToFloor(
  deps: StartBackupRoomDeps,
  note: BackupRoomNote,
  folders: BackupFolder[],
  skip: (reason: string) => void,
): Promise<void> {
  const floorBytes = deps.spareBytes + FULL_DISK_BYTES;
  let deletedAny = false;
  try {
    await makeRoom({
      neededBytes: 0,
      floorBytes,
      aimBytes: deps.floor,
      dir: deps.venueDir,
      statfs: deps.statfs,
      folders,
      installationStartedAt: async () => new Date(note.installationStartedAt),
      signal: NEVER_ABORTED,
      log: deps.log,
      reason: "start_room",
      outOfReach: "floor",
      onDeleted: async (deleted) => {
        deletedAny = true;
        await writeRecord(deps, deleted);
      },
    });
  } catch (error) {
    if (!isAppError(error) || !hasCode(error, "backup.staging_space_low")) throw error;
    if (!deletedAny) return skip("out_of_reach");
    deps.log("warn", "backup.start_room_short", {
      freeBytes: error.params.availableBytes,
      floorBytes,
    });
  }
}

async function writeRecord(
  deps: StartBackupRoomDeps,
  deleted: readonly DeletableArchive[],
): Promise<void> {
  const record = {
    version: 1,
    at: deps.now().toISOString(),
    deleted: deleted.map(({ destination, dir, key, bytes, takenAt }) => ({
      destination,
      dir,
      key,
      bytes,
      takenAt: takenAt.toISOString(),
    })),
  };
  try {
    await writeFileAtomic(
      join(deps.stateDir, BACKUP_ROOM_START_DELETED_FILE),
      JSON.stringify(record),
      0o600,
    );
  } catch (error) {
    deps.log("warn", "backup.start_room_record_failed", { errno: errnoOf(error) });
  }
}

async function present(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    return errnoOf(error) !== "ENOENT";
  }
}
