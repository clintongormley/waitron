import type { Hono } from "hono";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";

/**
 * Everything setup mode can report about an unprovisioned box: just the deployment environment
 * (`config.environment`). No `db`, no session key, no tenant — a box in setup mode has no venue bound
 * yet, so there is nothing to authenticate against and nothing tenant-scoped to read. The routes here
 * are UNAUTHENTICATED, like `/health`: they only announce that the box needs setting up and serve a
 * static placeholder page, neither of which is secret.
 */
export interface SetupDeps {
  /** The deployment environment (`production` / `preproduction`) this box booted under, echoed by
   * `/setup-api/status` so slice 2's wizard can warn before it provisions a real production venue. */
  environment: DeploymentEnvironment;
}

/**
 * The minimal shell an operator sees when the box boots unprovisioned. Deliberately a short inline
 * string, NOT a built front-end: the real setup wizard is a separate app (slice 2), and mounting a
 * catch-all that answers a bare 404 for every page load would be the §8 failure — the kind an
 * operator would only discover in the browser — that `spa-api.ts` warns against. This page always
 * renders, so a browser pointed at the box gets a clear "needs setup" message rather than a blank
 * 404. `no-cache` (below) keeps it from being pinned once the box is provisioned and the setup
 * routes stop being mounted.
 */
const SETUP_PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Waitron — setup needed</title>
  </head>
  <body>
    <main>
      <h1>This Waitron box needs setup</h1>
      <p>No venue is bound to this box yet. Finish setup to start trading.</p>
    </main>
  </body>
</html>
`;

/** The placeholder's URL is stable but its meaning changes the moment the box is provisioned (the
 * setup routes stop being mounted), so it must be revalidated, never pinned — the same reasoning
 * `spa-api.ts` revalidates a non-hashed `index.html` under. */
const REVALIDATE_CACHE_CONTROL = "no-cache";

/**
 * Mount the UNAUTHENTICATED setup-mode routes on an existing Hono app — the whole surface the box
 * exposes while no venue is bound (design: slice 1b). Two routes:
 *
 *   - `GET /setup-api/status` → a small, STABLE JSON fact sheet
 *     `{ provisioned: false, environment, needs: ["venue"] }`. Slice 2's wizard reads this to learn
 *     what the box still needs, so the shape is a contract: `provisioned` is always `false` here (a
 *     provisioned box never mounts these routes), and `needs` lists the outstanding steps — today
 *     only `"venue"`.
 *   - a root catch-all `GET *` → the `SETUP_PLACEHOLDER_HTML` shell, `text/html`, `no-cache`.
 *
 * Must be called LAST, after `/health` and after `GET /setup-api/status` (Task 3 mounts it that way):
 * the catch-all only runs for a path nothing else claimed, so a route registered earlier — `/health`,
 * or the status route registered just above it here — wins its own path (a Hono handler that returns
 * without `next()` ends the chain, so an earlier terminal handler is never shadowed).
 */
export function mountSetup(app: Hono, deps: SetupDeps, log: Logger): void {
  // One line at mount so an operator scanning logs sees the box came up unprovisioned and why every
  // page is answering with the placeholder — the box's mode is not otherwise visible in the request
  // log. Fires once, not per request, so the catch-all below stays silent under browser load.
  log("info", "setup.mode_active", { environment: deps.environment });

  app.get("/setup-api/status", (c) =>
    c.json({ provisioned: false, environment: deps.environment, needs: ["venue"] }, 200),
  );

  // Registered LAST and matching everything, so it answers only the paths `/setup-api/status` (above)
  // and any earlier route (e.g. `/health`) did not claim.
  app.get("*", (c) =>
    c.html(SETUP_PLACEHOLDER_HTML, 200, { "Cache-Control": REVALIDATE_CACHE_CONTROL }),
  );
}
