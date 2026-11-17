import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import {
  deleteCredential,
  getCredential,
  putCredential,
  readCredentialMeta,
  tryGetCredential,
  type KeyRing,
} from "@waitron/credentials";
import {
  nowIso,
  readSettings,
  saveSettings,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { normalisePrefix, readBucketConfig, type BucketConfig } from "@waitron/stream";
import {
  MAX_DESTINATION_TIMEOUT_MS,
  MIN_DESTINATION_TIMEOUT_MS,
  type BackupSchedule,
} from "./backup-config.js";
import {
  attachRecordMeta,
  type ArchiveRecordMeta,
  type ArchiveSettingsReason,
} from "./backup-settings-evidence.js";
import { credentialField, UNREADABLE_CREDENTIAL } from "./credentials.js";
import type { BackupDestination } from "./storage-backend.js";
import type { StreamSettings } from "./stream-host.js";
import { BACKUP_SETTINGS, type StoredArchive } from "./backup-settings-document.js";
import "./errors.js";

export const ARCHIVE_PURPOSE = "backup.archive";

export interface ArchiveSettings {
  /** Fresh on every write, so a reader can tell any edit apart, a secret-only one included. */
  revision: string;
  enabled: boolean;
  cloud: boolean;
  /** Empty only for Cloud-only archives. IDs are unique and at most one is a bucket. */
  destinations: BackupDestination[];
  schedule: BackupSchedule;
  retention: { count: number; days: number };
  destinationTimeoutMs: number;
}

// C0 controls, DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

// Unicode format characters, line and paragraph separators, and half a surrogate pair: each can
// hide or reorder what an owner reads as the archive folder.
const INVISIBLE = /[\p{Cf}\p{Cs}\u2028\u2029]/u;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const BUCKET_ID = "bucket";
const LOCAL_ID = "primary";

export function requestInvalid(field: string): AppError {
  return new AppError("backup.request_invalid", { field });
}

export function archiveNamespace(selectedPrefix: string): string {
  const root = normalisePrefix(selectedPrefix);
  if (root !== "") {
    const segments = root.slice(0, -1).split("/");
    if (
      CONTROL.test(root) ||
      INVISIBLE.test(root) ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw requestInvalid("prefix");
    }
  }
  return root;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every `required` key is present, and every key is `required` or `optional`. */
export function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !CONTROL.test(value);
}

function settingsInvalid(reason: ArchiveSettingsReason): AppError {
  return new AppError("backup.archive_settings_invalid", { reason });
}

/** Checks a schedule exactly, throwing what `invalid` returns. Wall-clock days must be ascending,
 * with no repeats. */
export function parseSchedule(raw: unknown, invalid: () => AppError): BackupSchedule {
  if (!isRecord(raw)) throw invalid();
  if (raw.kind === "interval") {
    if (!hasExactKeys(raw, ["kind", "ms"]) || !isCount(raw.ms)) throw invalid();
    return { kind: "interval", ms: raw.ms };
  }
  if (raw.kind !== "wall-clock" || !hasExactKeys(raw, ["kind", "days", "at"])) throw invalid();
  const { days, at } = raw;
  if (days !== "daily") {
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      !days.every(
        (day, i): day is number =>
          typeof day === "number" &&
          Number.isInteger(day) &&
          day >= 0 &&
          day <= 6 &&
          (i === 0 || day > (days[i - 1] as number)),
      )
    ) {
      throw invalid();
    }
  }
  if (at !== "auto") {
    if (
      !isRecord(at) ||
      !hasExactKeys(at, ["hour", "minute"]) ||
      typeof at.hour !== "number" ||
      typeof at.minute !== "number" ||
      !Number.isInteger(at.hour) ||
      !Number.isInteger(at.minute) ||
      at.hour < 0 ||
      at.hour > 23 ||
      at.minute < 0 ||
      at.minute > 59
    ) {
      throw invalid();
    }
  }
  return {
    kind: "wall-clock",
    days: days === "daily" ? "daily" : [...(days as number[])],
    at: at === "auto" ? "auto" : { hour: at.hour as number, minute: at.minute as number },
  };
}

