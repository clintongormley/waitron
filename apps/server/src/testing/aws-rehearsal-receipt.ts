import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface AwsReceiptEvent {
  scenario: string;
  phase: string;
  api?: string;
  objectRole?: string;
  count?: number;
  bytes?: number;
  httpStatus?: number | null;
  errorName?: string;
  attempts?: number;
  elapsedMs?: number;
  outcome: "ok" | "failed" | "refused" | "skipped";
}

export interface TeardownEntry {
  step:
    | "stop-child"
    | "abort-upload"
    | "remove-policy"
    | "delete-objects"
    | "delete-bucket"
    | "inventory"
    | "remove-scratch";
  outcome: "ok" | "failed" | "skipped";
  count?: number;
  errorName?: string;
  httpStatus?: number | null;
}

export type ActionStatus = "observed" | "source-only" | "not-exercised";

export interface ActionRow {
  api: string;
  status: ActionStatus;
}

export interface AwsReceiptHeader {
  runId: string;
  commit: string;
  node: string;
  sdkVersion: string;
  litestreamVersion: string;
  region: string;
  startedAt: string;
  finishedAt: string;
  limits: Record<string, number>;
}

export type AwsReceiptOwnership =
  | { state: "owned"; bucket: string; candidate?: undefined }
  | { state: "unowned-candidate"; bucket: null; candidate: string }
  | { state: "not-created" | "collision"; bucket: null; candidate?: undefined };

export interface AwsReceiptRemaining {
  bucket: string | null;
  uploadIds: string[];
}

export interface AwsReceipt {
  header: AwsReceiptHeader;
  ownership: AwsReceiptOwnership;
  events: AwsReceiptEvent[];
  teardown: TeardownEntry[];
  actions: ActionRow[];
  remaining: AwsReceiptRemaining;
  cleanupCommand: string | null;
}

export interface ReceiptFinishParts {
  finishedAt: string;
  ownership: AwsReceiptOwnership;
  remaining: AwsReceiptRemaining;
  cleanupCommand: string | null;
  sourceOnly?: readonly string[];
}

export interface ReceiptLog {
  record(event: unknown): void;
  teardown(entry: TeardownEntry): void;
  finish(parts: ReceiptFinishParts): AwsReceipt;
}

export const RECEIPT_APIS = [
  "GetObject",
  "PutObject",
  "ListObjectsV2",
  "DeleteObject",
  "DeleteObjects",
  "HeadObject",
  "GetBucketLocation",
  "CreateMultipartUpload",
  "UploadPart",
  "CompleteMultipartUpload",
  "AbortMultipartUpload",
  "CreateBucket",
  "DeleteBucket",
  "GetBucketPolicy",
  "PutBucketPolicy",
  "DeleteBucketPolicy",
  "ListMultipartUploads",
  "GetBucketEncryption",
  "GetBucketVersioning",
] as const;

export const REHEARSAL_BUCKET_PATTERN = /^waitron-rehearsal-waitron-[a-z0-9]{12}$/;

