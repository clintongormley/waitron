import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "@waitron/shared";
import "./errors.js"; // makes `node.read_only` reachable (the code is constructed below)

export const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

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
