import { stagedPath } from "./fs-atomic.js";

/** The box's spare file in its state folder: deleted to make room on a nearly full disk. */
export const SPARE_SPACE_FILE = "spare-space";

/** Written beside the spare when it is given up. */
export const SPARE_SPACE_RELEASED_FILE = "spare-space.released";

/** Which installation and venue.db the backups in the local folders belong to. */
export const BACKUP_ROOM_NOTE_FILE = "backup-room-note.json";

/** The backups the start deleted to make room. */
export const BACKUP_ROOM_START_DELETED_FILE = "backup-room-start-deleted.json";

/** The temporary name the note is written under before its rename; `hex` is 12 lowercase hex digits. */
export function backupRoomNoteTemporaryName(hex: string): string {
  return `${BACKUP_ROOM_NOTE_FILE}.${hex}.tmp`;
}

const BACKUP_ROOM_NOTE_TEMPORARY = /^backup-room-note\.json\.[0-9a-f]{12}\.tmp$/;

/** The backup room's own files in the state folder: they hold no venue data. */
export function isBackupRoomFileName(name: string): boolean {
  return (
    name === BACKUP_ROOM_NOTE_FILE ||
    name === BACKUP_ROOM_START_DELETED_FILE ||
    name === stagedPath(BACKUP_ROOM_START_DELETED_FILE) ||
    BACKUP_ROOM_NOTE_TEMPORARY.test(name)
  );
}
