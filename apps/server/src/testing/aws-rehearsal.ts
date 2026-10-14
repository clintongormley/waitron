import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { access, mkdir, readFile, realpath, rm } from "node:fs/promises";
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
  type ListMultipartUploadsCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  type BucketConfig,
  createBucketClient,
  LITESTREAM_VERSION,
  nameOf,
  statusOf,
} from "@waitron/stream";
import { isUnset } from "../env-value.js";
import {
  AWS_REHEARSAL_LIMITS,
  AWS_REHEARSAL_SCENARIO_DEADLINE_MS,
  AWS_REHEARSAL_SETTLE_MS,
  AWS_REHEARSAL_STOP_WAIT_MS,
} from "./aws-rehearsal-limits.js";
import {
  AWS_REHEARSAL_PROFILE,
  type AwsReceiptHeader,
  type AwsReceiptOwnership,
  type AwsReceiptRemaining,
  carriesKeyPair,
  CLEANUP_COMMAND_MAX,
  cleanupCommandFor,
  createReceiptLog,
  isReceiptCleanupCommand,
  isReceiptRegion,
  isReceiptToken,
  isReceiptUploadId,
  receiptErrorName,
  RECEIPT_APIS,
  receiptFileName,
  REHEARSAL_BUCKET_PATTERN,
  type ReceiptLog,
  type TeardownEntry,
  writeReceipt,
} from "./aws-rehearsal-receipt.js";
import { fixtureBudget } from "./fixture-budget.js";
import { listPages, listUploads, type Outcome, type TrackedUpload } from "./s3-listing.js";
import { settleWithin } from "./settle-within.js";
import { AwsRehearsalRefused } from "./aws-rehearsal-refused.js";
import {
  isJournalUploadKey,
  journalFileName,
  type JournalPid,
  type JournalState,
  processStartTime,
  type RehearsalJournal,
  writeJournal,
} from "./aws-rehearsal-journal.js";
import { type KeeperHandle, keeperEnv, startKeeper } from "./aws-rehearsal-keeper-start.js";
import { AWS_REHEARSAL_NONCE_KEY, createRequestPlan } from "./aws-request-plan.js";
import {
  currentRequestScope,
  installSendGate,
  markRunnerClient,
  openRequestScope,
  type RequestScope,
} from "./aws-send-gate.js";

export { AwsRehearsalRefused, type AwsRehearsalRefusalReason } from "./aws-rehearsal-refused.js";
export { type KeeperHandle, keeperEnv } from "./aws-rehearsal-keeper-start.js";

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

