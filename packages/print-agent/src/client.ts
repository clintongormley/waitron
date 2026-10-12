// Every call is folded into a Result, so no network condition reaches the caller as a throw.

import type {
  DiscoveredDevice,
  NetworkProbe,
  PairedBluetoothDevice,
  VisibleDevice,
} from "./host.js";
import type { PrintTransport } from "./transport.js";

/**
 * Every pull reports the devices it can deliver a job to now (`visible`) and active scan or
 * address-check results (`scanned`).
 */
export interface AgentInventory {
  host?: string;
  setupUrl?: string | null;
  setupPort?: number;
  visible: VisibleDevice[];
  scanned: DiscoveredDevice[];
  pairedBluetooth: PairedBluetoothDevice[];
  bluetoothOutcomes: BluetoothCommandOutcome[];
  bluetoothPrinting?: boolean;
}

export type BluetoothCommandKind = "pair" | "forget";

export interface BluetoothCommand {
  id: string;
  kind: BluetoothCommandKind;
  /** Always a full upper-case `XX:XX:XX:XX:XX:XX`, never bluetoothctl's `*` (every device). */
  address: string;
  /** The operator's PIN, on `pair` only: 1–16 printable ASCII characters, no spaces. Never
   * log it. */
  pin?: string;
}

export interface BluetoothCommandOutcome {
  id: string;
  ok: boolean;
  error?: string;
}

export interface NodeProbe {
  nodeId: string;
  term: number | null;
  acceptingSales: boolean;
  environment: string;
}

/** `nodeId` is filled in once a probe has confirmed it. */
export interface ServerEntry {
  url: string;
  nodeId?: string;
}

export type Failure =
  | { kind: "unreachable"; detail: string }
  | { kind: "unauthorized" }
  | { kind: "rate_limited" } // 429 — window flood OR pending cap; both mean back off
  | { kind: "pairing_closed" } // 403 — the venue's pairing window is shut
  | { kind: "refused" } // self-enrol only — the box's OWN server said no (any non-2xx); NOT a pairing event
  | { kind: "claim_lost" } // page jobs only — 409 `invoice_delivery.claim_lost`; final
  | { kind: "bad_reply"; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

export type JoinStatus = "pending" | "approved" | "not_approved";

/** `verificationNumber` is what the operator reads back to confirm which device they approve. */
export interface JoinReply {
  token: string;
  verificationNumber: string;
}

export type InvoicePrintClaim = { deliveryId: string; generation: number; token: string };

export interface WireJob {
  id: string;
  printerId: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  /** USB serial or Bluetooth MAC; the host resolves it to a device path. */
  localKey: string | null;
  payload: Uint8Array;
  invoiceClaim?: InvoicePrintClaim;
}

export interface PullReply {
  nodeId: string;
  servers: ServerEntry[];
  jobs: WireJob[];
  discoveryUntil: number | null;
  networkProbes?: NetworkProbe[];
  bluetoothCommands?: BluetoothCommand[];
}

export type JobOutcome = ({ status: "done" } | { status: "failed"; error: string }) & {
  invoiceClaim?: InvoicePrintClaim;
};

/** The server's `pagePrinterFormat` and `pagePrinterMedia` (`packages/db`); a server-side case in
 * `apps/server/src/page-print-api.test.ts` holds them equal. */
export const PAGE_FORMATS = ["application/pdf", "image/pwg-raster", "image/urf"] as const;
export const PAGE_MEDIA = ["iso_a4_210x297mm", "na_letter_8.5x11in"] as const;
export type PageFormat = (typeof PAGE_FORMATS)[number];
export type PageMedia = (typeof PAGE_MEDIA)[number];
/** Why a printer is holding an unfinished job, read from its `printer-state-reasons`. */
export const PAGE_HOLDS = [
  "paper_jam",
  "cover_open",
  "paper_out",
  "tray_missing",
  "ink_or_toner_out",
  "output_full",
  "paused",
  "stopped",
] as const;
export type PageHold = (typeof PAGE_HOLDS)[number];

/** An A4 invoice this agent holds a claim on, and the office printer it goes to. */
export interface PageJob {
  id: string;
  generation: number;
  token: string;
  printer: {
    id: string;
    host: string;
    port: number;
    resourcePath: string;
    documentFormat: PageFormat;
    media: PageMedia;
    resolutionDpi: number;
  };
}

/** The outcomes the server accepts from an agent (`AGENT_FAILURES`,
 * `apps/server/src/page-print-api.ts`). */
export type PageJobOutcome =
  | { status: "sent" }
  | {
      status: "failed";
      failureCode: "printer_refused" | "printer_unreachable" | "document_unavailable";
    }
  | { status: "unknown"; failureCode: "printer_aborted" | "timeout" };

export interface AgentClient {
  probeNode(url: string): Promise<Result<NodeProbe>>;
  join(url: string, name: string): Promise<Result<JoinReply>>;
  /** Enrol on THIS box's own loopback, never through a pairing window: any status but 201 is
   * `refused`. */
  enrolSelf(url: string, name: string): Promise<Result<{ token: string }>>;
  joinStatus(url: string, token: string): Promise<Result<JoinStatus>>;
  pullJobs(url: string, token: string, inventory: AgentInventory): Promise<Result<PullReply>>;
  report(url: string, token: string, jobId: string, outcome: JobOutcome): Promise<Result<void>>;
  /** `null` when no A4 job is waiting for this agent. */
  claimPageJob(url: string, token: string): Promise<Result<PageJob | null>>;
  fetchPageDocument(url: string, token: string, job: PageJob): Promise<Result<Uint8Array>>;
  renewPageJob(
    url: string,
    token: string,
    job: PageJob,
    hold: PageHold | null,
  ): Promise<Result<void>>;
  reportPageJob(
    url: string,
    token: string,
    job: PageJob,
    outcome: PageJobOutcome,
  ): Promise<Result<void>>;
}

/** Bounds a dead box's probe so the router's poll loop is never held open. */
export const DEFAULT_TIMEOUT_MS = 3_000;

/** The server renders the pages while this request waits, so it gets far longer than the other
 * calls; still inside the 60 s claim lease. */
export const PAGE_DOCUMENT_TIMEOUT_MS = 30_000;

/** `String(value)` invokes a `toString` an object is free to implement badly, and that throw must not
 * escape this module. */
export function describeRejection(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "unstringifiable rejection";
  }
}

