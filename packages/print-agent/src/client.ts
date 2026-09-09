/**
 * The wire client (design §3) — every call the agent makes to a Waitron server, each folded into a
 * {@link Result} so no network condition reaches the caller as a throw. `probeNode` asks a server "are
 * you the node accepting sales right now?" for the router's poll; `join`/`joinStatus` run the
 * join-and-accept handshake; `pullJobs`/`report` are the runtime's claim/settle loop.
 */

import type { PrintTransport } from "./transport.js";

/** The `/api/node` response, decoded into the shape the router compares across servers. */
export interface NodeProbe {
  nodeId: string;
  term: number | null;
  acceptingSales: boolean;
  environment: string;
}

/** One server the venue's router knows about. `nodeId` is filled in once a probe has confirmed it;
 * a freshly-added entry carries only the `url` the operator typed. */
export interface ServerEntry {
  url: string;
  nodeId?: string;
}

/** Every network condition a wire call can produce, as a value — never a throw, so a box that is off
 * can never crash the router's poll loop or the runtime. The fold lives in one place
 * ({@link foldFetch}) so a new status maps in one function. */
export type Failure =
  | { kind: "unreachable"; detail: string }
  | { kind: "unauthorized" }
  | { kind: "rate_limited" } // 429 — window flood OR pending cap; both mean back off
  | { kind: "pairing_closed" } // 403 — the venue's pairing window is shut
  | { kind: "bad_reply"; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

/** The three states a pending join can be in, as the server reports them. */
export type JoinStatus = "pending" | "approved" | "not_approved";

/** What `join` returns: the bearer token the agent stores, and the number the operator reads back to
 * confirm this is the device they mean to approve. */
export interface JoinReply {
  token: string;
  verificationNumber: string;
}

/** One job the pull hands back, decoded off the wire — `payload` is the raw ESC/POS bytes (base64 on
 * the wire, `Uint8Array` here). The connection fields mirror the printer's transport columns. */
export interface WireJob {
  id: string;
  printerId: string;
  transport: PrintTransport;
  host: string | null;
  port: number | null;
  usbPath: string | null;
  payload: Uint8Array;
}

/** The pull response: the serving node's id, the servers the venue holds (so the router can refresh
 * its set), and the claimed jobs. */
export interface PullReply {
  nodeId: string;
  servers: ServerEntry[];
  jobs: WireJob[];
}

/** The result the runtime reports back per job — `done`, or `failed` with the error text. */
export type JobOutcome = { status: "done" } | { status: "failed"; error: string };

export interface AgentClient {
  probeNode(url: string): Promise<Result<NodeProbe>>;
  join(url: string, name: string): Promise<Result<JoinReply>>;
  joinStatus(url: string, token: string): Promise<Result<JoinStatus>>;
  pullJobs(url: string, token: string): Promise<Result<PullReply>>;
  report(url: string, token: string, jobId: string, outcome: JobOutcome): Promise<Result<void>>;
}

/** The per-request deadline (ms) for {@link createClient}'s calls. A LAN round trip to a live server
 * is well under a second; a few seconds is generous headroom while still bounding a dead box's probe
 * so the router's poll loop is never held open. */
export const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * A rejection value rendered as a string, without ever throwing. A rejection is not guaranteed to be
 * an `Error`, nor even stringifiable: `String(value)` invokes `toString`, which an object is free to
 * implement badly. That throw would leave the catch block and escape this module's one contract —
 * that no network condition reaches the caller as an exception — so it is contained here.
 */
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

/** Runs one `fetch`, folding every outcome — a thrown rejection, an abort, and every HTTP status —
 * into a {@link Result}. `init` carries the method/headers/body (GET with no body by default);
 * `parseOk` decodes a 2xx body into `T`, returning `undefined` for a body that fails validation
 * (folded here to `bad_reply`) so callers never see a thrown parse error either. */
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
    // A thrown fetch (connection refused, DNS failure, …) and an aborted deadline land here
    // identically — both mean the server could not be reached in time.
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

/** Reads a JSON body into a plain object, or `undefined` for a non-JSON body or a non-object JSON
 * value (`typeof null === "object"`, so the null check guards a property read on it). */
async function readJson(response: Response): Promise<Record<string, unknown> | undefined> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return undefined;
  }
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : undefined;
}

/** A `parseOk` for a bodyless success (204). Returns a non-`undefined` sentinel so `foldFetch`'s
 * `undefined`-means-bad_reply check passes; `report` maps it back to `undefined`. */
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
      usbPath: typeof e.usbPath === "string" ? e.usbPath : null,
      payload: new Uint8Array(Buffer.from(e.payload, "base64")),
    });
  }
  return { nodeId: b.nodeId, servers, jobs };
}

/** Builds an {@link AgentClient}. `fetch` is injected (never the global) so tests run without a
 * network; `timeoutMs` bounds every request (default {@link DEFAULT_TIMEOUT_MS}). */
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
    pullJobs(url, token) {
      return foldFetch(
        opts.fetch,
        `${url}/print-api/agent/jobs`,
        timeoutMs,
        { headers: { authorization: `Bearer ${token}` } },
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
