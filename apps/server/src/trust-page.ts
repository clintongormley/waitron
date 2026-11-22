import { PAGE_THEME_SCRIPT, PAGE_THEME_STYLE } from "./page-theme.js";
import type { BoxTlsInspection } from "./box-tls-repair.js";
import { renderConnectionPage } from "./connection-bootstrap-page.js";
import { DECLARATION_LINK_WORDS } from "./i18n/declaration-page.js";
import { NOT_SET_UP_WORDS } from "./i18n/trust-page.js";
import { DEVICE_HELP, DEVICE_ORDER, type DeviceHelp, type DeviceId } from "./trust-page-devices.js";
import { TRUST_PAGE_LOGO_SVG } from "./trust-page-logo.js";
import type { VenueNameState } from "./mdns.js";

export const CA_CONTENT_TYPE = "application/x-x509-ca-cert";
export const CA_FILENAME = "waitron-ca.crt";

export interface TrustPageInput {
  caCertificate?: string;
  connection?: BoxTlsInspection & {
    repairAllowed?: boolean;
    /** The repair is offered, but only to a request from the server itself, and this is not one. */
    serverOnly?: boolean;
    continuationRequired?: boolean;
    storageFreeBytes?: number;
  };
  locale?: "en" | "es";
  reachUrls: string[];
  caAvailable: boolean;
  caDownloadPath: string;
  qrSvg?: string;
  httpsUrl: string;
  /** Which device's steps to open, guessed by `detectTrustDevice`. "unknown" opens none. */
  device: DeviceId | "unknown";
  /** This box's own HTTPS origin, offered first because another box answers `httpsUrl`'s name. */
  ownAddress?: string;
  /** Set only on a box with no node identity (`WAITRON_NODE_ID` unset). */
  notSetUp?: boolean;
}