function isNodeProbe(value: unknown): value is Omit<NodeProbe, "term"> & { term?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.nodeId === "string" &&
    typeof candidate.acceptingSales === "boolean" &&
    typeof candidate.environment === "string"
  );
}

/** `parseOk` returns `undefined` for a body that fails validation, which folds to `bad_reply`. */
async function foldFetch<T>(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  parseOk: (response: Response) => Promise<T | undefined>,
  refusal?: (response: Response) => Promise<Failure | undefined>,
): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", ...init.headers },
      body: init.body,
      signal: controller.signal,
    });
    if (response.status === 401) return { ok: false, failure: { kind: "unauthorized" } };
    if (response.status === 403) return { ok: false, failure: { kind: "pairing_closed" } };
    if (response.status === 429) return { ok: false, failure: { kind: "rate_limited" } };
    const refused = response.ok ? undefined : await refusal?.(response);
    if (refused !== undefined) return { ok: false, failure: refused };
    if (response.status >= 500) {
      return {
        ok: false,
        failure: { kind: "unreachable", detail: `status ${response.status}` },
      };
    }
    if (!response.ok) {
      return { ok: false, failure: { kind: "bad_reply", detail: `status ${response.status}` } };
    }
    const value = await parseOk(response);
    if (value === undefined) {
      return { ok: false, failure: { kind: "bad_reply", detail: "invalid response body" } };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, failure: { kind: "unreachable", detail: describeRejection(error) } };
  } finally {
    clearTimeout(timer);
  }
}

async function parseNodeProbe(response: Response): Promise<NodeProbe | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  if (!isNodeProbe(body)) return undefined;
  return {
    nodeId: body.nodeId,
    term: typeof body.term === "number" ? body.term : null,
    acceptingSales: body.acceptingSales,
    environment: body.environment,
  };
}

