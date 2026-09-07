/** The subset of `fetch` the dashboard client uses; the global satisfies it, and a test injects a stub. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** The one request primitive every dashboard API method funnels through — path-first: `(path, method, body?)`. */
export type DashboardRequest = <T>(path: string, method: string, body?: unknown) => Promise<T>;

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
  opts: { baseUrl?: string; fetchImpl?: FetchLike } = {},
): DashboardRequest {
  const baseUrl = opts.baseUrl ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async <T>(path: string, method: string, body?: unknown): Promise<T> => {
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
    const res = await fetchImpl(baseUrl + path, init);
    if (!res.ok) {
      const envelope = (await res.json()) as { error?: { code?: string } };
      throw { code: envelope.error?.code ?? "server.internal" };
    }
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  };
}
