/**
 * The self-contained trust page and the CA download's wire constants, shared by both onboarding
 * origins: the HTTPS discovery API (`discovery-api.ts`, CA at `/setup-api/ca.crt`) and the plain-HTTP
 * landing listener, which serves the identical page but downloads the CA from `/ca.crt`. The CA path
 * is therefore a parameter (`caDownloadPath`), not a constant baked into the template — without it the
 * landing page's download link would 404 on its own origin.
 */

/** The CA download's MIME type — the wire content-type both origins set on `GET …/ca.crt`. */
export const CA_CONTENT_TYPE = "application/x-x509-ca-cert";

/** The suggested filename for the downloaded CA — the `download=`/`Content-Disposition` value. */
export const CA_FILENAME = "waitron-ca.crt";

export interface TrustPageInput {
  /** The URLs a device can open this box on — the `.local` URL then one per detected IPv4. */
  reachUrls: string[];
  /** Whether the box has its own CA to hand out (false → operator-supplied certificate). */
  caAvailable: boolean;
  /** The origin-relative CA download path this page's link points at (differs per origin). */
  caDownloadPath: string;
  /** The rendered inline SVG QR of the reach target; absent when the box has no LAN address. */
  qrSvg?: string;
  /** The box's canonical https URL — carried for the landing origin's HTTPS hand-off (Task 3). */
  httpsUrl: string;
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
export function renderTrustPage(input: TrustPageInput): string {
  const { reachUrls, caAvailable, caDownloadPath, qrSvg, httpsUrl } = input;
  const urlItems = reachUrls.map((u) => `<li><a href="${u}">${u}</a></li>`).join("");

  // The hand-off to the box's canonical HTTPS origin. On the plain-HTTP landing origin (Task 3) this
  // is the "I've trusted the certificate, take me to the real site" link — the page's whole purpose,
  // since the HTTPS interstitial fires before any of our JS on the untrusted origin. On the HTTPS
  // discovery origin it points at the same secure host the visitor is already on, which is harmless.
  // Server-derived (config + interfaces, never request input), so no escaping is needed — same as the
  // reach URLs above.
  const continueBlock = `<p class="continue"><a href="${httpsUrl}">Continue to the secure site</a></p>`;

  const caBlock = caAvailable
    ? `<p>First, <a href="${caDownloadPath}" download="${CA_FILENAME}">download this box's certificate</a>, then follow the steps for your device to trust it.</p>`
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
      <section class="go">
        <h2>Continue</h2>
        ${continueBlock}
      </section>
      <section class="scan">
        <h2>Scan to open</h2>
        ${qrBlock}
      </section>
    </main>
  </body>
</html>
`;
}
