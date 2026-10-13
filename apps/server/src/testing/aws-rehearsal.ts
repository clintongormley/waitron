import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  type CreateBucketCommandInput,
  DeleteBucketCommand,
  DeleteBucketPolicyCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  type DeleteObjectsCommandOutput,
  GetBucketEncryptionCommand,
  type GetBucketEncryptionCommandOutput,
  GetBucketVersioningCommand,
  type GetBucketVersioningCommandOutput,
  GetObjectCommand,
  type GetObjectCommandOutput,
  ListMultipartUploadsCommand,
  type ListMultipartUploadsCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { type BucketConfig, createBucketClient, LITESTREAM_VERSION } from "@waitron/stream";
import { isUnset } from "../env-value.js";
import {
  AWS_REHEARSAL_LIMITS,
  AWS_REHEARSAL_SCENARIO_DEADLINE_MS,
} from "./aws-rehearsal-limits.js";
import {
  AWS_REHEARSAL_PROFILE,
  type AwsReceiptOwnership,
  type AwsReceiptRemaining,
  cleanupCommandFor,
  createReceiptLog,
  isReceiptCleanupCommand,
  isReceiptRegion,
  isReceiptToken,
  isReceiptUploadId,
  receiptFileName,
  REHEARSAL_BUCKET_PATTERN,
  type TeardownEntry,
  writeReceipt,
} from "./aws-rehearsal-receipt.js";

export { AWS_REHEARSAL_PROFILE, cleanupCommandFor } from "./aws-rehearsal-receipt.js";

export {
  AWS_REHEARSAL_LIMITS,
  AWS_REHEARSAL_SCENARIO_DEADLINE_MS,
  AWS_REHEARSAL_SETUP_MARGIN_MS,
} from "./aws-rehearsal-limits.js";

export type AwsRehearsalRefusalReason =
  | "opt-in-missing"
  | "profile-mismatch"
  | "variable-unset"
  | "file-not-absolute"
  | "file-inside-repository"
  | "file-unreadable"
  | "profile-section-missing"
  | "credentials-missing"
  | "session-token-unsupported"
  | "provider-unsupported"
  | "region-mismatch"
  | "supplied-bucket"
  | "receipt-dir-unsupported"
  | "fixture-limit"
  | "label-refused"
  | "prefix-not-issued"
  | "encryption-not-sse-s3"
  | "versioning-not-off"
  | "upload-id-refused"
  | "child-pid-refused"
  | "teardown-started"
  | "receipt-refused"
  | "ownership-unproven"
  | "region-unsupported"
  | "run-id-unsupported";

/** Its message names a rule and a variable or key, never a value read from the environment or a file. */
export class AwsRehearsalRefused extends Error {
  constructor(
    readonly reason: AwsRehearsalRefusalReason,
    detail: string,
  ) {
    super(`AWS rehearsal refused (${reason}): ${detail}`);
    this.name = "AwsRehearsalRefused";
  }
}

export interface RehearsalProfile {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface RehearsalProfileDeps {
  readFile(path: string): Promise<string>;
}

type Env = Readonly<Record<string, string | undefined>>;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const UNSUPPORTED_PROVIDER_KEYS = [
  "role_arn",
  "credential_process",
  "sso_session",
  "sso_start_url",
];

export function assertRehearsalOptIn(env: Env): void {
  if (env.WAITRON_RUN_AWS_REHEARSAL !== "1") {
    throw new AwsRehearsalRefused(
      "opt-in-missing",
      'WAITRON_RUN_AWS_REHEARSAL must be exactly "1"',
    );
  }
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (isUnset(value)) throw new AwsRehearsalRefused("variable-unset", `${name} must be set`);
  return value;
}

function absolutePath(env: Env, name: string): string {
  const path = required(env, name);
  if (!isAbsolute(path)) {
    throw new AwsRehearsalRefused("file-not-absolute", `${name} must be an absolute path`);
  }
  return path;
}

/** Compares real paths, so a link outside the root that points inside it is refused. */
export async function assertOutsideDirectory(
  name: string,
  path: string,
  root: string,
): Promise<void> {
  let realFile: string;
  try {
    realFile = await realpath(path);
  } catch {
    throw new AwsRehearsalRefused("file-unreadable", `${name} must name an existing file`);
  }
  const fromRoot = relative(await realpath(root), realFile);
  const outside = fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
  if (!outside) {
    throw new AwsRehearsalRefused(
      "file-inside-repository",
      `${name} must be outside the repository`,
    );
  }
}

function parseIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[\s*(.+?)\s*\]$/.exec(line);
    if (header) {
      const name = header[1]!.replace(/\s+/g, " ");
      current = sections.get(name) ?? new Map<string, string>();
      sections.set(name, current);
      continue;
    }
    const equals = line.indexOf("=");
    if (current === undefined || equals < 0) continue;
    current.set(line.slice(0, equals).trim().toLowerCase(), line.slice(equals + 1).trim());
  }
  return sections;
}

function section(text: string, name: string, variable: string): Map<string, string> {
  const found = parseIni(text).get(name);
  if (found === undefined) {
    throw new AwsRehearsalRefused(
      "profile-section-missing",
      `${variable} has no [${name}] section`,
    );
  }
  for (const key of UNSUPPORTED_PROVIDER_KEYS) {
    if (found.has(key))
      throw new AwsRehearsalRefused(
        "provider-unsupported",
        `${key} in ${variable} is not supported`,
      );
  }
  if (found.has("aws_session_token")) {
    throw new AwsRehearsalRefused(
      "session-token-unsupported",
      `aws_session_token in ${variable}: temporary credentials are not supported`,
    );
  }
  return found;
}

