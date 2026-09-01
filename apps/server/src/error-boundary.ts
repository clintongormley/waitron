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
 * an `AppError` reaching the boundary is logged at `warn` and re-emitted at the status its map assigns.
 * A status map MAY carry a 5xx — `setup-api.ts`'s `ADOPT_STATUS` maps `mirror.bundle_fetch_failed` to
 * 502, an UPSTREAM/dependency failure (the primary's bundle fetch) that is a deliberate, expected
 * AppError rather than a bug — so it is re-emitted at 502 and logged at `warn`, not as an `error`/500.
 * Most call sites' maps are still CLIENT 4xx codes only (see each file's `STATUS`), where every mapped
 * AppError is a client fault; the factory does not require that, and either way a fault the map does NOT
 * name arrives as a non-`AppError` and takes the opaque `server.internal` 500 on the `error` branch.
 */
export function createErrorBoundary(
  status: Record<string, ContentfulStatusCode>,
  tag: string,
): (c: Context, log: Logger, fn: () => Promise<Response>) => Promise<Response> {
  return async (c, log, fn) => {
    try {
      return await fn();
    } catch (cause) {
      // `requestId` is a LOG FIELD only — it correlates the line with the request, and is never
      // added to the error envelope (`cause.params` / the response body stay untouched). Absent
      // (no request-id middleware seeded it), it is `undefined` and `JSON.stringify` drops it.
      const requestId = c.get("requestId");
      if (isAppError(cause)) {
        const httpStatus = status[cause.code] ?? 400;
        log("warn", cause.code, { ...cause.params, requestId });
        return c.json({ error: { code: cause.code, params: cause.params } }, httpStatus);
      }
      log("error", tag, { errorCode: codeOf(cause), requestId });
      return c.json({ error: { code: "server.internal" } }, 500);
    }
  };
}
