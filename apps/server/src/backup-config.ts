import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { AppError, isAppError } from "@waitron/shared";
import { isUnset } from "./env-value.js";
import { positiveInt } from "./config.js";
import { MIN_PASSPHRASE_LENGTH } from "./recovery-bundle.js";
import type { BackupDestination } from "./storage-backend.js";
import "./errors.js";

export type BackupSchedule =
  | { kind: "interval"; ms: number }
  | { kind: "wall-clock"; days: "daily" | number[]; at: { hour: number; minute: number } | "auto" };

export interface BackupConfig {
  /** Never empty; ids and resolved dirs are both unique. */
  destinations: BackupDestination[];
  /** The operator-held passphrase every backup artifact is encrypted under. */
  recoveryKey: string;
  schedule: BackupSchedule;
  /** The count cap: how many archives each destination keeps. */
  retain: number;
  /** The age cap: an archive older than this many days is pruned even under the count cap. */
  retainDays: number;
  /** How long since the last successful backup before the box reports it stale. */
  staleAfterMs: number;
  /** `undefined` when never rotated. Reported in box status only; it gates no behaviour. */
  keyRotatedAt: string | undefined;
}

const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BACKUP_RETAIN = 7;
const DEFAULT_BACKUP_RETAIN_DAYS = 30;
const DEFAULT_BACKUP_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

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

function parseDestinations(env: Env): BackupDestination[] {
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
    for (const raw of parsed) {
      const entry = raw as { kind?: unknown; id?: unknown; dir?: unknown } | null;
      if (
        typeof entry !== "object" ||
        entry === null ||
        entry.kind !== "local-fs" ||
        typeof entry.id !== "string" ||
        typeof entry.dir !== "string" ||
        // `resolve("")` is the working directory (CLAUDE.md §3).
        isUnset(entry.id) ||
        isUnset(entry.dir)
      ) {
        throw new AppError("backup.destinations_invalid", { reason: "bad_entry" });
      }
      out.push({ kind: "local-fs", id: entry.id, dir: resolve(entry.dir) });
    }
  }

  // Compared after `resolve`, so `/mnt/a` and `/mnt/a/` collide.
  const seenIds = new Set<string>();
  const seenDirs = new Set<string>();
  for (const d of out) {
    if (seenIds.has(d.id)) {
      throw new AppError("backup.destinations_invalid", { reason: "duplicate_id" });
    }
    seenIds.add(d.id);
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

/**
 * `undefined`, and no backup duty runs, when no destination is configured. With one, the recovery
 * key is required, so an unattended backup never writes an unencrypted artifact.
 */
export function loadBackupConfig(env: Env): BackupConfig | undefined {
  const destinations = parseDestinations(env);
  if (destinations.length === 0) return undefined;

  const recoveryKey = loadRecoveryKey(env);
  if (recoveryKey === undefined) throw new AppError("backup.recovery_key_missing", {});

  return {
    destinations,
    recoveryKey,
    schedule: parseSchedule(env),
    retain: positiveInt(env, "WAITRON_BACKUP_RETAIN", DEFAULT_BACKUP_RETAIN),
    retainDays: positiveInt(env, "WAITRON_BACKUP_RETAIN_DAYS", DEFAULT_BACKUP_RETAIN_DAYS),
    staleAfterMs: positiveInt(env, "WAITRON_BACKUP_STALE_AFTER_MS", DEFAULT_BACKUP_STALE_AFTER_MS),
    keyRotatedAt: isUnset(env.WAITRON_BACKUP_KEY_ROTATED_AT)
      ? undefined
      : env.WAITRON_BACKUP_KEY_ROTATED_AT,
  };
}
