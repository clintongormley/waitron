import { readFile, access } from "node:fs/promises";
import type { Hono } from "hono";
import QRCode from "qrcode";
import { buildReachInfo } from "./box-reach.js";
import type { ReachInfo } from "./box-reach.js";
import { caCertPath } from "./box-secrets.js";
import type { Logger } from "./logger.js";
import { trustDeviceForRequest } from "./detect-device.js";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";

/** Public certificate files use a fixed state path; requests never choose a filesystem location. */
export interface DiscoveryDeps {
  /** The persisted state dir; the CA lives at <stateDir>/tls/ca.crt. */
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
        /* v8 ignore start */
        log("error", "setup.ca_read_failed", { code: code ?? "unknown" });
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
      device: trustDeviceForRequest(c.req),
    });
    return c.html(html, 200, { "Cache-Control": "no-cache" });
  });

  log("info", "discovery.mounted", { hostname: deps.hostname });
}
