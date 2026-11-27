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

export { backupKeyEnv } from "../backup-env-writer.js";