async function readJson(response: Response): Promise<Record<string, unknown> | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : undefined;
}

/** A non-`undefined` sentinel, because `undefined` means bad_reply to `foldFetch`. */
function parseVoid(): Promise<true> {
  return Promise.resolve(true);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function parsePullReply(response: Response): Promise<PullReply | undefined> {
  const b = await readJson(response);
  if (b === undefined) return undefined;
  if (typeof b.nodeId !== "string" || !Array.isArray(b.servers) || !Array.isArray(b.jobs)) {
    return undefined;
  }
  const servers: ServerEntry[] = [];
  for (const s of b.servers) {
    if (
      typeof s === "object" &&
      s !== null &&
      typeof (s as Record<string, unknown>).url === "string"
    ) {
      const e = s as Record<string, unknown>;
      servers.push(
        typeof e.nodeId === "string"
          ? { url: e.url as string, nodeId: e.nodeId }
          : { url: e.url as string },
      );
    }
  }
  const jobs: WireJob[] = [];
  for (const j of b.jobs) {
    if (typeof j !== "object" || j === null) return undefined;
    const e = j as Record<string, unknown>;
    if (
      typeof e.id !== "string" ||
      typeof e.printerId !== "string" ||
      typeof e.transport !== "string" ||
      typeof e.payload !== "string"
    ) {
      return undefined;
    }
    let invoiceClaim: InvoicePrintClaim | undefined;
    if (e.invoiceClaim !== undefined) {
      if (
        typeof e.invoiceClaim !== "object" ||
        e.invoiceClaim === null ||
        Array.isArray(e.invoiceClaim)
      )
        return undefined;
      const claim = e.invoiceClaim as Record<string, unknown>;
      if (
        typeof claim.deliveryId !== "string" ||
        !UUID.test(claim.deliveryId) ||
        typeof claim.token !== "string" ||
        !UUID.test(claim.token) ||
        typeof claim.generation !== "number" ||
        !Number.isSafeInteger(claim.generation) ||
        claim.generation < 1
      )
        return undefined;
      invoiceClaim = {
        deliveryId: claim.deliveryId,
        generation: claim.generation,
        token: claim.token,
      };
    }
    jobs.push({
      id: e.id,
      printerId: e.printerId,
      transport: e.transport as PrintTransport,
      host: typeof e.host === "string" ? e.host : null,
      port: typeof e.port === "number" ? e.port : null,
      localKey: typeof e.localKey === "string" ? e.localKey : null,
      payload: new Uint8Array(Buffer.from(e.payload, "base64")),
      ...(invoiceClaim === undefined ? {} : { invoiceClaim }),
    });
  }
  const discoveryUntil = typeof b.discoveryUntil === "number" ? b.discoveryUntil : null;
  const networkProbes: NetworkProbe[] = [];
  for (const raw of Array.isArray(b.networkProbes) ? b.networkProbes.slice(0, 8) : []) {
    if (typeof raw !== "object" || raw === null) continue;
    const target = raw as Record<string, unknown>;
    if (
      typeof target.host !== "string" ||
      target.host.length > 64 ||
      typeof target.port !== "number" ||
      !Number.isInteger(target.port) ||
      target.port < 1 ||
      target.port > 65535 ||
      typeof target.expiresInMs !== "number" ||
      !Number.isFinite(target.expiresInMs) ||
      target.expiresInMs <= 0 ||
      target.expiresInMs > 30_000
    )
      continue;
    networkProbes.push({ host: target.host, port: target.port, expiresInMs: target.expiresInMs });
  }
  const bluetoothCommands = decodeBluetoothCommands(b.bluetoothCommands);
  return {
    nodeId: b.nodeId,
    servers,
    jobs,
    discoveryUntil,
    ...(networkProbes.length ? { networkProbes } : {}),
    ...(bluetoothCommands.length ? { bluetoothCommands } : {}),
  };
}

/** How many Bluetooth commands the agent holds at once (queued, running, or with an unsent
 * outcome), so also the most outcomes one pull carries, and how many taken ids it remembers; and the
 * most commands it reads from one reply. */
export const BLUETOOTH_COMMAND_LIMIT = 8;
export const PIN_WITHHELD = "pairing failed; the detail was withheld because it contained the PIN";
const MAX_COMMAND_ID_LENGTH = 128;
export const MAX_OUTCOME_ERROR_LENGTH = 500;
const MAC_PATTERN = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
// Printable ASCII only, so the byte count BlueZ limits equals the length, and no newline can reach a
// line-oriented child's stdin.
const PIN_PATTERN = /^[\x21-\x7e]{1,16}$/;

export function isBluetoothAddress(value: string): boolean {
  return MAC_PATTERN.test(value);
}

export function isBluetoothPin(value: string): boolean {
  return PIN_PATTERN.test(value);
}

/** Withheld whole: masking only the PIN leaves it readable from what surrounds the gap. */
export function withholdPin(error: string, pin: string | undefined): string {
  return pin !== undefined && error.includes(pin) ? PIN_WITHHELD : error;
}

/** A malformed command is dropped alone, never failing the reply, so a server newer or older than
 * this agent cannot stop printing. */
function decodeBluetoothCommands(raw: unknown): BluetoothCommand[] {
  const commands: BluetoothCommand[] = [];
  for (const entry of Array.isArray(raw) ? raw.slice(0, BLUETOOTH_COMMAND_LIMIT) : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, kind, address, pin } = entry as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > MAX_COMMAND_ID_LENGTH ||
      (kind !== "pair" && kind !== "forget") ||
      typeof address !== "string" ||
      !isBluetoothAddress(address)
    )
      continue;
    const command: BluetoothCommand = { id, kind, address: address.toUpperCase() };
    if (kind === "pair" && pin !== undefined) {
      if (typeof pin !== "string" || !isBluetoothPin(pin)) continue;
      command.pin = pin;
    }
    commands.push(command);
  }
  return commands;
}

