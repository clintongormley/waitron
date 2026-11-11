export type ResetFate = "kept" | "deleted";
export interface StateEntry {
  readonly name: string;
  readonly kind: "file" | "folder" | "prefix";
  readonly reset: ResetFate;
  readonly why: string;
}

export const SPARE_SPACE_FILE = "spare-space";
export const SPARE_SPACE_RELEASED_FILE = "spare-space.released";
export const BACKUP_ROOM_NOTE_FILE = "backup-room-note.json";
export const BACKUP_ROOM_START_DELETED_FILE = "backup-room-start-deleted.json";
export const RESET_REQUEST_FILE = "reset-request.json";
export const PENDING_ADOPTION_FILE = "pending-adoption.json";
export const RECOVERY_LOCK_FILE = "recovery.lock";
export const FLOWS_DIR = "flows";
export const RESTORE_FLOW_DIR = "flows/restore";
export const SCRATCH_DIR = "scratch";
export const RESTORE_STAGING_DIR = "scratch/restore";
export const BACKUP_STAGING_DIR = "scratch/backup";
export const STREAM_RESTORE_PREFIX = "stream-restore-";
export const RESTORE_ENTRY_PREFIX = "restore-entry-";
export const ENVIRONMENT_RECOVERY_MOVE_FILE = "environment-recovery-move.json";
export const START_AGAIN_GUESSES_FILE = "first-setup-start-again-guesses.json";
export const SECRETS_ENV_FILE = "secrets.env";
export const TRADING_ENV_FILE = "trading.env";
export const BACKUP_ENV_FILE = "backup.env";
export const RECOVERY_STATE_FILE = "recovery.json";
export const MODULES_FILE = "modules.json";
export const MODULE_PREPARATION_STATE_FILE = "module-preparation-state.json";
export const MODULE_EVIDENCE_DIR = "module-evidence";
export const MODULE_OPERATION_PUBLIC_FILE = "module-operation-public.json";
export const FIRST_FISCAL_DOCUMENTS_DIR = "first-fiscal-documents";
export const FIRST_SETUP_FILE = "first-setup.json";
export const FIRST_SETUP_NODE_KEY_FILE = "first-setup-node-key.json";
export const FISCAL_READINESS_FILE = "fiscal-readiness.json";
export const SETUP_OPERATION_FILE = "setup-operation.json";
export const SETUP_OPERATION_LOCK_FILE = "setup-operation.lock";
export const CONFIGURATION_IMPORT_FILE = "configuration-import.json";
export const CONFIGURATION_IMPORT_ARTIFACT = "configuration-import.artifact";
export const CONFIGURATION_IMPORT_KEY = "configuration-import.key";
export const STREAM_DIR = "stream";
export const HANDOVER_DIR = "handover";
export const TLS_DIR = "tls";
export const TLS_REPAIR_FLOW_DIR = "flows/tls-repair";
export const TLS_REPAIR_DIR = "tls/repair";
export const SERVER_PEM_FILE = "tls/server.pem";
export const TLS_JOINED_FILE = "tls/joined.json";
export const TLS_INSTALL_FILE = "tls/install.json";
export const VENUE_DIR_NAME = "venue";
export const RECORDS_DIR = "records";
export const CLOUD_DIR = "cloud";
export const CLOUD_CONNECTION_FILE = "cloud/connection.json";
export const CLOUD_RECOVERY_FILE = "cloud/recovery.json";
export const CLOUD_REPLACEMENT_FILE = "cloud/replacement.json";
export const CLOUD_STAFF_KEY_FILE = "cloud/staff.key";
export const CLOUD_STAFF_CERT_FILE = "cloud/staff.crt";
export const CLOUD_SNAPSHOTS_DIR = "cloud/snapshots";
export const LOGS_DIR = "logs";
export const START_AGAIN_CHOICES_DIR = "records/choices";
export const START_AGAIN_SET_ASIDE_DIR = "records/set-aside";
export const TRADING_ENV_REPLACED_SUFFIX = ".replaced";

export const STATE_LAYOUT: readonly StateEntry[] = [
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
    name: START_AGAIN_GUESSES_FILE,
    kind: "file",
    reset: "deleted",
    why: "Password attempt limits survive a restart.",
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
    name: RECOVERY_STATE_FILE,
    kind: "file",
    reset: "deleted",
    why: "Recovery state outlives replacement of the venue database.",
  },
  {
    name: MODULES_FILE,
    kind: "file",
    reset: "deleted",
    why: "Module selection is read before opening the database.",
  },
  {
    name: MODULE_PREPARATION_STATE_FILE,
    kind: "file",
    reset: "deleted",
    why: "Module preparation must survive a restart.",
  },
  {
    name: MODULE_EVIDENCE_DIR,
    kind: "folder",
    reset: "deleted",
    why: "Holds setup evidence outside the venue database.",
  },
  {
    name: MODULE_OPERATION_PUBLIC_FILE,
    kind: "file",
    reset: "deleted",
    why: "Public setup progress is needed before opening the database.",
  },
  {
    name: FIRST_FISCAL_DOCUMENTS_DIR,
    kind: "folder",
    reset: "deleted",
    why: "Setup documents must survive a restart.",
  },
  {
    name: FIRST_SETUP_FILE,
    kind: "file",
    reset: "deleted",
    why: "Setup state is needed before opening the database.",
  },
  {
    name: FIRST_SETUP_NODE_KEY_FILE,
    kind: "file",
    reset: "deleted",
    why: "Setup signing secrets stay outside database backups.",
  },
  {
    name: FISCAL_READINESS_FILE,
    kind: "file",
    reset: "deleted",
    why: "Setup readiness is read before activation.",
  },
  {
    name: SETUP_OPERATION_FILE,
    kind: "file",
    reset: "deleted",
    why: "Setup ownership must survive a restart.",
  },
  {
    name: SETUP_OPERATION_LOCK_FILE,
    kind: "file",
    reset: "deleted",
    why: "Serialises setup operations.",
  },
  {
    name: CONFIGURATION_IMPORT_FILE,
    kind: "file",
    reset: "deleted",
    why: "Hands a configuration import to the next start.",
  },
  {
    name: CONFIGURATION_IMPORT_ARTIFACT,
    kind: "file",
    reset: "deleted",
    why: "Staged configuration import attachment.",
  },
  {
    name: CONFIGURATION_IMPORT_KEY,
    kind: "file",
    reset: "deleted",
    why: "Import secrets stay outside database backups.",
  },
  { name: STREAM_DIR, kind: "folder", reset: "deleted", why: "Owned by Litestream." },
  {
    name: HANDOVER_DIR,
    kind: "folder",
    reset: "deleted",
    why: "Handover copies must survive a restart.",
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