const ENDPOINT_KEYS = ["endpoint_url", "services"];
const ENDPOINT_VARIABLES = ["AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3"];

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
  // The SDK sends to these instead of Amazon. This parser does not read every header spelling the
  // SDK does, so unless `deps.endpoint` is set the send gate also refuses any resolved host other
  // than S3's own hosts for the run's bucket and region (`hosts` in `aws-send-gate.ts`).
  for (const key of ENDPOINT_KEYS) {
    if (found.has(key)) {
      throw new AwsRehearsalRefused(
        "endpoint-unsupported",
        `${key} in ${variable} is not supported: a rehearsal sends only to Amazon S3`,
      );
    }
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
  for (const name of ENDPOINT_VARIABLES) {
    if (!isUnset(env[name])) {
      throw new AwsRehearsalRefused(
        "endpoint-unsupported",
        `${name} must be unset: a rehearsal sends only to Amazon S3`,
      );
    }
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

/** A run that went wrong after the bucket was named; its message carries no SDK text or value. */
class AwsRehearsalFailed extends Error {
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
  /** Makes and returns `<scratchBase>/waitron-aws-rehearsal-<runId>/<label>/`; teardown removes the root. */
  scratch(label: string): Promise<string>;
  bucketConfig(prefix: string): BucketConfig;
  reserveUpload(bytes: number, role: string): void;
  reserveObjects(count: number): void;
  trackChild(pid: number): void;
  trackUpload(key: string, uploadId: string): void;
  /** The unfinished multipart uploads in `bucket` under `prefix`, an issued prefix or a path below one. */
  ownedUploads(prefix: string): Promise<TrackedUpload[]>;
  record(event: unknown): void;
  /** Acts on `bucket` alone; `put` takes only a listing-denial document (`assertListingDenial`). */
  bucketPolicy: {
    put(document: string): Promise<void>;
    remove(): Promise<void>;
  };
}

export interface TeardownDeps {
  isAlive(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  sleep(ms: number): Promise<void>;
  now(): number;
  teardownMs: number;
  /** How long the runner waits for tracked children after SIGTERM, and again after SIGKILL; 5 s when unset. */
  childGraceMs?: number;
  record?(event: unknown): void;
}

export interface AwsRehearsalDeps extends TeardownDeps, RehearsalProfileDeps {
  env: Env;
  createAdminClient(profile: RehearsalProfile, endpoint: string | undefined): AdminClient;
  randomSuffix(): string;
  runId(): string;
  commit(): string;
  receiptDir: string;
  deadlineMs: number;
  settleMs: number;
  /** Aborting it ends the run as its deadline does: the scenario is told to stop, then teardown runs. */
  signal?: AbortSignal;
  print(line: string): void;
  /** The S3 APIs the scenario's own clients send; a run without this list is refused. */
  apis?: readonly string[];
  /** The folder a run's scratch root is made in. */
  scratchBase: string;
  removeDir(path: string): Promise<void>;
  /** Writes the journal synchronously; it is in the file when this returns. */
  journal(receiptDir: string, journal: RehearsalJournal): void;
  /** A pid's start time as `ps -o lstart=` prints it, or null when it cannot be read. */
  processStartTime(pid: number): string | null;
  /** A local S3 endpoint, for proofs only; never read from the environment. With one, the preflight is skipped. */
  endpoint?: string;
  /** Starts the keeper on the journal at `journalPath` with `env` (the runner passes `keeperEnv`); resolves once it is ready. */
  startKeeper(journalPath: string, env: Env): Promise<KeeperHandle>;
}

export interface TeardownTarget {
  bucket: string;
  /** The run the bucket's ownership marker names; the marker is put back from it if needed. */
  runId: string;
  uploads: readonly TrackedUpload[];
  pids: readonly number[];
  /** The marker was never written; a bucket that survives teardown gets one, objects left or not. */
  markerMissing?: boolean;
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
const RECEIPT_DIR = /^\/[A-Za-z0-9._/@-]+$/;
const CHILD_GRACE_MS = 5_000;
const CHILD_POLL_MS = 100;
const DELETE_BATCH = 1000;

interface CallExtra {
  objectRole?: string;
  count?: number;
  bytes?: number;
}

function attemptsOf(value: unknown): number | undefined {
  const attempts = (value as { $metadata?: { attempts?: unknown } } | null)?.$metadata?.attempts;
  return typeof attempts === "number" && attempts >= 1 ? attempts : undefined;
}

/**
 * Sends one command and records it as a vetted event; never throws the SDK's error. Inside a run's
 * request scope a command the plan refuses is answered with the refusal and never sent.
 */
export async function call<T>(
  client: AdminClient,
  command: object & { input: object },
  api: string,
  phase: string,
  deps: Pick<TeardownDeps, "now" | "record">,
  extra: CallExtra = {},
  abortSignal?: AbortSignal,
): Promise<Outcome<T>> {
  const scope = currentRequestScope();
  if (scope !== undefined) {
    try {
      scope.check(
        "runner",
        command.constructor.name.replace(/Command$/, ""),
        command.input as Record<string, unknown>,
      );
    } catch (refusal) {
      return { error: refusal };
    }
  }
  const started = deps.now();
  let outcome: Outcome<T>;
  try {
    outcome = {
      output: (await client.send(command, abortSignal ? { abortSignal } : undefined)) as T,
    };
  } catch (error) {
    outcome = { error };
  }
  const answer = outcome.error ?? outcome.output;
  const attempts = attemptsOf(answer);
  deps.record?.({
    scenario: "lifecycle",
    phase,
    api,
    ...extra,
    httpStatus: statusOf(answer),
    ...(attempts === undefined ? {} : { attempts }),
    elapsedMs: Math.max(0, deps.now() - started),
    ...(outcome.error === undefined ? {} : { errorName: nameOf(outcome.error) }),
    outcome: outcome.error === undefined ? "ok" : "failed",
  });
  return outcome;
}

type Send = <T>(
  command: object & { input: object },
  api: string,
  extra?: CallExtra,
) => Promise<Outcome<T>>;

function sender(
  client: AdminClient,
  phase: string,
  deps: Pick<TeardownDeps, "now" | "record">,
  signal: AbortSignal,
): Send {
  return (command, api, extra = {}) => call(client, command, api, phase, deps, extra, signal);
}

function failedEntry(step: TeardownEntry["step"], error: unknown, count?: number): TeardownEntry {
  return {
    step,
    outcome: "failed",
    ...(count === undefined ? {} : { count }),
    errorName: nameOf(error),
    httpStatus: statusOf(error),
  };
}

/** Settles when `wait` does or `signal` aborts, whichever is first. */
function untilAborted(wait: Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      signal.removeEventListener("abort", done);
      resolve();
    };
    signal.addEventListener("abort", done, { once: true });
    wait.then(done, done);
  });
}

export async function stopChildren(
  pids: readonly number[],
  deps: TeardownDeps,
  signal: AbortSignal,
): Promise<TeardownEntry> {
  const live = [...new Set(pids)].filter((pid) => deps.isAlive(pid));
  if (live.length === 0) return { step: "stop-child", outcome: "skipped", count: 0 };
  const running = (): number[] => live.filter((pid) => deps.isAlive(pid));
  const send = (kill: NodeJS.Signals): void => {
    for (const pid of running()) {
      try {
        deps.kill(pid, kill);
      } catch {
        // A child that exits between the check and the signal is already stopped.
      }
    }
  };
  const polls = Math.ceil((deps.childGraceMs ?? CHILD_GRACE_MS) / CHILD_POLL_MS);
  // A child that has exited stays visible until this process reaps it, which needs a turn of the loop.
  const waitForExit = async (): Promise<void> => {
    for (let poll = 0; poll < polls && !signal.aborted && running().length > 0; poll += 1) {
      await untilAborted(deps.sleep(CHILD_POLL_MS), signal);
    }
  };
  send("SIGTERM");
  await waitForExit();
  send("SIGKILL");
  await waitForExit();
  const left = running().length;
  return left === 0
    ? { step: "stop-child", outcome: "ok", count: live.length }
    : { step: "stop-child", outcome: "failed", count: left };
}

async function abortUploads(
  send: Send,
  bucket: string,
  tracked: readonly TrackedUpload[],
): Promise<{ entry: TeardownEntry; left: string[] }> {
  const left = new Set<string>();
  const done = new Set<string>();
  let firstError: unknown;
  const abort = async ({ key, uploadId }: TrackedUpload): Promise<void> => {
    if (done.has(uploadId)) return;
    const result = await send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
      "AbortMultipartUpload",
    );
    if (result.error === undefined || nameOf(result.error) === "NoSuchUpload") {
      done.add(uploadId);
      left.delete(uploadId);
    } else {
      firstError ??= result.error;
      left.add(uploadId);
    }
  };
  for (const upload of tracked) await abort(upload);

  for await (const listed of listUploads(
    (command) => send<ListMultipartUploadsCommandOutput>(command, "ListMultipartUploads"),
    { bucket, failure: (message) => new AwsRehearsalFailed(message) },
  )) {
    if (listed.error !== undefined) {
      firstError ??= listed.error;
      break;
    }
    for (const upload of listed.uploads) await abort(upload);
  }
  const entry =
    firstError === undefined
      ? ({ step: "abort-upload", outcome: "ok", count: done.size } as const)
      : failedEntry("abort-upload", firstError, done.size);
  return { entry, left: [...left] };
}

