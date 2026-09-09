import { resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { isUnset } from "./env-value.js";
import { positiveInt } from "./config.js";
import { MIN_PASSPHRASE_LENGTH } from "./recovery-bundle.js";
import type { BackupDestination } from "./storage-backend.js";
import "./errors.js";

/**
 * The scheduled `pg_dump` backup config (slice 4b-ii, widened for BR-1 storage fan-out). OPT-IN
 * and fail-closed, the same posture `loadTunnelConfig` takes: with no destination
 * configured the whole thing is `undefined` and no backup duty runs. `WAITRON_BACKUP_DIR` remains
 * the single-destination convenience — it becomes one local-fs destination with `id: "primary"` —
 * and `WAITRON_BACKUP_DESTINATIONS` (a JSON array) appends any further destinations after it, so
 * a box can fan a dump out to more than one place without dropping the simple case. When at least
 * one destination is configured the operator `WAITRON_BACKUP_RECOVERY_KEY` is required — the
 * artifact is encrypted under it, so an unattended backup can never write an unencrypted artifact —
 * with a 12-char floor shared with the recovery bundle (`MIN_PASSPHRASE_LENGTH`). A blank recovery
 * key fails closed rather than resolving to a degenerate default. `WAITRON_BACKUP_DATABASE_URL` is
 * OPTIONAL: when unset the supervisor derives the backup read connection from the box's own owner
 * connection (BR-1 Task 2, 2026-09-09), so the old "required when a destination is set" throw is
 * gone; an explicitly-set value is passed through, and a blank one is treated as unset ("an empty
 * connection string is a valid connection string", CLAUDE.md §3).
 */
export type BackupSchedule =
  | { kind: "interval"; ms: number }
  | { kind: "wall-clock"; days: "daily" | number[]; at: { hour: number; minute: number } | "auto" };

export interface BackupConfig {
  /** Where dumps are written. At least one destination when this config exists at all; a lone
   * `WAITRON_BACKUP_DIR` becomes the single entry `{ kind: "local-fs", id: "primary", dir }`.
   * Ids and resolved dirs are both unique — `parseDestinations` throws `backup.destinations_invalid`
   * on a duplicate `id` (`reason: "duplicate_id"`) or a duplicate resolved `dir`
   * (`reason: "duplicate_dir"`, including `WAITRON_BACKUP_DIR` re-listed in the destinations JSON). */
  destinations: BackupDestination[];
  /** The operator-held passphrase every backup artifact is encrypted under, from
   * `WAITRON_BACKUP_RECOVERY_KEY`. Required whenever `destinations` is non-empty; a blank or missing
   * value throws `backup.recovery_key_missing`, and one under `MIN_PASSPHRASE_LENGTH` characters
   * throws `backup.recovery_key_too_short`. */
  recoveryKey: string;
  /**
   * The connection `pg_dump` runs over, from `WAITRON_BACKUP_DATABASE_URL`. `undefined` when unset:
   * the supervisor then derives the read connection from the box's own owner connection. The boot
   * probe accepts ownership or effective read grants on the dump sources and migration journals. A
   * blank env value is treated as unset.
   */
  databaseUrl: string | undefined;
  /** When the backup duty takes a dump: either a fixed `WAITRON_BACKUP_INTERVAL_MS` interval or a
   * wall-clock cadence from `WAITRON_BACKUP_SCHEDULE_DAYS` + `WAITRON_BACKUP_AT`. The two are
   * mutually exclusive (`backup.schedule_invalid`). Consumed by the sweep scheduler (BR-1 Task 3). */
  schedule: BackupSchedule;
  /** How many dumps to keep before the oldest is pruned, from `WAITRON_BACKUP_RETAIN` (a positive
   * int) — the count cap of the dual-retention policy. */
  retain: number;
  /** The age cap of the dual-retention policy: a dump older than this many days is pruned even if
   * the count cap has not been reached, from `WAITRON_BACKUP_RETAIN_DAYS` (a positive int). */
  retainDays: number;
  /** How long since the last successful dump before the box reports the backup stale (a `/health`
   * signal, mirroring the scheduler's own `staleAfterMs`), from `WAITRON_BACKUP_STALE_AFTER_MS`. */
  staleAfterMs: number;
  /** ISO timestamp of the last recovery-key rotation, from `WAITRON_BACKUP_KEY_ROTATED_AT`;
   * `undefined` when never rotated. Reported in box status only — it gates no behaviour here. */
  keyRotatedAt: string | undefined;
}

/** A daily dump when `WAITRON_BACKUP_INTERVAL_MS` is unset — a relaxed cadence for a background
 * housekeeping dump that need not run tight. */
const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Keep a week of daily dumps when `WAITRON_BACKUP_RETAIN` is unset — enough history to recover from
 * a fault noticed a few days late without unbounded disk growth. */
const DEFAULT_BACKUP_RETAIN = 7;
/** Keep a month of dumps by age when `WAITRON_BACKUP_RETAIN_DAYS` is unset — the age cap that runs
 * beside the count cap, so a burst of extra dumps cannot silently shorten the recovery window. */
const DEFAULT_BACKUP_RETAIN_DAYS = 30;
/** Report the backup stale after two missed daily dumps when `WAITRON_BACKUP_STALE_AFTER_MS` is
 * unset — one skipped run is tolerated, a second is an operator signal. */
const DEFAULT_BACKUP_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

type Env = Record<string, string | undefined>;

/**
 * The dump cadence. `WAITRON_BACKUP_INTERVAL_MS` (a fixed interval) and the wall-clock pair
 * (`WAITRON_BACKUP_SCHEDULE_DAYS` + `WAITRON_BACKUP_AT`) are mutually exclusive: setting both throws
 * `backup.schedule_invalid`. With neither set this is the legacy interval mode at
 * `DEFAULT_BACKUP_INTERVAL_MS`, so an existing interval config is unchanged.
 */
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

/** `"daily"` (the default when only `WAITRON_BACKUP_AT` is set) or a comma list of weekdays, each
 * `0`–`6` with Sunday = 0 (JS `getDay()` convention); deduped and sorted. A non-integer or
 * out-of-range token throws `backup.schedule_invalid`. */
function parseDays(raw: string | undefined): "daily" | number[] {
  if (isUnset(raw) || raw === "daily") return "daily";
  const parts = raw.split(",").map((s) => s.trim());
  const nums = parts.map((p) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 6) {
      throw new AppError("backup.schedule_invalid", { reason: "bad_day" });
    }
    return n;
  });
  if (nums.length === 0) throw new AppError("backup.schedule_invalid", { reason: "no_days" });
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** `"auto"` (the default when only `WAITRON_BACKUP_SCHEDULE_DAYS` is set — the scheduler picks a
 * quiet time) or an `"HH:MM"` 24-hour local time. A malformed or out-of-range time throws
 * `backup.schedule_invalid`. */
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

