import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { codeOf } from "@waitron/server-kit";
import { AppError, isAppError } from "@waitron/shared";
import { readBucketConfig } from "@waitron/stream";
import { archiveNamespace, type ArchiveSettings } from "./archive-settings.js";
import { isUnset } from "./env-value.js";
import { positiveInt } from "./config.js";
import { MIN_PASSPHRASE_LENGTH } from "./recovery-bundle.js";
import type { BackupDestination } from "./storage-backend.js";
import "./errors.js";

export type BackupSchedule =
  | { kind: "interval"; ms: number }
  | { kind: "wall-clock"; days: "daily" | number[]; at: { hour: number; minute: number } | "auto" };

export interface BackupConfig {
  source: "environment" | "dashboard";
  /** The stored record's revision; `undefined` for the environment. */
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
  /** `undefined` when never rotated. Reported in box status only; it gates no behaviour. */
  keyRotatedAt: string | undefined;
}

const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BACKUP_RETAIN = 7;
const DEFAULT_BACKUP_RETAIN_DAYS = 30;
const DEFAULT_BACKUP_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
export const DEFAULT_DESTINATION_TIMEOUT_MS = 15 * 60 * 1000;
export const MIN_DESTINATION_TIMEOUT_MS = 30 * 1000;
export const MAX_DESTINATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;

type Env = Record<string, string | undefined>;

function parseSchedule(env: Env): BackupSchedule {
  const daysRaw = env.WAITRON_BACKUP_SCHEDULE_DAYS;
  const atRaw = env.WAITRON_BACKUP_AT;
  const wallClockSet = !isUnset(daysRaw) || !isUnset(atRaw);
  const intervalSet = !isUnset(env.WAITRON_BACKUP_INTERVAL_MS);
  if (wallClockSet && intervalSet) {
    throw new AppError("backup.schedule_invalid", { reason: "interval_and_wall_clock" });
  }
  if (!wallClockSet) {
    return {
      kind: "interval",
      ms: positiveInt(env, "WAITRON_BACKUP_INTERVAL_MS", DEFAULT_BACKUP_INTERVAL_MS),
    };
  }
  return { kind: "wall-clock", days: parseDays(daysRaw), at: parseAt(atRaw) };
}

/** Weekdays use Sunday = 0, the `getDay()` convention. */
function parseDays(raw: string | undefined): "daily" | number[] {
  if (isUnset(raw) || raw === "daily") return "daily";
  const parts = raw.split(",").map((s) => s.trim());
  const nums = parts.map((p) => {
    // `Number("")` is `0`, so without this `"1, ,3"` would be read as Sunday.
    if (p === "") throw new AppError("backup.schedule_invalid", { reason: "bad_day" });
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 6) {
      throw new AppError("backup.schedule_invalid", { reason: "bad_day" });
    }
    return n;
  });
  if (nums.length === 0) throw new AppError("backup.schedule_invalid", { reason: "no_days" });
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** `"auto"` lets the scheduler pick the time; otherwise a 24-hour local `"HH:MM"`. */
function parseAt(raw: string | undefined): { hour: number; minute: number } | "auto" {
  if (isUnset(raw) || raw === "auto") return "auto";
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(raw);
  if (m === null) throw new AppError("backup.schedule_invalid", { reason: "bad_time" });
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59)
    throw new AppError("backup.schedule_invalid", { reason: "bad_time" });
  return { hour, minute };
}

function parseDestinationTimeout(env: Env): number {
  const variable = "WAITRON_BACKUP_DESTINATION_TIMEOUT_MS";
  const ms = positiveInt(env, variable, DEFAULT_DESTINATION_TIMEOUT_MS);
  if (ms < MIN_DESTINATION_TIMEOUT_MS || ms > MAX_DESTINATION_TIMEOUT_MS) {
    throw new AppError("server.config_invalid", { variable, reason: "timeout_out_of_range" });
  }
  return ms;
}

/** The `WAITRON_BACKUP_*` variables whose presence in the RAW base env marks the backup settings as
 * the environment's, so the dashboard cannot change them. */