const BUCKET_FIELDS = ["region", "bucket", "prefix", "accessKeyId", "secretAccessKey"] as const;

function parseStoredBucket(raw: unknown): BucketConfig {
  const invalid = () => settingsInvalid("bucket");
  if (!isRecord(raw) || !hasExactKeys(raw, BUCKET_FIELDS, ["endpoint"])) throw invalid();
  const { endpoint, region, bucket, prefix, accessKeyId, secretAccessKey } = raw;
  if (
    (endpoint !== undefined && !isText(endpoint)) ||
    !isText(region) ||
    !isText(bucket) ||
    typeof prefix !== "string" ||
    !isText(accessKeyId) ||
    !isText(secretAccessKey)
  ) {
    throw invalid();
  }
  try {
    return readBucketConfig(raw, () => {
      throw invalid();
    });
  } catch (error) {
    if (isAppError(error) && hasCode(error, "backup.stream_config_unsafe")) throw invalid();
    throw error;
  }
}

type ArchiveKeys = Pick<BucketConfig, "accessKeyId" | "secretAccessKey">;

function parseStoredDestination(raw: unknown, keys: ArchiveKeys | null): BackupDestination {
  const invalid = () => settingsInvalid("destination");
  if (!isRecord(raw)) throw invalid();
  if (raw.kind === "local-fs") {
    const { id, dir } = raw;
    if (!hasExactKeys(raw, ["kind", "id", "dir"]) || !isText(id) || !isText(dir)) throw invalid();
    if (dir !== resolve(dir)) throw invalid();
    return { kind: "local-fs", id, dir };
  }
  if (raw.kind !== "s3" || !hasExactKeys(raw, ["kind", "id", "bucket"])) throw invalid();
  const { id } = raw;
  if (!isText(id)) throw invalid();
  if (
    !isRecord(raw.bucket) ||
    !hasExactKeys(raw.bucket, ["region", "bucket", "prefix"], ["endpoint"])
  )
    throw settingsInvalid("bucket");
  if (keys === null) throw settingsInvalid("keys");
  const bucket = parseStoredBucket({ ...raw.bucket, ...keys });
  try {
    archiveNamespace(bucket.prefix);
  } catch {
    throw invalid();
  }
  return { kind: "s3", id, bucket };
}

export function isAtLeastDaily(schedule: BackupSchedule): boolean {
  return schedule.kind === "interval"
    ? schedule.ms <= 86_400_000
    : schedule.days === "daily" || schedule.days.length === 7;
}

const SETTINGS_FIELDS = [
  "revision",
  "enabled",
  "destinations",
  "schedule",
  "retention",
  "destinationTimeoutMs",
] as const;

export function parseArchiveSettings(raw: unknown, keys: ArchiveKeys | null): ArchiveSettings {
  if (!isRecord(raw) || !hasExactKeys(raw, SETTINGS_FIELDS, ["writtenAt", "cloud"]))
    throw settingsInvalid("fields");
  const { revision, enabled, destinations, retention, destinationTimeoutMs, cloud = false } = raw;
  if (typeof cloud !== "boolean") throw settingsInvalid("fields");
  if (typeof revision !== "string" || !UUID.test(revision)) throw settingsInvalid("revision");
  if (typeof enabled !== "boolean") throw settingsInvalid("enabled");
  if (!Array.isArray(destinations) || (destinations.length === 0 && !cloud)) {
    throw settingsInvalid("destinations");
  }
  const parsed = destinations.map((destination) => parseStoredDestination(destination, keys));
  if (new Set(parsed.map((d) => d.id)).size !== parsed.length) {
    throw settingsInvalid("duplicate_id");
  }
  const dirs = parsed.flatMap((d) => (d.kind === "local-fs" ? [d.dir] : []));
  if (new Set(dirs).size !== dirs.length) throw settingsInvalid("duplicate_dir");
  const buckets = parsed.filter((d) => d.kind === "s3");
  if (buckets.length > 1) throw settingsInvalid("buckets");
  if (buckets.length === 0 && keys !== null) throw settingsInvalid("keys");
  if (
    !isRecord(retention) ||
    !hasExactKeys(retention, ["count", "days"]) ||
    !isCount(retention.count) ||
    !isCount(retention.days)
  ) {
    throw settingsInvalid("retention");
  }
  if (
    !isCount(destinationTimeoutMs) ||
    destinationTimeoutMs < MIN_DESTINATION_TIMEOUT_MS ||
    destinationTimeoutMs > MAX_DESTINATION_TIMEOUT_MS
  ) {
    throw settingsInvalid("destinationTimeoutMs");
  }
  const schedule = parseSchedule(raw.schedule, () => settingsInvalid("schedule"));
  if (cloud && !isAtLeastDaily(schedule)) throw settingsInvalid("schedule");
  return {
    revision,
    enabled,
    cloud,
    destinations: parsed,
    schedule,
    retention: { count: retention.count, days: retention.days },
    destinationTimeoutMs,
  };
}

