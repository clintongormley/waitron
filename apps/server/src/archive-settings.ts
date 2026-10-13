import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { putCredential, tryGetCredential, type KeyRing } from "@waitron/credentials";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import {
  isKeySegment,
  normalisePrefix,
  readBucketConfig,
  type BucketConfig,
} from "@waitron/stream";
import {
  MAX_DESTINATION_TIMEOUT_MS,
  MIN_DESTINATION_TIMEOUT_MS,
  type BackupSchedule,
} from "./backup-config.js";
import { credentialField, UNREADABLE_CREDENTIAL } from "./credentials.js";
import type { BackupDestination } from "./storage-backend.js";
import type { StreamSettings } from "./stream-host.js";
import "./errors.js";

export const ARCHIVE_PURPOSE = "backup.archive";

export interface ArchiveSettings {
  /** Fresh on every write, so a reader can tell any edit apart, a secret-only one included. */
  revision: string;
  enabled: boolean;
  /** Never empty; ids are unique and at most one is a bucket. */
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

/** `<prefix>/archives/<venueId>/`, or `archives/<venueId>/` at the bucket root. */
export function archiveNamespace(selectedPrefix: string, venueId: string): string {
  if (!isKeySegment(venueId)) throw requestInvalid("venueId");
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
  return `${root}archives/${venueId}/`;
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

function settingsInvalid(reason: string): AppError {
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

function parseStoredDestination(raw: unknown): BackupDestination {
  const invalid = () => settingsInvalid("destination");
  if (!isRecord(raw)) throw invalid();
  if (raw.kind === "local-fs") {
    const { id, dir } = raw;
    if (!hasExactKeys(raw, ["kind", "id", "dir"]) || !isText(id) || !isText(dir)) throw invalid();
    if (dir !== resolve(dir)) throw invalid();
    return { kind: "local-fs", id, dir };
  }
  if (raw.kind !== "s3" || !hasExactKeys(raw, ["kind", "id", "bucket", "venueId"])) throw invalid();
  const { id, venueId } = raw;
  if (!isText(id) || typeof venueId !== "string") throw invalid();
  const bucket = parseStoredBucket(raw.bucket);
  try {
    archiveNamespace(bucket.prefix, venueId);
  } catch {
    throw invalid();
  }
  return { kind: "s3", id, bucket, venueId };
}

const SETTINGS_FIELDS = [
  "revision",
  "enabled",
  "destinations",
  "schedule",
  "retention",
  "destinationTimeoutMs",
] as const;

/** The stored record, exactly as `writeArchiveSettings` wrote it: nothing is coerced or defaulted. */
export function parseArchiveSettings(json: string): ArchiveSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw settingsInvalid("not_json");
  }
  if (!isRecord(raw) || !hasExactKeys(raw, SETTINGS_FIELDS)) throw settingsInvalid("fields");
  const { revision, enabled, destinations, retention, destinationTimeoutMs } = raw;
  if (typeof revision !== "string" || !UUID.test(revision)) throw settingsInvalid("revision");
  if (typeof enabled !== "boolean") throw settingsInvalid("enabled");
  if (!Array.isArray(destinations) || destinations.length === 0) {
    throw settingsInvalid("destinations");
  }
  const parsed = destinations.map(parseStoredDestination);
  if (new Set(parsed.map((d) => d.id)).size !== parsed.length) {
    throw settingsInvalid("duplicate_id");
  }
  const dirs = parsed.flatMap((d) => (d.kind === "local-fs" ? [d.dir] : []));
  if (new Set(dirs).size !== dirs.length) throw settingsInvalid("duplicate_dir");
  if (parsed.filter((d) => d.kind === "s3").length > 1) throw settingsInvalid("buckets");
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
  return {
    revision,
    enabled,
    destinations: parsed,
    schedule: parseSchedule(raw.schedule, () => settingsInvalid("schedule")),
    retention: { count: retention.count, days: retention.days },
    destinationTimeoutMs,
  };
}

export async function readArchiveSettings(
  db: Database,
  ring: KeyRing,
): Promise<ArchiveSettings | null> {
  const value = await withTransaction(db, (tx) =>
    tryGetCredential(tx, ring, { purpose: ARCHIVE_PURPOSE }),
  );
  if (value === null) return null;
  return parseArchiveSettings(credentialField(value, ARCHIVE_PURPOSE, "settings"));
}

/** What reading a stored archive record answers when the record itself cannot be read. */
const UNREADABLE_SETTINGS = new Set(["backup.archive_settings_invalid", ...UNREADABLE_CREDENTIAL]);

/** The stored archive settings, or the code that says the stored record cannot be read. */
export async function readHeldArchiveSettings(
  db: Database,
  ring: KeyRing,
): Promise<{ settings: ArchiveSettings | null } | { unreadable: string }> {
  try {
    return { settings: await readArchiveSettings(db, ring) };
  } catch (error) {
    if (isAppError(error) && UNREADABLE_SETTINGS.has(error.code)) {
      return { unreadable: error.code };
    }
    throw error;
  }
}

/** The record `writeArchiveSettings` would store, under a new revision, as a read would return
 * it; throws what that read would. */
export function archiveRecord(settings: Omit<ArchiveSettings, "revision">): {
  json: string;
  stored: ArchiveSettings;
} {
  const json = JSON.stringify({ ...settings, revision: randomUUID() });
  return { json, stored: parseArchiveSettings(json) };
}

/** Stores the settings under a new revision; what is stored is what a read will accept. */
export async function writeArchiveSettings(
  tx: Transaction,
  ring: KeyRing,
  settings: Omit<ArchiveSettings, "revision">,
): Promise<ArchiveSettings> {
  const { json, stored } = archiveRecord(settings);
  await putCredential(tx, ring, { purpose: ARCHIVE_PURPOSE, value: { settings: json } });
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
const STREAM_VENUES = "venues/";

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

export function archivePlace(bucket: BucketConfig, venueId: string): ArchivePlace {
  return {
    ...(bucket.endpoint === undefined ? {} : { endpoint: bucket.endpoint }),
    region: bucket.region,
    bucket: bucket.bucket,
    namespace: archiveNamespace(bucket.prefix, venueId),
  };
}

/** Refuses an archive folder and a stream's venue folders that would share keys in one bucket. */
export function refuseStreamOverlap(archive: ArchivePlace, stream: StreamSettings | null): void {
  if (stream === null) return;
  const s = stream.bucket;
  if (
    endpointPlace(s) !== endpointPlace(archive) ||
    s.region !== archive.region ||
    s.bucket !== archive.bucket
  ) {
    return;
  }
  // Every venue's stream folder sits under one `venues/` folder (`venuePrefix`, @waitron/stream).
  const venues = normalisePrefix(s.prefix) + STREAM_VENUES;
  if (archive.namespace.startsWith(venues) || venues.startsWith(archive.namespace)) {
    throw new AppError("backup.archive_namespace_overlap", {});
  }
}

function customBucket(
  body: Record<string, unknown>,
  ctx: { venueId: string; held: ArchiveSettings | null },
): BucketConfig {
  if (!Object.keys(body).every((key) => CUSTOM_FIELDS.includes(key))) {
    throw requestInvalid("destination");
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
      d.venueId === ctx.venueId &&
      d.bucket.accessKeyId === bucket.accessKeyId &&
      sameBucketPlace(d.bucket, bucket),
  );
  if (held === undefined) throw requestInvalid("secretAccessKey");
  return { ...bucket, secretAccessKey: held.bucket.secretAccessKey };
}

/**
 * The one destination a dashboard Save asks for, resolved server-side. `stream-bucket` copies the
 * stream's settings as they are now, so a later stream edit or removal does not move archives.
 */
export function resolveArchiveChoice(
  destination: unknown,
  ctx: { venueId: string; stream: StreamSettings | null; held: ArchiveSettings | null },
): BackupDestination {
  if (!isRecord(destination)) throw requestInvalid("destination");
  switch (destination.kind) {
    case "local-fs": {
      if (!hasExactKeys(destination, ["kind", "dir"])) throw requestInvalid("destination");
      const { dir } = destination;
      // `resolve("")` is the working directory (CLAUDE.md §3).
      if (typeof dir !== "string" || dir.trim() === "" || CONTROL.test(dir)) {
        throw requestInvalid("dir");
      }
      return { kind: "local-fs", id: LOCAL_ID, dir: resolve(dir) };
    }
    case "stream-bucket": {
      if (!hasExactKeys(destination, ["kind"])) throw requestInvalid("destination");
      if (ctx.stream === null) throw new AppError("backup.stream_not_configured", {});
      const bucket = { ...ctx.stream.bucket };
      archiveNamespace(bucket.prefix, ctx.venueId);
      return { kind: "s3", id: BUCKET_ID, bucket, venueId: ctx.venueId };
    }
    case "custom-s3": {
      const bucket = customBucket(destination, ctx);
      refuseStreamOverlap(archivePlace(bucket, ctx.venueId), ctx.stream);
      return { kind: "s3", id: BUCKET_ID, bucket, venueId: ctx.venueId };
    }
    default:
      throw requestInvalid("destination");
  }
}