/**
 * `WAITRON_BACKUP_DIR`, if set, becomes the single-destination convenience `{ kind: "local-fs",
 * id: "primary", dir }` — resolved to an absolute path at load, never `resolve("")` (the
 * `isUnset` gate above has already ruled the empty value out). `WAITRON_BACKUP_DESTINATIONS`, if set,
 * is parsed as a JSON array of `{ kind: "local-fs", id, dir }` descriptors and appended after it;
 * malformed JSON, a non-array, or a shape-invalid entry all throw `backup.destinations_invalid` with
 * a machine-readable `reason` rather than reaching `pg_dump`/the storage backend with something
 * unusable.
 */
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
        // An empty id or dir is invalid, not merely present: `resolve("")` is cwd ("an empty
        // connection string is a valid connection string", CLAUDE.md §3), so this fails closed
        // BEFORE the resolve below rather than silently backing up to the process working dir.
        isUnset(entry.id) ||
        isUnset(entry.dir)
      ) {
        throw new AppError("backup.destinations_invalid", { reason: "bad_entry" });
      }
      out.push({ kind: "local-fs", id: entry.id, dir: resolve(entry.dir) });
    }
  }

  // Reject collisions: two destinations sharing an `id` (the key a backend is logged/pruned under)
  // or a resolved `dir` (the same directory reached twice — most easily by re-listing
  // `WAITRON_BACKUP_DIR` in `WAITRON_BACKUP_DESTINATIONS`) are a config mistake, not a deliberate
  // double-write. Dirs are compared AFTER `resolve`, so `/mnt/a` and `/mnt/a/` collide.
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

/**
 * Enabled iff at least one destination is configured (`WAITRON_BACKUP_DIR` and/or
 * `WAITRON_BACKUP_DESTINATIONS` — see `parseDestinations`); with neither set this returns
 * `undefined` and no backup duty runs, the same off-switch `loadTunnelConfig` uses for an empty
 * relay url. When enabled, the recovery key is required: a missing/blank `WAITRON_BACKUP_RECOVERY_KEY`
 * throws `backup.recovery_key_missing`, and one shorter than `MIN_PASSPHRASE_LENGTH` throws
 * `backup.recovery_key_too_short` — fail-closed rather than letting an unattended backup ship
 * unencrypted or under a guessable key. `WAITRON_BACKUP_DATABASE_URL` is OPTIONAL: unset leaves
 * `databaseUrl` undefined for the supervisor to derive from the box's owner connection. The schedule
 * (interval vs wall-clock) is validated by `parseSchedule` (`backup.schedule_invalid`).
 */
export function loadBackupConfig(env: Env): BackupConfig | undefined {
  const destinations = parseDestinations(env);
  if (destinations.length === 0) return undefined;

  const recoveryKey = env.WAITRON_BACKUP_RECOVERY_KEY;
  if (isUnset(recoveryKey)) throw new AppError("backup.recovery_key_missing", {});
  if (recoveryKey.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError("backup.recovery_key_too_short", { min: MIN_PASSPHRASE_LENGTH });
  }

  const databaseUrl = isUnset(env.WAITRON_BACKUP_DATABASE_URL)
    ? undefined
    : env.WAITRON_BACKUP_DATABASE_URL;
  return {
    destinations,
    recoveryKey,
    databaseUrl,
    schedule: parseSchedule(env),
    retain: positiveInt(env, "WAITRON_BACKUP_RETAIN", DEFAULT_BACKUP_RETAIN),
    retainDays: positiveInt(env, "WAITRON_BACKUP_RETAIN_DAYS", DEFAULT_BACKUP_RETAIN_DAYS),
    staleAfterMs: positiveInt(env, "WAITRON_BACKUP_STALE_AFTER_MS", DEFAULT_BACKUP_STALE_AFTER_MS),
    keyRotatedAt: isUnset(env.WAITRON_BACKUP_KEY_ROTATED_AT)
      ? undefined
      : env.WAITRON_BACKUP_KEY_ROTATED_AT,
  };
}
