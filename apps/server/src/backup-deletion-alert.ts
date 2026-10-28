import { recordIncidentOnce } from "@waitron/core";
import { withTransaction, type Database } from "@waitron/db";
import type { FiscalContribution } from "@waitron/fiscal";
import { resolveVenueClock } from "@waitron/reporting";
import { AppError, backupOrigin, businessDayAt, type NodeId } from "@waitron/shared";
import type { DeletableArchive } from "./backup-room.js";
import "./errors.js";

export interface BackupRoomHooks {
  readInstallationStart(): Promise<Date | null>;
  recordArchivesDeleted(deleted: readonly DeletableArchive[], at: Date): Promise<void>;
}

export function createBackupRoomHooks(deps: {
  db: Database;
  nodeId: NodeId;
  fiscal: Pick<FiscalContribution, "installationStartedAt"> | null | undefined;
}): BackupRoomHooks {
  const { db, nodeId, fiscal } = deps;
  return {
    // A write-lock turn with no change-list drain: the drain is a write, and this read must answer
    // on a nearly full disk.
    readInstallationStart: async () => {
      if (!fiscal?.installationStartedAt) return null;
      return db.withWriteLock(() => fiscal.installationStartedAt!(db, nodeId));
    },
    recordArchivesDeleted: (deleted, at) =>
      withTransaction(db, async (tx) => {
        const clock = await resolveVenueClock(tx, nodeId);
        const date = businessDayAt(
          { timeZone: clock.timeZone, dayCutover: "00:00", cutoverChanges: [] },
          at,
        );
        // An alert still open keeps its first count: one run can delete at both of its checks.
        await recordIncidentOnce(tx, {
          origin: backupOrigin(),
          error: new AppError("backup.archives_deleted", { count: deleted.length, date }),
          severity: "warning",
          detectedAt: at,
        });
      }),
  };
}