const TOKEN = /^[A-Za-z0-9._:-]{1,64}$/;
// An access key id fits the token alphabet, so it is refused by shape as well.
const ACCESS_KEY_ID = /(?:AKIA|ASIA|AIDA|AROA)[A-Z0-9]{12,}/;
const ERROR_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;
// AWS calls an upload id opaque: printable ASCII without whitespace, `"` or `\`; never a URL.
const UPLOAD_ID = /^[!#-[\]-~]{1,1024}$/;
export const AWS_REHEARSAL_PROFILE = "waitron-rehearsal";
const REGION = "[a-z]{2}(?:-[a-z]+)+-[0-9]{1,2}";
const REGION_ONLY = new RegExp(`^${REGION}$`);
const CLEANUP_COMMAND_HEAD =
  'WAITRON_RUN_AWS_REHEARSAL=1 AWS_SHARED_CREDENTIALS_FILE="$HOME/.config/waitron-cloud/aws/credentials" ' +
  `AWS_CONFIG_FILE="$HOME/.config/waitron-cloud/aws/config" AWS_PROFILE=${AWS_REHEARSAL_PROFILE} AWS_REGION=`;
const CLEANUP_COMMAND_SCRIPT =
  " pnpm --filter @waitron/server exec tsx scripts/aws-rehearsal-cleanup.ts --receipt ";
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const CLEANUP_COMMAND = new RegExp(
  `^${escapeRegExp(CLEANUP_COMMAND_HEAD)}${REGION}` +
    `${escapeRegExp(CLEANUP_COMMAND_SCRIPT)}/(?:[A-Za-z0-9._@-]+/){0,40}aws-rehearsal-[A-Za-z0-9._:-]{1,64}\\.json$`,
);
export const CLEANUP_COMMAND_MAX = 512;
const EVENT_OUTCOMES = ["ok", "failed", "refused", "skipped"] as const;
const TEARDOWN_OUTCOMES = ["ok", "failed", "skipped"] as const;
const TEARDOWN_STEPS = [
  "stop-child",
  "abort-upload",
  "remove-policy",
  "delete-objects",
  "delete-bucket",
  "inventory",
  "remove-scratch",
] as const;
const OWNED_TEARDOWN_STEPS = {
  run: TEARDOWN_STEPS.filter((step) => step !== "inventory"),
  // A cleanup runs later, from another process, and never removes the run's scratch.
  cleanup: TEARDOWN_STEPS.filter((step) => step !== "inventory" && step !== "remove-scratch"),
} as const;
const OWNERSHIP_STATES = ["owned", "not-created", "collision", "unowned-candidate"] as const;

/** The receipt's shape rule for an upload id; the key-pair check is separate. */
export function isReceiptUploadId(id: unknown): id is string {
  return typeof id === "string" && UPLOAD_ID.test(id) && !id.includes("://");
}

/** A region the cleanup command may carry. */
export function isReceiptRegion(region: unknown): region is string {
  return typeof region === "string" && REGION_ONLY.test(region);
}

export function isReceiptToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value) && !ACCESS_KEY_ID.test(value);
}

/** The receipt's shape rule for a cleanup command; the key-pair check is separate. */
export function isReceiptCleanupCommand(command: unknown): command is string {
  return (
    typeof command === "string" &&
    command.length <= CLEANUP_COMMAND_MAX &&
    CLEANUP_COMMAND.test(command)
  );
}

/** The one command a receipt may carry: the cleanup script for that receipt, under the rehearsal profile. */
export function cleanupCommandFor(region: string, receiptPath: string): string {
  return `${CLEANUP_COMMAND_HEAD}${region}${CLEANUP_COMMAND_SCRIPT}${receiptPath}`;
}

