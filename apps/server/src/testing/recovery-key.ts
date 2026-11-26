import { makeMasterKey } from "@waitron/credentials";
import { replaceBackupSettings } from "../backup-env-writer.js";
import { backupKeySettings, heldBackupKey } from "./backup-key.js";

/** Backup key 1 of a master key no venue holds; long enough for `checkedRecoveryKey`. */
export const HELD_BACKUP_KEY = heldBackupKey(makeMasterKey());
export const USABLE_RECOVERY_KEY = HELD_BACKUP_KEY.key;

/** A main box answers a join only while its `backup.env` holds a usable recovery key. */
export async function holdRecoveryKey(
  stateDir: string,
  key: string = USABLE_RECOVERY_KEY,
): Promise<void> {
  await replaceBackupSettings(stateDir, backupKeySettings({ ...HELD_BACKUP_KEY, key }));
}
