import { replaceBackupSettings } from "../backup-env-writer.js";

/** Long enough for `checkedRecoveryKey`. */
export const USABLE_RECOVERY_KEY = "test-recovery-key-long-enough";

/** A main box answers a join only while its `backup.env` holds a usable recovery key. */
export async function holdRecoveryKey(
  stateDir: string,
  key: string = USABLE_RECOVERY_KEY,
): Promise<void> {
  await replaceBackupSettings(stateDir, { WAITRON_BACKUP_RECOVERY_KEY: key });
}
