// The server's ongoing-alert sources: one factory per live "keep asking" check the dashboard bell
// polls. The registry stamps each returned alert's `kind` and `area`; a source only supplies the
// per-alert facts. Later tasks append more factories to this file, so keep each one self-contained.

import type { AlertSource, OngoingAlert } from "@waitron/module";
import type { BackupStatus } from "./backup-status.js";
import "./errors.js";

/** The dashboard screen a backup alert links to. */
export const BACKUP_STALE_SCREEN = "backup";

/**
 * The last backup outcome per destination, in memory. A destination with an entry here failed its
 * most recent attempt; a successful attempt removes it. The sweep fills this holder as it runs
 * (`recordBackupOutcome`) and {@link backupAlertSource} reads it — a live process fact that is not in
 * the database, so it lives only as long as the process and is empty after a restart until the next
 * sweep tick.
 */
export interface BackupOutcomeHolder {
  failed: Map<string, { at: string }>;
}

/** Record one destination's latest sweep outcome: a failure is remembered with its time, a success
 * forgets any earlier failure. Kept beside the holder type so the sweep and the source share it. */
export function recordBackupOutcome(
  h: BackupOutcomeHolder,
  dest: string,
  ok: boolean,
  at: string,
): void {
  if (ok) h.failed.delete(dest);
  else h.failed.set(dest, { at });
}

/**
 * The backups alert source. Surfaces three states, each needing an operator's attention:
 * backups not configured at all (`backup.disabled`), a destination whose newest good backup is older
 * than allowed (`backup.destination_overdue`, `since` = that last good backup), and a destination
 * whose most recent attempt failed (`backup.destination_failed`, `since` = when it failed). Overdue
 * reads the per-request freshness listing; failed reads the in-process outcome holder — a fresh
 * destination can still carry a failed last attempt, so both are reported.
 */
export function backupAlertSource(deps: {
  listStatus: () => Promise<BackupStatus>;
  outcomes: BackupOutcomeHolder;
  now: () => Date;
}): AlertSource {
  return {
    area: "backup",
    permission: "system.manage",
    async read(): Promise<readonly OngoingAlert[]> {
      const status = await deps.listStatus();
      if (!status.configured) {
        return [
          {
            key: "backup.disabled",
            code: "backup.disabled",
            params: {},
            severity: "warning",
            since: null,
          },
        ];
      }
      const alerts: OngoingAlert[] = [];
      for (const d of status.destinations) {
        if (d.stale) {
          alerts.push({
            key: `backup.destination_overdue:${d.id}`,
            code: "backup.destination_overdue",
            params: { destination: d.id },
            severity: "error",
            since: d.lastBackupAt,
            screen: BACKUP_STALE_SCREEN,
          });
        }
        const failed = deps.outcomes.failed.get(d.id);
        if (failed) {
          alerts.push({
            key: `backup.destination_failed:${d.id}`,
            code: "backup.destination_failed",
            params: { destination: d.id },
            severity: "warning",
            since: failed.at,
            screen: BACKUP_STALE_SCREEN,
          });
        }
      }
      return alerts;
    },
  };
}