export async function readArchiveSettings(
  db: Database,
  ring: KeyRing,
): Promise<ArchiveSettings | null> {
  return withTransaction(db, (tx) => readArchiveSettingsIn(tx, ring));
}

export async function readArchiveSettingsIn(
  tx: Transaction,
  ring: KeyRing,
): Promise<ArchiveSettings | null> {
  const { doc } = await readSettings(tx, BACKUP_SETTINGS);
  const value = await tryGetCredential(tx, ring, { purpose: ARCHIVE_PURPOSE });
  return joinArchiveSettings(doc.archive, value);
}

function joinArchiveSettings(
  stored: StoredArchive | null,
  value: Record<string, string> | null,
): ArchiveSettings | null {
  const keys =
    value === null
      ? null
      : {
          accessKeyId: credentialField(value, ARCHIVE_PURPOSE, "accessKeyId"),
          secretAccessKey: credentialField(value, ARCHIVE_PURPOSE, "secretAccessKey"),
        };
  if (stored === null) {
    if (keys !== null) throw settingsInvalid("keys");
    return null;
  }
  return parseArchiveSettings(stored, keys);
}

/**
 * {@link readArchiveSettings} with the record's metadata, both read in one transaction so they
 * describe one record. A failing read throws its own error, carrying the metadata of the row that
 * failed for `recordMetaOf`.
 */
export async function readArchiveSettingsWithMeta(
  db: Database,
  ring: KeyRing,
): Promise<{ meta: ArchiveRecordMeta | null; settings: ArchiveSettings | null }> {
  let meta: ArchiveRecordMeta | null = null;
  try {
    return await withTransaction(db, async (tx) => {
      const { doc } = await readSettings(tx, BACKUP_SETTINGS);
      const row = await readCredentialMeta(tx, { purpose: ARCHIVE_PURPOSE });
      if (doc.archive !== null)
        meta = {
          keyVersion: row?.keyVersion ?? null,
          writtenAt: doc.archive.writtenAt,
          digest: createHash("sha256").update(JSON.stringify(doc.archive)).digest("hex"),
        };
      const value =
        row === null ? null : await getCredential(tx, ring, { purpose: ARCHIVE_PURPOSE });
      return { meta, settings: joinArchiveSettings(doc.archive, value) };
    });
  } catch (error) {
    attachRecordMeta(error, meta);
    throw error;
  }
}

/** What reading a stored archive record answers when the record itself cannot be read. */
export const UNREADABLE_SETTINGS: ReadonlySet<string> = new Set([
  "backup.archive_settings_invalid",
  ...UNREADABLE_CREDENTIAL,
]);

/** The stored archive settings, or the code that says the stored record cannot be read. */
export async function readHeldArchiveSettings(
  db: Database,
  ring: KeyRing,
): Promise<{ settings: ArchiveSettings | null } | { unreadable: string }> {
  return withTransaction(db, (tx) => readHeldArchiveSettingsIn(tx, ring));
}

export async function readHeldArchiveSettingsIn(
  tx: Transaction,
  ring: KeyRing,
): Promise<{ settings: ArchiveSettings | null } | { unreadable: string }> {
  try {
    return { settings: await readArchiveSettingsIn(tx, ring) };
  } catch (error) {
    if (isAppError(error) && UNREADABLE_SETTINGS.has(error.code)) {
      return { unreadable: error.code };
    }
    throw error;
  }
}

