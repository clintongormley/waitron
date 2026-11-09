import type { DiagnosticsLog } from "./log.js";

import { PATH_PATTERNS } from "./path-patterns.js";

export function maskPath(path: string): string {
  if (path === ":unparseable") return path;
  let segments: string[];
  try {
    segments = new URL(path, "http://local").pathname.split("/");
  } catch {
    return ":unparseable";
  }
  for (const pattern of PATH_PATTERNS) {
    const parts = pattern.split("/");
    if (parts.length !== segments.length) continue;
    if (parts.every((part, i) => (part === ":id" ? segments[i] !== "" : part === segments[i]))) {
      return pattern;
    }
  }
  return segments
    .map((segment, i) => {
      if (segment === "") return "";
      return i === 1 && (segment === "api" || segment === "management-api") ? segment : ":id";
    })
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
    // Typed as `typeof fetch`, so honour a `Request` input too: take its url/method/headers as the
    // base and let `init` overlay them, rather than stringifying it to `[object Request]`.
    const req = input instanceof Request ? input : undefined;
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (req?.url ?? String(input));
    let path: string;
    try {
      path = maskPath(new URL(urlStr, opts.baseUrl ?? "http://local").pathname);
    } catch {
      path = ":unparseable";
    }
    const headers = new Headers(req?.headers);
    if (init?.headers) for (const [k, v] of new Headers(init.headers)) headers.set(k, v);
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
