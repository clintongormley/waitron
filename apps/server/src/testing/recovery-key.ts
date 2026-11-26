import { makeMasterKey } from "@waitron/credentials";
import { decryptArtifactUnderBackupKey } from "../artifact-cipher.js";
import { replaceBackupSettings } from "../backup-env-writer.js";
import { backupKeyFrameInput } from "../backup-key-record.js";
import { backupKeySettings, heldBackupKey } from "./backup-key.js";

/** Backup key 1 of a master key no venue holds; long enough for `checkedRecoveryKey`. */
export const HELD_BACKUP_KEY = heldBackupKey(makeMasterKey());
export const USABLE_RECOVERY_KEY = HELD_BACKUP_KEY.key;
/** {@link HELD_BACKUP_KEY} as a backup run takes it. */
export const HELD_BACKUP_FRAME = backupKeyFrameInput(HELD_BACKUP_KEY);

/** Opens an archive's bytes written under {@link HELD_BACKUP_FRAME}. */
export function openUnderHeldKey(framed: Uint8Array): Buffer {
  return decryptArtifactUnderBackupKey(framed, HELD_BACKUP_FRAME.backupKey);
}

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
