import type { PageHold } from "@waitron/print-agent";
import { attribute, type IppEndpoint, printerUri, readAttributes } from "./ipp-capabilities.js";
import { exchangeIpp } from "./ipp-http.js";

/**
 * What printing one document over IPP came to, in the A4 failure codes the server accepts from an
 * agent (`apps/server/src/page-print-api.ts`, `AGENT_FAILURES`). `failed` means the printer did not
 * take the job; `unknown` means it may have printed some or all of it.
 */
export type IppPrintOutcome =
  | { status: "sent" }
  | { status: "failed"; failureCode: "printer_refused" | "printer_unreachable" }
  | { status: "unknown"; failureCode: "printer_aborted" | "timeout" };

export interface IppPrintTarget extends IppEndpoint {
  documentFormat: string;
}

export interface IppPrintOptions {
  /** Stops the polling once the job is submitted; a signal aborted beforehand sends nothing. */
  signal?: AbortSignal;
  submitTimeoutMs?: number;
  /** Restarted by every answer that finds the job held. */
  pollLimitMs?: number;
  pollIntervalMs?: number;
  heldPollIntervalMs?: number;
  /** Called when the printer starts holding the job, changes why, or lets it go (`null`). */
  onHold?: (hold: PageHold | null) => void;
}

export const IPP_SUBMIT_TIMEOUT_MS = 30_000;
export const IPP_POLL_LIMIT_MS = 120_000;
export const IPP_POLL_REQUEST_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 2_000;
const HELD_POLL_INTERVAL_MS = 10_000;

const SENT: IppPrintOutcome = { status: "sent" };
const REFUSED: IppPrintOutcome = { status: "failed", failureCode: "printer_refused" };
const UNREACHABLE: IppPrintOutcome = { status: "failed", failureCode: "printer_unreachable" };
const ABORTED: IppPrintOutcome = { status: "unknown", failureCode: "printer_aborted" };
const TIMEOUT: IppPrintOutcome = { status: "unknown", failureCode: "timeout" };

/** client-error-not-found and client-error-gone: the printer no longer holds the job. */
const JOB_ENDED = [0x0406, 0x0407];

const PENDING_HELD = 4;
const PROCESSING_STOPPED = 6;
const CANCELED = 7;
const ABORTED_STATE = 8;
const COMPLETED = 9;
const PRINTER_STOPPED = 5;

/** First match wins; a stopped printer whose reasons match none is `stopped`. */
const HOLD_REASONS: ReadonlyArray<readonly [PageHold, readonly string[]]> = [
  ["paper_jam", ["media-jam"]],
  ["cover_open", ["cover-open", "door-open", "interlock-open"]],
  ["paper_out", ["media-empty", "media-needed"]],
  ["tray_missing", ["input-tray-missing"]],
  ["ink_or_toner_out", ["marker-supply-empty", "toner-empty"]],
  ["output_full", ["output-area-full", "output-tray-missing"]],
  ["paused", ["paused", "moving-to-paused"]],
];

function header(operation: number, requestId: number): Buffer {
  const b = Buffer.alloc(9);
  b[0] = 2;
  b.writeUInt16BE(operation, 2);
  b.writeUInt32BE(requestId, 4);
  b[8] = 0x01;
  return b;
}

const language = (): Buffer[] => [
  attribute(0x47, "attributes-charset", "utf-8"),
  attribute(0x48, "attributes-natural-language", "en"),
];
const user = (): Buffer => attribute(0x42, "requesting-user-name", "Waitron");

function printJob(target: IppPrintTarget, document: Uint8Array): Buffer {
  return Buffer.concat([
    header(0x0002, 1),
    ...language(),
    attribute(0x45, "printer-uri", printerUri(target)),
    user(),
    attribute(0x42, "job-name", "Waitron invoice"),
    attribute(0x49, "document-format", target.documentFormat),
    Buffer.from([0x03]),
    document,
  ]);
}