async function parsePageJob(response: Response): Promise<PageJob | null | undefined> {
  if (response.status === 204) return null;
  const b = await readJson(response);
  const p = b?.printer;
  if (b === undefined || typeof p !== "object" || p === null) return undefined;
  const printer = p as Record<string, unknown>;
  if (
    typeof b.id !== "string" ||
    !UUID.test(b.id) ||
    typeof b.generation !== "number" ||
    !Number.isSafeInteger(b.generation) ||
    b.generation < 1 ||
    typeof b.token !== "string" ||
    !UUID.test(b.token) ||
    typeof printer.id !== "string" ||
    typeof printer.host !== "string" ||
    printer.host.length === 0 ||
    typeof printer.port !== "number" ||
    !Number.isInteger(printer.port) ||
    printer.port < 1 ||
    printer.port > 65535 ||
    typeof printer.resourcePath !== "string" ||
    !printer.resourcePath.startsWith("/") ||
    typeof printer.documentFormat !== "string" ||
    !(PAGE_FORMATS as readonly string[]).includes(printer.documentFormat) ||
    typeof printer.media !== "string" ||
    !(PAGE_MEDIA as readonly string[]).includes(printer.media) ||
    typeof printer.resolutionDpi !== "number" ||
    !Number.isInteger(printer.resolutionDpi) ||
    printer.resolutionDpi < 1
  )
    return undefined;
  return {
    id: b.id,
    generation: b.generation,
    token: b.token,
    printer: {
      id: printer.id,
      host: printer.host,
      port: printer.port,
      resourcePath: printer.resourcePath,
      documentFormat: printer.documentFormat as PageFormat,
      media: printer.media as PageMedia,
      resolutionDpi: printer.resolutionDpi,
    },
  };
}

async function claimLost(response: Response): Promise<Failure | undefined> {
  if (response.status !== 409) return undefined;
  const error = (await readJson(response))?.error;
  return typeof error === "object" &&
    error !== null &&
    (error as Record<string, unknown>).code === "invoice_delivery.claim_lost"
    ? { kind: "claim_lost" }
    : undefined;
}

