import { BACKUP_ENV_FILE } from "@waitron/store";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError, isAppError } from "@waitron/shared";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { writeFileDurable } from "./fs-atomic.js";
import "./errors.js";

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

/** Sets the recovery key (and its rotation time when one is given), keeping every other setting the
 * file holds. `0o600` because the file carries the key. */
export async function writeRecoveryKey(
  stateDir: string,
  input: { recoveryKey: string; keyRotatedAt: string | undefined },
): Promise<void> {
  const path = join(stateDir, BACKUP_ENV_FILE);
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
  await writeFileDurable(path, formatEnvFile(record), 0o600);
}

export type BackupSettingsCheck =
  | { ok: true; settings: Record<string, string> }
  | { ok: false; reason: "shape" | "name" | "value" | "control_char" | "round_trip" };

const BACKUP_SETTING_NAME = /^WAITRON_BACKUP_[A-Z0-9_]+$/;

/** Whether `value` is a whole `backup.env` this box would write. The reason names the check that
 * failed and never a value: a value may be the backup recovery key. */
export function checkBackupSettings(value: unknown): BackupSettingsCheck {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    return { ok: false, reason: "shape" };
  }
  const entries = Object.entries(value);
  if (entries.some(([name]) => !BACKUP_SETTING_NAME.test(name))) {
    return { ok: false, reason: "name" };
  }
  if (entries.some(([, setting]) => typeof setting !== "string")) {
    return { ok: false, reason: "value" };
  }
  const settings = value as Record<string, string>;
  try {
    assertStorableRecord(settings);
  } catch (error) {
    if (!isAppError(error) || error.code !== "backup.destinations_invalid") throw error;
    const reason = (error.params as { reason: string }).reason;
    return { ok: false, reason: reason === "round_trip" ? "round_trip" : "control_char" };
  }
  return { ok: true, settings };
}

/** Replaces `backup.env` whole with `settings`, or removes it for `null`. */
export async function replaceBackupSettings(
  stateDir: string,
  settings: Record<string, string> | null,
): Promise<void> {
  const path = join(stateDir, BACKUP_ENV_FILE);
  if (settings === null) {
    await rm(path, { force: true });
    return;
  }
  const check = checkBackupSettings(settings);
  if (!check.ok) throw new AppError("spare.settings_invalid", { reason: check.reason });
  await writeFileDurable(path, formatEnvFile(check.settings), 0o600);
}
