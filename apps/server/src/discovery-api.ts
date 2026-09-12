import { readFile, access } from "node:fs/promises";
import type { Hono } from "hono";
import QRCode from "qrcode";
import { buildReachInfo } from "./box-reach.js";
import type { ReachInfo } from "./box-reach.js";
import { caCertPath } from "./box-secrets.js";
import type { Logger } from "./logger.js";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";

/** Public certificate files use a fixed state path; requests never choose a filesystem location. */
export interface DiscoveryDeps {
  /** The persisted state dir (config.stateDir); the CA lives at <stateDir>/tls/ca.crt (2a). */
  stateDir: string;
  hostname: string; // "waitron.local"
  port: number; // config.httpPort
  secure: boolean;
  /** Machine discovery is restricted to setup; certificate help remains public in every mode. */
  discoveryEnabled?: boolean;
  /** False when the listener presents operator TLS, even if a fallback CA exists on disk. */
  serveBoxCa?: boolean;
  /** Injected for tests. */
  listIpv4?: () => string[];
  /** Injected for tests; default `QRCode.toString(text, { type: "svg", margin: 1 })`. */
  renderQrSvg?: (text: string) => Promise<string>;
}

/** Existing discovery clients keep this path; /ca.crt also survives an HTTP-to-HTTPS upgrade. */
const CA_DOWNLOAD_PATH = "/setup-api/ca.crt";

const defaultRenderQrSvg = (text: string): Promise<string> =>
  QRCode.toString(text, { type: "svg", margin: 1 });

/** Mount public certificate help/downloads and, when enabled, setup's discovery document. */
export function mountDiscovery(app: Hono, deps: DiscoveryDeps, log: Logger): void {
  const caPath = caCertPath(deps.stateDir);
  const renderQrSvg = deps.renderQrSvg ?? defaultRenderQrSvg;

  // The reach info is the same lookup for both read routes — one options object, built here once so
  // the two callers cannot drift apart. Cheap and synchronous (it just enumerates interfaces via the
  // injected `listIpv4`), so it is recomputed per request rather than cached across the app's life.
  const getReach = (): ReachInfo =>
    buildReachInfo({
      hostname: deps.hostname,
      port: deps.port,
      secure: deps.secure,
      listIpv4: deps.listIpv4,
    });

  // Page views omit unavailable downloads; explicit downloads log unexpected read failures.
  const caExists = (): Promise<boolean> =>
    deps.serveBoxCa === false
      ? Promise.resolve(false)
      : access(caPath).then(
          () => true,
          () => false,
        );

  app.on("GET", [CA_DOWNLOAD_PATH, "/ca.crt"], async (c) => {
    if (deps.serveBoxCa === false) {
      return c.json(
        { error: "no_box_ca", message: "No box CA is available for this connection." },
        404,
      );
    }
    let pem: string;
    try {
      pem = await readFile(caPath, "utf8");
    } catch (error) {
      // Missing files need no operator log. Other read failures are logged without exposing paths.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // `code` is optional on the ERROR TYPE, but every fs read failure this route can hit (EISDIR,
        // EACCES, ENOTDIR, …) sets it, so the `?? "unknown"` fallback is type-required but unreachable.
        /* v8 ignore next */
        log("error", "setup.ca_read_failed", { code: code ?? "unknown" });
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

  if (deps.discoveryEnabled !== false) {
    app.get("/setup-api/discovery", async (c) => {
      const reach = getReach();
      return c.json({
        ...reach,
        caDownloadAvailable: await caExists(),
        caDownloadPath: CA_DOWNLOAD_PATH,
      });
    });
  }

  app.get("/setup/trust", async (c) => {
    const reach = getReach();
    // `renderQrSvg` (encode the reach URL) and `caExists` (stat the CA file) are independent, so run
    // them concurrently — the route's latency is max(qr, fs) rather than their sum.
    const [qr, caAvailable] = await Promise.all([
      reach.qrTarget ? renderQrSvg(reach.qrTarget) : Promise.resolve(null),
      caExists(),
    ]);
    const html = renderTrustPage({
      reachUrls: [reach.hostnameUrl, ...reach.ipUrls],
      caAvailable,
      caDownloadPath: CA_DOWNLOAD_PATH,
      qrSvg: qr ?? undefined,
      httpsUrl: reach.hostnameUrl,
    });
    return c.html(html, 200, { "Cache-Control": "no-cache" });
  });

  // One line at mount, mirroring `mountSetup`: an operator scanning logs sees the
  // discovery surface came up. Fires once, not per request.
  log("info", "discovery.mounted", { hostname: deps.hostname });
}
