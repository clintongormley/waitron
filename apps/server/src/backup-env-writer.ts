import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import type { BackupSchedule } from "./backup-config.js";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { writeFileAtomic } from "./fs-atomic.js";
import "./errors.js";

/** What the backup wizard writes to `<stateDir>/backup.env`. */
export interface BackupEnvInput {
  destinationDir: string;
  recoveryKey: string;
  schedule: BackupSchedule;
  retention: { count: number; days: number };
  /** `undefined` when never rotated, and the key is then omitted. */
  keyRotatedAt: string | undefined;
}

/** Exported so the `apply` route can validate the SAME record through `loadBackupConfig` before
 * writing, refusing exactly what boot would. */
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
 * Refuses a record that would not survive the env-file round trip: a value carrying a newline would
 * plant the rest of its line as a setting the operator never chose.
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

/** `0o600` because the file carries the recovery key. */
export async function writeBackupEnv(stateDir: string, input: BackupEnvInput): Promise<void> {
  const record = backupEnvRecord(input);
  assertStorableRecord(record);
  await writeFileAtomic(join(stateDir, "backup.env"), formatEnvFile(record), 0o600);
}

/** Sets the recovery key (and its rotation time when one is given), keeping every other setting the
 * file holds, so a box with no archive destination can still hold a key. */
export async function writeRecoveryKey(
  stateDir: string,
  input: { recoveryKey: string; keyRotatedAt: string | undefined },
): Promise<void> {
  const path = join(stateDir, "backup.env");
  let existing: Record<string, string> = {};
  try {
    existing = parseEnvFile(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  const record: Record<string, string> = {
    ...existing,
    WAITRON_BACKUP_RECOVERY_KEY: input.recoveryKey,
  };
  if (input.keyRotatedAt !== undefined) record.WAITRON_BACKUP_KEY_ROTATED_AT = input.keyRotatedAt;
  assertStorableRecord(record);
  await writeFileAtomic(path, formatEnvFile(record), 0o600);
}
