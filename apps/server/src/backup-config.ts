import { resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { isUnset } from "./env-value.js";
import { positiveInt } from "./config.js";
import { MIN_PASSPHRASE_LENGTH } from "./recovery-bundle.js";
import type { BackupDestination } from "./storage-backend.js";
import "./errors.js";

/**
 * The scheduled `pg_dump` backup config (slice 4b-ii, widened for BR-1 storage fan-out). OPT-IN and
 * fail-closed, the same posture `loadTunnelConfig`/`loadSyncConfig` take: with no destination
 * configured the whole thing is `undefined` and no backup duty runs. `WAITRON_BACKUP_DIR` remains the
 * single-destination convenience — it becomes one local-fs destination with `id: "primary"` —
 * and `WAITRON_BACKUP_DESTINATIONS` (a JSON array) appends any further destinations after it, so a
 * box can fan a dump out to more than one place without dropping the simple case. When at least one
 * destination is configured the whole rest of the config is required: a privileged
 * `WAITRON_BACKUP_DATABASE_URL` `pg_dump` connects as (the app pool's least-privileged role cannot
 * dump every table), and an operator `WAITRON_BACKUP_RECOVERY_KEY` the artifact is encrypted under —
 * required so an unattended backup can never write an unencrypted artifact — with a 12-char floor
 * shared with the recovery bundle (`MIN_PASSPHRASE_LENGTH`). A blank value for any of these fails
 * closed rather than resolving to a degenerate default ("an empty connection string is a valid
 * connection string", CLAUDE.md §3).
 */
export interface BackupConfig {
  /** Where dumps are written. At least one destination when this config exists at all; a lone
   * `WAITRON_BACKUP_DIR` becomes the single entry `{ kind: "local-fs", id: "primary", dir }`.
   * Duplicate ids are not rejected in v1 — they simply fan the same dump out twice under two names;
   * a uniqueness check is a follow-on, not required for this destination count. */
  destinations: BackupDestination[];
  /** The operator-held passphrase every backup artifact is encrypted under, from
   * `WAITRON_BACKUP_RECOVERY_KEY`. Required whenever `destinations` is non-empty; a blank or missing
   * value throws `backup.recovery_key_missing`, and one under `MIN_PASSPHRASE_LENGTH` characters
   * throws `backup.recovery_key_too_short`. */
  recoveryKey: string;
  /** The privileged connection `pg_dump` runs over — a role that can read every table, NOT the app
   * pool's least-privileged deployment role. Required when a destination is configured; a blank value
   * fails closed. */
  databaseUrl: string;
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
      if (
        typeof raw !== "object" ||
        raw === null ||
        (raw as { kind?: unknown }).kind !== "local-fs" ||
        typeof (raw as { id?: unknown }).id !== "string" ||
        typeof (raw as { dir?: unknown }).dir !== "string" ||
        // An empty id or dir is invalid, not merely present: `resolve("")` is cwd ("an empty
        // connection string is a valid connection string", CLAUDE.md §3), so this fails closed
        // BEFORE the resolve below rather than silently backing up to the process working dir.
        (raw as { id: string }).id === "" ||
        (raw as { dir: string }).dir === ""
      ) {
        throw new AppError("backup.destinations_invalid", { reason: "bad_entry" });
      }
      const entry = raw as { id: string; dir: string };
      out.push({ kind: "local-fs", id: entry.id, dir: resolve(entry.dir) });
    }
  }
  return out;
}

/**
 * Enabled iff at least one destination is configured (`WAITRON_BACKUP_DIR` and/or
 * `WAITRON_BACKUP_DESTINATIONS` — see `parseDestinations`); with neither set this returns
 * `undefined` and no backup duty runs, the same off-switch `loadTunnelConfig` uses for an empty
 * relay url. When enabled, the backup db url and the recovery key are both required: a blank
 * `WAITRON_BACKUP_DATABASE_URL` throws `server.config_invalid` (`required_with_backup_dir`), a
 * missing/blank `WAITRON_BACKUP_RECOVERY_KEY` throws `backup.recovery_key_missing`, and one shorter
 * than `MIN_PASSPHRASE_LENGTH` throws `backup.recovery_key_too_short` — fail-closed rather than
 * letting an unattended backup ship unencrypted or under a guessable key.
 */
export function loadBackupConfig(env: Env): BackupConfig | undefined {
  const destinations = parseDestinations(env);
  if (destinations.length === 0) return undefined;

  const databaseUrl = env.WAITRON_BACKUP_DATABASE_URL;
  if (isUnset(databaseUrl)) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_BACKUP_DATABASE_URL",
      reason: "required_with_backup_dir",
    });
  }

  const recoveryKey = env.WAITRON_BACKUP_RECOVERY_KEY;
  if (isUnset(recoveryKey)) throw new AppError("backup.recovery_key_missing", {});
  if (recoveryKey.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError("backup.recovery_key_too_short", { min: MIN_PASSPHRASE_LENGTH });
  }

  return {
    destinations,
    recoveryKey,
    databaseUrl,
    intervalMs: positiveInt(env, "WAITRON_BACKUP_INTERVAL_MS", DEFAULT_BACKUP_INTERVAL_MS),
    retain: positiveInt(env, "WAITRON_BACKUP_RETAIN", DEFAULT_BACKUP_RETAIN),
    staleAfterMs: positiveInt(env, "WAITRON_BACKUP_STALE_AFTER_MS", DEFAULT_BACKUP_STALE_AFTER_MS),
  };
}
