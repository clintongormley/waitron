import { join, resolve } from "node:path";

export type ResetFate = "kept" | "deleted";
export interface StateEntry {
  readonly name: string;
  readonly kind: "file" | "folder" | "prefix";
  readonly reset: ResetFate;
  readonly why: string;
}

export const VENUE_FILE = "venue.db";
export const NODE_FILE = "node.db";
export const DATABASE_FILES = [VENUE_FILE, NODE_FILE] as const;
export const WAL_SUFFIX = "-wal";
export const SHM_SUFFIX = "-shm";
export const JOURNAL_SUFFIX = "-journal";
/** A committed row can live in the write-ahead file until it is checkpointed. */
export const SIDE_FILE_SUFFIXES = [WAL_SUFFIX, SHM_SUFFIX] as const;
export const VENUE_WAL_FILE = `${VENUE_FILE}${WAL_SUFFIX}`;
export const NODE_WAL_FILE = `${NODE_FILE}${WAL_SUFFIX}`;
export const VENUE_LOCK_FILE = "venue.lock";
export const VENUE_HOLDER_FILE = "venue.holder.json";
export const MIGRATIONS_LOCK_FILE = "migrations.lock";
export const LITESTREAM_META_SUFFIX = "-litestream";
export const VENUE_LITESTREAM_DIR = `.${VENUE_FILE}${LITESTREAM_META_SUFFIX}`;
export const INCOMING_SUFFIX = ".incoming";
export const REPLACED_DATABASE_PREFIX = `.${VENUE_FILE}-replaced-`;

export const SPARE_SPACE_FILE = "spare-space";
export const SPARE_SPACE_RELEASED_FILE = "spare-space.released";
export const BACKUP_ROOM_NOTE_FILE = "backup-room-note.json";
export const BACKUP_ROOM_START_DELETED_FILE = "backup-room-start-deleted.json";
export const RESET_REQUEST_FILE = "reset-request.json";
export const PENDING_ADOPTION_FILE = "pending-adoption.json";
export const RECOVERY_LOCK_FILE = "recovery.lock";
export const FLOWS_DIR = "flows";
export const SETUP_FLOW_DIR = "flows/setup";
export const RESTORE_FLOW_DIR = "flows/restore";
export const SCRATCH_DIR = "scratch";
export const RESTORE_STAGING_DIR = "scratch/restore";
export const BACKUP_STAGING_DIR = "scratch/backup";
export const STREAM_RESTORE_PREFIX = "stream-restore-";
export const RESTORE_ENTRY_PREFIX = "restore-entry-";
export const ENVIRONMENT_RECOVERY_MOVE_FILE = "environment-recovery-move.json";
export const START_AGAIN_GUESSES_FILE = "flows/setup/start-again-guesses.json";
export const SECRETS_ENV_FILE = "secrets.env";
export const TRADING_ENV_FILE = "trading.env";
export const BACKUP_ENV_FILE = "backup.env";
export const CHECKED_ADDRESSES_FILE = "checked-addresses.json";
export const RECOVERY_STATE_FILE = "recovery.json";
export const MODULE_RECORDS_DIR = "module-records";
export const FIRST_FISCAL_DOCUMENTS_DIR = "flows/setup/documents";
export const FIRST_SETUP_FILE = "flows/setup/record.json";
export const FISCAL_READINESS_FILE = "flows/setup/readiness.json";
export const SETUP_OPERATION_FILE = "flows/setup/operation.json";
export const SETUP_CLOCK_STEP_FILE = "setup-clock-step.json";
export const CONFIGURATION_IMPORT_FILE = "flows/setup/import/marker.json";
export const CONFIGURATION_IMPORT_ARTIFACT = "flows/setup/import/artifact";
export const CONFIGURATION_IMPORT_KEY = "flows/setup/import/key";
export const STREAM_DIR = "stream";
export const HANDOVER_DIR = "handover";
export const PAIR_STORE_DIR = "pair-store";
export const PAIR_COPY_DIR = "pair-copy";
export const TLS_DIR = "tls";
export const TLS_REPAIR_FLOW_DIR = "flows/tls-repair";
export const TLS_REPAIR_DIR = "tls/repair";
export const SERVER_PEM_FILE = "tls/server.pem";
export const TLS_JOINED_FILE = "tls/joined.json";
export const TLS_CLIENT_CERT_FILE = "tls/client.crt";
export const TLS_CLIENT_KEY_FILE = "tls/client.key";
export const TLS_INSTALL_FILE = "tls/install.json";
export const VENUE_DIR_NAME = "venue";
export const RECORDS_DIR = "records";
export const CLOUD_DIR = "cloud";
export const CLOUD_CONNECTION_FILE = "cloud/connection.json";
export const CLOUD_RECOVERY_FILE = "cloud/recovery.json";
export const CLOUD_REPLACEMENT_FILE = "cloud/replacement.json";
export const CLOUD_REPLACEMENT_SET_ASIDE_PREFIX = "cloud/replacement.json.set-aside-";
export const CLOUD_STAFF_KEY_FILE = "cloud/staff.key";
export const CLOUD_STAFF_CERT_FILE = "cloud/staff.crt";
export const CLOUD_SNAPSHOTS_DIR = "cloud/snapshots";
export const LOGS_DIR = "logs";
export const START_AGAIN_CHOICES_DIR = "records/choices";
export const START_AGAIN_SET_ASIDE_DIR = "records/set-aside";
export const TRADING_ENV_REPLACED_SUFFIX = ".replaced";

