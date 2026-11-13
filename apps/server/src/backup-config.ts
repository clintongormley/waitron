import { randomBytes } from "node:crypto";
import { codeOf } from "@waitron/server-kit";
import { AppError, isAppError } from "@waitron/shared";
import { type ArchiveSettings } from "./archive-settings.js";
import {
  recordMetaOf,
  safeLoadDetail,
  type ArchiveRecordMeta,
  type LoadFailureDetail,
} from "./backup-settings-evidence.js";
import { isUnset } from "./env-value.js";
export const MIN_RECOVERY_KEY_LENGTH = 12;
import type { BackupDestination } from "./storage-backend.js";
import "./errors.js";

export type BackupSchedule =
  | { kind: "interval"; ms: number }
  | { kind: "wall-clock"; days: "daily" | number[]; at: { hour: number; minute: number } | "auto" };

export interface BackupConfig {
  revision: string | undefined;
  /** False only for a dashboard record stored switched off, which runs no sweep. */
  enabled: boolean;
  /** Never empty; ids are unique, and so are local folders' resolved dirs. */
  destinations: BackupDestination[];
  /** The operator-held passphrase every backup artifact is encrypted under. `undefined` only on a
   * switched-off record whose box holds no usable key. */
  recoveryKey: string | undefined;
  schedule: BackupSchedule;
  /** The count cap: how many archives each destination keeps. */
  retain: number;
  /** The age cap: an archive older than this many days is pruned even under the count cap. */
  retainDays: number;
  /** How long since the last successful backup before the box reports it stale. */
  staleAfterMs: number;
  /** How long one destination's upload and its pruning may run before both are stopped. */
  destinationTimeoutMs: number;
  /** `undefined` when never rotated. Reported in `GET /api/box/status` only; it gates no behaviour. */
  keyRotatedAt: string | undefined;
}

export const BACKUP_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
export const DEFAULT_DESTINATION_TIMEOUT_MS = 15 * 60 * 1000;
export const MIN_DESTINATION_TIMEOUT_MS = 30 * 1000;
export const MAX_DESTINATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

type Env = Record<string, string | undefined>;

/** {@link loadRecoveryKey}'s check, for a key read from elsewhere. Unset or empty is `undefined`. */
export function checkedRecoveryKey(recoveryKey: string | undefined): string | undefined {
  if (isUnset(recoveryKey)) return undefined;
  if (recoveryKey.length < MIN_RECOVERY_KEY_LENGTH) {
    throw new AppError("backup.recovery_key_too_short", { min: MIN_RECOVERY_KEY_LENGTH });
  }
  return recoveryKey;
}

/** The recovery key without requiring an archive destination. Unset or empty is `undefined`. */
export function loadRecoveryKey(env: Env): string | undefined {
  return checkedRecoveryKey(env.WAITRON_BACKUP_RECOVERY_KEY);
}

/** A new recovery key: 32 random bytes, base64url. */
export function mintRecoveryKey(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Presence, not validity: a key under the length floor still counts as held, and `key` is then
 * undefined.
 */
export async function readHeldKey(
  read: () => Promise<string | undefined>,
): Promise<{ held: boolean; key: string | undefined }> {
  try {
    const key = await read();
    return { held: key !== undefined, key };
  } catch (error) {
    if (isAppError(error) && error.code === "backup.recovery_key_too_short") {
      return { held: true, key: undefined };
    }
    throw error;
  }
}

/** When the recovery key was last rotated, as the box env records it. */
export function loadKeyRotatedAt(env: Env): string | undefined {
  return isUnset(env.WAITRON_BACKUP_KEY_ROTATED_AT) ? undefined : env.WAITRON_BACKUP_KEY_ROTATED_AT;
}

function requiredKey(env: Env): string {
  const recoveryKey = loadRecoveryKey(env);
  if (recoveryKey === undefined) throw new AppError("backup.recovery_key_missing", {});
  return recoveryKey;
}

export function resolveBackupConfig(input: {
  env: Env;
  sealed: ArchiveSettings | null;
}): BackupConfig | undefined {
  const { env, sealed } = input;
  if (sealed === null) return undefined;
  return {
    revision: sealed.revision,
    enabled: sealed.enabled,
    destinations: archiveDestinations(sealed),
    // A switched-off record runs nothing, so a missing or short key must not stop it being reported.
    recoveryKey: sealed.enabled ? requiredKey(env) : heldUsableKey(env),
    schedule: sealed.schedule,
    retain: sealed.retention.count,
    retainDays: sealed.retention.days,
    staleAfterMs: BACKUP_STALE_AFTER_MS,
    destinationTimeoutMs: sealed.destinationTimeoutMs,
    keyRotatedAt: loadKeyRotatedAt(env),
  };
}

export function archiveDestinations(sealed: ArchiveSettings | null): BackupDestination[] {
  return sealed?.destinations ?? [];
}

/** The dashboard's stored settings could not be read or used, so archives stay off. Each optional
 * key is present only when it has a value. */
export interface BackupConfigUnusable {
  loadErrorCode: string;
  loadErrorDetail?: LoadFailureDetail;
  /** The saved record the load read or failed on. */
  record?: { digest: string; writtenAt: string };
}

/** Exactly one way to read the sealed record; only the one with metadata names the record. */
type SealedReader =
  | { readSealed: () => Promise<ArchiveSettings | null>; readSealedWithMeta?: never }
  | {
      readSealedWithMeta: () => Promise<{
        meta: ArchiveRecordMeta | null;
        settings: ArchiveSettings | null;
      }>;
      readSealed?: never;
    };

export async function loadBackupSettings(
  input: { env: Env } & SealedReader,
): Promise<BackupConfig | BackupConfigUnusable | undefined> {
  const { env } = input;
  let meta: ArchiveRecordMeta | null = null;
  try {
    let sealed: ArchiveSettings | null;
    if (input.readSealedWithMeta === undefined) {
      sealed = await input.readSealed();
    } else {
      ({ meta, settings: sealed } = await input.readSealedWithMeta());
    }
    return resolveBackupConfig({ env, sealed });
  } catch (error) {
    // A failure after a clean read names the record that read; a failing read carries its own.
    meta ??= recordMetaOf(error);
    const detail = safeLoadDetail(error);
    return {
      loadErrorCode: codeOf(error),
      ...(detail === null ? {} : { loadErrorDetail: detail }),
      ...(meta === null ? {} : { record: { digest: meta.digest, writtenAt: meta.writtenAt } }),
    };
  }
}

function heldUsableKey(env: Env): string | undefined {
  try {
    return loadRecoveryKey(env);
  } catch (error) {
    if (isAppError(error) && error.code === "backup.recovery_key_too_short") return undefined;
    throw error;
  }
}
