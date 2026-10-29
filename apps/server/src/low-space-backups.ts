import {
  foldersOnDisk,
  installationStartOrNull,
  makeRoom,
  reportArchivesDeleted,
  type DeletableArchive,
} from "./backup-room.js";
import type { StagingTurn } from "./backup-staging-turn.js";
import type { BackupRuntimeStatus } from "./backup-supervisor.js";
import type { DeviceOf } from "./disk-usage.js";
import { freeBytes, type Statfs } from "./free-bytes.js";
import { SPACE_LOW_BYTES, SPACE_OK_BYTES } from "./free-space-watch.js";
import type { Logger } from "./logger.js";
import type { StorageBackend } from "./storage-backend.js";

export interface LowSpaceBackupDeps {
  /** The folder whose disk the free-space watch reads: the venue folder. */
  dir: string;
  staging: Pick<StagingTurn, "ifNoBackup">;
  /** The destinations backups run to now; none while backups are off, keyless or not the primary,
   * where no run would replace what is deleted. */
  backends: () => readonly Pick<StorageBackend, "id" | "localDir">[];
  installationStartedAt?: () => Promise<Date | null>;
  onArchivesDeleted?: (deleted: readonly DeletableArchive[], at: Date) => Promise<void>;
  now: () => Date;
  log: Logger;
  /** DI for tests. */
  statfs?: Statfs;
  deviceOf?: DeviceOf;
}

/**
 * The free-space watch's step: under `SPACE_LOW_BYTES` free, deletes the oldest backups the box may
 * delete in local folders on `dir`'s disk until `SPACE_OK_BYTES` is free, or every one it may when
 * they cannot reach it. Deletes nothing while a backup run holds or waits for the staging turn; the
 * next reading tries again.
 */
export function lowSpaceBackupDeletion(
  deps: LowSpaceBackupDeps,
): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    const free = await freeBytes(deps.dir, deps.statfs);
    if (free === null || free >= SPACE_LOW_BYTES) return;
    if (!deps.backends().some((b) => b.localDir !== undefined)) return;
    await deps.staging.ifNoBackup(async () => {
      // Read again once the turn is held: settings can change, or the watch stop, while it waits.
      if (signal.aborted) return;
      const backends = deps.backends().filter((b) => b.localDir !== undefined);
      if (backends.length === 0) return;
      const { folders } = await foldersOnDisk(backends, deps.dir, deps.deviceOf);
      if (folders.length === 0) return;
      await makeRoom({
        neededBytes: 0,
        floorBytes: 0,
        aimBytes: SPACE_OK_BYTES,
        dir: deps.dir,
        statfs: deps.statfs,
        folders,
        installationStartedAt: () => installationStartOrNull(deps.installationStartedAt, deps.log),
        signal,
        log: deps.log,
        reason: "space_low",
        outOfReach: "aim",
        onDeleted: (deleted) =>
          reportArchivesDeleted(deps.onArchivesDeleted, deleted, deps.now(), deps.log),
      });
    });
  };
}

/** The local folders of a running backup duty, or none when it is not running. */
export function runningLocalBackends(
  status: Pick<BackupRuntimeStatus, "enabled" | "destinations">,
): Pick<StorageBackend, "id" | "localDir">[] {
  if (!status.enabled) return [];
  return status.destinations.flatMap((d) =>
    d.kind === "local-fs" ? [{ id: d.id, localDir: d.dir }] : [],
  );
}