/** `waitron.local` may reach another box, so a person joining this one is sent to its own address. */
export function ownAddressFor(
  state: VenueNameState | undefined,
  ipUrls: readonly string[],
  requestHostname: string,
): string | undefined {
  if (state !== "other-box-answers") return undefined;
  return ipUrls.find((url) => new URL(url).hostname === requestHostname) ?? ipUrls[0];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const REMOVAL_INTRO = `If you have installed a Waitron certificate on this computer before, then you
  will need to remove it before installing the new certificate. Remove only Waitron's own entry.
  If you cannot identify the old Waitron entry, stop and use another venue device.`;

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
  names vary by version. If installation is blocked, use a venue device that permits it.</p>`;

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
  if (input.connection) return renderConnectionPage({ ...input, connection: input.connection });
  const { caAvailable, caDownloadPath, qrSvg, device, ownAddress, notSetUp } = input;
  const reachUrls = ownAddress
    ? [ownAddress, ...input.reachUrls.filter((url) => url !== ownAddress)]
    : input.reachUrls;
  const httpsUrl = ownAddress
    ? ownAddress + input.httpsUrl.slice(new URL(input.httpsUrl).origin.length)
    : input.httpsUrl;
  const lead = ownAddress
    ? `<p>Adding a spare? You don't need this box's certificate: open this address (<a href="${escapeHtml(httpsUrl)}">${escapeHtml(ownAddress)}</a>) and accept your browser's warning once.</p>\n`
    : "";
  const urlItems = reachUrls
    .map((u) => `<li><a href="${escapeHtml(u)}">${escapeHtml(u)}</a></li>`)
    .join("");

  const warning =
    notSetUp && !ownAddress
      ? `<p class="warning-words">${escapeHtml(NOT_SET_UP_WORDS.en)}</p><p class="warning-words" lang="es">${escapeHtml(NOT_SET_UP_WORDS.es)}</p>\n`
      : "";
  const steps = caAvailable
    ? `${warning}${removeSection(device)}
       <section><h2>2. Get the certificate</h2>
       <p><a class="button" href="${escapeHtml(caDownloadPath)}" download="${CA_FILENAME}">Download the certificate</a></p>
       <p class="note">Your browser may ask you to confirm the download — choose <strong>Keep</strong>,
       or the file never reaches the disk.</p></section>
       ${installSection(device)}`
    : `<section><h2>1. Get the certificate</h2>
       <p>This box has no certificate to download. Check its known HTTPS address below and stop
       if it shows a certificate warning. This page cannot replace a separately installed certificate.
       A certificate downloaded before a re-image may no longer apply.</p></section>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Waitron — connect to this box</title>
<style>
:root { color-scheme: light dark; font: 17px/1.55 system-ui, sans-serif; }
${PAGE_THEME_STYLE}
body { margin: 0; } main { max-width: 44rem; margin: auto; padding: 1.5rem 1.5rem 4rem; }
h1 { line-height: 1.2; font-size: 1.5rem; } h2 { font-size: 1.2rem; } section { margin: 2rem 0; }
a { color: light-dark(#007392, #71cfeb); } li { margin-block: .5rem; }
details { border: 1px solid light-dark(#c4cbd4, #637080); border-radius: .5rem; padding: .8rem 1rem; margin-block: .7rem; }
details[open] { padding-bottom: .3rem; }
details details { padding-inline: .6rem; }
summary { cursor: pointer; font-weight: 600; }
/* Token values are inlined on this page, light then dark, and kept in step by hand: #626366/#a1a7b3
   is --wt-color-text-muted, #b3261e/#ff7f73 is --wt-color-danger, #007392/#71cfeb is
   --wt-color-primary (the button), --wt-color-primary-text (links) and --wt-color-focus (the focus
   outline), and #ffffff/#001016 is --wt-color-on-primary, all declared in
   packages/ui-core/src/tokens/colors.css. apps/server does not depend on @waitron/ui, and this page must
   stay one self-contained string with no external assets, so it cannot read the custom properties.
   Same arrangement, and the same reason, as packages/ui/brand/README.md. */
.note { color: light-dark(#626366, #a1a7b3); font-size: .92rem; }
/* The browser's own warning, in the browser's own colour. The words carry the meaning; the colour
   is emphasis, so a reader who cannot see it loses nothing. */
.accent, .warning-words { color: light-dark(#b3261e, #ff7f73); }
.warning-words { font-weight: 600; }
.button { display: inline-block; padding: .7rem 1.1rem; border-radius: .4rem; font-weight: 600;
  text-decoration: none; background: light-dark(#007392, #71cfeb); color: light-dark(#ffffff, #001016); }
code, a { overflow-wrap: anywhere; }
.logo svg { width: auto; height: 1.62rem; display: block; }
.qr svg { max-width: 14rem; height: auto; background: white; }
:focus-visible { outline: 3px solid light-dark(#007392, #71cfeb); outline-offset: 4px; }
</style><script>${PAGE_THEME_SCRIPT}</script></head><body><main>
<div class="logo">${TRUST_PAGE_LOGO_SVG}</div>
<h1>Connect <span class="accent">securely</span> to this Waitron box</h1>
${lead}<p>${lead ? "Otherwise, you" : "You"} need to install the Waitron secure certificate before entering passwords and sensitive information into this website:</p>
${steps}
<section class="go"><h2>${caAvailable ? "4" : "2"}. Open Waitron</h2>
<p>Open Waitron with the link below, then check the address bar of the page it opens. If that still
shows <span class="warning-words">Not secure</span>, come back here and start again from step 1.</p>
<p class="continue"><a class="button" href="${escapeHtml(httpsUrl)}">Continue to Waitron</a></p>
<ul>${urlItems}</ul></section>
${qrSvg ? `<section class="qr"><h2>Open this page on another device</h2><figure>${qrSvg}</figure></section>` : ""}
<p class="note"><a href="/legal/declaration" lang="es">${escapeHtml(DECLARATION_LINK_WORDS.title)}</a></p>
</main></body></html>\n`;
}
