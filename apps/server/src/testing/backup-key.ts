import { masterKeyName, sealingPublicKey } from "@waitron/credentials";
import type { BackupKeyRecord } from "../backup-env-writer.js";
import { backupKeyRecord } from "../backup-key-record.js";

/** The master key day {@link heldBackupKey} names unless given another. */
export const HELD_MASTER_KEY_DAY = "2026-11-23";

/** Backup key `n` (1 unless given) of `masterKey`, made on `day`, as setup writes it. */
export function heldBackupKey(
  masterKey: Uint8Array,
  n = 1,
  day = HELD_MASTER_KEY_DAY,
): BackupKeyRecord {
  return backupKeyRecord(
    masterKey,
    n,
    sealingPublicKey(masterKey),
    heldBackupKeyName(masterKey, day),
  );
}

/** The name of `masterKey` made on `day`, as its `master_keys` row holds it. */
export function heldBackupKeyName(masterKey: Uint8Array, day = HELD_MASTER_KEY_DAY): string {
  return masterKeyName(sealingPublicKey(masterKey), day);
}

/** {@link heldBackupKey}'s record as the `backup.env` settings that hold it. */
export function backupKeySettings(record: BackupKeyRecord): Record<string, string> {
  return {
    WAITRON_BACKUP_RECOVERY_KEY: record.key,
    WAITRON_BACKUP_KEY_NUMBER: String(record.keyNumber),
    WAITRON_BACKUP_MASTER_KEY_ID: record.masterKeyId,
    WAITRON_BACKUP_MASTER_KEY_DAY: record.masterKeyDay,
  };
}