function refused(key: string): Error {
  return new Error(`receipt field refused: ${key}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Error)
  );
}

function token(value: unknown, key: string): string {
  if (!isReceiptToken(value)) throw refused(key);
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value))
    throw refused(key);
  return value as T;
}

function integer(value: unknown, min: number, key: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) throw refused(key);
  return value;
}

function httpStatus(value: unknown, key: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599)
    throw refused(key);
  return value;
}

function errorName(value: unknown, key: string): string {
  if (typeof value !== "string") throw refused(key);
  return ERROR_NAME.test(value) && !ACCESS_KEY_ID.test(value) ? value : "Unlisted";
}

/** An error name as the receipt would carry it: a listed shape, else "Unlisted". */
export function receiptErrorName(name: string): string {
  return errorName(name, "errorName");
}

function bucketName(value: unknown, key: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !REHEARSAL_BUCKET_PATTERN.test(value)) throw refused(key);
  return value;
}

export interface ReceiptKeyPair {
  accessKeyId: string;
  secretAccessKey: string;
}

/** Lower-cased, so a containment test also catches a case-changed copy. */
type Forbidden = readonly string[];

function forbiddenFrom(keys: ReceiptKeyPair): Forbidden {
  const values = [keys.accessKeyId, keys.secretAccessKey];
  if (!values.every((value) => typeof value === "string" && value.length > 0)) {
    throw refused("keys");
  }
  return values.map((value) => value.toLowerCase());
}

function carriesKey(value: unknown, forbidden: Forbidden): boolean {
  if (typeof value !== "string") return false;
  const lower = value.toLowerCase();
  return forbidden.some((secret) => lower.includes(secret));
}

/** Whether `value` contains either key, in any case. */
export function carriesKeyPair(value: unknown, keys: ReceiptKeyPair): boolean {
  return carriesKey(value, forbiddenFrom(keys));
}

/** Checks every string, or string in an array, directly under `input` — before any shape rule. */
function refuseKeyPair(input: Record<string, unknown>, forbidden: Forbidden, prefix = ""): void {
  for (const [key, value] of Object.entries(input)) {
    const strings = Array.isArray(value) ? value : [key, value];
    if (strings.some((item) => carriesKey(item, forbidden))) throw refused(`${prefix}${key}`);
  }
}

function onlyKeys(input: Record<string, unknown>, allowed: readonly string[], prefix = ""): void {
  for (const key of Object.keys(input))
    if (!allowed.includes(key)) throw refused(`${prefix}${key}`);
}

const EVENT_KEYS = [
  "scenario",
  "phase",
  "api",
  "objectRole",
  "count",
  "bytes",
  "httpStatus",
  "errorName",
  "attempts",
  "elapsedMs",
  "outcome",
] as const;

export function sanitizeEvent(input: unknown, forbidden: Forbidden = []): AwsReceiptEvent {
  if (!isRecord(input)) throw refused("event");
  onlyKeys(input, EVENT_KEYS);
  refuseKeyPair(input, forbidden);
  const event: AwsReceiptEvent = {
    scenario: token(input.scenario, "scenario"),
    phase: token(input.phase, "phase"),
    outcome: oneOf(input.outcome, EVENT_OUTCOMES, "outcome"),
  };
  if (input.api !== undefined) event.api = oneOf(input.api, RECEIPT_APIS, "api");
  if (input.objectRole !== undefined) event.objectRole = token(input.objectRole, "objectRole");
  if (input.count !== undefined) event.count = integer(input.count, 0, "count");
  if (input.bytes !== undefined) event.bytes = integer(input.bytes, 0, "bytes");
  if (input.httpStatus !== undefined) event.httpStatus = httpStatus(input.httpStatus, "httpStatus");
  if (input.errorName !== undefined) event.errorName = errorName(input.errorName, "errorName");
  if (input.attempts !== undefined) event.attempts = integer(input.attempts, 1, "attempts");
  if (input.elapsedMs !== undefined) {
    const value = input.elapsedMs;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw refused("elapsedMs");
    event.elapsedMs = value;
  }
  return event;
}

function sanitizeTeardown(input: unknown, forbidden: Forbidden): TeardownEntry {
  if (!isRecord(input)) throw refused("teardown");
  onlyKeys(input, ["step", "outcome", "count", "errorName", "httpStatus"]);
  refuseKeyPair(input, forbidden);
  const entry: TeardownEntry = {
    step: oneOf(input.step, TEARDOWN_STEPS, "step"),
    outcome: oneOf(input.outcome, TEARDOWN_OUTCOMES, "outcome"),
  };
  if (input.count !== undefined) entry.count = integer(input.count, 0, "count");
  if (input.errorName !== undefined) entry.errorName = errorName(input.errorName, "errorName");
  if (input.httpStatus !== undefined) entry.httpStatus = httpStatus(input.httpStatus, "httpStatus");
  return entry;
}

function sanitizeHeader(
  input: Omit<AwsReceiptHeader, "finishedAt">,
  forbidden: Forbidden,
): Omit<AwsReceiptHeader, "finishedAt"> {
  if (!isRecord(input)) throw refused("header");
  const keys = [
    "runId",
    "commit",
    "node",
    "sdkVersion",
    "litestreamVersion",
    "region",
    "startedAt",
  ] as const;
  onlyKeys(input, [...keys, "limits"], "header.");
  refuseKeyPair(input, forbidden, "header.");
  const limits = input.limits;
  if (!isRecord(limits)) throw refused("header.limits");
  if (Object.keys(limits).some((name) => carriesKey(name, forbidden)))
    throw refused("header.limits");
  const cleanLimits: Record<string, number> = {};
  for (const [name, value] of Object.entries(limits)) {
    if (!TOKEN.test(name) || typeof value !== "number" || !Number.isFinite(value))
      throw refused("header.limits");
    cleanLimits[name] = value;
  }
  const header = { limits: cleanLimits } as Omit<AwsReceiptHeader, "finishedAt">;
  for (const key of keys) header[key] = token(input[key], `header.${key}`);
  return header;
}

function sanitizeOwnership(input: unknown, forbidden: Forbidden): AwsReceiptOwnership {
  if (!isRecord(input)) throw refused("ownership");
  onlyKeys(input, ["bucket", "state", "candidate"], "ownership.");
  refuseKeyPair(input, forbidden, "ownership.");
  const bucket = bucketName(input.bucket, "ownership.bucket");
  const state = oneOf(input.state, OWNERSHIP_STATES, "ownership.state");
  const candidate =
    input.candidate === undefined
      ? undefined
      : (bucketName(input.candidate, "ownership.candidate") ?? undefined);
  if (input.candidate !== undefined && candidate === undefined)
    throw refused("ownership.candidate");
  if (state === "owned") {
    if (bucket === null) throw refused("ownership.bucket");
    if (candidate !== undefined) throw refused("ownership.candidate");
    return { state, bucket };
  }
  if (bucket !== null) throw refused("ownership.bucket");
  if (state === "unowned-candidate") {
    if (candidate === undefined) throw refused("ownership.candidate");
    return { state, bucket, candidate };
  }
  if (candidate !== undefined) throw refused("ownership.candidate");
  return { state, bucket };
}

function sanitizeRemaining(input: unknown, forbidden: Forbidden): AwsReceiptRemaining {
  if (!isRecord(input)) throw refused("remaining");
  onlyKeys(input, ["bucket", "uploadIds"], "remaining.");
  refuseKeyPair(input, forbidden, "remaining.");
  const uploadIds = input.uploadIds;
  if (!Array.isArray(uploadIds) || !uploadIds.every(isReceiptUploadId)) {
    throw refused("remaining.uploadIds");
  }
  return {
    bucket: bucketName(input.bucket, "remaining.bucket"),
    uploadIds: [...(uploadIds as string[])],
  };
}

export function actionTable(
  events: readonly AwsReceiptEvent[],
  sourceOnly: readonly string[],
): ActionRow[] {
  for (const api of sourceOnly) {
    if (!(RECEIPT_APIS as readonly string[]).includes(api)) throw refused("sourceOnly");
  }
  const answered = new Set(
    events.filter((event) => typeof event.httpStatus === "number").map((event) => event.api),
  );
  return RECEIPT_APIS.map((api) => ({
    api,
    status: answered.has(api)
      ? "observed"
      : sourceOnly.includes(api)
        ? "source-only"
        : "not-exercised",
  }));
}

/** `keys` are the loaded credentials, held only to refuse any field that contains either value. */
export function createReceiptLog(
  header: Omit<AwsReceiptHeader, "finishedAt">,
  keys: ReceiptKeyPair,
  kind: "run" | "cleanup" = "run",
): ReceiptLog {
  const forbidden = forbiddenFrom(keys);
  const cleanHeader = sanitizeHeader(header, forbidden);
  const events: AwsReceiptEvent[] = [];
  const teardown: TeardownEntry[] = [];
  return {
    record(event) {
      events.push(sanitizeEvent(event, forbidden));
    },
    teardown(entry) {
      teardown.push(sanitizeTeardown(entry, forbidden));
    },
    finish(parts) {
      if (carriesKey(parts.finishedAt, forbidden)) throw refused("header.finishedAt");
      const cleanupCommand = parts.cleanupCommand;
      if (carriesKey(cleanupCommand, forbidden)) throw refused("cleanupCommand");
      if (cleanupCommand !== null && !isReceiptCleanupCommand(cleanupCommand)) {
        throw refused("cleanupCommand");
      }
      const finishedAt = token(parts.finishedAt, "header.finishedAt");
      const ownership = sanitizeOwnership(parts.ownership, forbidden);
      const actions = actionTable(events, parts.sourceOnly ?? []);
      const remaining = sanitizeRemaining(parts.remaining, forbidden);
      if (
        ownership.state === "owned" &&
        !OWNED_TEARDOWN_STEPS[kind].every((step) => teardown.some((entry) => entry.step === step))
      ) {
        throw refused("teardown");
      }
      return {
        header: { ...cleanHeader, finishedAt },
        ownership,
        events: [...events],
        teardown: [...teardown],
        actions,
        remaining,
        cleanupCommand,
      };
    },
  };
}

/** The file name a run's receipt, a cleanup's or a keeper's after an interrupt, takes in its folder. */
export function receiptFileName(
  runId: string,
  kind: "run" | "cleanup" | "interrupted" = "run",
): string {
  return `aws-rehearsal-${token(runId, "header.runId")}${kind === "run" ? "" : `-${kind}`}.json`;
}

export async function writeReceipt(
  dir: string,
  receipt: AwsReceipt,
  keys: ReceiptKeyPair,
  kind: "run" | "cleanup" = "run",
): Promise<string> {
  const text = `${JSON.stringify(receipt, null, 2)}\n`;
  if (carriesKeyPair(text, keys)) throw refused("receipt");
  const path = join(dir, receiptFileName(receipt.header.runId, kind));
  await mkdir(dir, { recursive: true });
  await writeFile(path, text);
  return path;
}