export const STATE_LAYOUT: readonly StateEntry[] = [
  {
    name: "fiscal-readiness-db-",
    kind: "prefix",
    reset: "deleted",
    why: "An isolated preproduction fiscal test retains its chain across restarts.",
  },
  {
    name: FLOWS_DIR,
    kind: "folder",
    reset: "deleted",
    why: "Operations that continue across a restart keep their record and attachments together.",
  },
  {
    name: ENVIRONMENT_RECOVERY_MOVE_FILE,
    kind: "file",
    reset: "deleted",
    why: "Resumes setting aside a database from another environment.",
  },
  {
    name: SPARE_SPACE_FILE,
    kind: "file",
    reset: "deleted",
    why: "Space reserved for a full-disk recovery.",
  },
  {
    name: SPARE_SPACE_RELEASED_FILE,
    kind: "file",
    reset: "deleted",
    why: "The sale stop must survive a restart.",
  },
  {
    name: BACKUP_ROOM_NOTE_FILE,
    kind: "file",
    reset: "deleted",
    why: "Backup ownership is needed before opening a database.",
  },
  {
    name: BACKUP_ROOM_START_DELETED_FILE,
    kind: "file",
    reset: "deleted",
    why: "Records backup cleanup performed at start.",
  },
  {
    name: RESET_REQUEST_FILE,
    kind: "file",
    reset: "deleted",
    why: "Hands a reset to the next start.",
  },
  {
    name: PENDING_ADOPTION_FILE,
    kind: "file",
    reset: "deleted",
    why: "Adoption must survive a restart.",
  },
  {
    name: RECOVERY_LOCK_FILE,
    kind: "file",
    reset: "deleted",
    why: "Serialises recovery operations.",
  },
  { name: SCRATCH_DIR, kind: "folder", reset: "deleted", why: "Temporary working copies." },
  {
    name: SETUP_CLOCK_STEP_FILE,
    kind: "file",
    reset: "deleted",
    why: "Clock steps made before the venue existed, alerted at its first full start that is neither a mirror nor fenced.",
  },
  {
    name: SECRETS_ENV_FILE,
    kind: "file",
    reset: "deleted",
    why: "Secrets stay outside database backups.",
  },
  {
    name: TRADING_ENV_FILE,
    kind: "file",
    reset: "deleted",
    why: "Trading settings are needed before opening the venue.",
  },
  {
    name: BACKUP_ENV_FILE,
    kind: "file",
    reset: "deleted",
    why: "Backup secrets stay outside the venue database.",
  },
  {
    name: CHECKED_ADDRESSES_FILE,
    kind: "file",
    reset: "deleted",
    why: "Where another box was last reached survives a restart.",
  },
  {
    name: RECOVERY_STATE_FILE,
    kind: "file",
    reset: "deleted",
    why: "Recovery state outlives replacement of the venue database.",
  },
  {
    name: MODULE_RECORDS_DIR,
    kind: "folder",
    reset: "deleted",
    why: "Module preparation and restored history survive restarts.",
  },
  { name: STREAM_DIR, kind: "folder", reset: "deleted", why: "Owned by Litestream." },
  {
    name: HANDOVER_DIR,
    kind: "folder",
    reset: "deleted",
    why: "Handover copies must survive a restart.",
  },
  {
    name: PAIR_STORE_DIR,
    kind: "folder",
    reset: "deleted",
    why: "The spare's copy of the main box's stream.",
  },
  {
    name: PAIR_COPY_DIR,
    kind: "folder",
    reset: "deleted",
    why: "A spare's first copy or a mirror's selected handover backup, held across its placing restart; selected source provenance stays until activation.",
  },
  {
    name: TLS_DIR,
    kind: "folder",
    reset: "kept",
    why: "The box certificate survives a plain reset; on a box that joined another, the reset empties it.",
  },
  { name: VENUE_DIR_NAME, kind: "folder", reset: "deleted", why: "Holds the venue databases." },
  {
    name: RECORDS_DIR,
    kind: "folder",
    reset: "kept",
    why: "Start-again choices and set-aside files survive a plain reset.",
  },
  {
    name: CLOUD_DIR,
    kind: "folder",
    reset: "deleted",
    why: "Cloud connection, recovery, staff authority and snapshot state.",
  },
  {
    name: LOGS_DIR,
    kind: "folder",
    reset: "deleted",
    why: "Logs are independent of the venue database.",
  },
  {
    name: `${TRADING_ENV_FILE}${TRADING_ENV_REPLACED_SUFFIX}`,
    kind: "file",
    reset: "deleted",
    why: "Trading secrets set aside during a restore.",
  },
];
export const RESET_KEPT: readonly string[] = STATE_LAYOUT.filter(
  (entry) => entry.reset === "kept",
).map((entry) => entry.name);

export function venueDirOf(
  env: Readonly<Record<string, string | undefined>>,
  stateDir: string,
): string {
  const value = env.WAITRON_VENUE_DIR;
  return value === undefined || value === "" ? join(stateDir, VENUE_DIR_NAME) : resolve(value);
}
