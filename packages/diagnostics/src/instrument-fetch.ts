import type { DiagnosticsLog } from "./log.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Replace dynamic path segments (uuids, all-numeric ids) with `:id` so the trail records a stable
 * pattern, never a concrete id or PII in a path segment. */
export function maskPath(path: string): string {
  return path
    .split("/")
    .map((seg) => (seg !== "" && (UUID.test(seg) || /^\d+$/.test(seg)) ? ":id" : seg))
    .join("/");
}

export function createInstrumentedFetch(
  baseFetch: typeof fetch,
  log: DiagnosticsLog,
  opts: { makeId?: () => string; baseUrl?: string } = {},
): typeof fetch {
  const makeId = opts.makeId ?? (() => crypto.randomUUID());
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const id = makeId();
    const method = (init?.method ?? "GET").toUpperCase();
    const urlStr =
      typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    let path = urlStr;
    try {
      path = maskPath(new URL(urlStr, opts.baseUrl ?? "http://local").pathname);
    } catch {
      /* keep raw */
    }
    const headers = new Headers(init?.headers);
    headers.set("x-request-id", id);
    log.record("debug", "api", { phase: "start", method, path, requestId: id });
    try {
      const res = await baseFetch(input, { ...init, headers });
      let code: string | undefined;
      if (!res.ok) {
        try {
          code = ((await res.clone().json()) as { error?: { code?: string } })?.error?.code;
        } catch {
          /* no body */
        }
      }
      log.record(res.ok ? "info" : "warn", "api", {
        phase: "end",
        method,
        path,
        status: res.status,
        requestId: id,
        ...(code !== undefined ? { code } : {}),
      });
      return res;
    } catch (e) {
      log.record("error", "api", { phase: "end", method, path, requestId: id, error: "network" });
      throw e;
    }
  }) as typeof fetch;
}