async function removePolicy(send: Send, bucket: string): Promise<TeardownEntry> {
  const result = await send(
    new DeleteBucketPolicyCommand({ Bucket: bucket }),
    "DeleteBucketPolicy",
  );
  return result.error === undefined || nameOf(result.error) === "NoSuchBucketPolicy"
    ? { step: "remove-policy", outcome: "ok" }
    : failedEntry("remove-policy", result.error);
}

async function deleteObjects(send: Send, bucket: string): Promise<TeardownEntry> {
  const keys: string[] = [];
  let failure: unknown;
  for await (const listed of listPages<ListObjectsV2CommandOutput, string>(
    (token) =>
      send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
        "ListObjectsV2",
      ),
    ({ NextContinuationToken: token }) =>
      token === undefined ? undefined : { position: token, seen: token },
    () => new AwsRehearsalFailed("ListObjectsV2 repeated its continuation token"),
  )) {
    if (listed.error !== undefined) {
      failure = listed.error;
      break;
    }
    for (const object of listed.output?.Contents ?? []) {
      if (object.Key !== undefined && object.Key !== AWS_REHEARSAL_NONCE_KEY) keys.push(object.Key);
    }
  }
  let deleted = 0;
  for (let start = 0; start < keys.length; start += DELETE_BATCH) {
    const batch = keys.slice(start, start + DELETE_BATCH);
    const result = await send<DeleteObjectsCommandOutput>(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
      "DeleteObjects",
      { count: batch.length },
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

const POLICY_SID = /^[A-Za-z0-9]{1,64}$/;
const PREFIX_WILDCARDS = /[*?$]/;

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/**
 * Refuses every document but one Deny of `s3:ListBucket` on `bucket` for a `s3:prefix` strictly
 * below a label prefix this run issued. The document must also be exactly what its parsed form
 * serialises to, so no duplicated key can show the check one value and AWS another.
 */
function assertListingDenial(document: string, bucket: string, issued: ReadonlySet<string>): void {
  const refuse = (detail: string): AwsRehearsalRefused =>
    new AwsRehearsalRefused("policy-refused", detail);
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    throw refuse("a bucket policy must be JSON");
  }
  if (
    !hasExactKeys(parsed, ["Version", "Statement"]) ||
    parsed.Version !== "2012-10-17" ||
    !Array.isArray(parsed.Statement) ||
    parsed.Statement.length !== 1
  ) {
    throw refuse("a bucket policy holds Version 2012-10-17 and one statement, nothing else");
  }
  const statement: unknown = parsed.Statement[0];
  if (
    !hasExactKeys(statement, ["Sid", "Effect", "Principal", "Action", "Resource", "Condition"]) ||
    typeof statement.Sid !== "string" ||
    !POLICY_SID.test(statement.Sid) ||
    statement.Effect !== "Deny" ||
    statement.Principal !== "*" ||
    statement.Action !== "s3:ListBucket" ||
    statement.Resource !== `arn:aws:s3:::${bucket}`
  ) {
    throw refuse("the statement denies s3:ListBucket on this run's bucket, nothing else");
  }
  const condition = statement.Condition;
  if (
    !hasExactKeys(condition, ["StringLike"]) ||
    !hasExactKeys(condition.StringLike, ["s3:prefix"])
  ) {
    throw refuse("the statement's one condition is StringLike on s3:prefix");
  }
  const pattern = condition.StringLike["s3:prefix"];
  const prefix = typeof pattern === "string" && pattern.endsWith("*") ? pattern.slice(0, -1) : "";
  const below = [...issued].some(
    (label) => prefix.startsWith(label) && prefix.length > label.length,
  );
  if (!below || PREFIX_WILDCARDS.test(prefix)) {
    throw refuse(
      "the s3:prefix is a literal prefix below one of this run's labels, followed by one *",
    );
  }
  if (JSON.stringify(parsed) !== document) {
    throw refuse("the policy must be exactly its own parsed form");
  }
}

function ownershipNonce(runId: string): string {
  return JSON.stringify({ runId });
}

async function deleteBucket(
  send: Send,
  restoreNonce: Send,
  bucket: string,
  runId: string,
  objectsDeleted: boolean,
  markerMissing: boolean,
): Promise<TeardownEntry> {
  // The nonce stays while any other object may remain: it is the proof the cleanup command reads.
  if (objectsDeleted) {
    const nonce = await send(
      new DeleteObjectCommand({ Bucket: bucket, Key: AWS_REHEARSAL_NONCE_KEY }),
      "DeleteObject",
      { objectRole: "ownership-nonce" },
    );
    if (nonce.error !== undefined) return failedEntry("delete-bucket", nonce.error);
  }
  const result = await send(new DeleteBucketCommand({ Bucket: bucket }), "DeleteBucket");
  if (result.error === undefined || nameOf(result.error) === "NoSuchBucket") {
    return { step: "delete-bucket", outcome: "ok" };
  }
  if (objectsDeleted || markerMissing) {
    // The bucket outlived its marker; put the marker back so the cleanup command can prove ownership.
    const body = ownershipNonce(runId);
    await restoreNonce(
      new PutObjectCommand({
        Bucket: bucket,
        Key: AWS_REHEARSAL_NONCE_KEY,
        Body: body,
        ContentType: "application/json",
      }),
      "PutObject",
      { objectRole: "ownership-nonce", bytes: Buffer.byteLength(body) },
    );
  }
  return failedEntry("delete-bucket", result.error);
}

/**
 * Every command names `target.bucket`; every step runs even when an earlier one failed. One budget,
 * `deps.teardownMs`, bounds stopping children and is the abort signal every command is sent with.
 */
export async function teardownOwnedBucket(
  client: AdminClient,
  target: TeardownTarget,
  deps: TeardownDeps,
): Promise<TeardownResult> {
  const { bucket } = target;
  const signal = AbortSignal.timeout(deps.teardownMs);
  const send = sender(client, "teardown", deps, signal);
  const entries: TeardownEntry[] = [await stopChildren(target.pids, deps, signal)];
  const aborted = await abortUploads(send, bucket, target.uploads);
  entries.push(aborted.entry);
  entries.push(await removePolicy(send, bucket));
  const objects = await deleteObjects(send, bucket);
  entries.push(objects);
  entries.push(
    await deleteBucket(
      send,
      sender(client, "restore-nonce", deps, signal),
      bucket,
      target.runId,
      objects.outcome === "ok",
      target.markerMissing === true,
    ),
  );
  const clean = entries.every((entry) => entry.outcome !== "failed");
  return {
    entries,
    remaining: clean ? { bucket: null, uploadIds: [] } : { bucket, uploadIds: aborted.left },
  };
}

/**
 * Refuses, before any command, a run whose run, cleanup or interrupted receipt could not carry a
 * cleanup command; the interrupted receipt's name is the longest.
 */
export function assertCleanupCommandFits(region: string, runId: string, receiptDir: string): void {
  if (!isReceiptRegion(region)) {
    throw new AwsRehearsalRefused(
      "region-unsupported",
      "AWS_REGION must look like eu-north-1 for the cleanup command to carry it",
    );
  }
  if (!isReceiptToken(runId) || !isReceiptToken(`${runId}-interrupted`)) {
    throw new AwsRehearsalRefused(
      "run-id-unsupported",
      "the run id must be a token of at most 52 characters for the interrupted receipt's name",
    );
  }
  for (const kind of ["run", "cleanup", "interrupted"] as const) {
    const command = cleanupCommandFor(region, join(receiptDir, receiptFileName(runId, kind)));
    const tooLong = command.length > CLEANUP_COMMAND_MAX;
    if (!isReceiptCleanupCommand(command)) {
      throw new AwsRehearsalRefused(
        "receipt-dir-unsupported",
        tooLong
          ? `the receipt folder's path is too long for a cleanup command of at most ${CLEANUP_COMMAND_MAX} characters`
          : "the receipt folder's path may hold only letters, digits and . _ @ - between its slashes, and be at most 40 folders deep",
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
    createAdminClient: (profile, endpoint) =>
      createBucketClient({
        region: profile.region,
        bucket: "",
        prefix: "",
        accessKeyId: profile.accessKeyId,
        secretAccessKey: profile.secretAccessKey,
        ...(endpoint === undefined ? {} : { endpoint }),
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
    settleMs: AWS_REHEARSAL_SETTLE_MS,
    teardownMs: AWS_REHEARSAL_LIMITS.teardownMs,
    print: (line) => process.stdout.write(`${line}\n`),
    scratchBase: tmpdir(),
    removeDir: (path) => rm(path, { recursive: true, force: true }),
    journal: writeJournal,
    processStartTime,
    startKeeper,
  };
}

function sdkVersion(): string {
  const require = createRequire(import.meta.url);
  return (require("@aws-sdk/client-s3/package.json") as { version: string }).version;
}

function receiptHeader(
  deps: Pick<AwsRehearsalDeps, "commit" | "now">,
  runId: string,
  region: string,
  limits: Record<string, number>,
): Omit<AwsReceiptHeader, "finishedAt"> {
  return {
    runId,
    commit: deps.commit(),
    node: process.version,
    sdkVersion: sdkVersion(),
    litestreamVersion: LITESTREAM_VERSION,
    region,
    startedAt: new Date(deps.now()).toISOString(),
    limits,
  };
}

/** The failed steps' names, comma-separated, or "none". */
function failedSteps(entries: readonly TeardownEntry[]): string {
  const failed = entries.filter((entry) => entry.outcome === "failed").map((entry) => entry.step);
  return failed.length === 0 ? "none" : failed.join(", ");
}

type CreateOutcome = AwsReceiptOwnership;

function classifyCreate(bucket: string, error: unknown): CreateOutcome {
  if (error === undefined) return { state: "owned", bucket };
  const name = nameOf(error);
  const httpStatus = statusOf(error);
  const attempts = attemptsOf(error);
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

async function preflight(
  client: AdminClient,
  bucket: string,
  deps: Pick<TeardownDeps, "now" | "record">,
  signal: AbortSignal,
): Promise<void> {
  const encryption = await call<GetBucketEncryptionCommandOutput>(
    client,
    new GetBucketEncryptionCommand({ Bucket: bucket }),
    "GetBucketEncryption",
    "preflight",
    deps,
    {},
    signal,
  );
  const rules = encryption.output?.ServerSideEncryptionConfiguration?.Rules ?? [];
  const sseS3 =
    rules.length > 0 &&
    rules.every((rule) => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm === "AES256");
  if (signal.aborted) throw new AwsRehearsalFailed("the rehearsal was stopped during setup");
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
    {},
    signal,
  );
  if (versioning.error !== undefined || versioning.output?.Status !== undefined) {
    throw new AwsRehearsalRefused(
      "versioning-not-off",
      "the new bucket must never have had versioning enabled",
    );
  }
}

/**
 * Creates one bucket this run owns and runs `scenario` against it. Attempts teardown of a bucket it
 * created; when any teardown step fails, the receipt names the bucket as possibly left.
 * Credentials reach the scenario only inside `bucketConfig(...)`.
 */
export async function withAwsRehearsal<T>(
  scenario: (ctx: AwsRehearsal) => Promise<T>,
  overrides: Partial<AwsRehearsalDeps> = {},
): Promise<T> {
  const env = overrides.env ?? process.env;
  const deps: AwsRehearsalDeps = { ...defaultDeps(env), ...overrides };
  assertRehearsalOptIn(env);
  if (deps.apis === undefined) {
    throw new AwsRehearsalRefused(
      "plan-refused",
      "a rehearsal declares the S3 APIs its scenario sends",
    );
  }
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
  if (profile.region === "us-east-1") {
    throw new AwsRehearsalRefused(
      "region-unsupported",
      "us-east-1 is refused: there AWS answers a create for a bucket this account already owns with success, so a create cannot prove the bucket is new",
    );
  }
  if (deps.signal?.aborted === true) {
    throw new AwsRehearsalFailed("the rehearsal was stopped before it started");
  }
  installSendGate();
  const client = deps.createAdminClient(profile, deps.endpoint);
  markRunnerClient(client);
  try {
    return await runOwned(scenario, deps, deps.apis, profile, client, receiptDir);
  } finally {
    client.destroy?.();
  }
}

/** Names only a refused field or an error code, never a value. */
export function receiptFailureCause(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("receipt field refused: ")) {
    return error.message;
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : nameOf(error);
}

/**
 * Records into `log`, and in place of an entry the receipt refuses writes a fixed note and counts
 * it, so a refused entry never stops teardown or loses the receipt.
 */
export function containedLog(log: ReceiptLog): {
  record(event: unknown): void;
  teardown(entry: TeardownEntry): void;
  /** Notes and counts a value left out of the receipt by the caller. */
  refuse(): void;
  refused(): number;
} {
  let refused = 0;
  const note = (): void => {
    refused += 1;
    try {
      log.record({ scenario: "lifecycle", phase: "record-refused", outcome: "refused" });
    } catch {
      // Refused only if a loaded key is part of these fixed words; the count still fails the run.
    }
  };
  return {
    record(event) {
      try {
        log.record(event);
      } catch {
        note();
      }
    },
    teardown(entry) {
      try {
        log.teardown(entry);
      } catch {
        note();
        try {
          log.teardown({ step: entry.step, outcome: entry.outcome });
        } catch {
          // As above.
        }
      }
    },
    refuse: note,
    refused: () => refused,
  };
}

/**
 * Leaves out, as a refused entry, a listed upload id the receipt could not carry; the cleanup
 * command lists the bucket's uploads itself, so `bucket` alone is enough to finish the job.
 */
export function carriedRemaining(
  remaining: AwsReceiptRemaining,
  profile: RehearsalProfile,
  contained: { refuse(): void },
): AwsReceiptRemaining {
  const uploadIds = remaining.uploadIds.filter((id) => {
    const carried = isReceiptUploadId(id) && !carriesKeyPair(id, profile);
    if (!carried) contained.refuse();
    return carried;
  });
  return { bucket: remaining.bucket, uploadIds };
}

export function unplannedFailure(refusals: {
  count: number;
  first: string | undefined;
}): AwsRehearsalFailed | undefined {
  return refusals.count === 0
    ? undefined
    : new AwsRehearsalFailed(
        `${refusals.count} unplanned request(s) refused before sending; the first: ${refusals.first}`,
      );
}

/**
 * A scope for `plan` that records each refusal in the receipt until `finished()` (the receipt is about
 * to be built), and prints it after; `close()` stops the counting the run's failure reads.
 */
export function runScope(
  plan: Parameters<typeof openRequestScope>[0]["plan"],
  record: (event: unknown) => void,
  print: (line: string) => void,
  endpoint: string | undefined,
  region: string,
): {
  scope: RequestScope;
  finished(): void;
  close(): { count: number; first: string | undefined };
} {
  let state: "open" | "finished" | "closed" = "open";
  const scope = openRequestScope({
    plan,
    mode: "enforce",
    hosts: endpoint === undefined ? { s3Region: region } : "any",
    onRefused(detail, api) {
      if (state !== "open") {
        try {
          print(
            state === "finished"
              ? `refused after the receipt was written: ${detail}`
              : `refused after the run ended: ${detail}`,
          );
        } catch {
          // The refusal still rejects the send.
        }
        return;
      }
      record({
        scenario: "lifecycle",
        phase: "request-refused",
        ...((RECEIPT_APIS as readonly string[]).includes(api) ? { api } : {}),
        outcome: "refused",
      });
    },
  });
  return {
    scope,
    finished() {
      if (state === "open") state = "finished";
    },
    close() {
      const refusals = scope.refusals();
      state = "closed";
      scope.close();
      return refusals;
    },
  };
}

function refusedEntriesFailure(refused: number): AwsRehearsalFailed | undefined {
  return refused === 0
    ? undefined
    : new AwsRehearsalFailed(
        `${refused} receipt entr${refused === 1 ? "y was" : "ies were"} refused and left out of the receipt`,
      );
}

interface DeadlineOptions {
  controller: AbortController;
  deadlineMs: number;
  settleMs: number;
  outside: AbortSignal | undefined;
  now(): number;
  record(event: unknown): void;
  /** Called when `body` was still running at the end of the settle wait. */
  unsettled?(): void;
}

/**
 * Runs `body` until it settles, its deadline passes or `outside` aborts. On either stop it aborts
 * `controller`, rejects, and first gives `body` up to `settleMs` to settle, so a body that stops
 * within that grace does not race the teardown that follows. `controller` is aborted however `body`
 * ends.
 */
async function runWithDeadline<T>(body: () => Promise<T>, options: DeadlineOptions): Promise<T> {
  const { controller, outside, now, record } = options;
  const started = now();
  const running = Promise.resolve().then(body);
  // A body that rejects after a stop won the race must not surface as unhandled.
  running.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  let onOutside: (() => void) | undefined;
  let stopped = false;
  const stop = new Promise<never>((_, reject) => {
    const end = (phase: string, message: string): void => {
      if (stopped) return;
      stopped = true;
      controller.abort();
      record({
        scenario: "lifecycle",
        phase,
        elapsedMs: Math.max(0, now() - started),
        outcome: "failed",
      });
      reject(new AwsRehearsalFailed(message));
    };
    timer = setTimeout(
      () => end("deadline", `the rehearsal passed its deadline of ${options.deadlineMs} ms`),
      options.deadlineMs,
    );
    onOutside = () => end("interrupt", "the rehearsal was stopped from outside");
    if (outside?.aborted === true) onOutside();
    else outside?.addEventListener("abort", onOutside, { once: true });
  });
  try {
    return await Promise.race([running, stop]);
  } finally {
    clearTimeout(timer);
    if (onOutside !== undefined) outside?.removeEventListener("abort", onOutside);
    controller.abort();
    if (stopped) {
      const settleStarted = now();
      const settled = await settleWithin(running, options.settleMs);
      record({
        scenario: "lifecycle",
        phase: "settle",
        elapsedMs: Math.max(0, now() - settleStarted),
        outcome: settled ? "ok" : "failed",
      });
      if (!settled) options.unsettled?.();
    }
  }
}

async function runOwned<T>(
  scenario: (ctx: AwsRehearsal) => Promise<T>,
  deps: AwsRehearsalDeps,
  apis: readonly string[],
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
  const header = receiptHeader(deps, runId, region, {
    ...AWS_REHEARSAL_LIMITS,
    deadlineMs: deps.deadlineMs,
    teardownMs: deps.teardownMs,
  });
  const log = createReceiptLog(header, profile);
  const contained = containedLog(log);
  const { record } = contained;
  const callDeps = { now: deps.now, record };
  const controller = new AbortController();
  const { signal } = controller;

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
  const { reserveUpload, reserveObjects } = fixtureBudget(
    record,
    (detail) => new AwsRehearsalRefused("fixture-limit", detail),
  );
  const issued = new Set<string>();
  const labels = new Set<string>();
  const scratchRoot = join(deps.scratchBase, `waitron-aws-rehearsal-${runId}`);
  const scratchLabels = new Set<string>();
  const scratchMaking: Promise<unknown>[] = [];
  let scratchMade = false;

  const journalPids: JournalPid[] = [];
  let journalState: JournalState = "creating";
  let journalScratch: string | null = null;
  let journalFailures = 0;
  let keeperPid: number | null = null;
  const journalNow = (): RehearsalJournal => ({
    version: 1,
    runId,
    region,
    bucket,
    state: journalState,
    uploads: uploads.map((upload) => ({ ...upload })),
    pids: journalPids.map((entry) => ({ ...entry })),
    scratchRoot: journalScratch,
    receiptDir,
    header: {
      commit: header.commit,
      node: header.node,
      sdkVersion: header.sdkVersion,
      litestreamVersion: header.litestreamVersion,
      startedAt: header.startedAt,
      limits: header.limits,
    },
    teardownMs: deps.teardownMs,
    keeperCeilingMs: 2 * (deps.deadlineMs + deps.settleMs + deps.teardownMs),
    ...(deps.endpoint === undefined ? {} : { endpoint: deps.endpoint }),
    keeperPid,
    ready: keeperPid === null ? null : true,
  });
  // Once a bucket may exist a failed write fails the run, but never stops it or its teardown.
  // The whole serialised journal, as writeReceipt checks the receipt's text.
  const writeChecked = (): void => {
    const body = journalNow();
    if (carriesKeyPair(JSON.stringify(body), profile)) {
      throw new AwsRehearsalRefused("journal-refused", "the journal would hold the key pair");
    }
    deps.journal(receiptDir, body);
  };
  const journal = (state: JournalState = journalState): void => {
    journalState = state;
    try {
      writeChecked();
    } catch {
      journalFailures += 1;
      record({ scenario: "lifecycle", phase: "journal", outcome: "failed" });
    }
  };
  const requests = runScope(
    createRequestPlan({ bucket, apis, prefixes: () => issued }),
    record,
    deps.print,
    deps.endpoint,
    region,
  );
  const ctx: AwsRehearsal = {
    runId,
    bucket,
    region,
    signal,
    prefix(label) {
      if (!LABEL.test(label) || labels.has(label)) {
        throw new AwsRehearsalRefused("label-refused", "a prefix label is new and a token");
      }
      labels.add(label);
      const prefix = `rehearsal-${runId}/${label}/`;
      issued.add(prefix);
      return prefix;
    },
    async scratch(label) {
      refuseOnceTearingDown();
      if (!LABEL.test(label) || scratchLabels.has(label)) {
        throw new AwsRehearsalRefused("label-refused", "a scratch label is new and a token");
      }
      scratchLabels.add(label);
      if (journalScratch === null) {
        journalScratch = scratchRoot;
        journal();
      }
      scratchMade = true;
      const folder = join(scratchRoot, label);
      const making = mkdir(scratchRoot, { recursive: true }).then(() => mkdir(folder));
      scratchMaking.push(making.catch(() => undefined));
      await making;
      return folder;
    },
    bucketConfig(prefix) {
      if (!issued.has(prefix)) {
        throw new AwsRehearsalRefused("prefix-not-issued", "use a prefix from prefix(label)");
      }
      return {
        ...(deps.endpoint === undefined ? {} : { endpoint: deps.endpoint }),
        region,
        bucket,
        prefix,
        accessKeyId: profile.accessKeyId,
        secretAccessKey: profile.secretAccessKey,
      };
    },
    reserveUpload,
    reserveObjects,
    trackChild(pid) {
      refuseOnceTearingDown();
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new AwsRehearsalRefused("child-pid-refused", "a child pid is a positive integer");
      }
      journalPids.push({ pid, startTime: deps.processStartTime(pid) });
      pids.push(pid);
      journal();
    },
    trackUpload(key, uploadId) {
      refuseOnceTearingDown();
      if (!isReceiptUploadId(uploadId) || carriesKeyPair(uploadId, profile)) {
        throw new AwsRehearsalRefused(
          "upload-id-refused",
          "an upload id the receipt could not carry is not tracked",
        );
      }
      if (!isJournalUploadKey(key) || carriesKeyPair(key, profile)) {
        throw new AwsRehearsalRefused(
          "upload-id-refused",
          "an upload key the journal could not carry is not tracked",
        );
      }
      uploads.push({ key, uploadId });
      journal();
    },
    async ownedUploads(prefix) {
      refuseOnceTearingDown();
      if (![...issued].some((given) => prefix.startsWith(given))) {
        throw new AwsRehearsalRefused(
          "prefix-not-issued",
          "list under a prefix from prefix(label) or a path below one",
        );
      }
      const send = sender(client, "inventory", callDeps, signal);
      const found: TrackedUpload[] = [];
      for await (const listed of listUploads(
        (command) => send<ListMultipartUploadsCommandOutput>(command, "ListMultipartUploads"),
        { bucket, prefix, failure: (message) => new AwsRehearsalFailed(message) },
      )) {
        if (listed.error instanceof AwsRehearsalFailed) throw listed.error;
        if (listed.error !== undefined) {
          throw new AwsRehearsalFailed(
            `ListMultipartUploads failed: ${receiptErrorName(nameOf(listed.error))}`,
          );
        }
        found.push(...listed.uploads);
      }
      return found;
    },
    // The scenario's own entries stay strict, so a refused one fails the scenario where it is made.
    record: (event) => log.record(event),
    bucketPolicy: {
      async put(document) {
        refuseOnceTearingDown();
        assertListingDenial(document, bucket, issued);
        const result = await call(
          client,
          new PutBucketPolicyCommand({ Bucket: bucket, Policy: document }),
          "PutBucketPolicy",
          "listing-denial",
          callDeps,
          {},
          signal,
        );
        if (result.error !== undefined) {
          throw new AwsRehearsalFailed(
            `PutBucketPolicy failed: ${receiptErrorName(nameOf(result.error))}`,
          );
        }
      },
      async remove() {
        refuseOnceTearingDown();
        const entry = await removePolicy(
          sender(client, "listing-denial", callDeps, signal),
          bucket,
        );
        if (entry.outcome !== "ok") {
          throw new AwsRehearsalFailed(
            `DeleteBucketPolicy failed: ${receiptErrorName(entry.errorName!)}`,
          );
        }
      },
    },
  };

  // Set once CreateBucket answers; a deadline can end the run before it does.
  let created: CreateOutcome | undefined;
  const stopIfStopped = (): void => {
    if (signal.aborted) throw new AwsRehearsalFailed("the rehearsal was stopped during setup");
  };
  const setUpAndRun = async (): Promise<T> => {
    if (signal.aborted) {
      created = { state: "not-created", bucket: null };
      journal("not-created");
      throw new AwsRehearsalFailed("the rehearsal was stopped before it created a bucket");
    }
    const answer = await call(
      client,
      new CreateBucketCommand({
        Bucket: bucket,
        CreateBucketConfiguration: { LocationConstraint: region },
      } as CreateBucketCommandInput),
      "CreateBucket",
      "create",
      callDeps,
      {},
      signal,
    );
    created = classifyCreate(bucket, answer.error);
    // An unanswered create stays `creating`: the bucket may exist.
    if (created.state !== "unowned-candidate") journal(created.state);
    if (created.state !== "owned") throw createFailure(created, bucket);
    stopIfStopped();
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
      signal,
    );
    if (put.error !== undefined) {
      throw new AwsRehearsalFailed(`writing the ownership nonce to ${bucket} failed`);
    }
    stopIfStopped();
    if (deps.endpoint === undefined) {
      await preflight(client, bucket, callDeps, signal);
    } else {
      // A local S3 server: versitygw answers GetBucketEncryption 501 NotImplemented (design D12).
      for (const api of ["GetBucketEncryption", "GetBucketVersioning"]) {
        record({ scenario: "lifecycle", phase: "preflight", api, outcome: "skipped" });
      }
    }
    stopIfStopped();
    return scenario(ctx);
  };

  let failure: unknown;
  let result: T | undefined;
  let teardown: TeardownResult | undefined;
  let scenarioStillRunning = false;
  // After every refusal that can come before CreateBucket, so a refused run leaves no journal.
  try {
    writeChecked();
  } catch (error) {
    const keyPair = error instanceof AwsRehearsalRefused && error.reason === "journal-refused";
    throw new AwsRehearsalRefused(
      "journal-unwritable",
      keyPair
        ? "the journal would hold the key pair; nothing was created"
        : "the journal could not be written in the receipt folder; nothing was created",
    );
  }
  const journalPath = join(receiptDir, journalFileName(runId));
  let keeper: KeeperHandle;
  try {
    keeper = await deps.startKeeper(journalPath, keeperEnv(deps.env));
  } catch (error) {
    rmSync(journalPath, { force: true });
    throw error instanceof AwsRehearsalRefused && error.reason === "keeper-unavailable"
      ? error
      : new AwsRehearsalRefused(
          "keeper-unavailable",
          "the keeper could not be started; nothing was created",
        );
  }
  keeperPid = keeper.keeperPid;
  try {
    return await runStarted();
  } finally {
    // After `finished`, so a keeper that reads end-of-file finds the run done.
    keeper.end();
  }

  async function runStarted(): Promise<T> {
    await requests.scope.run(async () => {
      try {
        result = await runWithDeadline(setUpAndRun, {
          controller,
          deadlineMs: deps.deadlineMs,
          settleMs: deps.settleMs,
          outside: deps.signal,
          now: deps.now,
          record,
          unsettled: () => {
            scenarioStillRunning = true;
          },
        });
      } catch (error) {
        failure = error;
      }
      if (created?.state === "owned") {
        tearingDown = true;
        teardown = await teardownOwnedBucket(
          client,
          { bucket, runId, uploads, pids },
          {
            ...deps,
            record,
          },
        );
        for (const entry of teardown.entries) contained.teardown(entry);
        if (
          teardown.entries.some((entry) => entry.step === "delete-bucket" && entry.outcome === "ok")
        ) {
          journal("deleted");
        }
      }
    });
    tearingDown = true;
    // A run that never owned a bucket records this step only if it made scratch.
    const scratchEntries: TeardownEntry[] = [];
    if (created?.state === "owned" || scratchMade) {
      await Promise.all(scratchMaking);
      const entry = await removeScratch(
        scratchMade,
        scratchRoot,
        deps.removeDir,
        scenarioStillRunning,
      );
      contained.teardown(entry);
      scratchEntries.push(entry);
    }
    const scratchLeft = scratchEntries.some((entry) => entry.outcome === "failed")
      ? `; scratch folder not removed: ${scratchRoot}`
      : "";
    const ownership: CreateOutcome = created ?? {
      state: "unowned-candidate",
      bucket: null,
      candidate: bucket,
    };

    const remaining = carriedRemaining(
      teardown?.remaining ?? { bucket: null, uploadIds: [] },
      profile,
      contained,
    );
    const failed = failedSteps([...(teardown?.entries ?? []), ...scratchEntries]);
    let receiptFailure: AwsRehearsalFailed | undefined;
    requests.finished();
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
    let finishFailure: AwsRehearsalFailed | undefined;
    if (receiptFailure === undefined) {
      // Written last, so a keeper that reads it knows the receipt exists.
      journalState = "finished";
      try {
        writeChecked();
      } catch {
        finishFailure = new AwsRehearsalFailed("the journal was not marked finished");
      }
    }
    const refusals = requests.close();

    const teardownFailure =
      failed === "none"
        ? undefined
        : new AwsRehearsalFailed(
            `teardown failed at ${failed}` +
              scratchLeft +
              (receiptFailure === undefined ? `; receipt: ${receiptPath}` : ""),
          );
    const problems = [
      failure,
      unplannedFailure(refusals),
      refusedEntriesFailure(contained.refused()),
      journalFailures === 0
        ? undefined
        : new AwsRehearsalFailed(
            `${journalFailures} journal write${journalFailures === 1 ? "" : "s"} failed, so the journal may not have named everything this run made`,
          ),
      teardownFailure,
      finishFailure,
    ].filter((error) => error !== undefined);
    if (receiptFailure !== undefined) {
      const left =
        remaining.bucket ??
        (ownership.state === "unowned-candidate"
          ? `${ownership.candidate} (ownership unknown)`
          : "none");
      throw new AggregateError(
        [...problems, receiptFailure],
        `the rehearsal's receipt was not written; bucket left: ${left}; ` +
          `failed teardown steps: ${failed}${scratchLeft}`,
      );
    }
    if (printFailure !== undefined) {
      if (problems.length === 0) throw printFailure;
      throw new AggregateError(
        [...problems, printFailure],
        `the rehearsal failed${scratchLeft}; receipt: ${receiptPath}`,
      );
    }
    if (problems.length === 1) throw problems[0];
    if (problems.length > 1) {
      throw new AggregateError(
        problems,
        teardownFailure === undefined
          ? `the rehearsal failed; receipt: ${receiptPath}`
          : `the rehearsal failed and so did its teardown${scratchLeft}; receipt: ${receiptPath}`,
      );
    }
    return result as T;
  }
}

/** `stillRunning`: the scenario outlived its settle wait, so it can write the root again after this. */
export async function removeScratch(
  made: boolean,
  root: string,
  removeDir: AwsRehearsalDeps["removeDir"],
  stillRunning: boolean,
): Promise<TeardownEntry> {
  if (!made) return { step: "remove-scratch", outcome: "skipped" };
  try {
    await removeDir(root);
  } catch (error) {
    return failedEntry("remove-scratch", error);
  }
  const back = await access(root).then(
    () => true,
    () => false,
  );
  if (stillRunning || back) {
    return {
      step: "remove-scratch",
      outcome: "failed",
      errorName: stillRunning ? "ScenarioStillRunning" : "ScratchRecreated",
      httpStatus: null,
    };
  }
  return { step: "remove-scratch", outcome: "ok" };
}

/**
 * Runs one rehearsal for a test file whose test can hit Vitest's time limit, which leaves the run
 * going after the test has failed. Call `stop()` in `afterAll`: it stops a scenario still running as its
 * deadline would, and waits up to `waitMs` for the teardown and the receipt.
 */
export function rehearsalLifecycle(overrides: Partial<AwsRehearsalDeps> = {}): {
  run<T>(scenario: (ctx: AwsRehearsal) => Promise<T>): Promise<T>;
  stop(waitMs?: number): Promise<void>;
} {
  const outside = new AbortController();
  let running: Promise<unknown> | undefined;
  return {
    run(scenario) {
      const run = withAwsRehearsal(scenario, { ...overrides, signal: outside.signal });
      running = run;
      return run;
    },
    async stop(waitMs = AWS_REHEARSAL_STOP_WAIT_MS) {
      outside.abort();
      if (running !== undefined && !(await settleWithin(running, waitMs))) {
        throw new AwsRehearsalFailed(
          `the rehearsal did not finish within ${waitMs} ms of its stop`,
        );
      }
    },
  };
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

export function namesRun(text: string, runId: string): boolean {
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

  const log = createReceiptLog(
    receiptHeader(deps, runId, region, { teardownMs: deps.teardownMs }),
    profile,
    "cleanup",
  );
  const contained = containedLog(log);
  const { record } = contained;
  installSendGate();
  const client = deps.createAdminClient(profile, deps.endpoint);
  markRunnerClient(client);
  const requests = runScope(
    createRequestPlan({ bucket, apis: [], prefixes: () => new Set() }),
    record,
    deps.print,
    deps.endpoint,
    region,
  );
  try {
    const removed = await requests.scope.run(async () => {
      const marker = await call<GetObjectCommandOutput>(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: AWS_REHEARSAL_NONCE_KEY }),
        "GetObject",
        "ownership",
        { now: deps.now, record },
        { objectRole: "ownership-nonce" },
        AbortSignal.timeout(deps.teardownMs),
      );
      if (marker.error !== undefined && nameOf(marker.error) === "NoSuchBucket") return null;
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
      for (const entry of teardown.entries) contained.teardown(entry);
      return teardown;
    });
    if (removed === null) {
      deps.print("bucket not found; nothing deleted");
      return { ok: true, receiptPath: null };
    }
    const remaining = carriedRemaining(removed.remaining, profile, contained);
    requests.finished();
    const receipt = log.finish({
      finishedAt: new Date(deps.now()).toISOString(),
      ownership: { state: "owned", bucket },
      remaining,
      cleanupCommand: remaining.bucket === null ? null : cleanupCommandFor(region, cleanupPath),
    });
    let written: string;
    try {
      written = await writeReceipt(dirname(path), receipt, profile, "cleanup");
    } catch (error) {
      const refused = unplannedFailure(requests.close());
      throw new AwsRehearsalFailed(
        `cleanup receipt not written (${receiptFailureCause(error)}); ` +
          `bucket left: ${remaining.bucket ?? "none"}; ` +
          `failed teardown steps: ${failedSteps(removed.entries)}` +
          (refused === undefined ? "" : `; ${refused.message}`),
      );
    }
    deps.print(written);
    const unplanned = unplannedFailure(requests.close());
    if (unplanned !== undefined) throw unplanned;
    return {
      ok: remaining.bucket === null && contained.refused() === 0,
      receiptPath: written,
    };
  } finally {
    requests.close();
    client.destroy?.();
  }
}
