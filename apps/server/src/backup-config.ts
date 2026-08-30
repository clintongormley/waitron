import { resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { isUnset } from "./env-value.js";
import { positiveInt } from "./config.js";
import "./errors.js";

/**
 * The scheduled `pg_dump` backup config (slice 4b-ii). OPT-IN and fail-closed, the same posture
 * `loadTunnelConfig`/`loadSyncConfig` take: `WAITRON_BACKUP_DIR` is the off-switch, so a box that
 * sets no backup env gets `undefined` and no backup duty runs. When the dir IS set the whole thing
 * is required — a privileged `WAITRON_BACKUP_DATABASE_URL` `pg_dump` connects as (the app pool's
 * least-privileged role cannot dump every table), and a blank one fails closed rather than resolving
 * to a degenerate connection string ("an empty connection string is a valid connection string",
 * CLAUDE.md §3).
 */
export interface BackupConfig {
  /** The privileged connection `pg_dump` runs over — a role that can read every table, NOT the app
   * pool's least-privileged deployment role. Required when `dir` is set; a blank value fails closed. */
  databaseUrl: string;
  /** The ABSOLUTE directory dumps are written to and pruned within. `resolve`d at load so the backup
   * duty joins timestamped filenames onto a settled base, not one whose meaning shifts with cwd. */
  dir: string;
  /** How often the backup duty takes a dump, from `WAITRON_BACKUP_INTERVAL_MS`. */
  intervalMs: number;
  /** How many dumps to keep before the oldest is pruned, from `WAITRON_BACKUP_RETAIN` (a positive
   * int). */
  retain: number;
  /** How long since the last successful dump before the box reports the backup stale (a `/health`
   * signal, mirroring the scheduler's own `staleAfterMs`), from `WAITRON_BACKUP_STALE_AFTER_MS`. */
  staleAfterMs: number;
}

/** A daily dump when `WAITRON_BACKUP_INTERVAL_MS` is unset — a relaxed cadence for a background
 * housekeeping dump that need not run tight. */
const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Keep a week of daily dumps when `WAITRON_BACKUP_RETAIN` is unset — enough history to recover from
 * a fault noticed a few days late without unbounded disk growth. */
const DEFAULT_BACKUP_RETAIN = 7;
/** Report the backup stale after two missed daily dumps when `WAITRON_BACKUP_STALE_AFTER_MS` is
 * unset — one skipped run is tolerated, a second is an operator signal. */
const DEFAULT_BACKUP_STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

type Env = Record<string, string | undefined>;

/**
 * Enabled iff `WAITRON_BACKUP_DIR` is set (absent OR empty → `undefined` → backup off, via `isUnset`
 * — the same off-switch `loadTunnelConfig` uses for an empty relay url). When on, the backup db url
 * is required and a blank one throws `server.config_invalid` (`required_with_backup_dir`) rather than
 * reaching `pg_dump` as `""`. The dir is `resolve`d to an absolute path — never `resolve("")`, which
 * is cwd (the "empty value is a valid value" trap, CLAUDE.md §3), and here it cannot be, because the
 * `isUnset` gate above has already ruled out the empty value.
 */
export function loadBackupConfig(env: Env): BackupConfig | undefined {
  const rawDir = env.WAITRON_BACKUP_DIR;
  if (isUnset(rawDir)) return undefined;
  const databaseUrl = env.WAITRON_BACKUP_DATABASE_URL;
  if (isUnset(databaseUrl)) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_BACKUP_DATABASE_URL",
      reason: "required_with_backup_dir",
    });
  }
  return {
    databaseUrl,
    dir: resolve(rawDir),
    intervalMs: positiveInt(env, "WAITRON_BACKUP_INTERVAL_MS", DEFAULT_BACKUP_INTERVAL_MS),
    retain: positiveInt(env, "WAITRON_BACKUP_RETAIN", DEFAULT_BACKUP_RETAIN),
    staleAfterMs: positiveInt(env, "WAITRON_BACKUP_STALE_AFTER_MS", DEFAULT_BACKUP_STALE_AFTER_MS),
  };
}