function getJobAttributes(target: IppEndpoint, jobId: number, requestId: number): Buffer {
  const id = Buffer.alloc(4);
  id.writeInt32BE(jobId);
  return Buffer.concat([
    header(0x0009, requestId),
    ...language(),
    attribute(0x45, "printer-uri", printerUri(target)),
    attribute(0x21, "job-id", id),
    user(),
    attribute(0x44, "requested-attributes", "job-state"),
    attribute(0x44, "", "job-state-reasons"),
    Buffer.from([0x03]),
  ]);
}

function getPrinterAttributes(target: IppEndpoint, requestId: number): Buffer {
  return Buffer.concat([
    header(0x000b, requestId),
    ...language(),
    attribute(0x45, "printer-uri", printerUri(target)),
    user(),
    attribute(0x44, "requested-attributes", "printer-state"),
    attribute(0x44, "", "printer-state-reasons"),
    Buffer.from([0x03]),
  ]);
}

/** The status code of a reply with an IPP 1.x or 2.x header, else `undefined`. */
function statusOf(reply: Buffer): number | undefined {
  if (reply.length < 8 || (reply[0] !== 1 && reply[0] !== 2)) return undefined;
  return reply.readUInt16BE(2);
}

interface JobReport {
  jobId?: number;
  state?: number;
  reasons: string[];
}

function readJob(reply: Buffer): JobReport | undefined {
  const values = readAttributes(reply)?.filter((v) => v.group === 2);
  if (values === undefined) return undefined;
  const integer = (name: string, tag: number): number | undefined =>
    values
      .find((v) => v.name === name && v.tag === tag && v.value.length === 4)
      ?.value.readInt32BE(0);
  return {
    jobId: integer("job-id", 0x21),
    state: integer("job-state", 0x23),
    reasons: values
      .filter((v) => v.name === "job-state-reasons" && v.tag === 0x44)
      .map((v) => v.value.toString("utf8")),
  };
}

/** The outcome a finished job reached, or `undefined` while it may still print. */
function finishedAs(job: JobReport): IppPrintOutcome | undefined {
  if (job.state === CANCELED || job.state === ABORTED_STATE) return ABORTED;
  if (job.state !== COMPLETED) return undefined;
  const cut = job.reasons.some(
    (r) =>
      r === "job-completed-with-errors" ||
      r === "aborted-by-system" ||
      r.startsWith("job-canceled"),
  );
  return cut ? ABORTED : SENT;
}

/** Whether the printer's own state is worth asking for: the job says it is stopped or held. */
function mayBeHeld(job: JobReport): boolean {
  return (
    job.state === PENDING_HELD ||
    job.state === PROCESSING_STOPPED ||
    job.reasons.includes("printer-stopped")
  );
}

/**
 * Why a stopped printer holds its jobs, `null` for a printer that is not stopped, or `undefined`
 * for an unreadable or refused reply. RFC 8011 §5.4.12: a stopped printer's unsuffixed reason is an
 * error, and a `-warning` or `-report` one cannot keep a job from completing.
 */
