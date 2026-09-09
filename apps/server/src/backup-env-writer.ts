import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { BackupSchedule } from "./backup-config.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { writeFileAtomic } from "./fs-atomic.js";
// This file THROWS `backup.destinations_invalid` when a persisted value would not round-trip, so it
// imports the host error registry (the "every file that throws a code imports ./errors.js" convention).
import "./errors.js";

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

/**
 * Refuse a record that would not survive the `KEY=value` env-file round-trip. Guards EVERY persisted
 * value, not only the recovery key: a free string carrying a newline/control char injects an extra
 * `KEY=value` line on read — a `destinationDir` of `"/mnt/usb\nWAITRON_BACKUP_DATABASE_URL=…"` would
 * plant a DB url that points the dump at the wrong database, an unrecoverable fiscal fault (§5). The
 * belt-and-braces second check asserts the WHOLE record parses back byte-for-byte before any write, so
 * no `backup.env` is ever written that does not round-trip.
 */
export function assertStorableRecord(record: Record<string, string>): void {
  for (const [key, value] of Object.entries(record)) {
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f]/.test(value)) {
      throw new AppError("backup.destinations_invalid", { reason: `control_char:${key}` });
    }
  }
  const roundTrip = parseEnvFile(formatEnvFile(record));
  const keys = Object.keys(record);
  if (
    Object.keys(roundTrip).length !== keys.length ||
    keys.some((k) => roundTrip[k] !== record[k])
  ) {
    throw new AppError("backup.destinations_invalid", { reason: "round_trip" });
  }
}

/** Persist the box's per-venue backup config to `<stateDir>/backup.env`, atomically and `0o600` (it
 * carries the recovery key — a secret, the same perms the other secret writers use). The supervisor
 * re-reads this file on its next `reload()`, so a change takes effect without a restart (spec §3.4).
 * The record is round-trip guarded FIRST, so a value that would inject an env var never reaches disk. */
export async function writeBackupEnv(stateDir: string, input: BackupEnvInput): Promise<void> {
  const record = backupEnvRecord(input);
  assertStorableRecord(record);
  await writeFileAtomic(join(stateDir, "backup.env"), formatEnvFile(record), 0o600);
}
