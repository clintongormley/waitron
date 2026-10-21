import { Hono } from "hono";
import { readBoxPublicCa } from "./box-tls-repair.js";
import type { Logger } from "./logger.js";
import { trustDeviceForRequest } from "./detect-device.js";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";
import { mountConnectionBootstrap, type ConnectionBootstrapDeps } from "./connection-bootstrap.js";

/** HTTP exposes public connection setup; application and recovery inputs stay on HTTPS. */
export interface LandingDeps {
  landingPort?: number;
  connectionHostnames?: string[];
  /** The persisted state dir (config.stateDir); the CA lives at `<stateDir>/tls/ca.crt`. */
  stateDir: string;
  /** The URLs a device can open the box on over HTTPS — the `.local` URL then one per detected IPv4. */
  reachUrls: string[];
  /** The box's canonical HTTPS URL, used by the "Continue to Waitron" link. */
  httpsUrl: string;
  log: Logger;
  connection?: ConnectionBootstrapDeps;
}

/** Keep the established agent-download path as well as the HTTPS discovery alias. */
const CA_DOWNLOAD_PATH = "/ca.crt";

export function buildLandingApp(deps: LandingDeps): Hono {
  const app = new Hono();
  if (deps.connection !== undefined) {
    mountConnectionBootstrap(app, deps.connection);
    return app;
  }

  const known = deps.reachUrls.length ? deps.reachUrls : [deps.httpsUrl];
  mountConnectionBootstrap(
    app,
    {
      stateDir: deps.stateDir,
      hostnames: deps.connectionHostnames ?? [new URL(deps.httpsUrl).hostname],
      listIpv4: () =>
        known
          .map((url) => new URL(url).hostname)
          .filter((host) => /^\d+\.\d+\.\d+\.\d+$/.test(host)),
      now: () => new Date(),
      origins: known.map(
        (url) => new URL(`http://${new URL(url).hostname}:${deps.landingPort ?? 80}`).origin,
      ),
      reachUrls: known,
      onRepaired: async () => {},
      log: deps.log,
    },
    false,
  );

  // A page view is not a deliberate download, so any read failure is `false` and nothing is logged;
  // the `/ca.crt` route below is the deliberate action and distinguishes ENOENT from other failures.
  const caExists = (): Promise<boolean> =>
    readBoxPublicCa(deps.stateDir).then(
      (pem) => pem !== null,
      () => false,
    );

  app.on("GET", ["/", "/setup/trust"], async (c) => {
    const html = renderTrustPage({
      reachUrls: deps.reachUrls,
      caAvailable: await caExists(),
      caDownloadPath: CA_DOWNLOAD_PATH,
      httpsUrl: deps.httpsUrl,
      device: trustDeviceForRequest(c.req),
    });
    // A re-image must not leave a cached guide. HTTPS navigation remains an explicit link here.
    return c.html(html, 200, { "Cache-Control": "no-cache" });
  });

  app.on("GET", [CA_DOWNLOAD_PATH, "/setup-api/ca.crt"], async (c) => {
    let pem: string;
    try {
      pem = (await readBoxPublicCa(deps.stateDir)) ?? "";
    } catch (error) {
      // Missing files need no operator log. Other read failures are logged without exposing paths.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // `code` is optional on the error TYPE, but every fs read failure this route can hit sets it.
        /* v8 ignore start */
        deps.log("error", "landing.ca_read_failed", { code: code ?? "unknown" });
        /* v8 ignore stop */
      }
      return c.json(
        {
          error: "no_box_ca",
          message: "No box CA is available for this connection.",
        },
        404,
      );
    }
    if (!pem) return c.json({ error: "no_box_ca" }, 404);
    return c.body(pem, 200, {
      "Content-Type": CA_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${CA_FILENAME}"`,
      "Cache-Control": "no-store",
    });
  });

  return app;
}
