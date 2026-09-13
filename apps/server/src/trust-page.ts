import { DEVICE_HELP, DEVICE_ORDER, type DeviceHelp, type DeviceId } from "./trust-page-devices.js";
import { TRUST_PAGE_LOGO_SVG } from "./trust-page-logo.js";

/** Shared, self-contained instructions for the HTTP landing page and HTTPS setup help. */
export const CA_CONTENT_TYPE = "application/x-x509-ca-cert";
export const CA_FILENAME = "waitron-ca.crt";

export interface TrustPageInput {
  reachUrls: string[];
  caAvailable: boolean;
  caDownloadPath: string;
  qrSvg?: string;
  httpsUrl: string;
  /** Which device's steps to open, guessed by `detectTrustDevice`. "unknown" opens none. */
  device: DeviceId | "unknown";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Why an old certificate has to go before a new one works. It heads every device's removal
 * disclosure rather than standing as its own section: a re-image is the reason an operator has an
 * old certificate, not a separate procedure.
 */
const REMOVAL_INTRO = `<p>A re-imaged server has a <strong>new</strong> certificate, so the one you
  installed before will not work. Remove Waitron's old entry first, then install the new file.
  Remove only Waitron's own entry and leave everything else alone. If you see several entries with
  the same name and cannot tell which is this server's, ask whoever installed it before you remove
  anything.</p>`;

function notes(help: DeviceHelp): string {
  return (help.notes ?? []).map((n) => `<p class="note">${n}</p>`).join("");
}

function removal(help: DeviceHelp): string {
  const steps = help.removal.map((r) => `<li>${r}</li>`).join("");
  return `<details class="removal"><summary>Already installed a Waitron certificate?</summary>
    ${REMOVAL_INTRO}<ul>${steps}</ul></details>`;
}

/** One device's full instructions: install steps, any asides, and how to clear an old certificate. */
function deviceBody(help: DeviceHelp): string {
  const steps = help.install.map((s) => `<li>${s}</li>`).join("");
  return `<ol>${steps}</ol>${notes(help)}${removal(help)}`;
}

function deviceDetails(id: DeviceId): string {
  const help = DEVICE_HELP[id];
  return `<details><summary>${help.summary}</summary>${deviceBody(help)}</details>`;
}

/**
 * The install step. When the request's headers named a device, its steps are open and every other
 * device folds into one disclosure; when they did not, the page falls back to the plain list.
 */
function installSection(device: DeviceId | "unknown"): string {
  const managed = `<p class="note">These steps use your device's own settings, with no terminal.
    Menu names vary by version. On a device your employer manages, an administrator may have to
    install the certificate for you.</p>`;
  if (device === "unknown")
    return `<section><h2>2. Install it on your device</h2>${managed}
      ${DEVICE_ORDER.map(deviceDetails).join("")}</section>`;
  const others = DEVICE_ORDER.filter((d) => d !== device);
  return `<section><h2>2. ${DEVICE_HELP[device].heading}</h2>${deviceBody(DEVICE_HELP[device])}
    </section>
    <details class="others"><summary>Using a different device?</summary>${managed}
    ${others.map(deviceDetails).join("")}</details>`;
}

/** No external assets: certificate recovery must remain readable without internet access. */
export function renderTrustPage(input: TrustPageInput): string {
  const { reachUrls, caAvailable, caDownloadPath, qrSvg, httpsUrl, device } = input;
  const urlItems = reachUrls
    .map((u) => `<li><a href="${escapeHtml(u)}">${escapeHtml(u)}</a></li>`)
    .join("");

  const caBlock = caAvailable
    ? `<p><a class="button" href="${escapeHtml(caDownloadPath)}" download="${CA_FILENAME}">Download the certificate</a></p>
       <p class="note">Your browser may ask you to confirm the download — choose <strong>Keep</strong>,
       or the file never reaches the disk. This is the connection certificate, not your business's
       tax-agency certificate.</p>`
    : `<p>This server has no certificate to download. If it uses one your installer supplied, ask
       whoever installed it to check its trust, its expiry, and the address you are opening. A
       certificate downloaded before a re-image may no longer apply.</p>`;

  const steps = caAvailable ? installSection(device) : "";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Waitron — connect to this server</title>
<style>
:root { color-scheme: light dark; font: 17px/1.55 system-ui, sans-serif; }
body { margin: 0; } main { max-width: 44rem; margin: auto; padding: 1.5rem 1.5rem 4rem; }
h1 { line-height: 1.2; font-size: 1.5rem; } h2 { font-size: 1.2rem; } section { margin: 2rem 0; }
a { color: light-dark(#174da1, #9ec5ff); } li { margin-block: .5rem; }
details { border: 1px solid light-dark(#c4cbd4, #637080); border-radius: .5rem; padding: .8rem 1rem; margin-block: .7rem; }
details[open] { padding-bottom: .3rem; }
/* Three levels are reachable (other devices > one device > its removal steps); without this the
   indents compound and the innermost text column collapses on a phone. */
details details { padding-inline: .6rem; }
summary { cursor: pointer; font-weight: 600; }
.note { color: light-dark(#5c626e, #a1a7b3); font-size: .92rem; }
.button { display: inline-block; padding: .7rem 1.1rem; border-radius: .4rem; font-weight: 600;
  text-decoration: none; background: light-dark(#1f6feb, #4c8dff); color: light-dark(#ffffff, #16181d); }
code, a { overflow-wrap: anywhere; }
.logo svg { width: 9.5rem; height: auto; display: block; }
.qr svg { max-width: 14rem; height: auto; background: white; }
:focus-visible { outline: 3px solid light-dark(#174da1, #9ec5ff); outline-offset: 4px; }
</style></head><body><main>
<div class="logo">${TRUST_PAGE_LOGO_SVG}</div>
<h1>Connect to this Waitron server</h1>
<p>Do this before you enter passwords or business details. When it has worked, you can reopen this
server with no certificate warning. Clicking “continue anyway” past a warning is not the same thing.</p>
<section><h2>1. Get the certificate</h2>${caBlock}</section>
${steps}
<section class="go"><h2>${caAvailable ? "3" : "2"}. Open Waitron</h2>
<p>Reopen your browser and follow this link. If it still warns you, go back to the steps above
rather than entering setup details.</p>
<p class="continue"><a class="button" href="${escapeHtml(httpsUrl)}">Continue to Waitron</a></p>
<ul>${urlItems}</ul></section>
<details id="connection-help"><summary>If you cannot open this page or download the file</summary>
<p>Check that the server is on and that your device is on its network. Open this guide at
<code>http://&lt;server-address&gt;/setup/trust</code>, using the server's IP address if its name
does not work.</p>
<p>Some browsers change HTTP to HTTPS on their own. This guide and the download exist on both, but
HTTPS can show a certificate warning before the page opens. Take the browser's option to visit the
HTTP version of this local server if it offers one. If your browser or your administrator forbids
that, download the file on another device that can reach this server and transfer it across.</p>
<p>If a warning remains after you installed the certificate, check the address, your device's date
and time, and the trust settings of the browser you are using.</p>
</details>
${qrSvg ? `<section class="qr"><h2>Open on another device</h2><figure>${qrSvg}<figcaption>This QR opens the server address.</figcaption></figure></section>` : ""}
</main></body></html>\n`;
}