export async function loadRehearsalProfile(
  env: Env,
  deps: RehearsalProfileDeps,
): Promise<RehearsalProfile> {
  assertRehearsalOptIn(env);
  if (env.AWS_PROFILE !== AWS_REHEARSAL_PROFILE) {
    throw new AwsRehearsalRefused(
      "profile-mismatch",
      `AWS_PROFILE must be ${AWS_REHEARSAL_PROFILE}`,
    );
  }
  const region = required(env, "AWS_REGION");
  const credentialsPath = absolutePath(env, "AWS_SHARED_CREDENTIALS_FILE");
  const configPath = absolutePath(env, "AWS_CONFIG_FILE");
  await assertOutsideDirectory("AWS_SHARED_CREDENTIALS_FILE", credentialsPath, REPOSITORY_ROOT);
  await assertOutsideDirectory("AWS_CONFIG_FILE", configPath, REPOSITORY_ROOT);

  const credentials = section(
    await deps.readFile(credentialsPath),
    AWS_REHEARSAL_PROFILE,
    "AWS_SHARED_CREDENTIALS_FILE",
  );
  const config = section(
    await deps.readFile(configPath),
    `profile ${AWS_REHEARSAL_PROFILE}`,
    "AWS_CONFIG_FILE",
  );

  const accessKeyId = credentials.get("aws_access_key_id");
  const secretAccessKey = credentials.get("aws_secret_access_key");
  for (const [key, value] of [
    ["aws_access_key_id", accessKeyId],
    ["aws_secret_access_key", secretAccessKey],
  ] as const) {
    if (isUnset(value)) throw new AwsRehearsalRefused("credentials-missing", `${key} must be set`);
  }
  if (config.get("region") !== region) {
    throw new AwsRehearsalRefused(
      "region-mismatch",
      "region in AWS_CONFIG_FILE must equal AWS_REGION",
    );
  }
  return { region, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! };
}

/** The ownership nonce, at the bucket root; deleted only just before the bucket itself. */
export const AWS_REHEARSAL_NONCE_KEY = ".waitron-rehearsal-owner";

/** A run that went wrong after the bucket was named; its message carries no SDK text or value. */
export class AwsRehearsalFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwsRehearsalFailed";
  }
}

/** The subset of `S3Client` the runner uses, so tests can drive a fake. */
export interface AdminClient {
  send(command: object, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
  destroy?(): void;
}

export interface AwsRehearsal {
  runId: string;
  bucket: string;
  region: string;
  signal: AbortSignal;
  prefix(label: string): string;
  bucketConfig(prefix: string): BucketConfig;
  reserveUpload(bytes: number, role: string): void;
  reserveObjects(count: number): void;
  trackChild(pid: number): void;
  trackUpload(key: string, uploadId: string): void;
  record(event: unknown): void;
}

export interface TeardownDeps {
  isAlive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<void>;
  now(): number;
  teardownMs: number;
  record?(event: unknown): void;
}

export interface AwsRehearsalDeps extends TeardownDeps, RehearsalProfileDeps {
  env: Env;
  createAdminClient(profile: RehearsalProfile): AdminClient;
  randomSuffix(): string;
  runId(): string;
  commit(): string;
  receiptDir: string;
  deadlineMs: number;
  print(line: string): void;
}

export interface TrackedUpload {
  key: string;
  uploadId: string;
}

export interface TeardownTarget {
  bucket: string;
  /** The run the bucket's ownership marker names; the marker is put back from it if needed. */
  runId: string;
  uploads: readonly TrackedUpload[];
  pids: readonly number[];
}

export interface TeardownResult {
  entries: TeardownEntry[];
  remaining: AwsReceiptRemaining;
}

const SOURCE_ONLY_APIS = [
  "GetBucketLocation",
  "HeadObject",
  "CreateMultipartUpload",
  "UploadPart",
  "CompleteMultipartUpload",
] as const;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RECEIPT_DIR = /^\/[A-Za-z0-9._/@-]{1,300}$/;
const CHILD_TERM_POLLS = 50;
const CHILD_POLL_MS = 100;
const MAX_LIST_PAGES = 10_000;
const DELETE_BATCH = 1000;

interface Outcome<T> {
  output?: T;
  error?: unknown;
}

function metadata(value: unknown): { httpStatus: number | null; attempts?: number } {
  const meta = (value as { $metadata?: { httpStatusCode?: unknown; attempts?: unknown } } | null)
    ?.$metadata;
  const status = meta?.httpStatusCode;
  const attempts = meta?.attempts;
  return {
    httpStatus: typeof status === "number" ? status : null,
    ...(typeof attempts === "number" && attempts >= 1 ? { attempts } : {}),
  };
}

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : "Unknown";
}

