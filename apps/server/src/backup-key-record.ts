import { backupKey, masterKeyDayOf, masterKeyId } from "@waitron/credentials";
import type { BackupKeyFrameInput } from "@waitron/provisioning";
import { AppError, decodeMasterKeyCode, isAppError } from "@waitron/shared";
import { backupKeyBytes } from "./artifact-cipher-file.js";
import { loadHeldKeyNumber, loadKeyRotatedAt, loadNumberedBackupKey } from "./backup-config.js";
import { writeBackupKey, type BackupKeyRecord } from "./backup-env-writer.js";
import { keyFingerprint } from "./backup-key-fingerprint.js";
import type { SealedStateRefresher } from "./sealed-state.js";
import type { StreamHost } from "./stream-host.js";

type Env = Readonly<Record<string, string | undefined>>;

/** `publicKey` and `masterKeyName` are what the master key's `master_keys` row keeps. */
export function backupKeyRecord(
  masterKey: Uint8Array,
  n: number,
  publicKey: Uint8Array,
  masterKeyName: string,
): BackupKeyRecord {
  const masterKeyDay = masterKeyDayOf(masterKeyName);
  return {
    key: backupKey(masterKey, n).toString("base64url"),
    keyNumber: n,
    masterKeyId: masterKeyId(publicKey).toString("hex"),
    masterKeyDay,
  };
}

/** What every kind of setup writes for the master key it has just made and shows. */
export function writeBackupKeyOne(
  stateDir: string,
  masterKey: { made: { masterKey: string; masterKeyName: string }; publicKey: Uint8Array },
): Promise<void> {
  return writeBackupKey(
    stateDir,
    backupKeyRecord(
      decodeMasterKeyCode(masterKey.made.masterKey),
      1,
      masterKey.publicKey,
      masterKey.made.masterKeyName,
    ),
  );
}

/** The record as the archive frame takes it: the key's and the master key id's bytes. */
export function backupKeyFrameInput(record: BackupKeyRecord): BackupKeyFrameInput {
  const backupKey = backupKeyBytes(record.key);
  if (backupKey === undefined) {
    throw new AppError("backup.archive_key_invalid", { input: "backup_key" });
  }
  return {
    backupKey,
    keyNumber: record.keyNumber,
    masterKeyId: Buffer.from(record.masterKeyId, "hex"),
    masterKeyDay: record.masterKeyDay,
  };
}

/** The number of the backup key `backup.env` holds, so the next key is one more. 0 when it names
 * no number: a box set up before keys were numbered holds a random key, so key 1 was never handed
 * out there. `undefined` when it names a number that is not a backup key's. */
export function heldBackupKeyNumber(env: Env): number | undefined {
  const number = loadHeldKeyNumber(env);
  return number === null ? 0 : number;
}

export interface BackupKeyChangeDeps {
  stateDir: string;
  stream: Pick<StreamHost, "reload">;
  /** Rewrites this node's sealed state row, which carries `backup.env`. */
  sealedState: Pick<SealedStateRefresher, "refresh">;
}

/** Writes `record` into `backup.env`. Stopping the stream before the write leaves the old generation
 * the secrets its pack opens. */
export async function changeBackupKey(
  deps: BackupKeyChangeDeps,
  record: BackupKeyRecord,
  rotatedAt: string,
): Promise<void> {
  await deps.stream.reload(async () => {
    await writeBackupKey(deps.stateDir, { ...record, rotatedAt });
    await deps.sealedState.refresh();
  });
}

export interface BackupKeyFacts {
  number: number;
  fingerprint: string;
  changedAt: string | null;
  /** Whether `backup.env` names the id of the venue's current master key. */
  fromCurrentMasterKey: boolean;
}

/** What `backup.env` says of its backup key, or `null` when it holds no key with a number and id. */
export function backupKeyFacts(
  env: Env,
  currentPublicKey: Uint8Array | null,
): BackupKeyFacts | null {
  let held: ReturnType<typeof loadNumberedBackupKey>;
  try {
    held = loadNumberedBackupKey(env);
  } catch (error) {
    if (isAppError(error) && error.code === "backup.recovery_key_too_short") return null;
    throw error;
  }
  if (held === undefined) return null;
  return {
    number: held.keyNumber,
    fingerprint: keyFingerprint(held.key),
    changedAt: loadKeyRotatedAt(env) ?? null,
    fromCurrentMasterKey:
      currentPublicKey !== null &&
      masterKeyId(currentPublicKey).toString("hex") === held.masterKeyId,
  };
}
