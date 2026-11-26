import { backupKey, masterKeyId } from "@waitron/credentials";
import type { BackupKeyFrameInput } from "@waitron/provisioning";
import { decodeMasterKeyCode } from "@waitron/shared";
import { writeBackupKey, type BackupKeyRecord } from "./backup-env-writer.js";

/** `publicKey` is the master key's sealing public key, the one its `master_keys` row keeps. */
export function backupKeyRecord(
  masterKey: Uint8Array,
  n: number,
  publicKey: Uint8Array,
): BackupKeyRecord {
  return {
    key: backupKey(masterKey, n).toString("base64url"),
    keyNumber: n,
    masterKeyId: masterKeyId(publicKey).toString("hex"),
  };
}

/** What every kind of setup writes for the master key it has just made and shows. */
export function writeBackupKeyOne(
  stateDir: string,
  masterKey: { made: { masterKey: string }; publicKey: Uint8Array },
): Promise<void> {
  return writeBackupKey(
    stateDir,
    backupKeyRecord(decodeMasterKeyCode(masterKey.made.masterKey), 1, masterKey.publicKey),
  );
}

/** The record as the archive frame takes it: the key's and the master key id's bytes. */
export function backupKeyFrameInput(record: BackupKeyRecord): BackupKeyFrameInput {
  return {
    backupKey: Buffer.from(record.key, "base64url"),
    keyNumber: record.keyNumber,
    masterKeyId: Buffer.from(record.masterKeyId, "hex"),
  };
}
