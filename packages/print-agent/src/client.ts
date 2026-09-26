// Every call is folded into a Result, so no network condition reaches the caller as a throw.

import type { DiscoveredDevice, NetworkProbe, VisibleDevice } from "./host.js";
import type { PrintTransport } from "./transport.js";

/** Every pull reports local presence (`visible`) and active scan or address-check results (`scanned`). */
export interface AgentInventory {
  host?: string;
  setupUrl?: string | null;
  setupPort?: number;
  visible: VisibleDevice[];
  scanned: DiscoveredDevice[];
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
  | { kind: "bad_reply"; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

export type JoinStatus = "pending" | "approved" | "not_approved";

/** `verificationNumber` is what the operator reads back to confirm which device they approve. */
export interface JoinReply {
  token: string;
  verificationNumber: string;
}

export interface WireJob {
  id: string;
  printerId: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  /** USB serial or Bluetooth MAC; the host resolves it to a device path. */
  localKey: string | null;
  payload: Uint8Array;
}

export interface PullReply {
  nodeId: string;
  servers: ServerEntry[];
  jobs: WireJob[];
  discoveryUntil: number | null;
  networkProbes?: NetworkProbe[];
}

export type JobOutcome = { status: "done" } | { status: "failed"; error: string };

export interface AgentClient {
  probeNode(url: string): Promise<Result<NodeProbe>>;
  join(url: string, name: string): Promise<Result<JoinReply>>;
  /** Enrol on THIS box's own loopback, never through a pairing window: any status but 201 is
   * `refused`. */
  enrolSelf(url: string, name: string): Promise<Result<{ token: string }>>;
  joinStatus(url: string, token: string): Promise<Result<JoinStatus>>;
  pullJobs(url: string, token: string, inventory: AgentInventory): Promise<Result<PullReply>>;
  report(url: string, token: string, jobId: string, outcome: JobOutcome): Promise<Result<void>>;
}

/** Bounds a dead box's probe so the router's poll loop is never held open. */
export const DEFAULT_TIMEOUT_MS = 3_000;

/** `String(value)` invokes a `toString` an object is free to implement badly, and that throw must not
 * escape this module. */
function describeRejection(error: unknown): string {
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
    jobs.push({
      id: e.id,
      printerId: e.printerId,
      transport: e.transport as PrintTransport,
      host: typeof e.host === "string" ? e.host : null,
      port: typeof e.port === "number" ? e.port : null,
      localKey: typeof e.localKey === "string" ? e.localKey : null,
      payload: new Uint8Array(Buffer.from(e.payload, "base64")),
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
  return {
    nodeId: b.nodeId,
    servers,
    jobs,
    discoveryUntil,
    ...(networkProbes.length ? { networkProbes } : {}),
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
          body: JSON.stringify(inventory),
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
  };
}
