import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { BACKUP_ROOM_NOTE_FILE } from "./spare-space-name.js";

/** A missing note counts as deleted; any other failure is thrown. */
export async function deleteBackupRoomNote(stateDir: string): Promise<void> {
  try {
    await unlink(join(stateDir, BACKUP_ROOM_NOTE_FILE));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