/** Sends one command and records it as a vetted event; never throws the SDK's error. */
async function call<T>(
  client: AdminClient,
  command: object & { input: object },
  api: string,
  phase: string,
  deps: Pick<TeardownDeps, "now" | "record">,
  extra: { objectRole?: string; count?: number; bytes?: number } = {},
  abortSignal?: AbortSignal,
): Promise<Outcome<T>> {
  const started = deps.now();
  let outcome: Outcome<T>;
  try {
    outcome = {
      output: (await client.send(command, abortSignal ? { abortSignal } : undefined)) as T,
    };
  } catch (error) {
    outcome = { error };
  }
  const meta = metadata(outcome.error ?? outcome.output);
  deps.record?.({
    scenario: "lifecycle",
    phase,
    api,
    ...extra,
    httpStatus: meta.httpStatus,
    ...(meta.attempts === undefined ? {} : { attempts: meta.attempts }),
    elapsedMs: Math.max(0, deps.now() - started),
    ...(outcome.error === undefined ? {} : { errorName: errorNameOf(outcome.error) }),
    outcome: outcome.error === undefined ? "ok" : "failed",
  });
  return outcome;
}

function failedEntry(step: TeardownEntry["step"], error: unknown, count?: number): TeardownEntry {
  const { httpStatus } = metadata(error);
  return {
    step,
    outcome: "failed",
    ...(count === undefined ? {} : { count }),
    errorName: errorNameOf(error),
    httpStatus,
  };
}

async function stopChildren(pids: readonly number[], deps: TeardownDeps): Promise<TeardownEntry> {
  const live = [...new Set(pids)].filter((pid) => deps.isAlive(pid));
  if (live.length === 0) return { step: "stop-child", outcome: "skipped", count: 0 };
  let stopped = 0;
  for (const pid of live) {
    try {
      deps.kill(pid, "SIGTERM");
      for (let poll = 0; poll < CHILD_TERM_POLLS && deps.isAlive(pid); poll += 1) {
        await deps.sleep(CHILD_POLL_MS);
      }
      if (deps.isAlive(pid)) deps.kill(pid, "SIGKILL");
    } catch {
      // A child that exits between the check and the signal is already stopped.
    }
    if (!deps.isAlive(pid)) stopped += 1;
  }
  return stopped === live.length
    ? { step: "stop-child", outcome: "ok", count: stopped }
    : { step: "stop-child", outcome: "failed", count: live.length - stopped };
}

async function abortUploads(
  client: AdminClient,
  bucket: string,
  tracked: readonly TrackedUpload[],
  deps: TeardownDeps,
  signal: AbortSignal,
): Promise<{ entry: TeardownEntry; left: string[] }> {
  const left = new Set<string>();
  const done = new Set<string>();
  let firstError: unknown;
  const abort = async ({ key, uploadId }: TrackedUpload): Promise<void> => {
    if (done.has(uploadId)) return;
    const result = await call(
      client,
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
      "AbortMultipartUpload",
      "teardown",
      deps,
      {},
      signal,
    );
    if (result.error === undefined || errorNameOf(result.error) === "NoSuchUpload") {
      done.add(uploadId);
      left.delete(uploadId);
    } else {
      firstError ??= result.error;
      left.add(uploadId);
    }
  };
  for (const upload of tracked) await abort(upload);

  const markers = new Set<string>();
  let keyMarker: string | undefined;
  let uploadIdMarker: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const listed = await call<ListMultipartUploadsCommandOutput>(
      client,
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
        ...(uploadIdMarker === undefined ? {} : { UploadIdMarker: uploadIdMarker }),
      }),
      "ListMultipartUploads",
      "teardown",
      deps,
      {},
      signal,
    );
    if (listed.error !== undefined) {
      firstError ??= listed.error;
      break;
    }
    for (const upload of listed.output?.Uploads ?? []) {
      if (upload.Key !== undefined && upload.UploadId !== undefined) {
        await abort({ key: upload.Key, uploadId: upload.UploadId });
      }
    }
    if (listed.output?.IsTruncated !== true) break;
    keyMarker = listed.output.NextKeyMarker;
    uploadIdMarker = listed.output.NextUploadIdMarker;
    const marker = `${keyMarker ?? ""}\u0000${uploadIdMarker ?? ""}`;
    if (markers.has(marker)) {
      firstError ??= new AwsRehearsalFailed("ListMultipartUploads repeated its marker");
      break;
    }
    markers.add(marker);
  }
  const entry =
    firstError === undefined
      ? ({ step: "abort-upload", outcome: "ok", count: done.size } as const)
      : failedEntry("abort-upload", firstError, done.size);
  return { entry, left: [...left] };
}

async function removePolicy(
  client: AdminClient,
  bucket: string,
  deps: TeardownDeps,
  signal: AbortSignal,
): Promise<TeardownEntry> {
  const result = await call(
    client,
    new DeleteBucketPolicyCommand({ Bucket: bucket }),
    "DeleteBucketPolicy",
    "teardown",
    deps,
    {},
    signal,
  );
  return result.error === undefined || errorNameOf(result.error) === "NoSuchBucketPolicy"
    ? { step: "remove-policy", outcome: "ok" }
    : failedEntry("remove-policy", result.error);
}

