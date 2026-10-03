/** The subset of `fetch` the dashboard client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A plain (non-array, non-null) object — the only parsed body shape an error envelope can be read from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Per-call options. `as: "blob"` resolves a 2xx to its body's bytes, undecoded, for a file download; a
 * refusal is decoded exactly as without it. `timeLimitMs` replaces `READ_TIME_LIMIT_MS` for one GET other
 * than a file download.
 */
export interface RequestOptions {
  passive?: boolean;
  as?: "blob";
  timeLimitMs?: number;
}

/** How long a read may take, response and body together, before it fails as `connection.timed_out`. */
const READ_TIME_LIMIT_MS = 30_000;

/** The one request primitive every dashboard API method funnels through — path-first: `(path, method, body?)`. */
export type DashboardRequest = <T>(
  path: string,
  method: string,
  body?: unknown,
  options?: RequestOptions,
) => Promise<T>;

/**
 * Build the dashboard's request primitive: `credentials: "include"` on every call (the session
 * cookie); a JSON `body` is JSON-encoded under a `content-type: application/json` header; a
 * `FormData` body is passed through AS-IS with NO `content-type`, so the browser sets
 * `multipart/form-data` and its boundary itself; a GET/DELETE with no body carries neither. A non-2xx
 * becomes a rejected `{ code, status }` read from the server's `{ error: { code } }` envelope, falling
 * back to `server.internal` when the body is missing, non-JSON or names no code — so callers branch
 * on a stable domain code, never an HTTP status, while `status` (the answered response's HTTP status)
 * rides along for the rare caller that needs it. Without `as: "blob"`, a 2xx with an EMPTY body
 * resolves to `undefined`, keyed off the empty body, not the status. A GET other than a blob download
 * is aborted after its time limit and fails as `connection.timed_out`, while a fetch that fails on
 * its own fails as `connection.failed`; it is aborted rather than only abandoned, so it does not keep
 * holding one of the browser's connections to the box. This primitive does NOT redirect on 401 — it
 * only decodes and throws the code.
 */
export function createRequest(
  opts: {
    baseUrl?: string;
    fetchImpl?: FetchLike;
    onError?: (code: string) => void;
    onSuccess?: (path: string) => void;
    passive?: boolean;
  } = {},
): DashboardRequest {
  const baseUrl = opts.baseUrl ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async <T>(
    path: string,
    method: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> => {
    const init: RequestInit =
      body === undefined
        ? { method, credentials: "include" }
        : body instanceof FormData
          ? { method, credentials: "include", body }
          : {
              method,
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            };
    const passive = method === "GET" && (options?.passive ?? opts.passive) === true;
    if (passive) {
      const headers = new Headers(init.headers);
      headers.set("x-waitron-live", "1");
      init.headers = headers;
    }
    const fail = (code: "connection.failed" | "connection.timed_out"): { code: string } => {
      opts.onError?.(code);
      return { code };
    };
    const limit = method === "GET" && options?.as !== "blob" ? new AbortController() : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced against every wait below, so a fetch or body that ignores the signal still settles.
    const timedOut =
      limit === undefined
        ? undefined
        : new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              limit.abort();
              reject(new Error("read time limit"));
            }, options?.timeLimitMs ?? READ_TIME_LIMIT_MS);
          });
    timedOut?.catch(() => undefined);
    const within = <V>(wait: Promise<V>): Promise<V> =>
      timedOut === undefined ? wait : Promise.race([wait, timedOut]);
    if (limit !== undefined) init.signal = limit.signal;
    try {
      let res: Response;
      try {
        res = await within(fetchImpl(baseUrl + path, init));
      } catch {
        throw fail(limit?.signal.aborted === true ? "connection.timed_out" : "connection.failed");
      }
      if (!res.ok) {
        // The body is untrusted: a route that is gone answers Hono's own `404 Not Found` as
        // `text/plain`, on which `res.json()` throws; and the literal `null` is valid JSON, so a bare
        // try/catch is not enough — the parsed value is checked for being an object before `.error` is
        // read off it, and `code` is used only when it is a string. Any of these falls back to
        // `server.internal` rather than surfacing a parse error as a fake network outage.
        const parsed: unknown = await within(res.json()).catch(() => undefined);
        if (limit?.signal.aborted === true) throw fail("connection.timed_out");
        const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
        const rawCode = envelope?.code;
        const code = typeof rawCode === "string" ? rawCode : "server.internal";
        opts.onError?.(code);
        // Carry the envelope's `params` through so a caller that needs a code's structured detail can
        // read it. Attached ONLY when present, so a code-only rejection stays a bare `{ code, status }`.
        const rawParams = envelope?.params;
        const params = isRecord(rawParams) ? rawParams : undefined;
        throw params === undefined
          ? { code, status: res.status }
          : { code, params, status: res.status };
      }
      let read: Blob | string;
      try {
        read = await within<Blob | string>(options?.as === "blob" ? res.blob() : res.text());
      } catch (error) {
        if (limit?.signal.aborted === true) throw fail("connection.timed_out");
        throw error;
      }
      if (!passive) opts.onSuccess?.(path);
      if (typeof read !== "string") return read as T;
      return (read === "" ? undefined : JSON.parse(read)) as T;
    } finally {
      clearTimeout(timer);
    }
  };
}
