import type { MiddlewareHandler } from "hono";
import { AppError } from "@waitron/shared";
import type { DeploymentMode } from "@waitron/db";
import "./errors.js"; // makes `node.read_only` reachable (the code is constructed below)

/** This gate blocks every HTTP verb EXCEPT the safe reads GET/HEAD/OPTIONS — i.e. every write verb the
 * dashboard (management/catalogue/report/recipe/schedule/purchasing/workforce/me) uses; a survey of that
 * DASHBOARD read surface found no read behind a non-safe verb (C2a design §5). HEAD is a bodyless GET and
 * OPTIONS is a CORS preflight — neither mutates, so both pass.
 *
 * IMPORTANT — this is NOT "no write behind any GET". It gates by HTTP VERB, so an INTERNAL SQL write
 * inside a GET handler still runs — e.g. the management-session keepalive (`mirror-session.ts`) does
 * `update management_sessions set last_seen_at = now()` on a mirror's own GETs. That is intended: the gate
 * refuses a CLIENT'S write verb, not the server's own bookkeeping (`mirror-session.ts:49` spells this out).
 *
 * The operational groups that DID expose a write behind a GET — `GET /print-api/agent/jobs`, whose
 * `claimPrintJobs` runs a locking `SELECT … FOR UPDATE … SKIP LOCKED` + `UPDATE` (packages/printing/src/
 * runtime.ts:145-179), and the device group — are no longer mounted under `mode='mirror'`: boot.ts wraps
 * both `mountDeviceApi`/`mountPrintApi` in `if (!isMirror)` (boot.ts:844). So on a mirror those write-GETs
 * are UNREACHABLE (404 — no route), not merely inert because their backing tables (`print_*`, `devices`)
 * are unprovisioned. This gate is unchanged; only the surface behind it shrank. A future slice that
 * RE-MOUNTS those groups on a mirror (kitchen-sync, promotion) revives the write-behind-a-GET concern —
 * keep them gated by `if (!isMirror)`, or allow-list the write-GETs here. The dashboard read surface this
 * mirror serves stays fully covered. */
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
