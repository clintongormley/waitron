import { DEVICE_HELP, DEVICE_ORDER, type DeviceHelp, type DeviceId } from "./trust-page-devices.js";
import { TRUST_PAGE_LOGO_SVG } from "./trust-page-logo.js";

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
 * Step one, not an aside: installing a new certificate while the old one is still trusted changes
 * nothing an operator can see — the browser keeps the entry it already has.
 */
const REMOVAL_INTRO = `If you have installed a Waitron certificate on this computer before, then you
  will need to remove it before installing the new certificate. Remove only Waitron's own entry — if
  you cannot tell which one it is, ask whoever installed this server.`;

function notes(help: DeviceHelp): string {
  return (help.notes ?? []).map((n) => `<p class="note">${n}</p>`).join("");
}

function removeSection(device: DeviceId | "unknown"): string {
  const body =
    device === "unknown"
      ? `<p class="note">Find your device in step 3 — each one's steps begin with how to remove an
         old certificate.</p>`
      : `<ul>${DEVICE_HELP[device].removal.map((r) => `<li>${r}</li>`).join("")}</ul>
         <p>Then quit your browser completely and reopen this page.</p>`;
  return `<section><h2>1. Remove any old Waitron certificate</h2>
    <p>${REMOVAL_INTRO}</p>${body}</section>`;
}

function deviceDetails(id: DeviceId): string {
  const help = DEVICE_HELP[id];
  const removal = help.removal.map((r) => `<li>${r}</li>`).join("");
  const install = help.install.map((i) => `<li>${i}</li>`).join("");
  return `<details><summary>${help.summary}</summary>
    <p class="note">First, remove any old Waitron certificate:</p><ul>${removal}</ul>
    <p class="note">Then install the new one:</p><ol>${install}</ol>${notes(help)}</details>`;
}

const MANAGED = `<p class="note">These steps use your device's own settings, with no terminal. Menu
  names vary by version. On a device your employer manages, an administrator may have to install the
  certificate for you.</p>`;

function installSection(device: DeviceId | "unknown"): string {
  if (device === "unknown")
    return `<section><h2>3. Install it on your device</h2>${MANAGED}
      ${DEVICE_ORDER.map(deviceDetails).join("")}</section>`;
  const help = DEVICE_HELP[device];
  const steps = help.install.map((i) => `<li>${i}</li>`).join("");
  return `<section><h2>3. ${help.heading}</h2><ol>${steps}</ol>${notes(help)}</section>
    <details class="others"><summary>Using a different device?</summary>${MANAGED}
    ${DEVICE_ORDER.filter((d) => d !== device)
      .map(deviceDetails)
      .join("")}</details>`;
}

/** No external assets: certificate recovery must remain readable without internet access. */
export function renderTrustPage(input: TrustPageInput): string {
  const { reachUrls, caAvailable, caDownloadPath, qrSvg, httpsUrl, device } = input;
  const urlItems = reachUrls
    .map((u) => `<li><a href="${escapeHtml(u)}">${escapeHtml(u)}</a></li>`)
    .join("");

  const steps = caAvailable
    ? `${removeSection(device)}
       <section><h2>2. Get the certificate</h2>
       <p><a class="button" href="${escapeHtml(caDownloadPath)}" download="${CA_FILENAME}">Download the certificate</a></p>
       <p class="note">Your browser may ask you to confirm the download — choose <strong>Keep</strong>,
       or the file never reaches the disk.</p></section>
       ${installSection(device)}`
    : `<section><h2>1. Get the certificate</h2>
       <p>This server has no certificate to download. If it uses one your installer supplied, ask
       whoever installed it to check its trust, its expiry, and the address you are opening. A
       certificate downloaded before a re-image may no longer apply.</p></section>`;

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
details details { padding-inline: .6rem; }
summary { cursor: pointer; font-weight: 600; }
/* Four token pairs are inlined below, light then dark, and kept in step by hand: #5c626e/#a1a7b3
   is --wt-color-text-muted, #b3261e/#ff6b5e is --wt-color-danger, #1f6feb/#4c8dff is
   --wt-color-primary, and #ffffff/#06101f is --wt-color-on-primary, all declared in
   packages/ui-core/src/tokens/colors.css. apps/server does not depend on @waitron/ui, and this page must
   stay one self-contained string with no external assets, so it cannot read the custom properties.
   Same arrangement, and the same reason, as packages/ui/brand/README.md. */
.note { color: light-dark(#5c626e, #a1a7b3); font-size: .92rem; }
/* The browser's own warning, in the browser's own colour. The words carry the meaning; the colour
   is emphasis, so a reader who cannot see it loses nothing. */
.accent, .warning-words { color: light-dark(#b3261e, #ff6b5e); }
.warning-words { font-weight: 600; }
.button { display: inline-block; padding: .7rem 1.1rem; border-radius: .4rem; font-weight: 600;
  text-decoration: none; background: light-dark(#1f6feb, #4c8dff); color: light-dark(#ffffff, #06101f); }
code, a { overflow-wrap: anywhere; }
.logo svg { width: 9.5rem; height: auto; display: block; }
.qr svg { max-width: 14rem; height: auto; background: white; }
:focus-visible { outline: 3px solid light-dark(#174da1, #9ec5ff); outline-offset: 4px; }
</style></head><body><main>
<div class="logo">${TRUST_PAGE_LOGO_SVG}</div>
<h1>Connect <span class="accent">securely</span> to this Waitron server</h1>
<p>You need to install the Waitron secure certificate before entering passwords and sensitive information into this website:</p>
${steps}
<section class="go"><h2>${caAvailable ? "4" : "2"}. Open Waitron</h2>
<p>Open Waitron with the link below, then check the address bar of the page it opens. If that still
shows <span class="warning-words">“not secure”</span>, come back here and start again from step 1.</p>
<p class="continue"><a class="button" href="${escapeHtml(httpsUrl)}">Continue to Waitron</a></p>
<ul>${urlItems}</ul></section>
${qrSvg ? `<section class="qr"><h2>Open this page on another device</h2><figure>${qrSvg}</figure></section>` : ""}
</main></body></html>\n`;
}
