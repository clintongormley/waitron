import type { MiddlewareHandler } from "hono";
import { AppError } from "@waitron/shared";
import type { DeploymentMode } from "@waitron/db";
import "./errors.js"; // makes `node.read_only` reachable (the code is constructed below)

/** GET/HEAD/OPTIONS are the read verbs the dashboard uses; everything else is a write on this surface
 * (a method survey across report-api/me-api/catalogue-api/schedule-api found no read behind a non-GET
 * verb — C2a design §5). OPTIONS is a CORS preflight and carries no body. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses every write when this node is a read-only mirror. `getMode` is read PER REQUEST (not captured
 * once) so a later promotion — `deployment.mode = 'primary'` + a refresh of the holder boot passes in —
 * opens every write route live, no restart (design §10). On a primary it is a pure pass-through.
 *
 * Returns the error-boundary response shape directly (`{ error: { code, params } }`, `error-boundary.ts`)
 * rather than throwing, because a Hono middleware is not inside a route's `createErrorBoundary` wrapper —
 * the code is built through `AppError` so `tsc` checks it is a real code and `import "./errors.js"` keeps
 * it reachable.
 */
export function readOnlyGate(getMode: () => DeploymentMode): MiddlewareHandler {
  return async (c, next) => {
    if (getMode() === "mirror" && !SAFE_METHODS.has(c.req.method)) {
      const err = new AppError("node.read_only", {});
      return c.json({ error: { code: err.code, params: err.params } }, 403);
    }
    return next();
  };
}