function holdOf(reply: Buffer): PageHold | null | undefined {
  const values = readAttributes(reply)?.filter((v) => v.group === 4);
  if (values === undefined) return undefined;
  const state = values
    .find((v) => v.name === "printer-state" && v.tag === 0x23 && v.value.length === 4)
    ?.value.readInt32BE(0);
  if (state !== PRINTER_STOPPED) return null;
  const reasons = values
    .filter((v) => v.name === "printer-state-reasons" && v.tag === 0x44)
    .map((v) => v.value.toString("utf8"))
    .filter((r) => !r.endsWith("-warning") && !r.endsWith("-report"))
    .map((r) => r.replace(/-error$/, ""));
  return (
    HOLD_REASONS.find(([, keywords]) => keywords.some((k) => reasons.includes(k)))?.[0] ?? "stopped"
  );
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

async function pollJob(
  target: IppPrintTarget,
  jobId: number,
  options: IppPrintOptions,
): Promise<IppPrintOutcome> {
  const stop = new AbortController();
  const end = (): void => stop.abort();
  const limit = options.pollLimitMs ?? IPP_POLL_LIMIT_MS;
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  let bound: ReturnType<typeof setTimeout> | undefined;
  let nearing: ReturnType<typeof setTimeout> | undefined;
  /** Set once the last poll before the bound may be under way: the printer is asked then too. */
  let nearBound = false;
  const restartBound = (): void => {
    clearTimeout(bound);
    clearTimeout(nearing);
    bound = setTimeout(end, limit);
    const untilNear = limit - interval - IPP_POLL_REQUEST_TIMEOUT_MS;
    nearBound = untilNear <= 0;
    if (!nearBound) nearing = setTimeout(() => (nearBound = true), untilNear);
  };
  restartBound();
  options.signal?.addEventListener("abort", end, { once: true });
  if (options.signal?.aborted) end();
  let requestId = 2;
  const ask = (body: Buffer) =>
    exchangeIpp(
      target.host,
      target.port,
      target.resourcePath,
      body,
      IPP_POLL_REQUEST_TIMEOUT_MS,
      stop.signal,
    );
  let hold: PageHold | null = null;
  const report = (change: PageHold | null): void => {
    try {
      options.onHold?.(change);
    } catch {
      // The caller's failure must not change what the job came to.
    }
  };
  try {
    while (!stop.signal.aborted) {
      const reply = await ask(getJobAttributes(target, jobId, requestId++));
      if (reply.kind === "reply" && JOB_ENDED.includes(statusOf(reply.body) ?? 0)) return TIMEOUT;
      const job = reply.kind === "reply" ? readJob(reply.body) : undefined;
      const outcome = job && finishedAs(job);
      if (outcome !== undefined) return outcome;
      if (job !== undefined && (hold !== null || nearBound || mayBeHeld(job))) {
        const printer = await ask(getPrinterAttributes(target, requestId++));
        const seen = printer.kind === "reply" ? holdOf(printer.body) : undefined;
        if (seen !== undefined) {
          if (seen !== null) restartBound();
          if (seen !== hold) report((hold = seen));
        }
      }
      await pause(
        hold === null ? interval : (options.heldPollIntervalMs ?? HELD_POLL_INTERVAL_MS),
        stop.signal,
      );
    }
    return TIMEOUT;
  } finally {
    clearTimeout(bound);
    clearTimeout(nearing);
    options.signal?.removeEventListener("abort", end);
  }
}

/**
 * Sends `document` to an IPP printer as one Print-Job and follows that job until it ends, the
 * printer forgets it, the poll bound passes with no answer finding it held, or `options.signal`
 * aborts. Never sends the job twice, never cancels it and never throws. The printer's own words
 * never leave this function: its replies are read only to pick an outcome or a hold code.
 */
export async function printOverIpp(
  target: IppPrintTarget,
  document: Uint8Array,
  options: IppPrintOptions = {},
): Promise<IppPrintOutcome> {
  if (options.signal?.aborted) return TIMEOUT;
  let body: Buffer;
  try {
    body = printJob(target, document);
  } catch {
    return UNREACHABLE;
  }
  const reply = await exchangeIpp(
    target.host,
    target.port,
    target.resourcePath,
    body,
    options.submitTimeoutMs ?? IPP_SUBMIT_TIMEOUT_MS,
  );
  if (reply.kind === "unreachable") return UNREACHABLE;
  if (reply.kind === "http_refused") return REFUSED;
  if (reply.kind === "no_answer") return TIMEOUT;
  if ((statusOf(reply.body) ?? 0) > 0xff) return REFUSED;
  const job = readJob(reply.body);
  if (job?.jobId === undefined) return TIMEOUT;
  return finishedAs(job) ?? pollJob(target, job.jobId, options);
}
