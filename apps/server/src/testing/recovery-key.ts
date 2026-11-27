import { makeMasterKey } from "@waitron/credentials";
import { encodeMasterKeyCode } from "@waitron/shared";
import { decryptArtifactUnderBackupKey } from "../artifact-cipher.js";
import { replaceBackupSettings } from "../backup-env-writer.js";
import { backupKeyFrameInput } from "../backup-key-record.js";
import { backupKeyEnv, heldBackupKey } from "./backup-key.js";

const HELD_MASTER_KEY = makeMasterKey();
/** The master key {@link HELD_BACKUP_KEY} comes from, as a person types it. */
export const HELD_MASTER_KEY_TEXT = encodeMasterKeyCode(HELD_MASTER_KEY);
/** Backup key 1 of a master key no venue holds; long enough for `checkedRecoveryKey`. */
export const HELD_BACKUP_KEY = heldBackupKey(HELD_MASTER_KEY);
export const USABLE_RECOVERY_KEY = HELD_BACKUP_KEY.key;
/** {@link HELD_BACKUP_KEY} as a backup run takes it. */
export const HELD_BACKUP_FRAME = backupKeyFrameInput(HELD_BACKUP_KEY);

/** Opens an archive's bytes written under {@link HELD_BACKUP_FRAME}. */
export function openUnderHeldKey(framed: Uint8Array): Buffer {
  return decryptArtifactUnderBackupKey(framed, HELD_BACKUP_FRAME.backupKey);
}

/**
 * A main box answers a join only while its `backup.env` holds a usable recovery key. With no `key`
 * the file holds {@link HELD_BACKUP_KEY} with its number and master key id and day; a given `key` is no
 * master key's, so the file holds it alone.
 */
export async function holdRecoveryKey(stateDir: string, key?: string): Promise<void> {
  await replaceBackupSettings(
    stateDir,
    key === undefined ? backupKeyEnv(HELD_BACKUP_KEY) : { WAITRON_BACKUP_RECOVERY_KEY: key },
  );
}
