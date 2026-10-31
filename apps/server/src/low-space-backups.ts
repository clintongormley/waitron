import { codeOf } from "@waitron/server-kit";
import {
  foldersOnDisk,
  type BackupFolder,
  installationStartOrNull,
  makeRoom,
  reportArchivesDeleted,
  type DeletableArchive,
} from "./backup-room.js";
import type { ClockStep } from "@waitron/fiscal";
import type { StagingTurn } from "./backup-staging-turn.js";
import { readClockStepHold } from "./backup-sweep.js";
import type { BackupRuntimeStatus } from "./backup-supervisor.js";
import type { DeviceOf } from "./disk-usage.js";
import { errnoOf } from "./errno.js";
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
  /** The latest step the box made to its own clock; absent, nothing is held (see `clockStepHold`). */
  latestClockStep?: () => Promise<ClockStep | null>;
  /** The running backups' age cap, which bounds how long a step holds; unknown, nothing is deleted. */
  retainDays?: () => number | undefined;
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
 * next reading tries again. Once it holds the turn it reads free space and the backup settings again
 * and lists the folders; once the installation start is read it checks that each listed folder's
 * destination is still among `backends()` with the same `localDir`, and deletes nothing if not.
 * Archives a recent step to the clock holds are deleted last, as the backup run's pruning keeps them. A
 * venue folder whose disk cannot be read is logged `backup.venue_disk_unreadable` and deletes
 * nothing.
 */
export function lowSpaceBackupDeletion(
  deps: LowSpaceBackupDeps,
): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    const free = await freeBytes(deps.dir, deps.statfs);
    if (free === null || free >= SPACE_LOW_BYTES) return;
    if (!deps.backends().some((b) => b.localDir !== undefined)) return;
    await deps.staging.ifNoBackup(async () => {
      // Read again once the turn is held: settings can change, the watch stop, or a holder free
      // space, while it waits.
      if (signal.aborted) return;
      const freeNow = await freeBytes(deps.dir, deps.statfs);
      if (freeNow === null || freeNow >= SPACE_LOW_BYTES) return;
      const backends = deps.backends().filter((b) => b.localDir !== undefined);
      if (backends.length === 0) return;
      let folders: BackupFolder[];
      try {
        ({ folders } = await foldersOnDisk(backends, deps.dir, deps.deviceOf));
      } catch (err) {
        deps.log("warn", "backup.venue_disk_unreadable", {
          errorCode: codeOf(err),
          errno: errnoOf(err),
        });
        return;
      }
      if (folders.length === 0) return;
      const listedDirs = new Map(
        folders.map((f) => [f.destination, backends.find((b) => b.id === f.destination)?.localDir]),
      );
      // The installation start can wait on the write lock, and settings can change meanwhile; null
      // offers nothing to delete.
      const installationStartedAt = async () => {
        const at = await installationStartOrNull(deps.installationStartedAt, deps.log);
        const current = deps.backends();
        for (const [id, localDir] of listedDirs)
          if (!current.some((b) => b.id === id && b.localDir === localDir)) return null;
        return at;
      };
      await makeRoom({
        neededBytes: 0,
        floorBytes: 0,
        aimBytes: SPACE_OK_BYTES,
        dir: deps.dir,
        statfs: deps.statfs,
        folders,
        installationStartedAt,
        clockStepHold: async () => {
          if (deps.latestClockStep === undefined) return undefined;
          const retainDays = deps.retainDays?.();
          if (retainDays === undefined) return "everything";
          return readClockStepHold(
            deps.latestClockStep,
            deps.now().getTime(),
            retainDays,
            deps.log,
          );
        },
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
