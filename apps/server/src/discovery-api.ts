import { readFile, access } from "node:fs/promises";
import type { Hono } from "hono";
import QRCode from "qrcode";
import { buildReachInfo } from "./box-reach.js";
import type { ReachInfo } from "./box-reach.js";
import { caCertPath } from "./box-secrets.js";
import type { Logger } from "./logger.js";

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

/** The download path the trust page links and the discovery document advertises — a stable contract,
 *  not a per-request value, so it lives here as one constant both routes read. */
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
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="waitron-ca.crt"',
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
    const html = renderTrustPage(reach, caAvailable, qr);
    return c.html(html, 200, { "Cache-Control": "no-cache" });
  });

  // One line at mount, mirroring `mountSetup`/`mountMedia`: an operator scanning logs sees the
  // discovery surface came up. Fires once, not per request.
  log("info", "discovery.mounted", { hostname: deps.hostname });
}

/**
 * The self-contained trust page — a deliberately short inline string, NOT a built front end, matching
 * `setup-api.ts`'s placeholder style: this page is served while the box is unprovisioned and must
 * render with no external asset. It shows how to reach the box, how to obtain and trust its
 * certificate, and (when a LAN address exists) an inline SVG QR to open it on a phone.
 *
 * `qrSvg` and the per-OS copy are static/server-derived, so they are embedded directly; the reach
 * URLs come from config and the box's own interfaces (never request input), so no escaping is needed.
 */
function renderTrustPage(reach: ReachInfo, caAvailable: boolean, qrSvg: string | null): string {
  const urlItems = [reach.hostnameUrl, ...reach.ipUrls]
    .map((u) => `<li><a href="${u}">${u}</a></li>`)
    .join("");

  const caBlock = caAvailable
    ? `<p>First, <a href="${CA_DOWNLOAD_PATH}" download="waitron-ca.crt">download this box's certificate</a>, then follow the steps for your device to trust it.</p>`
    : `<p>This box uses an operator-supplied certificate, so there is nothing to download — your device already trusts it if your administrator installed their own certificate.</p>`;

  const qrBlock = qrSvg
    ? `<figure class="qr">${qrSvg}<figcaption>Scan with a phone on the same network to open this box.</figcaption></figure>`
    : `<p class="no-qr">No local network address was detected, so there is no QR code to scan. Use one of the addresses above from a device on the same network.</p>`;

  // Concise, factual per-OS steps — static help text (brief Step 4). Arrows (→) separate menu hops.
  const osSteps = `<section class="os-steps">
      <h2>Trust the certificate</h2>
      <dl>
        <dt>Android</dt>
        <dd>Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate.</dd>
        <dt>iOS / iPadOS</dt>
        <dd>Install the downloaded profile, then Settings → General → VPN &amp; Device Management. Then enable full trust under Settings → General → About → Certificate Trust Settings.</dd>
        <dt>macOS</dt>
        <dd>Open the file → Keychain Access → set the certificate to Always Trust.</dd>
        <dt>Windows</dt>
        <dd>Import the certificate into Trusted Root Certification Authorities.</dd>
      </dl>
    </section>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Waitron — trust this box</title>
  </head>
  <body>
    <main>
      <h1>Connect to this Waitron box</h1>
      <section class="reach">
        <h2>Open this box</h2>
        <ul>${urlItems}</ul>
      </section>
      <section class="cert">
        <h2>Get the certificate</h2>
        ${caBlock}
      </section>
      ${osSteps}
      <section class="scan">
        <h2>Scan to open</h2>
        ${qrBlock}
      </section>
    </main>
  </body>
</html>
`;
}
