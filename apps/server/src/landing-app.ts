import { readFile, access } from "node:fs/promises";
import { Hono } from "hono";
import { caCertPath } from "./box-secrets.js";
import type { Logger } from "./logger.js";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";

/**
 * The plain-HTTP trust/landing surface (Task 3): the ONE page a phone reaches by typing the box's
 * bare address before it trusts the box's self-signed CA. It is a SEPARATE, plain-HTTP listener from
 * the HTTPS app (`boot.ts` binds it on `config.landingPort`, default 80) because the browser's
 * certificate interstitial fires on the untrusted HTTPS origin before any of our JS runs — so the
 * "download and trust the CA" instructions have to live on an origin the browser does not block.
 *
 * Two UNAUTHENTICATED routes, mirroring the HTTPS `discovery-api.ts` but with the CA served from
 * `/ca.crt` on THIS origin (so the page's own download link resolves without a trust step, which is
 * the whole point):
 *
 *   - `GET /`       → the shared trust page (`renderTrustPage`), `Cache-Control: no-cache`, and
 *                     crucially NO `Strict-Transport-Security` — HSTS on this plain-HTTP origin would
 *                     pin the browser to HTTPS and strand the phone back on the interstitial it came
 *                     here to escape.
 *   - `GET /ca.crt` → the persisted CA as a downloadable attachment (200), or a `no_box_ca` 404 when
 *                     the box runs an operator-supplied certificate (no CA to hand out).
 *
 * This surface NEVER redirects: a redirect to the HTTPS origin would land the phone straight back on
 * the interstitial. The hand-off to HTTPS is a plain link on the page (`httpsUrl`), which the visitor
 * follows only after trusting the CA.
 */
export interface LandingDeps {
  /** The persisted state dir (config.stateDir); the CA lives at `<stateDir>/tls/ca.crt`. */
  stateDir: string;
  /** The URLs a device can open the box on over HTTPS — the `.local` URL then one per detected IPv4. */
  reachUrls: string[];
  /** The box's canonical HTTPS URL — the "continue to the secure site" hand-off link on the page. */
  httpsUrl: string;
  log: Logger;
}

/** This origin's CA download path. The plain-HTTP landing origin serves the CA at the ROOT-level
 *  `/ca.crt`, not the HTTPS-only `/setup-api/ca.crt`, which is why `renderTrustPage` takes the path as
 *  a parameter (see its header). */
const CA_DOWNLOAD_PATH = "/ca.crt";

/**
 * Build the landing Hono app. Pure of I/O at construction time (it only reads the CA file per request
 * inside the route handlers), so the suite runs on a bare temp state dir with no boot.
 */
export function buildLandingApp(deps: LandingDeps): Hono {
  const caPath = caCertPath(deps.stateDir);
  const app = new Hono();

  // Does the box have its own CA to serve? A page view is not a deliberate download, so this collapses
  // ENOENT (operator-cert box) and any other read failure alike to `false` — the page just shows "no
  // box CA" rather than logging. The `/ca.crt` route below is the deliberate action, so it
  // distinguishes the two error classes. Same split as `discovery-api.ts`.
  const caExists = (): Promise<boolean> =>
    access(caPath).then(
      () => true,
      () => false,
    );

  app.get("/", async (c) => {
    const html = renderTrustPage({
      reachUrls: deps.reachUrls,
      caAvailable: await caExists(),
      caDownloadPath: CA_DOWNLOAD_PATH,
      httpsUrl: deps.httpsUrl,
    });
    // `no-cache` so a box that later mints/rotates its CA is not shown a stale "no CA" page from a
    // cache. NO `Strict-Transport-Security`: this is the plain-HTTP escape hatch from the HTTPS
    // interstitial, and HSTS would pin the browser back to HTTPS. This surface never redirects.
    return c.html(html, 200, { "Cache-Control": "no-cache" });
  });

  app.get(CA_DOWNLOAD_PATH, async (c) => {
    let pem: string;
    try {
      pem = await readFile(caPath, "utf8");
    } catch (error) {
      // ENOENT is the ordinary case — this box uses an operator-supplied certificate, so there is no
      // box CA to hand out; unlogged. Any OTHER read failure (EACCES, EISDIR, …) of this box-owned
      // path is a misconfiguration worth one line, but STILL the same `no_box_ca` 404 to the LAN
      // caller: this route never 500s and never leaks fs detail. Same posture as `discovery-api.ts`.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // `code` is optional on the error TYPE, but every fs read failure this route can hit sets it,
        // so the `?? "unknown"` fallback is type-required but unreachable — same shape as
        // `discovery-api.ts`'s own `code ?? "unknown"`.
        /* v8 ignore next */
        deps.log("error", "landing.ca_read_failed", { code: code ?? "unknown" });
      }
      return c.json(
        {
          error: "no_box_ca",
          message: "This box uses an operator-supplied certificate; no CA download is needed.",
        },
        404,
      );
    }
    return c.body(pem, 200, {
      "Content-Type": CA_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${CA_FILENAME}"`,
      "Cache-Control": "no-store",
    });
  });

  return app;
}