function boundInventory(inventory: AgentInventory): AgentInventory {
  return {
    ...inventory,
    bluetoothOutcomes: inventory.bluetoothOutcomes.map((outcome) =>
      outcome.error === undefined
        ? outcome
        : { ...outcome, error: outcome.error.slice(0, MAX_OUTCOME_ERROR_LENGTH) },
    ),
  };
}

export function createClient(opts: { fetch: typeof fetch; timeoutMs?: number }): AgentClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    probeNode(url) {
      return foldFetch(opts.fetch, `${url}/api/node`, timeoutMs, {}, parseNodeProbe);
    },
    join(url, name) {
      return foldFetch(
        opts.fetch,
        `${url}/print-api/agent/join`,
        timeoutMs,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        },
        async (response) => {
          const b = await readJson(response);
          if (
            b === undefined ||
            typeof b.token !== "string" ||
            typeof b.verificationNumber !== "string"
          ) {
            return undefined;
          }
          return { token: b.token, verificationNumber: b.verificationNumber };
        },
      );
    },
    async enrolSelf(url, name) {
      // NOT foldFetch, which would mislabel a self-enrol refusal as a pairing event: here every
      // non-201 means one thing — the box will not self-enrol us.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await opts.fetch(`${url}/api/node/enrol-self`, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ name }),
          signal: controller.signal,
        });
        if (response.status !== 201) return { ok: false, failure: { kind: "refused" } };
        const b = await readJson(response);
        if (b === undefined || typeof b.token !== "string") {
          return { ok: false, failure: { kind: "refused" } };
        }
        return { ok: true, value: { token: b.token } };
      } catch (error) {
        return { ok: false, failure: { kind: "unreachable", detail: describeRejection(error) } };
      } finally {
        clearTimeout(timer);
      }
    },
    joinStatus(url, token) {
      return foldFetch(
        opts.fetch,
        `${url}/print-api/agent/join/status`,
        timeoutMs,
        { headers: { authorization: `Bearer ${token}` } },
        async (response) => {
          const b = await readJson(response);
          const s = b?.status;
          return s === "pending" || s === "approved" || s === "not_approved" ? s : undefined;
        },
      );
    },
    pullJobs(url, token, inventory) {
      return foldFetch(
        opts.fetch,
        `${url}/print-api/agent/jobs`,
        timeoutMs,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(boundInventory(inventory)),
        },
        parsePullReply,
      );
    },
    async report(url, token, jobId, outcome) {
      const result = await foldFetch(
        opts.fetch,
        `${url}/print-api/agent/jobs/${jobId}/result`,
        timeoutMs,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(outcome),
        },
        parseVoid,
      );
      return result.ok ? { ok: true, value: undefined } : result;
    },
    claimPageJob(url, token) {
      return foldFetch(
        opts.fetch,
        `${url}/print-api/agent/page-jobs/claim`,
        timeoutMs,
        { method: "POST", headers: { authorization: `Bearer ${token}` } },
        parsePageJob,
      );
    },
    fetchPageDocument(url, token, job) {
      return foldFetch(
        opts.fetch,
        `${url}/print-api/agent/page-jobs/${job.id}/document`,
        PAGE_DOCUMENT_TIMEOUT_MS,
        claimed(token, job, {}),
        async (response) => new Uint8Array(await response.arrayBuffer()),
        claimLost,
      );
    },
    async renewPageJob(url, token, job, hold) {
      const result = await foldFetch(
        opts.fetch,
        `${url}/print-api/agent/page-jobs/${job.id}/renew`,
        timeoutMs,
        claimed(token, job, { hold }),
        parseVoid,
        claimLost,
      );
      return result.ok ? { ok: true, value: undefined } : result;
    },
    async reportPageJob(url, token, job, outcome) {
      const result = await foldFetch(
        opts.fetch,
        `${url}/print-api/agent/page-jobs/${job.id}/result`,
        timeoutMs,
        claimed(token, job, outcome),
        parseVoid,
        claimLost,
      );
      return result.ok ? { ok: true, value: undefined } : result;
    },
  };
}

function claimed(token: string, job: PageJob, extra: object) {
  return {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ generation: job.generation, token: job.token, ...extra }),
  };
}