export const BACKUP_ENV_KEYS = [
  "WAITRON_BACKUP_DIR",
  "WAITRON_BACKUP_DESTINATIONS",
  "WAITRON_BACKUP_RECOVERY_KEY",
  "WAITRON_BACKUP_SCHEDULE_DAYS",
  "WAITRON_BACKUP_AT",
  "WAITRON_BACKUP_INTERVAL_MS",
  "WAITRON_BACKUP_RETAIN",
  "WAITRON_BACKUP_RETAIN_DAYS",
  "WAITRON_BACKUP_DESTINATION_TIMEOUT_MS",
] as const;

export function isBackupManagedByEnvironment(base: Env): boolean {
  return BACKUP_ENV_KEYS.some((k) => !isUnset(base[k]));
}

const LOCAL_FIELDS = ["kind", "id", "dir"];
const S3_FIELDS = [
  "kind",
  "id",
  "endpoint",
  "region",
  "bucket",
  "prefix",
  "accessKeyId",
  "secretAccessKey",
];

function badEntry(): AppError {
  return new AppError("backup.destinations_invalid", { reason: "bad_entry" });
}

/** Every refusal is `bad_entry` with no value in it: an entry may carry a secret. */
function parseEntry(raw: unknown, venueId: string): BackupDestination {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw badEntry();
  const entry = raw as Record<string, unknown>;
  const allowed = entry.kind === "local-fs" ? LOCAL_FIELDS : entry.kind === "s3" ? S3_FIELDS : null;
  if (allowed === null || !Object.keys(entry).every((k) => allowed.includes(k))) throw badEntry();
  const { id } = entry;
  if (typeof id !== "string" || isUnset(id)) throw badEntry();
  if (entry.kind === "local-fs") {
    const { dir } = entry;
    // `resolve("")` is the working directory (CLAUDE.md §3).
    if (typeof dir !== "string" || isUnset(dir)) throw badEntry();
    return { kind: "local-fs", id, dir: resolve(dir) };
  }
  try {
    const bucket = readBucketConfig(entry, () => {
      throw badEntry();
    });
    archiveNamespace(bucket.prefix, venueId);
    return { kind: "s3", id, bucket, venueId };
  } catch {
    throw badEntry();
  }
}

function parseDestinations(env: Env, venueId: string): BackupDestination[] {
  const out: BackupDestination[] = [];
  const dir = env.WAITRON_BACKUP_DIR;
  if (!isUnset(dir)) out.push({ kind: "local-fs", id: "primary", dir: resolve(dir) });

  const extra = env.WAITRON_BACKUP_DESTINATIONS;
  if (!isUnset(extra)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(extra);
    } catch {
      throw new AppError("backup.destinations_invalid", { reason: "not_json" });
    }
    if (!Array.isArray(parsed)) {
      throw new AppError("backup.destinations_invalid", { reason: "not_array" });
    }
    for (const raw of parsed) out.push(parseEntry(raw, venueId));
  }

  // Compared after `resolve`, so `/mnt/a` and `/mnt/a/` collide.
  const seenIds = new Set<string>();
  const seenDirs = new Set<string>();
  for (const d of out) {
    if (seenIds.has(d.id)) {
      throw new AppError("backup.destinations_invalid", { reason: "duplicate_id" });
    }
    seenIds.add(d.id);
    if (d.kind !== "local-fs") continue;
    if (seenDirs.has(d.dir)) {
      throw new AppError("backup.destinations_invalid", { reason: "duplicate_dir" });
    }
    seenDirs.add(d.dir);
  }
  return out;
}

