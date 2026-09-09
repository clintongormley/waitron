import { readFile, access } from "node:fs/promises";
import type { Hono } from "hono";
import QRCode from "qrcode";
import { buildReachInfo } from "./box-reach.js";
import type { ReachInfo } from "./box-reach.js";
import { caCertPath } from "./box-secrets.js";
import type { Logger } from "./logger.js";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";

/**
 * The one HTTP surface onboarding slice 3 adds: it lets a device on the LAN discover and trust this
 * box before any venue is bound. Three UNAUTHENTICATED routes (like setup mode and `/media`, none of
 * these is secret): the self-signed CA download, a machine-readable discovery document, and a
 * server-rendered trust page carrying an inline SVG QR. Everything IO-touching is injected
 * (`listIpv4`, `renderQrSvg`) so the suite runs on a bare `new Hono()` + a temp state dir.
 *
 * The CA is the one slice 2a minted and persisted; its path is FIXED at `<stateDir>/tls/ca.crt`,
 * never derived from the request, so no crafted URL can point the read anywhere else. A box running
 * an operator-supplied certificate has no such file — every CA-touching route treats "cannot read the
 * CA" uniformly as "no box CA", the same all-errors-collapse posture `caExists` below encodes.
 */
export interface DiscoveryDeps {
  /** The persisted state dir (config.stateDir); the CA lives at <stateDir>/tls/ca.crt (2a). */
  stateDir: string;
  hostname: string; // "waitron.local"
  port: number; // config.httpPort
  secure: boolean; // config.tls !== undefined || the box mints its own (setup mode → true)
  /** Injected for tests. */
  listIpv4?: () => string[];
  /** Injected for tests; default `QRCode.toString(text, { type: "svg", margin: 1 })`. */
  renderQrSvg?: (text: string) => Promise<string>;
}

/** This origin's CA download path — the route this API registers and advertises in its discovery
 *  document, and the link it passes to the shared trust page. The plain-HTTP landing origin (Task 3)
 *  serves the same page with a different path, which is why `renderTrustPage` takes it as a parameter. */
const CA_DOWNLOAD_PATH = "/setup-api/ca.crt";

/**
 * The default QR renderer — the real `qrcode` path, exercised only when `renderQrSvg` is NOT injected.
 * Every test in this task injects a fast stub, so this right-hand side runs only under a full boot
 * (Task 4), which is where it is measured — left to the `apps/server` coverage aggregate rather than
 * pinned by a real-`qrcode` unit test, the same real-only-path posture `box-reach.ts`'s `listBoxIpv4`
 * and `boot.ts` record. `qrcode` is CJS, hence the default import.
 */
const defaultRenderQrSvg = (text: string): Promise<string> =>
  QRCode.toString(text, { type: "svg", margin: 1 });

/**
 * Mount the three discovery routes on an existing Hono app. Registered by Task 4's boot wiring in the
 * setup branch, alongside `mountSetup`.
 *
 *   - `GET /setup-api/ca.crt` → the persisted CA as a downloadable attachment (200), or a
 *     `no_box_ca` 404 JSON when the box runs an operator-supplied certificate.
 *   - `GET /setup-api/discovery` → the `ReachInfo` fields plus whether the CA is downloadable.
 *   - `GET /setup/trust` → a self-contained trust page: reach URLs, the CA link (or the operator-cert
 *     note), concise per-OS trust steps, and the inline SVG QR of the IP-QR target.
 */
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

  // Does the box have its own CA to serve? These read-on-every-page-view routes (`/discovery`,
  // `/trust`) collapse ENOENT (operator-cert box) and any other read failure alike to `false`: a
  // page view is not a deliberate download, so it just shows "no box CA" rather than logging. The
  // download route below is the deliberate action, so it distinguishes the two error classes.
  const caExists = (): Promise<boolean> =>
    access(caPath).then(
      () => true,
      () => false,
    );

  app.get(CA_DOWNLOAD_PATH, async (c) => {
    let pem: string;
    try {
      pem = await readFile(caPath, "utf8");
    } catch (error) {
      // ENOENT is the ordinary case — this box uses an operator-supplied certificate, so there is no
      // box CA to hand out; unlogged, like a missing image in `media-api.ts`. Any OTHER read failure
      // (EACCES, EISDIR, …) of this box-owned path is a misconfiguration worth one line, but STILL the
      // same `no_box_ca` 404 to the LAN caller: this route never 500s and never leaks fs detail on a
      // download. Same ENOENT-vs-other split, and same "log but don't leak", as `media-api.ts`.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // `code` is optional on the ERROR TYPE, but every fs read failure this route can hit (EISDIR,
        // EACCES, ENOTDIR, …) sets it, so the `?? "unknown"` fallback is type-required but unreachable
        // — the same shape `media-api.ts`'s `code ?? "unknown"` documents and v8-ignores.
        /* v8 ignore next */
        log("error", "setup.ca_read_failed", { code: code ?? "unknown" });
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

  app.get("/setup-api/discovery", async (c) => {
    const reach = getReach();
    return c.json({
      ...reach,
      caDownloadAvailable: await caExists(),
      caDownloadPath: CA_DOWNLOAD_PATH,
    });
  });

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

  // One line at mount, mirroring `mountSetup`/`mountMedia`: an operator scanning logs sees the
  // discovery surface came up. Fires once, not per request.
  log("info", "discovery.mounted", { hostname: deps.hostname });
}
