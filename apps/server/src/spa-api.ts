import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { AppError } from "@waitron/shared";
import type { Context, Hono } from "hono";
import { getMimeType } from "hono/utils/mime";
import type { Logger } from "./logger.js";
import "./errors.js";

/**
 * No session: a built SPA bundle is not secret. Served same-origin with the API so the front-ends
 * need no CORS or cross-origin cookies.
 */
export interface SpaDeps {
  /** Absolute path to the built SPA directory (holds index.html + assets/). */
  root: string;
  /** URL prefix this SPA is served under; "" (or "/") for the origin root, else e.g. "/manage" (no trailing slash). */
  basePath: string;
  /** Absolute path prefix for browser navigation, e.g. /tabs or /manage. */
  navigationPath?: string;
}

/** A content-addressed asset name (`app-<hash>.js`) changes only when its bytes change, so its URL is
 * safe to cache forever. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** index.html and any file outside `/assets/` keep a stable URL whose contents may change between
 * deploys, so they must be revalidated — otherwise a browser pins a stale index.html and never sees
 * the new bundle. */
const REVALIDATE_CACHE_CONTROL = "no-cache";

/**
 * The path-traversal guard: an absolute file inside `root`, or `null` if the path would escape it.
 * Written here rather than inherited from `@hono/node-server/serve-static`, so the refusal is code
 * this repo tests. Comparing against `base + sep` refuses a sibling like `<base>-evil` and `base`
 * itself.
 */
export function safeResolve(root: string, relPath: string): string | null {
  const base = resolve(root);
  const absolute = resolve(base, "." + (relPath.startsWith("/") ? relPath : "/" + relPath));
  if (!absolute.startsWith(base + sep)) return null;
  return absolute;
}

/**
 * A configured SPA directory that holds no `index.html` fails the boot, rather than mounting a
 * catch-all that answers 404 to every page load. The error carries the env variable's NAME, never
 * the path.
 */
export function assertBuiltApp(dir: string, variable: string): void {
  if (!existsSync(join(dir, "index.html"))) {
    throw new AppError("server.config_invalid", { variable, reason: "missing_index_html" });
  }
}

/**
 * Must be called AFTER every API route, so this catch-all runs only for paths nothing else claimed.
 *
 * Browser HTML requests under `navigationPath` serve index.html, so saved UI paths survive a
 * refresh; root files and assets stay outside navigation.
 */
export function mountSpa(app: Hono, deps: SpaDeps, log: Logger): void {
  const root = resolve(deps.root);
  const indexFile = join(root, "index.html");

  const serve = (c: Context, relPath: string): Promise<Response> => {
    const navigation = deps.navigationPath;
    const firstSegment = relPath.split("/")[1] ?? "";
    const isNavigation =
      navigation !== undefined &&
      (c.req.path === navigation || c.req.path.startsWith(`${navigation}/`)) &&
      firstSegment !== "assets" &&
      !firstSegment.includes(".") &&
      (c.req.header("Accept") ?? "").includes("text/html");
    if (relPath === "/" || isNavigation) {
      return sendFile(c, indexFile, REVALIDATE_CACHE_CONTROL, log);
    }
    const abs = safeResolve(root, relPath);
    // The adapter collapses dot segments on the way in, so what reaches this in practice is a path
    // resolving to the root directory itself, `//` among them.
    if (abs === null) return Promise.resolve(c.body(null, 404));
    // Everything under `/assets/` is cached immutably, so only content-addressed names belong there;
    // `relPath` has `basePath` sliced off.
    const cache = relPath.startsWith("/assets/")
      ? IMMUTABLE_CACHE_CONTROL
      : REVALIDATE_CACHE_CONTROL;
    return sendFile(c, abs, cache, log);
  };

  if (deps.basePath === "" || deps.basePath === "/") {
    app.get("*", (c) => serve(c, c.req.path));
    return;
  }
  const base = deps.basePath;
  app.get(base, (c) => serve(c, "/"));
  app.get(`${base}/*`, (c) => serve(c, c.req.path.slice(base.length)));
}

/**
 * Any read failure is a bare 404 to the caller, never a 500 or filesystem detail; a failure other
 * than ENOENT is logged.
 */
async function sendFile(
  c: Context,
  absolutePath: string,
  cacheControl: string,
  log: Logger,
): Promise<Response> {
  try {
    // `c.body` wants `Uint8Array<ArrayBuffer>`, narrower than the `Buffer` `readFile` returns.
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await readFile(absolutePath));
    return c.body(bytes, 200, {
      "Content-Type": getMimeType(absolutePath) ?? "application/octet-stream",
      "Cache-Control": cacheControl,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return c.body(null, 404);
    log("error", "spa.read_failed", { path: absolutePath, code });
    return c.body(null, 404);
  }
}
