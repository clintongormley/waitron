import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "./logger.js";

// Make c.get("requestId") / c.set("requestId", …) typed across the whole server.
declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

const VALID = /^[A-Za-z0-9._-]{1,64}$/;

/** A client-supplied id is accepted only if it is safe to embed in a structured log verbatim —
 * bounded length and a strict charset, so a hostile value cannot inject a newline and forge a line. */
export function sanitizeRequestId(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  return VALID.test(raw) ? raw : null;
}

export function requestIdMiddleware(log: Logger, now: () => Date): MiddlewareHandler {
  return async (c, next) => {
    const id = sanitizeRequestId(c.req.header("x-request-id")) ?? randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    const start = now().getTime();
    await next();
    log("debug", "http.request", {
      requestId: id,
      method: c.req.method,
      routePath: c.req.routePath, // the matched pattern, never the concrete path/query
      status: c.res.status,
      durationMs: now().getTime() - start,
    });
  };
}
