import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isAppError } from "@waitron/shared";
import { codeOf } from "./error-code.js";
import type { Logger } from "./logger.js";

// Co-declared with `apps/server`'s request-id middleware, which SETS it; neither package imports
// the other, and the identical declarations merge.
declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

/**
 *  - An `AppError` → `{ error: { code, params } }` at the status `status` assigns the code, or 400
 *    when the map omits it, logged at `warn` — a mapped 5xx included.
 *  - Anything else → logged at `error` under `tag` with only `codeOf`'s classification (never its
 *    `.message`), and answered with an opaque `server.internal` 500.
 */
export function createErrorBoundary(
  status: Record<string, ContentfulStatusCode>,
  tag: string,
): (c: Context, log: Logger, fn: () => Promise<Response>) => Promise<Response> {
  return async (c, log, fn) => {
    try {
      return await fn();
    } catch (cause) {
      // A log field only, never added to the response.
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