async function deleteObjects(
  client: AdminClient,
  bucket: string,
  deps: TeardownDeps,
  signal: AbortSignal,
): Promise<TeardownEntry> {
  const keys: string[] = [];
  const tokens = new Set<string>();
  let token: string | undefined;
  let failure: unknown;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const listed = await call<ListObjectsV2CommandOutput>(
      client,
      new ListObjectsV2Command({
        Bucket: bucket,
        ...(token === undefined ? {} : { ContinuationToken: token }),
      }),
      "ListObjectsV2",
      "teardown",
      deps,
      {},
      signal,
    );
    if (listed.error !== undefined) {
      failure = listed.error;
      break;
    }
    for (const object of listed.output?.Contents ?? []) {
      if (object.Key !== undefined && object.Key !== AWS_REHEARSAL_NONCE_KEY) keys.push(object.Key);
    }
    if (listed.output?.IsTruncated !== true) break;
    token = listed.output.NextContinuationToken;
    if (token === undefined || tokens.has(token)) {
      failure = new AwsRehearsalFailed("ListObjectsV2 repeated its continuation token");
      break;
    }
    tokens.add(token);
  }
  let deleted = 0;
  for (let start = 0; start < keys.length; start += DELETE_BATCH) {
    const batch = keys.slice(start, start + DELETE_BATCH);
    const result = await call<DeleteObjectsCommandOutput>(
      client,
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
      "DeleteObjects",
      "teardown",
      deps,
      { count: batch.length },
      signal,
    );
    const errors = result.output?.Errors ?? [];
    if (result.error !== undefined) {
      failure ??= result.error;
    } else if (errors.length > 0) {
      failure ??= Object.assign(new AwsRehearsalFailed("DeleteObjects refused keys"), {
        name: "DeleteObjectsKeyError",
        $metadata: result.output?.$metadata,
      });
      deleted += batch.length - errors.length;
    } else {
      deleted += batch.length;
    }
  }
  return failure === undefined
    ? { step: "delete-objects", outcome: "ok", count: deleted }
    : failedEntry("delete-objects", failure, deleted);
}

export function ownershipNonce(runId: string): string {
  return JSON.stringify({ runId });
}

async function deleteBucket(
  client: AdminClient,
  bucket: string,
  runId: string,
  objectsDeleted: boolean,
  deps: TeardownDeps,
  signal: AbortSignal,
): Promise<TeardownEntry> {
  // The nonce stays while any other object may remain: it is the proof the cleanup command reads.
  if (objectsDeleted) {
    const nonce = await call(
      client,
      new DeleteObjectCommand({ Bucket: bucket, Key: AWS_REHEARSAL_NONCE_KEY }),
      "DeleteObject",
      "teardown",
      deps,
      { objectRole: "ownership-nonce" },
      signal,
    );
    if (nonce.error !== undefined) return failedEntry("delete-bucket", nonce.error);
  }
  const result = await call(
    client,
    new DeleteBucketCommand({ Bucket: bucket }),
    "DeleteBucket",
    "teardown",
    deps,
    {},
    signal,
  );
  if (result.error === undefined || errorNameOf(result.error) === "NoSuchBucket") {
    return { step: "delete-bucket", outcome: "ok" };
  }
  if (objectsDeleted) {
    // The bucket outlived its marker; put the marker back so the cleanup command can prove ownership.
    const body = ownershipNonce(runId);
    await call(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: AWS_REHEARSAL_NONCE_KEY,
        Body: body,
        ContentType: "application/json",
      }),
      "PutObject",
      "restore-nonce",
      deps,
      { objectRole: "ownership-nonce", bytes: Buffer.byteLength(body) },
      signal,
    );
  }
  return failedEntry("delete-bucket", result.error);
}

/** Every command names `target.bucket`; every step runs even when an earlier one failed. */
export async function teardownOwnedBucket(
  client: AdminClient,
  target: TeardownTarget,
  deps: TeardownDeps,
): Promise<TeardownResult> {
  const { bucket } = target;
  const signal = AbortSignal.timeout(deps.teardownMs);
  const entries: TeardownEntry[] = [await stopChildren(target.pids, deps)];
  const aborted = await abortUploads(client, bucket, target.uploads, deps, signal);
  entries.push(aborted.entry);
  entries.push(await removePolicy(client, bucket, deps, signal));
  const objects = await deleteObjects(client, bucket, deps, signal);
  entries.push(objects);
  entries.push(
    await deleteBucket(client, bucket, target.runId, objects.outcome === "ok", deps, signal),
  );
  const clean = entries.every((entry) => entry.outcome !== "failed");
  return {
    entries,
    remaining: clean ? { bucket: null, uploadIds: [] } : { bucket, uploadIds: aborted.left },
  };
}

/**
 * Refuses, before any command, a run whose receipt or cleanup receipt could not carry a cleanup
 * command; the cleanup receipt's name is the longer of the two.
 */
function assertCleanupCommandFits(region: string, runId: string, receiptDir: string): void {
  if (!isReceiptRegion(region)) {
    throw new AwsRehearsalRefused(
      "region-unsupported",
      "AWS_REGION must look like eu-north-1 for the cleanup command to carry it",
    );
  }
  if (!isReceiptToken(runId) || !isReceiptToken(`${runId}-cleanup`)) {
    throw new AwsRehearsalRefused(
      "run-id-unsupported",
      "the run id must be a token of at most 56 characters for the cleanup receipt's name",
    );
  }
  for (const kind of ["run", "cleanup"] as const) {
    const path = join(receiptDir, receiptFileName(runId, kind));
    if (!isReceiptCleanupCommand(cleanupCommandFor(region, path))) {
      throw new AwsRehearsalRefused(
        "receipt-dir-unsupported",
        "the receipt folder's path cannot be named in a cleanup command of at most 512 characters",
      );
    }
  }
}

