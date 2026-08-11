import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isAppError } from "@waitron/shared";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";
// No `./errors.js` side-effect import: this file throws no code — it only re-emits a caught
// AppError's own `.code` and returns the literal `server.internal`, so it registers nothing itself
// (the call sites that DO throw codes carry that import).

/**
 * The one error boundary a route's handler is wrapped in, built per surface from that surface's own
 * status map and log tag. `till-api.ts` and `management-api.ts` each held the same `run` body,
 * differing only in the `status` map and the log `tag` this factory takes (till-api.ts's `export`ed,
 * management-api.ts's local); this is that shared body, extracted once.
 *
 * The returned boundary behaves exactly so:
 *  - `fn()` resolves → its `Response` is returned unchanged and nothing is logged.
 *  - `fn()` throws an `AppError` → a structured `{ error: { code, params } }` response at the status
 *    `status` assigns the code, or 400 when the map omits it, logged at `warn`.
 *  - `fn()` throws anything else → treated as a server fault: logged at `error` under `tag` with only
 *    `codeOf`'s structured classification of the caught value (never its `.message`, which a driver
 *    can load with a connection string), and answered with an opaque `server.internal` 500 that
 *    carries no params and leaks nothing about the cause.
 *
 * The `warn`-vs-`error` split reflects a caller convention rather than anything this factory checks:
 * both of today's call sites pass a `status` map of CLIENT 4xx codes only (see each file's `STATUS`),
 * so an `AppError` reaching the boundary is always a client fault and a 5xx-worthy fault always
 * arrives as a non-`AppError` on the `error`/500 branch.
 */
export function createErrorBoundary(
  status: Record<string, ContentfulStatusCode>,
  tag: string,
): (c: Context, log: Logger, fn: () => Promise<Response>) => Promise<Response> {
  return async (c, log, fn) => {
    try {
      return await fn();
    } catch (cause) {
      if (isAppError(cause)) {
        const httpStatus = status[cause.code] ?? 400;
        log("warn", cause.code, cause.params);
        return c.json({ error: { code: cause.code, params: cause.params } }, httpStatus);
      }
      log("error", tag, { errorCode: codeOf(cause) });
      return c.json({ error: { code: "server.internal" } }, 500);
    }
  };
}
