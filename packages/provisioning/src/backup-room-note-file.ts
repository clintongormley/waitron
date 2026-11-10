import { join } from "node:path";
import { errnoOf } from "./errno.js";
import { removeAndSync } from "./folder-sync.js";
import { BACKUP_ROOM_NOTE_FILE, BACKUP_ROOM_START_DELETED_FILE } from "@waitron/store";
import { stagedPath } from "./fs-atomic.js";

/**
 * Deletes the note and syncs the state folder. A missing note counts as deleted; any other
 * failure, a failed folder sync included, is thrown.
 */
export async function deleteBackupRoomNote(stateDir: string): Promise<void> {
  try {
    await removeAndSync(join(stateDir, BACKUP_ROOM_NOTE_FILE), "file");
  } catch (error) {
    if (errnoOf(error) !== "ENOENT") throw error;
  }
}

/** The backup room's own files in the state folder: they hold no venue data. */
export function isBackupRoomFileName(name: string): boolean {
  return (
    name === BACKUP_ROOM_NOTE_FILE ||
    name === BACKUP_ROOM_START_DELETED_FILE ||
    name === stagedPath(BACKUP_ROOM_START_DELETED_FILE) ||
    name === stagedPath(BACKUP_ROOM_NOTE_FILE)
  );
}
