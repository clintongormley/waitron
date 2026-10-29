import type { KeyRing } from "@waitron/credentials";
import type { Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { hasCode, isAppError } from "@waitron/shared";
import {
  UNREADABLE_SETTINGS,
  archiveNamespace,
  readArchiveSettingsWithMeta,
  type ArchiveSettings,
} from "./archive-settings.js";
import { loadRecoveryKey, readHeldKey } from "./backup-config.js";
import {
  keyFingerprint,
  type BackupLoadHistory,
  type BackupRuntimeStatus,
} from "./backup-supervisor.js";
import { errnoOf } from "./errno.js";
import { redactSecrets } from "./redact-secrets.js";
import "./errors.js";

/** Every `reason` `parseArchiveSettings` and its helpers throw; `settingsInvalid` takes only these. */
export const ARCHIVE_SETTINGS_REASONS = [
  "not_json",
  "fields",
  "revision",
  "enabled",
  "destinations",
  "destination",
  "bucket",
  "duplicate_id",
  "duplicate_dir",
  "buckets",
  "retention",
  "destinationTimeoutMs",
  "schedule",
] as const;

export type ArchiveSettingsReason = (typeof ARCHIVE_SETTINGS_REASONS)[number];

/** The variables a dashboard record's load reads from the environment and can refuse. */
export const CONFIG_VARIABLES = ["WAITRON_BACKUP_STALE_AFTER_MS"] as const;

/** The one parameter of a load failure safe to keep and show. */
export type LoadFailureDetail =
  | { reason: ArchiveSettingsReason }
  | { keyVersion: number }
  | { min: number }
  | { variable: (typeof CONFIG_VARIABLES)[number] };

/** What the saved record reveals without being opened. */
export interface ArchiveRecordMeta {
  keyVersion: number;
  writtenAt: string;
  digest: string;
}

/** One failure to load the saved backup settings, as the supervisor keeps it. */
export interface LoadFailure {
  at: string;
  code: string;
  detail: LoadFailureDetail | null;
  recordDigest: string | null;
  recordWrittenAt: string | null;
}

const has = <T extends string>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value);

/** Only allowlisted values: any other parameter, message or stack is dropped. */
export function safeLoadDetail(error: unknown): LoadFailureDetail | null {
  if (!isAppError(error)) return null;
  if (hasCode(error, "backup.archive_settings_invalid")) {
    const { reason } = error.params;
    return has(ARCHIVE_SETTINGS_REASONS, reason) ? { reason } : null;
  }
  if (hasCode(error, "credentials.key_version_unknown")) {
    const { keyVersion } = error.params;
    return Number.isSafeInteger(keyVersion) ? { keyVersion } : null;
  }
  if (hasCode(error, "backup.recovery_key_too_short")) {
    const { min } = error.params;
    return Number.isSafeInteger(min) ? { min } : null;
  }
  if (hasCode(error, "server.config_invalid")) {
    const { variable } = error.params;
    return has(CONFIG_VARIABLES, variable) ? { variable } : null;
  }
  return null;
}

// Non-enumerable symbol: a spread, `Object.keys` and `JSON.stringify` leave it out.
const RECORD_META = Symbol("archiveRecordMeta");

export function attachRecordMeta(error: unknown, meta: ArchiveRecordMeta | null): void {
  if (typeof error !== "object" || error === null) return;
  // `Reflect` answers false on a frozen error instead of throwing over the error being rethrown.
  Reflect.defineProperty(error, RECORD_META, { value: meta, enumerable: false });
}

export function recordMetaOf(error: unknown): ArchiveRecordMeta | null {
  if (typeof error !== "object" || error === null) return null;
  return (error as { [RECORD_META]?: ArchiveRecordMeta })[RECORD_META] ?? null;
}

/** What the box holds of its recovery key. `fileKey` is the box env's key when usable there. */
export interface RecoveryKeyFacts {
  held: boolean;
  tooShort: boolean;
  fileKey: string | undefined;
}

/** With no key in the box env, the key the supervisor loaded counts as held. */
export async function recoveryKeyFacts(
  env: Record<string, string | undefined>,
  loadedKey: () => string | undefined,
): Promise<RecoveryKeyFacts> {
  const fileKey = await readHeldKey(async () => loadRecoveryKey(env));
  const loaded = loadedKey();
  const { held, key } = fileKey.held ? fileKey : { held: loaded !== undefined, key: loaded };
  return { held, tooShort: held && key === undefined, fileKey: fileKey.key };
}

export type FolderLook = "folder" | "missing" | "not_a_folder" | "unknown";

/** Where a saved destination is; never a bucket's secret. */
export type EvidenceDestination =
  | { kind: "folder"; dir: string; look: FolderLook }
  | {
      kind: "bucket";
      endpoint: string | null;
      region: string;
      bucket: string;
      accessKeyId: string;
      archiveFolder: string;
    };

