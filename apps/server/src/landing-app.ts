import { readFile, access } from "node:fs/promises";
import { Hono } from "hono";
import { caCertPath } from "./box-secrets.js";
import type { Logger } from "./logger.js";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";

/**
 * Public certificate help on the separate HTTP listener. It never redirects to HTTPS;
 * browsers may still upgrade navigation themselves, so the HTTPS listener mirrors these paths.
 * It serves public help and CA downloads, with no application forms or write routes.
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

/** Keep the established agent-download path as well as the HTTPS discovery alias. */
const CA_DOWNLOAD_PATH = "/ca.crt";

/**
 * Build the landing Hono app. Pure of I/O at construction time (it only reads the CA file per request
 * inside the route handlers), so the suite runs on a bare temp state dir with no boot.
 */
export function buildLandingApp(deps: LandingDeps): Hono {
  const caPath = caCertPath(deps.stateDir);
  const app = new Hono();

  // Does the box have its own CA to serve? A page view is not a deliberate download, so this collapses
  // ENOENT and any other read failure alike to `false` — the page just shows "no
  // box CA" rather than logging. The `/ca.crt` route below is the deliberate action, so it
  // distinguishes the two error classes. Same split as `discovery-api.ts`.
  const caExists = (): Promise<boolean> =>
    access(caPath).then(
      () => true,
      () => false,
    );

  app.on("GET", ["/", "/setup/trust"], async (c) => {
    const html = renderTrustPage({
      reachUrls: deps.reachUrls,
      caAvailable: await caExists(),
      caDownloadPath: CA_DOWNLOAD_PATH,
      httpsUrl: deps.httpsUrl,
    });
    // A re-image must not leave a cached guide. HTTPS navigation remains an explicit link here.
    return c.html(html, 200, { "Cache-Control": "no-cache" });
  });

  app.on("GET", [CA_DOWNLOAD_PATH, "/setup-api/ca.crt"], async (c) => {
    let pem: string;
    try {
      pem = await readFile(caPath, "utf8");
    } catch (error) {
      // Missing files need no operator log. Other read failures are logged without exposing paths.
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
          message: "No box CA is available for this connection.",
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
