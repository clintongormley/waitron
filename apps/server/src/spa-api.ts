import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { AppError } from "@waitron/shared";
import type { Context, Hono } from "hono";
import { getMimeType } from "hono/utils/mime";
import type { Logger } from "./logger.js";
import "./errors.js";

/**
 * Everything the SPA-serving route needs: the absolute directory a front-end was built into and the
 * URL prefix it is served under. No `db`, no session, no tenant — a built SPA bundle (index.html +
 * hashed assets) is not secret, and both the `till` and the `dashboard` are fetched by a browser with
 * plain `GET`s. Mounted so the box can serve those front-ends SAME-ORIGIN (slice 1a), which is what
 * lets the till/dashboard reach the API without a CORS or cross-origin cookie story.
 */
export interface SpaDeps {
  /** Absolute path to the built SPA directory (holds index.html + assets/). */
  root: string;
  /** URL prefix this SPA is served under; "" (or "/") for the origin root, else e.g. "/manage" (no trailing slash). */
  basePath: string;
}

/** A content-addressed asset name (`app-<hash>.js`) changes only when its bytes change, so its URL is
 * safe to cache forever — the same reasoning `media-api.ts` caches a content-hashed image under. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** index.html and any non-hashed file carry a stable URL whose CONTENTS change on each deploy, so they
 * must be revalidated — otherwise a browser pins a stale index.html and never sees the new bundle. */
const REVALIDATE_CACHE_CONTROL = "no-cache";

/**
 * Resolve a request's relative path to an absolute file inside `root`, or `null` if it would escape
 * `root`. THIS is the explicit path-traversal guard — the reason we serve files by a custom `fs`
 * handler and not `@hono/node-server/serve-static` (`CLAUDE.md` §3: "the defence is explicit, never
 * implicit"). `root` is normalised with `resolve` FIRST, so the containment check compares two
 * canonical absolute paths: a relative root (`apps/till/dist`) or a trailing-slash root (`/srv/till/`)
 * would otherwise make `absolute.startsWith(<raw root> + sep)` always false and 404 every asset. The
 * request path is resolved against that same normalised `base`, and `resolve` collapses any `..`
 * segments; we then require the collapsed result to stay within `base`. Comparing against `base + sep`
 * (not a bare `startsWith(base)`) is deliberate: a sibling directory like `<base>-evil` shares the
 * prefix but must NOT pass, and a request resolving to `base` itself (`base.startsWith(base + sep)`
 * is false) returns `null` too. Self-contained (it normalises its own `root`) so any caller's
 * standalone use is correct. Exported so the guard is unit-testable on its own — `spa-api.test.ts`
 * proves it by deletion.
 */
export function safeResolve(root: string, relPath: string): string | null {
  const base = resolve(root);
  const absolute = resolve(base, "." + (relPath.startsWith("/") ? relPath : "/" + relPath));
  if (!absolute.startsWith(base + sep)) return null;
  return absolute;
}

/**
 * A configured SPA directory's ONE boot-time precondition: it must actually hold an `index.html`.
 * `boot.ts` calls this for each configured app dir BEFORE `mountSpa`, so a dir that was set but never
 * built (a wrong path, or the frontend build never ran) fails the boot LOUDLY here — the §8
 * "everything escapes" posture — rather than mounting a catch-all that answers 404 for every page
 * load, a failure an operator would only discover in the browser. `variable` is the env var that
 * supplied the dir (`WAITRON_TILL_APP_DIR` / `WAITRON_DASHBOARD_APP_DIR`), named in the error so the
 * operator knows which one to fix: `server.config_invalid` carries the variable NAME, never the path
 * value (this file's no-leak discipline, the same the rest of that code's throwers follow).
 *
 * Exported and split out of `boot.ts` deliberately: reaching a throw inside the full-boot path needs
 * a real container and a mis-built dir, so the guard lives here where `spa-api.test.ts` unit-tests
 * both branches directly and proves the throw by construction (the task brief's Step 7).
 */
export function assertBuiltApp(dir: string, variable: string): void {
  if (!existsSync(join(dir, "index.html"))) {
    throw new AppError("server.config_invalid", { variable, reason: "missing_index_html" });
  }
}

