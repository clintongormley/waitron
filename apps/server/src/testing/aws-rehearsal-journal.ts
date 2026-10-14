// What a rehearsal run has created, written as it goes, so a keeper can clean up after a kill.
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import {
  isReceiptRegion,
  isReceiptToken,
  isReceiptUploadId,
  REHEARSAL_BUCKET_PATTERN,
} from "./aws-rehearsal-receipt.js";
import { AwsRehearsalRefused } from "./aws-rehearsal-refused.js";

export const JOURNAL_VERSION = 1;

export const JOURNAL_STATES = [
  "creating",
  "owned",
  "not-created",
  "collision",
  "deleted",
  "finished",
] as const;

export type JournalState = (typeof JOURNAL_STATES)[number];

export interface JournalUpload {
  key: string;
  uploadId: string;
}

export interface JournalPid {
  pid: number;
  /** As `ps -o lstart= -p <pid>` printed it when tracked; null when it could not be read. */
  startTime: string | null;
}

/** The run receipt's header less the fields the journal holds itself and `finishedAt`. */
export interface JournalHeader {
  commit: string;
  node: string;
  sdkVersion: string;
  litestreamVersion: string;
  startedAt: string;
  limits: Record<string, number>;
}

export interface RehearsalJournal {
  version: typeof JOURNAL_VERSION;
  runId: string;
  region: string;
  bucket: string;
  state: JournalState;
  uploads: JournalUpload[];
  pids: JournalPid[];
  /** `<scratchBase>/waitron-aws-rehearsal-<runId>`, written before the folder is made; null until then. */
  scratchRoot: string | null;
  receiptDir: string;
  header: JournalHeader;
  teardownMs: number;
  /** Twice the run's whole budget: deadline, settle and teardown. */
  keeperCeilingMs: number;
  endpoint?: string;
  keeperPid: number | null;
  ready: boolean | null;
}

const KEYS = [
  "version",
  "runId",
  "region",
  "bucket",
  "state",
  "uploads",
  "pids",
  "scratchRoot",
  "receiptDir",
  "header",
  "teardownMs",
  "keeperCeilingMs",
  "endpoint",
  "keeperPid",
  "ready",
] as const;
const HEADER_TOKENS = ["commit", "node", "sdkVersion", "litestreamVersion", "startedAt"] as const;
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/;
const START_TIME = /^[A-Za-z0-9 :]{1,64}$/;
const RECEIPT_DIR = /^\/[A-Za-z0-9._/@-]+$/;
const S3_KEY_MAX = 1024;
const CONTROL = /\p{Cc}/u;
// Far above any run's budget, and inside what setTimeout can wait.
const DURATION_MAX_MS = 24 * 60 * 60_000;

export function journalFileName(runId: string): string {
  return `aws-rehearsal-${runId}-journal.json`;
}

/**
 * Synchronous and atomic, so a kill after this returns finds the journal it wrote and a kill during
 * it finds the previous one whole.
 */
export function writeJournal(receiptDir: string, journal: RehearsalJournal): void {
  mkdirSync(receiptDir, { recursive: true });
  const path = join(receiptDir, journalFileName(journal.runId));
  const temporary = `${path}.${process.pid}.tmp`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

export function processStartTime(pid: number): string | null {
  try {
    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return started === "" ? null : started;
  } catch {
    return null;
  }
}

function refused(field: string): AwsRehearsalRefused {
  return new AwsRehearsalRefused("journal-refused", `the journal's ${field} is not one it accepts`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw refused(`${prefix}fields`);
  }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Pid 1 is init or launchd, never a child the run started. */
function childPid(value: unknown): value is number {
  return positiveInteger(value) && value > 1;
}

function duration(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > DURATION_MAX_MS
  ) {
    throw refused(field);
  }
  return value;
}

function receiptDir(value: unknown): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    !RECEIPT_DIR.test(value) ||
    normalize(value) !== value ||
    (value.length > 1 && value.endsWith("/")) ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    throw refused("receiptDir");
  }
  return value;
}

/** The upload keys the journal's reader accepts. */
export function isJournalUploadKey(key: unknown): key is string {
  return (
    typeof key === "string" && key.length > 0 && key.length <= S3_KEY_MAX && !CONTROL.test(key)
  );
}

