/** The subset of `fetch` the dashboard client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A plain (non-array, non-null) object — the only parsed body shape an error envelope can be read from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface DownloadedFile {
  readonly blob: Blob;
  /** From `Content-Disposition: attachment; filename="<name>"` only; otherwise null. */
  readonly fileName: string | null;
  /** Present only when the call named `headers`: each named header's value, or null when absent. */
  readonly headers?: Readonly<Record<string, string | null>>;
}

/**
 * Per-call options. `as: "blob"` resolves a 2xx to its body's bytes, undecoded, for a file download;
 * `as: "file"` resolves to a `DownloadedFile`, the bytes with the server's file name, plus the values
 * of any response `headers` the call names. A refusal is
 * decoded exactly as without either. Explicit deadlines apply to any method; ordinary reads
 * retain their default deadline. Cancellation bounds both fetch and response-body waits.
 * `refusals: "envelope"` rejects a non-2xx whose body names no `{ error: { code } }` as
 * `connection.failed`, with no status: a gateway's own page says nothing of whether the server acted.
 */
export interface RequestOptions {
  passive?: boolean;
  refusals?: "envelope";
  as?: "blob" | "file";
  headers?: readonly string[];
  timeLimitMs?: number;
  signal?: AbortSignal;
  sessionErrors?: "caller";
  activity?: "none";
}

// Only the exact form the server writes; a name holding a quote or a backslash is not read.
const ATTACHMENT_NAME = /^attachment; filename="([^"\\]+)"$/;

function attachmentName(disposition: string | null): string | null {
  return disposition === null ? null : (ATTACHMENT_NAME.exec(disposition)?.[1] ?? null);
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

/** Race fetch and body waits as well as aborting their transport: either may ignore its signal. */
export function createRequest(
  opts: {
    baseUrl?: string;
    fetchImpl?: FetchLike;
    onError?: (code: string, status?: number, generation?: number) => void;
    onSuccess?: (path: string, generation?: number) => void;
    passive?: boolean;
    sessionGeneration?: () => number;
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
    const generation = opts.sessionGeneration?.();
    const current = () => generation === opts.sessionGeneration?.();
    const reportError = (code: string, status?: number): void => {
      if (code !== "node.reset" && !current()) return;
      if (
        options?.sessionErrors === "caller" &&
        ["management_session.required", "management_session.expired", "person.suspended"].includes(
          code,
        )
      )
        return;
      if (generation === undefined) {
        if (status === undefined) opts.onError?.(code);
        else opts.onError?.(code, status);
      } else opts.onError?.(code, status, generation);
    };
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
    const fail = (code: string): { code: string } => {
      reportError(code);
      return { code };
    };
    const deadline =
      options?.timeLimitMs ??
      (method === "GET" && options?.as === undefined ? READ_TIME_LIMIT_MS : undefined);
    const limit =
      deadline !== undefined || options?.signal !== undefined ? new AbortController() : undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped: "connection.cancelled" | "connection.timed_out" | undefined;
    let rejectWait: ((error: Error) => void) | undefined;
    const interrupted =
      limit === undefined
        ? undefined
        : new Promise<never>((_resolve, reject) => {
            rejectWait = reject;
          });
    interrupted?.catch(() => undefined);
    const interrupt = (code: "connection.cancelled" | "connection.timed_out"): void => {
      if (stopped !== undefined) return;
      stopped = code;
      limit?.abort();
      rejectWait?.(new Error("request interrupted"));
    };
    const onAbort = () => interrupt("connection.cancelled");
    const within = <V>(wait: Promise<V>): Promise<V> =>
      interrupted === undefined ? wait : Promise.race([wait, interrupted]);
    if (limit !== undefined) init.signal = limit.signal;
    try {
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      if (options?.signal?.aborted) throw fail("connection.cancelled");
      if (deadline !== undefined)
        timer = setTimeout(() => interrupt("connection.timed_out"), deadline);
      let res: Response;
      try {
        res = await within(fetchImpl(baseUrl + path, init));
      } catch {
        throw fail(stopped ?? "connection.failed");
      }
      if (!res.ok) {
        // The body is untrusted: a route that is gone answers Hono's own `404 Not Found` as
        // `text/plain`, on which `res.json()` throws; and the literal `null` is valid JSON, so a bare
        // try/catch is not enough — the parsed value is checked for being an object before `.error` is
        // read off it, and `code` is used only when it is a string. Any of these falls back to
        // `server.internal` rather than surfacing a parse error as a fake network outage, or to
        // `connection.failed` with no status under `refusals: "envelope"`.
        const parsed: unknown = await within(res.json()).catch(() => undefined);
        if (stopped !== undefined) throw fail(stopped);
        const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
        const rawCode = envelope?.code;
        if (typeof rawCode !== "string" && options?.refusals === "envelope")
          throw fail("connection.failed");
        const code = typeof rawCode === "string" ? rawCode : "server.internal";
        reportError(code, res.status);
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
        read = await within<Blob | string>(options?.as === undefined ? res.text() : res.blob());
      } catch (error) {
        if (stopped !== undefined) throw fail(stopped);
        throw error;
      }
      if (stopped !== undefined) throw fail(stopped);
      if (!passive && options?.activity !== "none" && current()) {
        if (generation === undefined) opts.onSuccess?.(path);
        else opts.onSuccess?.(path, generation);
      }
      if (typeof read !== "string") {
        if (options?.as !== "file") return read as T;
        const fileName = attachmentName(res.headers.get("content-disposition"));
        const named = options.headers;
        const file: DownloadedFile =
          named === undefined
            ? { blob: read, fileName }
            : {
                blob: read,
                fileName,
                headers: Object.fromEntries(named.map((name) => [name, res.headers.get(name)])),
              };
        return file as T;
      }
      return (read === "" ? undefined : JSON.parse(read)) as T;
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onAbort);
    }
  };
}
