/** The subset of `fetch` the dashboard client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

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
 * no body carries neither. A non-2xx becomes a rejected `{ code }` read from the server's
 * `{ error: { code } }` envelope, falling back to `server.internal` when the body names none — so callers
 * branch on a stable domain code, never an HTTP status. A 2xx with an EMPTY body resolves to `undefined`
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
    const res = await fetchImpl(baseUrl + path, init);
    if (!res.ok) {
      const envelope = (await res.json()) as {
        error?: { code?: string; params?: Record<string, unknown> };
      };
      const code = envelope.error?.code ?? "server.internal";
      opts.onError?.(code);
      // Carry the envelope's `params` through so a caller that needs a code's structured detail can
      // read it (the SumUp connect form reads `payment.provider_merchant_ambiguous`'s `merchants`
      // list to offer a picker). Attached ONLY when present, so a code-only rejection stays the bare
      // `{ code }` every existing consumer branches on (`codeOf` reads `.code`).
      const params = envelope.error?.params;
      throw params === undefined ? { code } : { code, params };
    }
    const text = await res.text();
    if (!passive) opts.onSuccess?.(path);
    return (text === "" ? undefined : JSON.parse(text)) as T;
  };
}
