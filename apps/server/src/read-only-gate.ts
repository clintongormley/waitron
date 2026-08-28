import type { MiddlewareHandler } from "hono";
import { AppError } from "@waitron/shared";
import type { DeploymentMode } from "@waitron/db";
import "./errors.js"; // makes `node.read_only` reachable (the code is constructed below)

/** This gate blocks every HTTP verb EXCEPT the safe reads GET/HEAD/OPTIONS — i.e. every write verb the
 * dashboard (management/catalogue/report/recipe/schedule/purchasing/workforce/me) uses; a survey of that
 * DASHBOARD read surface found no read behind a non-safe verb (C2a design §5). HEAD is a bodyless GET and
 * OPTIONS is a CORS preflight — neither mutates, so both pass.
 *
 * IMPORTANT — this is NOT "no write behind any GET on the whole mounted surface". Decision 5 mounts the
 * full trading surface (till/device/print) too, and a few OPERATIONAL GET handlers DO write — notably
 * `GET /print-api/agent/jobs`, whose `claimPrintJobs` runs a locking UPDATE. Those paths are inert on a
 * mirror only because their backing tables (`print_agents`/`print_jobs`, `devices`, …) are not in the 17
 * synced tables and are not provisioned on a mirror, so the caller 401s before the write — the read-only
 * guarantee for them rests on that, not on this method gate. A later slice that syncs or provisions those
 * tables (kitchen-sync, promotion) MUST revisit this gate (allow-list the write-GETs, or don't mount those
 * groups on a mirror). The dashboard read surface this mirror actually serves is fully covered. */
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
