import type { Hono, MiddlewareHandler } from "hono";
import { diskFullRefusal, type DiskFullState } from "./disk-full-state.js";
import type { Logger } from "./logger.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Adds `routes`' routes to `root`, first putting in front of each write route under `/api/` a
 * check that answers 507 `storage.disk_full`, before the route runs, while `disk.full()` is true.
 * A route `open` names ("POST /api/session") is not checked. With no `disk`, nothing is checked.
 *
 * The check is registered on `root` route by route, never as a `use`, so routes mounted on `root`
 * later are not caught by it.
 */
export function mountGatedWhileDiskFull(
  root: Hono,
  routes: Hono,
  deps: { disk?: DiskFullState; log: Logger; open: ReadonlySet<string> },
): void {
  const { disk } = deps;
  if (disk !== undefined) {
    const checked = new Set<string>();
    for (const { method, path } of routes.routes) {
      const key = `${method} ${path}`;
      if (!WRITE_METHODS.has(method) || !path.startsWith("/api/")) continue;
      if (deps.open.has(key) || checked.has(key)) continue;
      checked.add(key);
      root.on(method, path, gate(disk, deps.log, key));
    }
  }
  root.route("/", routes);
}

function gate(disk: DiskFullState, log: Logger, key: string): MiddlewareHandler {
  return async (c, next) => {
    // Awaiting full() with nothing noted would add a tick and reorder this write's first transaction.
    if (disk.since() === null || !(await disk.full())) return next();
    log("warn", "storage.disk_full_stop_refused", { route: key, requestId: c.get("requestId") });
    // Returned, not thrown: a middleware is outside the route's error boundary.
    const err = diskFullRefusal();
    return c.json({ error: { code: err.code, params: err.params } }, 507);
  };
}
