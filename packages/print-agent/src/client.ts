/**
 * The wire client (design §3) — how the agent asks a Waitron server "are you the node accepting
 * sales right now?" A later slice's router polls every server a venue holds with this and follows
 * whichever one answers yes; this slice only lands `probeNode`, the single call that router needs.
 * `join`, `pullJobs` and `report` are deliberately not here (task-2-brief.md scope ruling).
 */

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

/** Every network condition `probeNode` can produce, as a value — never a throw, so a box that is
 * off can never crash the router's poll loop. The join branch (a later slice) widens this with
 * `pending` / `rate_limited` / `full` / `pairing_closed`; keep the fold in one place ({@link foldFetch})
 * so that widening touches one function. */
export type Failure =
  | { kind: "unreachable"; detail: string }
  | { kind: "unauthorized" }
  | { kind: "bad_reply"; detail: string };

export type Result<T> = { ok: true; value: T } | { ok: false; failure: Failure };

export interface AgentClient {
  probeNode(url: string): Promise<Result<NodeProbe>>;
}

/** The per-request deadline (ms) for {@link createClient}'s calls. A LAN round trip to a live server
 * is well under a second; a few seconds is generous headroom while still bounding a dead box's probe
 * so the router's poll loop is never held open. */
export const DEFAULT_TIMEOUT_MS = 3_000;

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
 * into a {@link Result}. `parseOk` decodes a 200 body into `T`, returning `undefined` for a body that
 * fails validation (folded here to `bad_reply`) so callers never see a thrown parse error either. */
async function foldFetch<T>(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  parseOk: (response: Response) => Promise<T | undefined>,
): Promise<Result<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401) return { ok: false, failure: { kind: "unauthorized" } };
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
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, failure: { kind: "unreachable", detail } };
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

/** Builds an {@link AgentClient}. `fetch` is injected (never the global) so tests run without a
 * network; `timeoutMs` bounds every request (default {@link DEFAULT_TIMEOUT_MS}). */
export function createClient(opts: { fetch: typeof fetch; timeoutMs?: number }): AgentClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    probeNode(url: string): Promise<Result<NodeProbe>> {
      return foldFetch(opts.fetch, `${url}/api/node`, timeoutMs, parseNodeProbe);
    },
  };
}
