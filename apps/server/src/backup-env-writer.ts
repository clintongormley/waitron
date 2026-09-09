import { join } from "node:path";
import type { BackupSchedule } from "./backup-config.js";
import { formatEnvFile } from "./env-file.js";
import { writeFileAtomic } from "./fs-atomic.js";

/** What the backup wizard writes to `<stateDir>/backup.env` — the box's PER-VENUE backup config only.
 * `WAITRON_BACKUP_DATABASE_URL` is DELIBERATELY absent: the supervisor derives the backup read
 * connection from the box's own owner connection, so the wizard never records a DB url (writing one
 * would let a stale wizard value point the dump at the wrong database, spec §3.4). */
export interface BackupEnvInput {
  destinationDir: string;
  recoveryKey: string;
  schedule: BackupSchedule;
  retention: { count: number; days: number };
  /** ISO timestamp of the last recovery-key rotation, or undefined (never rotated → key omitted). */
  keyRotatedAt: string | undefined;
}

/** The `KEY=value` record `writeBackupEnv` persists, split out so the `apply` route can dry-validate
 * the SAME record through `loadBackupConfig` before writing (rejecting exactly what boot would). */
export function backupEnvRecord(input: BackupEnvInput): Record<string, string> {
  const env: Record<string, string> = {
    WAITRON_BACKUP_DIR: input.destinationDir,
    WAITRON_BACKUP_RECOVERY_KEY: input.recoveryKey,
  };
  if (input.schedule.kind === "interval") {
    env.WAITRON_BACKUP_INTERVAL_MS = String(input.schedule.ms);
  } else {
    env.WAITRON_BACKUP_SCHEDULE_DAYS =
      input.schedule.days === "daily" ? "daily" : input.schedule.days.join(",");
    env.WAITRON_BACKUP_AT =
      input.schedule.at === "auto"
        ? "auto"
        : `${String(input.schedule.at.hour).padStart(2, "0")}:${String(
            input.schedule.at.minute,
          ).padStart(2, "0")}`;
  }
  env.WAITRON_BACKUP_RETAIN = String(input.retention.count);
  env.WAITRON_BACKUP_RETAIN_DAYS = String(input.retention.days);
  if (input.keyRotatedAt !== undefined) env.WAITRON_BACKUP_KEY_ROTATED_AT = input.keyRotatedAt;
  return env;
}

/** Persist the box's per-venue backup config to `<stateDir>/backup.env`, atomically and `0o600` (it
 * carries the recovery key — a secret, the same perms the other secret writers use). The supervisor
 * re-reads this file on its next `reload()`, so a change takes effect without a restart (spec §3.4). */
export async function writeBackupEnv(stateDir: string, input: BackupEnvInput): Promise<void> {
  await writeFileAtomic(join(stateDir, "backup.env"), formatEnvFile(backupEnvRecord(input)), 0o600);
}