/** The recovery key without requiring an archive destination. Unset or empty is `undefined`. */
export function loadRecoveryKey(env: Env): string | undefined {
  const recoveryKey = env.WAITRON_BACKUP_RECOVERY_KEY;
  if (isUnset(recoveryKey)) return undefined;
  if (recoveryKey.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError("backup.recovery_key_too_short", { min: MIN_PASSPHRASE_LENGTH });
  }
  return recoveryKey;
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

function keyRotatedAt(env: Env): string | undefined {
  return isUnset(env.WAITRON_BACKUP_KEY_ROTATED_AT) ? undefined : env.WAITRON_BACKUP_KEY_ROTATED_AT;
}

function requiredKey(env: Env): string {
  const recoveryKey = loadRecoveryKey(env);
  if (recoveryKey === undefined) throw new AppError("backup.recovery_key_missing", {});
  return recoveryKey;
}

/**
 * The settings the environment injects. `undefined`, and no backup duty runs, when no destination is
 * configured. With one, the recovery key is required, so an unattended backup never writes an
 * unencrypted artifact. `venueId` is stamped on every bucket destination.
 */
export function loadBackupConfig(env: Env, venueId: string): BackupConfig | undefined {
  const destinations = parseDestinations(env, venueId);
  if (destinations.length === 0) return undefined;

  const recoveryKey = requiredKey(env);

  return {
    source: "environment",
    revision: undefined,
    enabled: true,
    destinations,
    recoveryKey,
    schedule: parseSchedule(env),
    retain: positiveInt(env, "WAITRON_BACKUP_RETAIN", DEFAULT_BACKUP_RETAIN),
    retainDays: positiveInt(env, "WAITRON_BACKUP_RETAIN_DAYS", DEFAULT_BACKUP_RETAIN_DAYS),
    staleAfterMs: positiveInt(env, "WAITRON_BACKUP_STALE_AFTER_MS", DEFAULT_BACKUP_STALE_AFTER_MS),
    destinationTimeoutMs: parseDestinationTimeout(env),
    keyRotatedAt: keyRotatedAt(env),
  };
}

/**
 * Exactly one source: the environment when it owns any backup variable, else the sealed dashboard
 * record. Without a record nothing runs; `WAITRON_BACKUP_DIR` left in `backup.env` is not read,
 * because no installation's data is carried forward before go-live (CLAUDE.md §3).
 */
export function resolveBackupConfig(input: {
  managedByEnvironment: boolean;
  env: Env;
  sealed: ArchiveSettings | null;
  venueId: string;
}): BackupConfig | undefined {
  const { env, sealed } = input;
  if (input.managedByEnvironment) return loadBackupConfig(env, input.venueId);
  if (sealed === null) return undefined;
  return {
    source: "dashboard",
    revision: sealed.revision,
    enabled: sealed.enabled,
    destinations: sealed.destinations,
    // A switched-off record runs nothing, so a missing or short key must not stop it being reported.
    recoveryKey: sealed.enabled ? requiredKey(env) : heldUsableKey(env),
    schedule: sealed.schedule,
    retain: sealed.retention.count,
    retainDays: sealed.retention.days,
    staleAfterMs: positiveInt(env, "WAITRON_BACKUP_STALE_AFTER_MS", DEFAULT_BACKUP_STALE_AFTER_MS),
    destinationTimeoutMs: sealed.destinationTimeoutMs,
    keyRotatedAt: keyRotatedAt(env),
  };
}

/** The dashboard's stored settings could not be read or used, so archives stay off. */
export interface BackupConfigUnusable {
  loadErrorCode: string;
}

/**
 * {@link resolveBackupConfig} over the settings' one source. An environment the box cannot use
 * still stops the start; a dashboard record that cannot be read or used answers its error code
 * instead, so the box still starts and sells, as it does when the bucket copy's sealed settings
 * fail (`StreamHost.start`).
 */
export async function loadBackupSettings(input: {
  managedByEnvironment: boolean;
  env: Env;
  readSealed: () => Promise<ArchiveSettings | null>;
  venueId: string;
}): Promise<BackupConfig | BackupConfigUnusable | undefined> {
  const { managedByEnvironment, env, venueId } = input;
  if (managedByEnvironment) {
    return resolveBackupConfig({ managedByEnvironment, env, sealed: null, venueId });
  }
  try {
    const sealed = await input.readSealed();
    return resolveBackupConfig({ managedByEnvironment, env, sealed, venueId });
  } catch (error) {
    return { loadErrorCode: codeOf(error) };
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