function randomBucketSuffix(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultDeps(env: Env): AwsRehearsalDeps {
  return {
    env,
    readFile: (path) => readFile(path, "utf8"),
    createAdminClient: (profile) =>
      createBucketClient({
        region: profile.region,
        bucket: "",
        prefix: "",
        accessKeyId: profile.accessKeyId,
        secretAccessKey: profile.secretAccessKey,
      }),
    randomSuffix: randomBucketSuffix,
    runId: randomUUID,
    now: Date.now,
    commit: gitCommit,
    receiptDir: isUnset(env.WAITRON_AWS_REHEARSAL_RECEIPT_DIR)
      ? join(tmpdir(), "waitron-aws-rehearsal")
      : env.WAITRON_AWS_REHEARSAL_RECEIPT_DIR,
    isAlive: processAlive,
    kill: (pid, signal) => process.kill(pid, signal),
    sleep: (ms) => delay(ms),
    deadlineMs: AWS_REHEARSAL_SCENARIO_DEADLINE_MS,
    teardownMs: AWS_REHEARSAL_LIMITS.teardownMs,
    print: (line) => process.stdout.write(`${line}\n`),
  };
}

function sdkVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("@aws-sdk/client-s3/package.json") as { version: string }).version;
}

type CreateOutcome = AwsReceiptOwnership;

function classifyCreate(bucket: string, error: unknown): CreateOutcome {
  if (error === undefined) return { state: "owned", bucket };
  const name = errorNameOf(error);
  const { httpStatus, attempts } = metadata(error);
  // On a retry, "already owned by you" may answer this run's own lost first attempt.
  if (name === "BucketAlreadyOwnedByYou" && attempts !== undefined && attempts > 1) {
    return { state: "unowned-candidate", bucket: null, candidate: bucket };
  }
  if (name === "BucketAlreadyExists" || name === "BucketAlreadyOwnedByYou") {
    return { state: "collision", bucket: null };
  }
  if (httpStatus !== null && httpStatus >= 400 && httpStatus < 500) {
    return { state: "not-created", bucket: null };
  }
  return { state: "unowned-candidate", bucket: null, candidate: bucket };
}

function createFailure(ownership: CreateOutcome, bucket: string): AwsRehearsalFailed {
  switch (ownership.state) {
    case "collision":
      return new AwsRehearsalFailed(
        `bucket name ${bucket} already exists; this run never owned it and deleted nothing`,
      );
    case "not-created":
      return new AwsRehearsalFailed(`AWS refused to create ${bucket}; nothing was deleted`);
    default:
      return new AwsRehearsalFailed(
        `creating ${bucket} gave no answer; check who owns it before deleting it`,
      );
  }
}

function nonNegativeInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AwsRehearsalRefused("fixture-limit", `${what} must be a non-negative integer`);
  }
}

async function preflight(
  client: AdminClient,
  bucket: string,
  deps: Pick<TeardownDeps, "now" | "record">,
): Promise<void> {
  const encryption = await call<GetBucketEncryptionCommandOutput>(
    client,
    new GetBucketEncryptionCommand({ Bucket: bucket }),
    "GetBucketEncryption",
    "preflight",
    deps,
  );
  const rules = encryption.output?.ServerSideEncryptionConfiguration?.Rules ?? [];
  const sseS3 =
    rules.length > 0 &&
    rules.every((rule) => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm === "AES256");
  if (encryption.error !== undefined || !sseS3) {
    throw new AwsRehearsalRefused(
      "encryption-not-sse-s3",
      "the new bucket's default encryption must be SSE-S3 (AES256) alone",
    );
  }
  const versioning = await call<GetBucketVersioningCommandOutput>(
    client,
    new GetBucketVersioningCommand({ Bucket: bucket }),
    "GetBucketVersioning",
    "preflight",
    deps,
  );
  if (versioning.error !== undefined || versioning.output?.Status !== undefined) {
    throw new AwsRehearsalRefused(
      "versioning-not-off",
      "the new bucket must never have had versioning enabled",
    );
  }
}

/**
 * Creates one bucket this run owns, runs `scenario` against it, and always tears that bucket down.
 * Credentials reach the scenario only inside `bucketConfig(...)`.
 */
export async function withAwsRehearsal<T>(
  scenario: (ctx: AwsRehearsal) => Promise<T>,
  overrides: Partial<AwsRehearsalDeps> = {},
): Promise<T> {
  const env = overrides.env ?? process.env;
  const deps: AwsRehearsalDeps = { ...defaultDeps(env), ...overrides };
  assertRehearsalOptIn(env);
  if (!isUnset(env.WAITRON_AWS_REHEARSAL_BUCKET)) {
    throw new AwsRehearsalRefused(
      "supplied-bucket",
      "WAITRON_AWS_REHEARSAL_BUCKET must be unset: the rehearsal only uses a bucket it creates",
    );
  }
  const receiptDir = resolve(deps.receiptDir);
  if (!RECEIPT_DIR.test(receiptDir)) {
    throw new AwsRehearsalRefused(
      "receipt-dir-unsupported",
      "the receipt folder's path may hold only letters, digits and . _ / @ -",
    );
  }
  const profile = await loadRehearsalProfile(env, deps);
  const client = deps.createAdminClient(profile);
  try {
    return await runOwned(scenario, deps, profile, client, receiptDir);
  } finally {
    client.destroy?.();
  }
}