function splitArchiveSettings(settings: ArchiveSettings): {
  archive: StoredArchive;
  keys: ArchiveKeys | null;
} {
  let keys: ArchiveKeys | null = null;
  const destinations = settings.destinations.map((destination) => {
    if (destination.kind !== "s3") return destination;
    const { accessKeyId, secretAccessKey, ...bucket } = destination.bucket;
    keys = { accessKeyId, secretAccessKey };
    return { ...destination, bucket };
  });
  return { archive: { ...settings, destinations, writtenAt: nowIso() }, keys };
}

type ArchiveSettingsInput = Omit<ArchiveSettings, "revision" | "cloud"> & { cloud?: boolean };

export function archiveRecord(settings: ArchiveSettingsInput): {
  json: string;
  stored: ArchiveSettings;
} {
  const { archive, keys } = splitArchiveSettings({
    ...settings,
    cloud: settings.cloud ?? false,
    revision: randomUUID(),
  });
  const stored = parseArchiveSettings(archive, keys);
  return { json: JSON.stringify(stored), stored };
}

export async function writeArchiveSettings(
  tx: Transaction,
  ring: KeyRing,
  settings: ArchiveSettingsInput,
  personId: string | null,
): Promise<ArchiveSettings> {
  const { stored } = archiveRecord(settings);
  const { archive, keys } = splitArchiveSettings(stored);
  const saved = await readSettings(tx, BACKUP_SETTINGS);
  if (keys === null) await deleteCredential(tx, { purpose: ARCHIVE_PURPOSE, personId });
  else await putCredential(tx, ring, { purpose: ARCHIVE_PURPOSE, value: keys, personId });
  await saveSettings(tx, BACKUP_SETTINGS, {
    doc: { ...saved.doc, archive },
    expectedRevision: saved.revision,
    personId,
  });
  return stored;
}

const CUSTOM_FIELDS = [
  "kind",
  "endpoint",
  "region",
  "bucket",
  "prefix",
  "accessKeyId",
  "secretAccessKey",
];

function sameBucketPlace(a: BucketConfig, b: BucketConfig): boolean {
  return (
    a.endpoint === b.endpoint &&
    a.region === b.region &&
    a.bucket === b.bucket &&
    normalisePrefix(a.prefix) === normalisePrefix(b.prefix)
  );
}

const AWS = "aws";

/**
 * Two spellings the S3 client sends to one URL compare equal. No endpoint is taken to be AWS's
 * regional or global endpoint: wrongly calling two places one only refuses more.
 */
function endpointPlace(bucket: { endpoint?: string; region: string }): string {
  if (bucket.endpoint === undefined) return AWS;
  const url = new URL(bucket.endpoint);
  const place = `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
  return place === "https://s3.amazonaws.com" ||
    place === `https://s3.${bucket.region}.amazonaws.com`
    ? AWS
    : place;
}

/** An archive folder: its bucket, and the folder's whole key prefix there (`archiveNamespace`). */
export interface ArchivePlace {
  endpoint?: string;
  region: string;
  bucket: string;
  namespace: string;
}

export function archivePlace(bucket: BucketConfig): ArchivePlace {
  return {
    ...(bucket.endpoint === undefined ? {} : { endpoint: bucket.endpoint }),
    region: bucket.region,
    bucket: bucket.bucket,
    namespace: archiveNamespace(bucket.prefix),
  };
}

export function refuseStreamOverlap(
  archive: ArchivePlace,
  stream: Pick<StreamSettings, "bucket"> | null,
): void {
  if (stream === null) return;
  const s = stream.bucket;
  if (
    endpointPlace(s) !== endpointPlace(archive) ||
    s.region !== archive.region ||
    s.bucket !== archive.bucket
  ) {
    return;
  }
  const streamPrefix = normalisePrefix(s.prefix);
  if (archive.namespace.startsWith(streamPrefix) || streamPrefix.startsWith(archive.namespace)) {
    throw new AppError("backup.archive_namespace_overlap", {});
  }
}

