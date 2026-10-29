import { unlink } from "node:fs/promises";
import { codeOf } from "@waitron/server-kit";
import type { BackupRoomHooks } from "./backup-deletion-alert.js";
import { venueDbIdentity } from "./backup-room-note.js";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";
import {
  readStartDeletedRecord,
  sameVenueDb,
  startDeletedRecordPath,
} from "./start-backup-room.js";

/**
 * Raises the deletion alert for what the start deleted before this boot, then deletes the start's
 * record. A record left for another `venue.db` is dropped: its deletions belong to an earlier
 * installation. The record is kept when the alert cannot be recorded, for the next start to try.
 * Nothing is thrown.
 */
export async function recordStartDeletions(deps: {
  stateDir: string;
  venueDir: string;
  record: BackupRoomHooks["recordArchivesDeleted"];
  log: Logger;
  /** DI for tests. */
  remove?: (path: string) => Promise<void>;
}): Promise<void> {
  const { stateDir, log, remove = unlink } = deps;
  const path = startDeletedRecordPath(stateDir);
  const removeRecord = async () => {
    try {
      await remove(path);
    } catch (error) {
      if (errnoOf(error) !== "ENOENT")
        log("warn", "backup.start_room_record_delete_failed", { errno: errnoOf(error) ?? null });
    }
  };
  const read = await readStartDeletedRecord(stateDir);
  if ("skipped" in read) {
    if (read.skipped === "missing") return;
    if (read.skipped === "unreadable") {
      log("warn", "backup.start_room_record_kept", { reason: "unreadable", errno: read.errno });
      return;
    }
    log("warn", "backup.start_room_record_dropped", { reason: "malformed" });
    return removeRecord();
  }
  const { record } = read;
  let current;
  try {
    current = await venueDbIdentity(deps.venueDir);
  } catch (error) {
    log("warn", "backup.start_room_record_kept", {
      reason: "venue_db_unreadable",
      errno: errnoOf(error) ?? null,
    });
    return;
  }
  if (!sameVenueDb(record.venueDb, current)) {
    log("warn", "backup.start_room_record_dropped", { reason: "other_venue_db" });
    return removeRecord();
  }
  if (record.deleted.length > 0) {
    try {
      await deps.record(
        record.deleted.map((each) => ({ ...each, takenAt: new Date(each.takenAt) })),
        new Date(record.at),
      );
    } catch (error) {
      log("warn", "backup.start_room_alert_failed", {
        errorCode: codeOf(error),
        errno: errnoOf(error) ?? null,
      });
      return;
    }
  }
  await removeRecord();
}