/** Names only a refused field or an error code, never a value. */
function receiptFailureCause(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("receipt field refused: ")) {
    return error.message;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : errorNameOf(error);
}

async function runOwned<T>(
  scenario: (ctx: AwsRehearsal) => Promise<T>,
  deps: AwsRehearsalDeps,
  profile: RehearsalProfile,
  client: AdminClient,
  receiptDir: string,
): Promise<T> {
  const { region } = profile;
  const runId = deps.runId();
  const bucket = `waitron-rehearsal-waitron-${deps.randomSuffix()}`;
  if (!REHEARSAL_BUCKET_PATTERN.test(bucket)) {
    throw new AwsRehearsalFailed("the generated bucket name does not match the rehearsal pattern");
  }
  assertCleanupCommandFits(region, runId, receiptDir);
  const receiptPath = join(receiptDir, receiptFileName(runId));
  const log = createReceiptLog(
    {
      runId,
      commit: deps.commit(),
      node: process.version,
      sdkVersion: sdkVersion(),
      litestreamVersion: LITESTREAM_VERSION,
      region,
      startedAt: new Date(deps.now()).toISOString(),
      limits: { ...AWS_REHEARSAL_LIMITS, deadlineMs: deps.deadlineMs, teardownMs: deps.teardownMs },
    },
    profile,
  );
  const record = (event: unknown) => log.record(event);
  const callDeps = { now: deps.now, record };

  const created = await call(
    client,
    new CreateBucketCommand({
      Bucket: bucket,
      ...(region === "us-east-1"
        ? {}
        : { CreateBucketConfiguration: { LocationConstraint: region } }),
    } as CreateBucketCommandInput),
    "CreateBucket",
    "create",
    callDeps,
  );
  const ownership = classifyCreate(bucket, created.error);

  let failure: unknown;
  let result: T | undefined;
  let teardown: TeardownResult | undefined;
  const pids: number[] = [];
  const uploads: TrackedUpload[] = [];
  let tearingDown = false;
  const refuseOnceTearingDown = (): void => {
    if (tearingDown) {
      throw new AwsRehearsalRefused(
        "teardown-started",
        "teardown has started; nothing more is tracked",
      );
    }
  };
  const loweredKeys = [profile.accessKeyId, profile.secretAccessKey].map((key) =>
    key.toLowerCase(),
  );

  if (ownership.state !== "owned") {
    failure = createFailure(ownership, bucket);
  } else {
    let uploaded = 0;
    let objects = 0;
    const reserveUpload = (bytes: number, role: string): void => {
      nonNegativeInteger(bytes, "bytes");
      const overTotal = uploaded + bytes > AWS_REHEARSAL_LIMITS.uploadedBytes;
      const overArchive = role === "archive" && bytes > AWS_REHEARSAL_LIMITS.archiveBytes;
      if (overTotal || overArchive) {
        record({
          scenario: "lifecycle",
          phase: "fixture-limit",
          objectRole: role,
          bytes,
          outcome: "refused",
        });
        throw new AwsRehearsalRefused(
          "fixture-limit",
          overArchive ? "an archive fixture is over its byte limit" : "the upload budget is spent",
        );
      }
      uploaded += bytes;
    };
    try {
      const nonce = ownershipNonce(runId);
      const nonceBytes = Buffer.byteLength(nonce);
      reserveUpload(nonceBytes, "ownership-nonce");
      const put = await call(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: AWS_REHEARSAL_NONCE_KEY,
          Body: nonce,
          ContentType: "application/json",
        }),
        "PutObject",
        "ownership",
        callDeps,
        { objectRole: "ownership-nonce", bytes: nonceBytes },
      );
      if (put.error !== undefined) {
        throw new AwsRehearsalFailed(`writing the ownership nonce to ${bucket} failed`);
      }
      await preflight(client, bucket, callDeps);

      const issued = new Set<string>();
      const labels = new Set<string>();
      const controller = new AbortController();
      const ctx: AwsRehearsal = {
        runId,
        bucket,
        region,
        signal: controller.signal,
        prefix(label) {
          if (!LABEL.test(label) || labels.has(label)) {
            throw new AwsRehearsalRefused("label-refused", "a prefix label is new and a token");
          }
          labels.add(label);
          const prefix = `rehearsal-${runId}/${label}/`;
          issued.add(prefix);
          return prefix;
        },
        bucketConfig(prefix) {
          if (!issued.has(prefix)) {
            throw new AwsRehearsalRefused("prefix-not-issued", "use a prefix from prefix(label)");
          }
          return {
            region,
            bucket,
            prefix,
            accessKeyId: profile.accessKeyId,
            secretAccessKey: profile.secretAccessKey,
          };
        },
        reserveUpload,
        reserveObjects(count) {
          nonNegativeInteger(count, "count");
          if (objects + count > AWS_REHEARSAL_LIMITS.deleteObjects) {
            record({
              scenario: "lifecycle",
              phase: "fixture-limit",
              count,
              outcome: "refused",
            });
            throw new AwsRehearsalRefused("fixture-limit", "the object budget is spent");
          }
          objects += count;
        },
        trackChild(pid) {
          refuseOnceTearingDown();
          if (!Number.isSafeInteger(pid) || pid <= 0) {
            throw new AwsRehearsalRefused("child-pid-refused", "a child pid is a positive integer");
          }
          pids.push(pid);
        },
        trackUpload(key, uploadId) {
          refuseOnceTearingDown();
          const lowered = typeof uploadId === "string" ? uploadId.toLowerCase() : "";
          if (!isReceiptUploadId(uploadId) || loweredKeys.some((k) => lowered.includes(k))) {
            throw new AwsRehearsalRefused(
              "upload-id-refused",
              "an upload id the receipt could not carry is not tracked",
            );
          }
          uploads.push({ key, uploadId });
        },
        record,
      };
      const started = deps.now();
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          record({
            scenario: "lifecycle",
            phase: "deadline",
            elapsedMs: Math.max(0, deps.now() - started),
            outcome: "failed",
          });
          reject(
            new AwsRehearsalFailed(`the scenario passed its deadline of ${deps.deadlineMs} ms`),
          );
        }, deps.deadlineMs);
      });
      const running = scenario(ctx);
      // A scenario that rejects after the deadline won the race must not surface as unhandled.
      running.catch(() => {});
      try {
        result = await Promise.race([running, deadline]);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    } catch (error) {
      failure = error;
    }
    tearingDown = true;
    teardown = await teardownOwnedBucket(
      client,
      { bucket, runId, uploads, pids },
      { ...deps, record },
    );
    for (const entry of teardown.entries) log.teardown(entry);
  }

  const remaining = teardown?.remaining ?? { bucket: null, uploadIds: [] };
  const failedSteps = (teardown?.entries ?? [])
    .filter((entry) => entry.outcome === "failed")
    .map((entry) => entry.step);
  let receiptFailure: AwsRehearsalFailed | undefined;
  try {
    const receipt = log.finish({
      finishedAt: new Date(deps.now()).toISOString(),
      ownership,
      remaining,
      cleanupCommand: remaining.bucket === null ? null : cleanupCommandFor(region, receiptPath),
      sourceOnly: SOURCE_ONLY_APIS,
    });
    await writeReceipt(receiptDir, receipt, profile);
  } catch (error) {
    receiptFailure = new AwsRehearsalFailed(
      `the receipt was not written (${receiptFailureCause(error)})`,
    );
  }
  let printFailure: unknown;
  if (receiptFailure === undefined) {
    try {
      deps.print(receiptPath);
    } catch (error) {
      printFailure = error;
    }
  }

  const teardownFailure =
    failedSteps.length === 0
      ? undefined
      : new AwsRehearsalFailed(
          `teardown failed at ${failedSteps.join(", ")}` +
            (receiptFailure === undefined ? `; receipt: ${receiptPath}` : ""),
        );
  if (receiptFailure !== undefined) {
    const left =
      remaining.bucket ??
      (ownership.state === "unowned-candidate"
        ? `${ownership.candidate} (ownership unknown)`
        : "none");
    throw new AggregateError(
      [failure, teardownFailure, receiptFailure].filter((error) => error !== undefined),
      `the rehearsal's receipt was not written; bucket left: ${left}; ` +
        `failed teardown steps: ${failedSteps.length === 0 ? "none" : failedSteps.join(", ")}`,
    );
  }
  if (printFailure !== undefined) {
    const errors = [failure, teardownFailure, printFailure].filter((error) => error !== undefined);
    if (errors.length === 1) throw printFailure;
    throw new AggregateError(errors, `the rehearsal failed; receipt: ${receiptPath}`);
  }
  if (failure !== undefined) {
    if (teardownFailure !== undefined) {
      throw new AggregateError(
        [failure, teardownFailure],
        `the rehearsal failed and so did its teardown; receipt: ${receiptPath}`,
      );
    }
    throw failure;
  }
  if (teardownFailure !== undefined) throw teardownFailure;
  return result as T;
}

