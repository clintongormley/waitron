import { PAGE_THEME_SCRIPT, PAGE_THEME_STYLE } from "./page-theme.js";
import type { BoxTlsInspection } from "./box-tls-repair.js";
import { renderConnectionPage } from "./connection-bootstrap-page.js";
import { CONNECTION_DEVICE_ES, CONNECTION_TEXT } from "./connection-bootstrap-strings.js";
import { TOUCH_FIRST_CONDITION } from "./detect-device.js";
import { DECLARATION_LINK_WORDS } from "./i18n/declaration-page.js";
import { NOT_SET_UP_WORDS, TRUST_PAGE_WORDS } from "./i18n/trust-page.js";
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
  /** The server's guess, from `detectTrustDevice`; the page may replace "linux" in the browser. "unknown" opens none. */
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

type Locale = keyof typeof TRUST_PAGE_WORDS;
type TrustWords = (typeof TRUST_PAGE_WORDS)[Locale];

function notes(help: DeviceHelp): string {
  return (help.notes ?? []).map((n) => `<p class="note">${n}</p>`).join("");
}

function removeSection(help: DeviceHelp | undefined, words: TrustWords): string {
  const body = help
    ? `<ul>${help.removal.map((r) => `<li>${r}</li>`).join("")}</ul><p>${words.reopen}</p>`
    : `<p class="note">${words.findDevice}</p>`;
  return `<section><h2>1. ${words.remove}</h2><p>${words.removeIntro}</p>${body}</section>`;
}

function deviceDetails(help: DeviceHelp, words: TrustWords): string {
  const removal = help.removal.map((r) => `<li>${r}</li>`).join("");
  const install = help.install.map((i) => `<li>${i}</li>`).join("");
  return `<details><summary>${help.summary}</summary>
    <p class="note">${words.removeFirst}</p><ul>${removal}</ul>
    <p class="note">${words.installNext}</p><ol>${install}</ol>${notes(help)}</details>`;
}

function installSection(
  device: DeviceId | "unknown",
  devices: Record<DeviceId, DeviceHelp>,
  words: TrustWords,
): string {
  const managed = `<p class="note">${words.managed}</p>`;
  if (device === "unknown")
    return `<section><h2>3. ${words.install}</h2>${managed}
      ${DEVICE_ORDER.map((id) => deviceDetails(devices[id], words)).join("")}</section>`;
  const help = devices[device];
  const steps = help.install.map((i) => `<li>${i}</li>`).join("");
  return `<section><h2>3. ${help.heading}</h2><ol>${steps}</ol>${notes(help)}</section>
    <details class="others"><summary>${words.otherDevices}</summary>${managed}
    ${DEVICE_ORDER.filter((d) => d !== device)
      .map((id) => deviceDetails(devices[id], words))
      .join("")}</details>`;
}

const TOUCH_STEPS_SCRIPT = `if(${TOUCH_FIRST_CONDITION})document.getElementById("steps").replaceChildren(document.getElementById("touch-steps").content)`;

function certificateSteps(
  device: DeviceId | "unknown",
  caDownloadPath: string,
  locale: Locale,
): string {
  const words = TRUST_PAGE_WORDS[locale];
  const devices = locale === "es" ? CONNECTION_DEVICE_ES : DEVICE_HELP;
  return `${removeSection(device === "unknown" ? undefined : devices[device], words)}
       <section><h2>2. ${words.get}</h2>
       <p><a class="button" href="${escapeHtml(caDownloadPath)}" download="${CA_FILENAME}">${words.download}</a></p>
       <p class="note">${words.downloadHelp(CA_FILENAME)}</p></section>
       ${installSection(device, devices, words)}`;
}

/**
 * An Android tablet can be answered `linux` (`detect-device.ts`), so a touch-first device is shown
 * Android's steps. That is a guess too: "Using a different device?" still lists Linux. Without the
 * script, the Linux steps stay.
 */
function stepsOrTouchSteps(
  device: DeviceId | "unknown",
  caDownloadPath: string,
  locale: Locale,
): string {
  const steps = certificateSteps(device, caDownloadPath, locale);
  if (device !== "linux") return steps;
  return `<div id="steps">${steps}</div>
    <template id="touch-steps">${certificateSteps("android", caDownloadPath, locale)}</template>
    <script>${TOUCH_STEPS_SCRIPT}</script>`;
}

/** No external assets: certificate recovery must remain readable without internet access. */
export function renderTrustPage(input: TrustPageInput): string {
  if (input.connection) return renderConnectionPage({ ...input, connection: input.connection });
  const { caAvailable, caDownloadPath, qrSvg, device, ownAddress, notSetUp, locale = "en" } = input;
  const words = TRUST_PAGE_WORDS[locale];
  const reachUrls = ownAddress
    ? [ownAddress, ...input.reachUrls.filter((url) => url !== ownAddress)]
    : input.reachUrls;
  const httpsUrl = ownAddress
    ? ownAddress + input.httpsUrl.slice(new URL(input.httpsUrl).origin.length)
    : input.httpsUrl;
  const lead = ownAddress
    ? `<p>${words.spareLead(`<a href="${escapeHtml(httpsUrl)}">${escapeHtml(ownAddress)}</a>`)}</p>\n`
    : "";
  const urlItems = reachUrls
    .map((u) => `<li><a href="${escapeHtml(u)}">${escapeHtml(u)}</a></li>`)
    .join("");

  const otherLocale = locale === "es" ? "en" : "es";
  const warning =
    notSetUp && !ownAddress
      ? `<p class="warning-words">${escapeHtml(NOT_SET_UP_WORDS[locale])}</p><p class="warning-words" lang="${otherLocale}">${escapeHtml(NOT_SET_UP_WORDS[otherLocale])}</p>\n`
      : "";
  const steps = caAvailable
    ? `${warning}${stepsOrTouchSteps(device, caDownloadPath, locale)}`
    : `<section><h2>1. ${words.get}</h2><p>${words.unavailable}</p></section>`;

  return `<!doctype html>
<html lang="${locale}"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${words.title}</title>
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
<h1>${words.heading}</h1>
${lead}<p>${words.intro(Boolean(ownAddress))}</p>
${steps}
<section class="go"><h2>${caAvailable ? "4" : "2"}. ${words.open}</h2>
<p>${words.openHelp}</p>
<p class="continue"><a class="button" href="${escapeHtml(httpsUrl)}">${CONNECTION_TEXT[locale].continue}</a></p>
<ul>${urlItems}</ul></section>
${qrSvg ? `<section class="qr"><h2>${words.qr}</h2><figure>${qrSvg}</figure></section>` : ""}
<p class="note"><a href="/legal/declaration" lang="es">${escapeHtml(DECLARATION_LINK_WORDS.title)}</a></p>
</main></body></html>\n`;
}