function uploads(value: unknown): JournalUpload[] {
  if (!Array.isArray(value)) throw refused("uploads");
  return value.map((upload) => {
    if (!isRecord(upload)) throw refused("uploads");
    onlyKeys(upload, ["key", "uploadId"], "uploads.");
    const { key, uploadId } = upload;
    if (!isJournalUploadKey(key)) throw refused("uploads");
    if (!isReceiptUploadId(uploadId)) throw refused("uploads");
    return { key, uploadId };
  });
}

function pids(value: unknown): JournalPid[] {
  if (!Array.isArray(value)) throw refused("pids");
  return value.map((entry) => {
    if (!isRecord(entry)) throw refused("pids");
    onlyKeys(entry, ["pid", "startTime"], "pids.");
    const { pid, startTime } = entry;
    if (!childPid(pid)) throw refused("pids");
    if (startTime !== null && (typeof startTime !== "string" || !START_TIME.test(startTime))) {
      throw refused("pids");
    }
    return { pid, startTime };
  });
}

function header(value: unknown): JournalHeader {
  if (!isRecord(value)) throw refused("header");
  onlyKeys(value, [...HEADER_TOKENS, "limits"], "header.");
  const read = {} as JournalHeader;
  for (const key of HEADER_TOKENS) {
    if (!isReceiptToken(value[key])) throw refused(`header.${key}`);
    read[key] = value[key];
  }
  const limits = value.limits;
  if (!isRecord(limits)) throw refused("header.limits");
  read.limits = {};
  for (const [name, limit] of Object.entries(limits)) {
    if (!isReceiptToken(name) || typeof limit !== "number" || !Number.isFinite(limit)) {
      throw refused("header.limits");
    }
    read.limits[name] = limit;
  }
  return read;
}

/**
 * Refuses anything malformed or outside the keeper's bounds; a refusal names the field, never its
 * value. `tmpdir` is the folder the scratch root must sit directly in.
 */
export function readJournal(text: string, options: { tmpdir: string }): RehearsalJournal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw refused("JSON");
  }
  if (!isRecord(parsed)) throw refused("JSON");
  onlyKeys(parsed, KEYS, "");
  for (const key of KEYS) {
    if (key !== "endpoint" && !(key in parsed)) throw refused(key);
  }
  if (parsed.version !== JOURNAL_VERSION) throw refused("version");
  const runId = parsed.runId;
  if (!isReceiptToken(runId)) throw refused("runId");
  if (!isReceiptRegion(parsed.region)) throw refused("region");
  const bucket = parsed.bucket;
  if (typeof bucket !== "string" || !REHEARSAL_BUCKET_PATTERN.test(bucket)) {
    throw refused("bucket");
  }
  const state = parsed.state;
  if (typeof state !== "string" || !(JOURNAL_STATES as readonly string[]).includes(state)) {
    throw refused("state");
  }
  const scratchRoot = parsed.scratchRoot;
  if (
    scratchRoot !== null &&
    scratchRoot !== join(options.tmpdir, `waitron-aws-rehearsal-${runId}`)
  ) {
    throw refused("scratchRoot");
  }
  const endpoint = parsed.endpoint;
  if (endpoint !== undefined) {
    const port =
      typeof endpoint === "string" && LOOPBACK.test(endpoint) ? Number(endpoint.split(":")[2]) : 0;
    if (port < 1 || port > 65535) throw refused("endpoint");
  }
  const keeperPid = parsed.keeperPid;
  if (keeperPid !== null && !positiveInteger(keeperPid)) throw refused("keeperPid");
  const ready = parsed.ready;
  if (ready !== null && typeof ready !== "boolean") throw refused("ready");
  return {
    version: JOURNAL_VERSION,
    runId,
    region: parsed.region,
    bucket,
    state: state as JournalState,
    uploads: uploads(parsed.uploads),
    pids: pids(parsed.pids),
    scratchRoot,
    receiptDir: receiptDir(parsed.receiptDir),
    header: header(parsed.header),
    teardownMs: duration(parsed.teardownMs, "teardownMs"),
    keeperCeilingMs: duration(parsed.keeperCeilingMs, "keeperCeilingMs"),
    ...(endpoint === undefined ? {} : { endpoint: endpoint as string }),
    keeperPid,
    ready,
  };
}