export type RecordNow =
  | { state: "absent" }
  | { state: "unreadable"; code: string; detail: LoadFailureDetail | null }
  | { state: "readable"; destinations: EvidenceDestination[] };

/** The answer of `GET /api/backup/settings-evidence`. */
export interface SettingsEvidence {
  readAt: string;
  managedByEnvironment: boolean;
  failures: Readonly<LoadFailure>[];
  lastCleanLoadAt: string | null;
  latestLoadFailed: boolean;
  record: ArchiveRecordMeta | null;
  /** The record now is not the one the newest failure read. */
  rewrittenSinceLastFailure: boolean;
  boxKeyNumbers: { current: number; previous?: number };
  now: RecordNow;
  recoveryKey: { held: boolean; tooShort: boolean; fingerprint?: string };
}

export interface SettingsEvidenceDeps {
  db: Database;
  ring: KeyRing;
  current: () => BackupRuntimeStatus;
  loadHistory: () => BackupLoadHistory;
  readBoxEnv: () => Promise<Record<string, string | undefined>>;
  now: () => Date;
  statFolder: (dir: string) => Promise<{ isDirectory(): boolean }>;
  /** How long a folder look may take before it answers `unknown`. */
  lookTimeoutMs: number;
}

async function lookAt(
  dir: string,
  statFolder: SettingsEvidenceDeps["statFolder"],
  timeoutMs: number,
): Promise<FolderLook> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<FolderLook>((resolve) => {
    timer = setTimeout(() => resolve("unknown"), timeoutMs);
  });
  const look = Promise.resolve()
    .then(() => statFolder(dir))
    .then(
      (stats): FolderLook => (stats.isDirectory() ? "folder" : "not_a_folder"),
      (error: unknown): FolderLook => (errnoOf(error) === "ENOENT" ? "missing" : "unknown"),
    );
  try {
    return await Promise.race([look, limit]);
  } finally {
    clearTimeout(timer);
  }
}

function evidenceDestinations(
  settings: ArchiveSettings,
  deps: SettingsEvidenceDeps,
): Promise<EvidenceDestination[]> {
  return Promise.all(
    settings.destinations.map(async (d): Promise<EvidenceDestination> => {
      if (d.kind === "local-fs") {
        return {
          kind: "folder",
          dir: d.dir,
          look: await lookAt(d.dir, deps.statFolder, deps.lookTimeoutMs),
        };
      }
      return {
        kind: "bucket",
        endpoint: d.bucket.endpoint === undefined ? null : redactSecrets(d.bucket.endpoint),
        region: d.bucket.region,
        bucket: d.bucket.bucket,
        accessKeyId: d.bucket.accessKeyId,
        archiveFolder: archiveNamespace(d.bucket.prefix, d.venueId),
      };
    }),
  );
}

/** Writes nothing of its own: the record's facts come from one transaction, and each folder is
 * looked at after it. */
export async function readSettingsEvidence(deps: SettingsEvidenceDeps): Promise<SettingsEvidence> {
  // Taken before the record is read, so a record written meanwhile is newer than the history's
  // newest failure, never older.
  const loaded = deps.current();
  const { failures, lastCleanLoadAt, latestLoadFailed } = deps.loadHistory();
  let record: ArchiveRecordMeta | null;
  let settings: ArchiveSettings | null = null;
  let unreadable: RecordNow | undefined;
  try {
    ({ meta: record, settings } = await readArchiveSettingsWithMeta(deps.db, deps.ring));
  } catch (error) {
    if (!isAppError(error) || !UNREADABLE_SETTINGS.has(error.code)) throw error;
    record = recordMetaOf(error);
    unreadable = { state: "unreadable", code: codeOf(error), detail: safeLoadDetail(error) };
  }
  const now: RecordNow =
    unreadable ??
    (settings === null
      ? { state: "absent" }
      : {
          state: "readable",
          // A record the environment overrides is not in effect, so none of its places are shown.
          destinations: loaded.managedByEnvironment
            ? []
            : await evidenceDestinations(settings, deps),
        });
  const env = await deps.readBoxEnv();
  const key = await recoveryKeyFacts(env, () => loaded.recoveryKey);
  const fingerprint =
    key.fileKey === undefined ? loaded.keyFingerprint : keyFingerprint(key.fileKey);
  const newest = failures[0];
  const { previous } = deps.ring;
  return {
    readAt: deps.now().toISOString(),
    managedByEnvironment: loaded.managedByEnvironment,
    failures,
    lastCleanLoadAt,
    latestLoadFailed,
    record,
    rewrittenSinceLastFailure:
      newest !== undefined && (record?.digest ?? null) !== newest.recordDigest,
    boxKeyNumbers: {
      current: deps.ring.current.version,
      ...(previous === undefined ? {} : { previous: previous.version }),
    },
    now,
    recoveryKey: {
      held: key.held,
      tooShort: key.tooShort,
      ...(fingerprint === undefined ? {} : { fingerprint }),
    },
  };
}