export interface CleanupResult {
  ok: boolean;
  /** The cleanup's own receipt, or null when nothing was sent that needed one. */
  receiptPath: string | null;
}

interface LeftReceipt {
  runId: string;
  region: string;
  ownership: { state: string; bucket: unknown; candidate?: unknown };
  bucket: string | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function receiptRefused(detail: string): AwsRehearsalRefused {
  return new AwsRehearsalRefused("receipt-refused", detail);
}

/** Its refusals name a field, never a value read from the receipt. */
function readLeftReceipt(text: string): LeftReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw receiptRefused("the receipt is not JSON");
  }
  if (!isPlainObject(parsed)) throw receiptRefused("the receipt is not an object");
  const { header, ownership, remaining } = parsed;
  if (!isPlainObject(header) || !isReceiptToken(header.runId)) {
    throw receiptRefused("header.runId must be a token");
  }
  if (!isReceiptToken(header.region)) throw receiptRefused("header.region must be a token");
  if (!isPlainObject(ownership) || typeof ownership.state !== "string") {
    throw receiptRefused("ownership.state is missing");
  }
  if (!isPlainObject(remaining)) throw receiptRefused("remaining is missing");
  const bucket = remaining.bucket;
  if (bucket !== null && (typeof bucket !== "string" || !REHEARSAL_BUCKET_PATTERN.test(bucket))) {
    throw receiptRefused("remaining.bucket is not a rehearsal bucket");
  }
  if (!Array.isArray(remaining.uploadIds) || !remaining.uploadIds.every(isReceiptUploadId)) {
    throw receiptRefused("remaining.uploadIds is not a list of upload ids");
  }
  return {
    runId: header.runId,
    region: header.region,
    ownership: { state: ownership.state, bucket: ownership.bucket, candidate: ownership.candidate },
    bucket,
  };
}