function customBucket(
  body: Record<string, unknown>,
  ctx: { held: ArchiveSettings | null },
): BucketConfig {
  if (!Object.keys(body).every((key) => CUSTOM_FIELDS.includes(key))) {
    throw requestInvalid("destinations");
  }
  const offered = body.secretAccessKey;
  const keepHeld = offered === undefined || offered === "";
  let bucket: BucketConfig;
  try {
    // A stand-in only so the other fields are checked; it is replaced or refused below.
    bucket = readBucketConfig(keepHeld ? { ...body, secretAccessKey: "held" } : body, (field) => {
      throw requestInvalid(field);
    });
  } catch (error) {
    if (isAppError(error) && hasCode(error, "backup.stream_config_unsafe")) {
      throw requestInvalid(error.params.field);
    }
    throw error;
  }
  if (!keepHeld) return bucket;
  const held = ctx.held?.destinations.find(
    (d): d is Extract<BackupDestination, { kind: "s3" }> =>
      d.kind === "s3" &&
      d.bucket.accessKeyId === bucket.accessKeyId &&
      sameBucketPlace(d.bucket, bucket),
  );
  if (held === undefined) throw requestInvalid("secretAccessKey");
  return { ...bucket, secretAccessKey: held.bucket.secretAccessKey };
}

/**
 * One destination of a dashboard Save, resolved server-side. `stream-bucket` copies the stream's
 * settings as they are now, so a later stream edit or removal does not move archives.
 */
export function resolveArchiveChoice(
  destination: unknown,
  ctx: { stream: StreamSettings | null; held: ArchiveSettings | null },
): BackupDestination {
  if (!isRecord(destination)) throw requestInvalid("destinations");
  switch (destination.kind) {
    case "local-fs": {
      if (!hasExactKeys(destination, ["kind", "dir"])) throw requestInvalid("destinations");
      const { dir } = destination;
      if (typeof dir !== "string" || dir.trim() === "" || CONTROL.test(dir)) {
        throw requestInvalid("dir");
      }
      if (!isAbsolute(dir)) {
        throw new AppError("backup.request_invalid", { field: "dir", reason: "relative" });
      }
      return { kind: "local-fs", id: LOCAL_ID, dir: resolve(dir) };
    }
    case "stream-bucket": {
      if (!hasExactKeys(destination, ["kind"])) throw requestInvalid("destinations");
      if (ctx.stream === null) throw new AppError("backup.stream_not_configured", {});
      const bucket = { ...ctx.stream.bucket };
      refuseStreamOverlap(archivePlace(bucket), ctx.stream);
      return { kind: "s3", id: BUCKET_ID, bucket };
    }
    case "custom-s3": {
      const bucket = customBucket(destination, ctx);
      refuseStreamOverlap(archivePlace(bucket), ctx.stream);
      return { kind: "s3", id: BUCKET_ID, bucket };
    }
    default:
      throw requestInvalid("destinations");
  }
}

/** The destination choices resolved against the bucket copy's settings; a Save lists one at most. */
export const BUCKET_CHOICES = new Set<unknown>(["stream-bucket", "custom-s3"]);

/** Counts the raw kinds before any entry resolves, so an entry's own refusal never answers for a
 * list that is wrong as a whole. */
export function checkArchiveChoiceList(
  raw: unknown,
  allowEmpty = false,
): Record<string, unknown>[] {
  if (
    !Array.isArray(raw) ||
    (raw.length === 0 && !allowEmpty) ||
    raw.length > 2 ||
    !raw.every(isRecord) ||
    raw.filter((c) => c.kind === "local-fs").length > 1 ||
    raw.filter((c) => BUCKET_CHOICES.has(c.kind)).length > 1
  ) {
    throw requestInvalid("destinations");
  }
  return raw;
}

/** A Save's destinations: at most one folder and one bucket, returned folder first. */
export function resolveArchiveChoices(
  choices: unknown,
  ctx: { stream: StreamSettings | null; held: ArchiveSettings | null; cloud?: boolean },
): BackupDestination[] {
  const resolved = checkArchiveChoiceList(choices, ctx.cloud).map((c) =>
    resolveArchiveChoice(c, ctx),
  );
  return [
    ...resolved.filter((d) => d.kind === "local-fs"),
    ...resolved.filter((d) => d.kind === "s3"),
  ];
}
