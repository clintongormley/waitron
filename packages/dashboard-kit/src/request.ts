/** The subset of `fetch` the dashboard client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A plain (non-array, non-null) object — the only parsed body shape an error envelope can be read from. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The one request primitive every dashboard API method funnels through — path-first: `(path, method, body?)`. */
export type DashboardRequest = <T>(
  path: string,
  method: string,
  body?: unknown,
  options?: { passive?: boolean },
) => Promise<T>;

/**
 * Build the dashboard's request primitive. Lifted verbatim from apps/dashboard/src/api/client.ts's
 * `#request`: `credentials: "include"` on every call (the session cookie); a JSON `body` is JSON-encoded
 * under a `content-type: application/json` header; a `FormData` body is passed through AS-IS with NO
 * `content-type`, so the browser sets `multipart/form-data` and its boundary itself; a GET/DELETE with
 * no body carries neither. A non-2xx becomes a rejected `{ code, status }` read from the server's
 * `{ error: { code } }` envelope, falling back to `server.internal` when the body is missing, non-JSON
 * or names no code — so callers branch on a stable domain code, never an HTTP status, while `status`
 * (the answered response's HTTP status) rides along for the rare caller that needs it. A 2xx with an EMPTY body resolves to `undefined`
 * (the 204 mutation routes), keyed off the empty body, not the status. This primitive does NOT redirect
 * on 401 — it only decodes and throws the code.
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
    options?: { passive?: boolean },
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
    let res: Response;
    try {
      res = await fetchImpl(baseUrl + path, init);
    } catch {
      opts.onError?.("connection.failed");
      throw { code: "connection.failed" };
    }
    if (!res.ok) {
      // The body is untrusted: a route that is gone answers Hono's own `404 Not Found` as
      // `text/plain`, on which `res.json()` throws; and the literal `null` is valid JSON, so a bare
      // try/catch is not enough — the parsed value is checked for being an object before `.error` is
      // read off it, and `code` is used only when it is a string. Any of these falls back to
      // `server.internal` rather than surfacing a parse error as a fake network outage.
      const parsed: unknown = await res.json().catch(() => undefined);
      const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;
      const rawCode = envelope?.code;
      const code = typeof rawCode === "string" ? rawCode : "server.internal";
      opts.onError?.(code);
      // Carry the envelope's `params` through so a caller that needs a code's structured detail can
      // read it (the SumUp connect form reads `payment.provider_merchant_ambiguous`'s `merchants`
      // list to offer a picker). Attached ONLY when present, so a code-only rejection stays a bare
      // `{ code, status }` every existing consumer branches on (`codeOf` reads `.code`). `status` is
      // the HTTP status of the answered response — its presence tells a caller the box replied at all.
      const rawParams = envelope?.params;
      const params = isRecord(rawParams) ? rawParams : undefined;
      throw params === undefined
        ? { code, status: res.status }
        : { code, params, status: res.status };
    }
    const text = await res.text();
    if (!passive) opts.onSuccess?.(path);
    return (text === "" ? undefined : JSON.parse(text)) as T;
  };
}