function rehearsalBucket(value: unknown): value is string {
  return typeof value === "string" && REHEARSAL_BUCKET_PATTERN.test(value);
}

/** Refuses unless the receipt says this runner owned the bucket it still names. */
function ownedBucketOf(left: LeftReceipt): string | null {
  const { state, bucket, candidate } = left.ownership;
  if (state === "unowned-candidate") {
    if (!rehearsalBucket(candidate)) throw receiptRefused("ownership.candidate is not a bucket");
    throw new AwsRehearsalRefused(
      "ownership-unproven",
      `the run never proved it owned ${candidate}; a person must check who owns it before deleting it`,
    );
  }
  if (state === "collision" || state === "not-created") {
    throw new AwsRehearsalRefused(
      "ownership-unproven",
      `the receipt records ${state}: the run never owned a bucket, so there is nothing to delete`,
    );
  }
  if (state !== "owned" || !rehearsalBucket(bucket)) {
    throw receiptRefused("ownership is not an owned rehearsal bucket");
  }
  if (left.bucket !== null && left.bucket !== bucket) {
    throw receiptRefused("remaining.bucket is not the bucket the run owned");
  }
  return left.bucket;
}

function namesRun(text: string, runId: string): boolean {
  try {
    const marker: unknown = JSON.parse(text);
    return isPlainObject(marker) && Object.keys(marker).length === 1 && marker.runId === runId;
  } catch {
    return false;
  }
}

/**
 * Removes the bucket a rehearsal's receipt still names, once that bucket's ownership marker names the
 * receipt's run. Never signals a process. Writes `aws-rehearsal-<runId>-cleanup.json` beside the
 * receipt and prints only its path.
 */
export async function cleanupFromReceipt(
  receiptPath: string,
  overrides: Partial<AwsRehearsalDeps> = {},
): Promise<CleanupResult> {
  const env = overrides.env ?? process.env;
  const deps: AwsRehearsalDeps = { ...defaultDeps(env), ...overrides };
  assertRehearsalOptIn(env);
  const profile = await loadRehearsalProfile(env, deps);
  const path = resolve(receiptPath);
  let text: string;
  try {
    text = await deps.readFile(path);
  } catch {
    throw receiptRefused("the receipt could not be read");
  }
  const left = readLeftReceipt(text);
  if (left.region !== profile.region) {
    throw new AwsRehearsalRefused("region-mismatch", "the receipt's region must equal AWS_REGION");
  }
  const bucket = ownedBucketOf(left);
  if (bucket === null) {
    deps.print("the receipt names no bucket left behind; nothing to do");
    return { ok: true, receiptPath: null };
  }
  const { runId, region } = left;
  assertCleanupCommandFits(region, runId, dirname(path));
  const cleanupPath = join(dirname(path), receiptFileName(runId, "cleanup"));

  const client = deps.createAdminClient(profile);
  try {
    const log = createReceiptLog(
      {
        runId,
        commit: deps.commit(),
        node: process.version,
        sdkVersion: sdkVersion(),
        litestreamVersion: LITESTREAM_VERSION,
        region,
        startedAt: new Date(deps.now()).toISOString(),
        limits: { teardownMs: deps.teardownMs },
      },
      profile,
    );
    const record = (event: unknown) => log.record(event);
    const marker = await call<GetObjectCommandOutput>(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: AWS_REHEARSAL_NONCE_KEY }),
      "GetObject",
      "ownership",
      { now: deps.now, record },
      { objectRole: "ownership-nonce" },
      AbortSignal.timeout(deps.teardownMs),
    );
    if (marker.error !== undefined && errorNameOf(marker.error) === "NoSuchBucket") {
      deps.print("bucket not found; nothing deleted");
      return { ok: true, receiptPath: null };
    }
    let markerText: string | undefined;
    try {
      markerText = await marker.output?.Body?.transformToString();
    } catch {
      markerText = undefined;
    }
    if (markerText === undefined || !namesRun(markerText, runId)) {
      throw new AwsRehearsalRefused(
        "ownership-unproven",
        `${bucket}'s ownership marker is missing, unreadable or names another run; nothing deleted — ` +
          "a person must check who owns it before deleting it",
      );
    }

    const teardown = await teardownOwnedBucket(
      client,
      { bucket, runId, uploads: [], pids: [] },
      { ...deps, record },
    );
    for (const entry of teardown.entries) log.teardown(entry);
    const receipt = log.finish({
      finishedAt: new Date(deps.now()).toISOString(),
      ownership: { state: "owned", bucket },
      remaining: teardown.remaining,
      cleanupCommand:
        teardown.remaining.bucket === null ? null : cleanupCommandFor(region, cleanupPath),
    });
    let written: string;
    try {
      written = await writeReceipt(dirname(path), receipt, profile, "cleanup");
    } catch (error) {
      const failed = teardown.entries.filter((entry) => entry.outcome === "failed");
      throw new AwsRehearsalFailed(
        `cleanup receipt not written (${receiptFailureCause(error)}); ` +
          `bucket left: ${teardown.remaining.bucket ?? "none"}; failed teardown steps: ` +
          (failed.length === 0 ? "none" : failed.map((entry) => entry.step).join(", ")),
      );
    }
    deps.print(written);
    return { ok: teardown.remaining.bucket === null, receiptPath: written };
  } finally {
    client.destroy?.();
  }
}