/**
 * Mount the GET routes that serve a built SPA directory at `deps.basePath`. Must be called AFTER every
 * API route so a terminal API handler wins its own path; this catch-all only runs for paths nothing
 * else claimed (a Hono handler that returns without `next()` ends the chain, so `/api/ping` registered
 * earlier is never shadowed).
 *
 * Behaviour: the base-path root serves index.html; an existing file under it is served with its
 * content-type and cache header; anything else 404s. There is deliberately NO history/SPA fallback —
 * neither front-end uses client-side URL routing (screens are in-memory Lit state; the URL never
 * changes), so a reload only ever lands on the base-path root, and the existence check is what stops a
 * stray unmatched path (e.g. `/api/typo`) from being answered with HTML.
 */
export function mountSpa(app: Hono, deps: SpaDeps, log: Logger): void {
  // Normalise the configured dir ONCE, so `index.html` and every asset are served from the same
  // canonical absolute base whether the operator supplied an absolute path, a relative one
  // (`apps/till/dist`, the plan's own smoke) or a trailing-slash one (`/srv/till/`). `safeResolve`
  // normalises its own `root` again — cheap and idempotent — so it stays correct for any caller.
  const root = resolve(deps.root);
  const indexFile = join(root, "index.html");

  const serve = (c: Context, relPath: string): Promise<Response> => {
    // The base-path root ("/") serves index.html; there is no client-side routing to fall back on.
    if (relPath === "/") {
      return sendFile(c, indexFile, REVALIDATE_CACHE_CONTROL, log);
    }
    const abs = safeResolve(root, relPath);
    // Defence-in-depth: `safeResolve` returns null on an escaping path, and we 404 it. In production
    // requests reach this handler through `@hono/node-server`, whose `newRequest` builds the `Request`
    // by running Node's raw `req.url` through WHATWG `new URL(...)`:
    // `@hono/node-server@1.19.15` `dist/request.js` `newRequest` (defined at its line 191) reads
    // `const incomingUrl = incoming.url || ""` (line 194) and constructs
    // `const url = new URL(`${scheme}://${host}${incomingUrl}`)` (line 221), storing `url.href` as the
    // request URL (line 225) — the SAME `new URL(...)` normalisation `app.request` applies in tests.
    // So an escaping `/../` is collapsed before the handler's `c.req.path` sees it, and a `%2f` stays a
    // single encoded segment. That is why this branch is not reached in practice. The security property
    // does NOT depend on that unreachability: it rests on `safeResolve` being present and directly
    // unit-tested (`spa-api.test.ts`'s `safeResolve` block, proven by deletion). This branch is kept as
    // belt-and-braces defence — removing a guard because it "can't happen" is precisely the mistake
    // CLAUDE.md §3 forbids.
    /* v8 ignore next */
    if (abs === null) return Promise.resolve(c.body(null, 404));
    // Only hashed files under the `/assets/` prefix are safe to cache immutably; everything else is
    // revalidated. A LEADING-segment check (not a `.includes`, which would also match a stray
    // `/foo/assets/bar`): `relPath` here is the SPA-relative path — `/assets/app-<hash>.js` for the
    // till (basePath ""), `/assets/d-<hash>.js` for the dashboard (basePath "/manage" already sliced
    // off) — so both real cases start with `/assets/`, while a root file like `/favicon.svg` stays
    // revalidated.
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
 * Read a file and answer with it, or a bare 404. Any read failure is a 404 to the caller — this route
 * never 500s and never leaks filesystem detail — but a non-ENOENT failure (a misconfigured root, a
 * permission problem) is logged once, exactly as `media-api.ts` does for its media reads. ENOENT is
 * the ordinary "no such file" and is left unlogged.
 */
async function sendFile(
  c: Context,
  absolutePath: string,
  cacheControl: string,
  log: Logger,
): Promise<Response> {
  try {
    // `readFile` returns a `Buffer` (`Uint8Array<ArrayBufferLike>`); `c.body` wants the narrower
    // `Uint8Array<ArrayBuffer>`, so `new Uint8Array(…)` copies into a plainly-backed array of that type.
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await readFile(absolutePath));
    return c.body(bytes, 200, {
      // Hono ships an extension→Content-Type table for its own static server; reuse it rather than
      // hand-maintaining a local map that silently drifts from it. Unknown extensions → octet-stream
      // (getMimeType returns undefined), as before. (Unlike media-api.ts's closed 3-type upload
      // allowlist, a built SPA emits an open set of file types, which is exactly getMimeType's job.)
      "Content-Type": getMimeType(absolutePath) ?? "application/octet-stream",
      "Cache-Control": cacheControl,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return c.body(null, 404); // missing file → plain 404, no fallback
    log("error", "spa.read_failed", { path: absolutePath, code });
    return c.body(null, 404); // never 500, never leak fs detail — as media-api.ts does
  }
}
