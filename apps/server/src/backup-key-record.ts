import { backupKey, masterKeyId } from "@waitron/credentials";
import type { BackupKeyFrameInput } from "@waitron/provisioning";
import { decodeMasterKeyCode, isAppError } from "@waitron/shared";
import { loadBackupKey, loadKeyRotatedAt } from "./backup-config.js";
import { writeBackupKey, type BackupKeyRecord } from "./backup-env-writer.js";
import { keyFingerprint } from "./backup-supervisor.js";
import type { SealedStateRefresher } from "./sealed-state.js";
import type { StreamHost } from "./stream-host.js";

type Env = Readonly<Record<string, string | undefined>>;

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

/** The number of the backup key `backup.env` holds; 0 when it holds none with a number, or one under
 * the length floor, so the next key is 1. */
export function heldBackupKeyNumber(env: Env): number {
  try {
    return loadBackupKey(env)?.keyNumber ?? 0;
  } catch (error) {
    if (isAppError(error) && error.code === "backup.recovery_key_too_short") return 0;
    throw error;
  }
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
  let held: ReturnType<typeof loadBackupKey>;
  try {
    held = loadBackupKey(env);
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
