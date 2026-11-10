import { describe, expect, it } from "vitest";
import {
  BACKUP_ROOM_NOTE_FILE,
  BACKUP_ROOM_START_DELETED_FILE,
  SPARE_SPACE_FILE,
  SPARE_SPACE_RELEASED_FILE,
} from "@waitron/store";
import { isBackupRoomFileName } from "./backup-room-note-file.js";
import { stagedPath } from "./fs-atomic.js";

describe("isBackupRoomFileName", () => {
  it.each([
    BACKUP_ROOM_NOTE_FILE,
    BACKUP_ROOM_START_DELETED_FILE,
    `${BACKUP_ROOM_START_DELETED_FILE}.tmp`,
    stagedPath(BACKUP_ROOM_NOTE_FILE),
  ])("accepts the backup room's own file %s", (name) => {
    expect(isBackupRoomFileName(name)).toBe(true);
  });

  it.each([
    "",
    "venue.db",
    SPARE_SPACE_FILE,
    SPARE_SPACE_RELEASED_FILE,
    "backup-room-note.json.0123456789ab.tmp",
    `${BACKUP_ROOM_NOTE_FILE} `,
    `x${BACKUP_ROOM_NOTE_FILE}`,
    `${BACKUP_ROOM_START_DELETED_FILE}.tmp.tmp`,
    `x${BACKUP_ROOM_START_DELETED_FILE}`,
    "backup-room-start-deleted.json.0123456789ab.tmp",
    "backup-room-note.json.0123456789a.tmp",
    "backup-room-note.json.0123456789abc.tmp",
    "backup-room-note.json.0123456789AB.tmp",
    "backup-room-note.json.0123456789ag.tmp",
    "backup-room-noteXjson.0123456789ab.tmp",
    "backup-room-note.json.0123456789abXtmp",
    "xbackup-room-note.json.0123456789ab.tmp",
    "backup-room-note.json.0123456789ab.tmpx",
  ])("refuses %j", (name) => {
    expect(isBackupRoomFileName(name)).toBe(false);
  });
});
