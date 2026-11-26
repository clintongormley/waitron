import { sealingPublicKey } from "@waitron/credentials";
import type { BackupKeyRecord } from "../backup-env-writer.js";
import { backupKeyRecord } from "../backup-key-record.js";

/** Backup key `n` (1 unless given) of `masterKey`, as setup writes it. */
export function heldBackupKey(masterKey: Uint8Array, n = 1): BackupKeyRecord {
  return backupKeyRecord(masterKey, n, sealingPublicKey(masterKey));
}

/** {@link heldBackupKey}'s record as the `backup.env` settings that hold it. */
export function backupKeySettings(record: BackupKeyRecord): Record<string, string> {
  return {
    WAITRON_BACKUP_RECOVERY_KEY: record.key,
    WAITRON_BACKUP_KEY_NUMBER: String(record.keyNumber),
    WAITRON_BACKUP_MASTER_KEY_ID: record.masterKeyId,
  };
}
