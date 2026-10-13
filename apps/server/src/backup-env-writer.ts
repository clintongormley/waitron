import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@waitron/shared";
import { formatEnvFile, parseEnvFile } from "./env-file.js";
import { writeFileAtomic } from "./fs-atomic.js";
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
