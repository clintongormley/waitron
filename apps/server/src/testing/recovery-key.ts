import { makeMasterKey } from "@waitron/credentials";
import { replaceBackupSettings } from "../backup-env-writer.js";
import { backupKeySettings, heldBackupKey } from "./backup-key.js";

/** Backup key 1 of a master key no venue holds; long enough for `checkedRecoveryKey`. */
export const HELD_BACKUP_KEY = heldBackupKey(makeMasterKey());
export const USABLE_RECOVERY_KEY = HELD_BACKUP_KEY.key;

/**
 * A main box answers a join only while its `backup.env` holds a usable recovery key. With no `key`
 * the file holds {@link HELD_BACKUP_KEY} with its number and master key id; a given `key` is no
 * master key's, so the file holds it alone.
 */
export async function holdRecoveryKey(stateDir: string, key?: string): Promise<void> {
  await replaceBackupSettings(
    stateDir,
    key === undefined ? backupKeySettings(HELD_BACKUP_KEY) : { WAITRON_BACKUP_RECOVERY_KEY: key },
  );
}
