import type { Hono } from "hono";
import type { Logger } from "./logger.js";
import { mountSpa } from "./spa-api.js";

// Setup has no URL routes; browser navigation returns to the entry page without masking API failures.
export function mountSetupSpa(app: Hono, root: string, log: Logger): void {
  app.use("*", async (c, next) => {
    await next();
    const segments = c.req.path.split("/").filter(Boolean);
    const first = segments[0] ?? "";
    if (
      c.req.method === "GET" &&
      c.res.status === 404 &&
      (c.req.header("Accept") ?? "").includes("text/html") &&
      first !== "assets" &&
      first !== "api" &&
      !first.endsWith("-api") &&
      !segments.some((segment) => segment.includes("."))
    )
      c.res = c.redirect("/", 302);
  });
  app.use("/setup-assets/*", async (c, next) => {
    await next();
    if (c.res.status === 200) c.header("Content-Disposition", "attachment");
  });
  mountSpa(app, { root: root, basePath: "" }, log);
}
