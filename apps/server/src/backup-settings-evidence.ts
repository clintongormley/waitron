import { hasCode, isAppError } from "@waitron/shared";
import { loadRecoveryKey, readHeldKey } from "./backup-config.js";
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
  const { held, key } = fileKey.held
    ? fileKey
    : { held: loadedKey() !== undefined, key: loadedKey() };
  return { held, tooShort: held && key === undefined, fileKey: fileKey.key };
}
