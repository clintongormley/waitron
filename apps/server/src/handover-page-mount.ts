import type { Hono } from "hono";
import type { NodeDatabase } from "@waitron/db";
import { readHandoverOperation, readNodeMode } from "@waitron/node-db";
import type { Logger } from "./logger.js";
import { mountSpa } from "./spa-api.js";

export function mountHandoverPage(
  app: Hono,
  deps: { root: string; node: NodeDatabase; nodeId: string },
  log: Logger,
): void {
  app.get("/handover", (c) => c.notFound());
  app.use("/handover/*", async (c, next) => {
    const path = c.req.path;
    if (
      path.startsWith("/handover/assets/") ||
      ["/handover/favicon.ico", "/handover/favicon.svg", "/handover/apple-touch-icon.png"].includes(
        path,
      )
    )
      return next();
    const match = /^\/handover\/([^/]+)\/?$/.exec(path);
    if (match === null || match[1]!.length > 64) return c.notFound();
    if (match[1] === "emergency") {
      if ((await readNodeMode(deps.node, deps.nodeId)).mode !== "mirror") return c.notFound();
    } else {
      const operation = await readHandoverOperation(deps.node, deps.nodeId, match[1]!);
      if (operation?.role !== "destination") return c.notFound();
    }
    if (path.endsWith("/")) return c.redirect(path.slice(0, -1), 302);
    return next();
  });
  mountSpa(app, { root: deps.root, basePath: "/handover", navigationPath: "/handover" }, log);
}
