import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "@waitron/shared";
import "./errors.js"; // makes `node.read_only` reachable (the code is constructed below)

/**
 * A survey of the DASHBOARD read surface found no read behind a non-safe verb (C2a design §5).
 *
 * The gate refuses by HTTP VERB, so a server-side write inside a GET handler (the management-session
 * keepalive in `mirror-session.ts`) still runs: it refuses a CLIENT's write verb, not the server's own
 * bookkeeping.
 *
 * The print and device groups are not gated here: boot does not mount them on a mirror or a fenced node
 * (its `if (!fencedOrMirror)` guard). A slice that re-mounts them there must keep that guard, not the
 * narrower `!isMirror`. Gating the whole surface at request time instead is deferred to promotion
 * Slice 3 (docs/superpowers/specs/2026-08-29-promotion-runbook-design.md §3a).
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses every write verb while `isReadOnly()` is true. Read PER REQUEST so a live promotion opens
 * the write routes without a restart.
 *
 * Returns the error-boundary response shape directly rather than throwing, because a Hono middleware
 * is not inside a route's `createErrorBoundary` wrapper.
 *
 * `isExempt` lets a request through even on a write verb; each exempt route authenticates itself.
 */
export function readOnlyGate(
  isReadOnly: () => boolean,
  isExempt?: (c: Context) => boolean,
): MiddlewareHandler {
  return async (c, next) => {
    if (isExempt?.(c) === true) return next();
    if (isReadOnly() && !SAFE_METHODS.has(c.req.method)) {
      const err = new AppError("node.read_only", {});
      return c.json({ error: { code: err.code, params: err.params } }, 403);
    }
    return next();
  };
}
