import { resolveLoginLocale } from "./login-locale.js";
import type { BoxTlsInspection } from "./box-tls-repair.js";
import { CONNECTION_TEXT, CONNECTION_DEVICE_ES } from "./connection-bootstrap-strings.js";
import { DEVICE_HELP, DEVICE_ORDER } from "./trust-page-devices.js";
import { TRUST_PAGE_LOGO_SVG } from "./trust-page-logo.js";
import type { TrustPageInput } from "./trust-page.js";

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function connectionLocale(language: string | undefined): "en" | "es" {
  return resolveLoginLocale(language, "en-GB").startsWith("es") ? "es" : "en";
}

// The public page cannot fetch app assets before certificate trust has been established.
const STYLE = `
:root {
color-scheme: light dark;
--wt-color-bg: light-dark(#f7f7f8, #101216);
--wt-color-text: light-dark(#16181d, #eceef2);
--wt-color-text-muted: light-dark(#5c626e, #a1a7b3);
--wt-color-primary: light-dark(#1f6feb, #4c8dff);
--wt-color-on-primary: light-dark(#ffffff, #06101f);
--wt-color-primary-text: light-dark(#1a5fd0, #78a9ff);
--wt-color-danger: light-dark(#b3261e, #ff7f73);
--wt-color-border: light-dark(#d6d9e0, #333945);
--wt-color-focus: light-dark(#1f6feb, #4c8dff);
--wt-space-1: 4px; --wt-space-2: 8px; --wt-space-3: 12px; --wt-space-4: 16px; --wt-space-5: 24px; --wt-space-6: 32px;
--wt-radius-md: 8px;
--wt-font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
--wt-font-size-md: 14px; --wt-font-size-lg: 18px; --wt-font-size-xl: 22px;
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
body { margin: 0; background: var(--wt-color-bg); color: var(--wt-color-text); font: var(--wt-font-size-md)/1.6 var(--wt-font-family); }
main { max-width: 680px; margin: auto; padding: var(--wt-space-5) var(--wt-space-4) var(--wt-space-6); }
h1 { font-size: var(--wt-font-size-xl); line-height: 1.3; }
h2 { font-size: var(--wt-font-size-lg); }
section { margin-block: var(--wt-space-6); }
a { color: var(--wt-color-primary-text); overflow-wrap: anywhere; }
.logo svg { width: 150px; height: auto; }
nav { display: flex; gap: var(--wt-space-4); margin-block: var(--wt-space-4); }
button, .button { display: inline-block; box-sizing: border-box; max-width: 100%; border: 0; border-radius: var(--wt-radius-md); padding: var(--wt-space-3) var(--wt-space-4); background: var(--wt-color-primary); color: var(--wt-color-on-primary); font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; }
button:disabled { cursor: wait; }
details { border: 1px solid var(--wt-color-border); border-radius: var(--wt-radius-md); padding: var(--wt-space-3) var(--wt-space-4); margin-block: var(--wt-space-3); }
summary { cursor: pointer; font-weight: 600; }
li { margin-block: var(--wt-space-2); }
.note { color: var(--wt-color-text-muted); }
#connection-error { color: var(--wt-color-danger); }
#connection-fingerprint { overflow-wrap: anywhere; font-family: var(--wt-font-family); }
:focus-visible { outline: 2px solid var(--wt-color-focus); outline-offset: var(--wt-space-1); }
[hidden] { display: none !important; }
`;

export function renderConnectionPage(
  input: TrustPageInput & {
    connection: BoxTlsInspection & { repairAllowed?: boolean; continuationRequired?: boolean };
  },
): string {
  const locale = input.locale ?? "en";
  const words = CONNECTION_TEXT[locale];
  const status = input.connection;
  const operator = status.repairAllowed === false;
  const retry = status.continuationRequired === true;
  const ready = status.state === "healthy" && !operator;
  const hidden = (visible: boolean) => (visible ? "" : " hidden");
  const help = locale === "es" ? CONNECTION_DEVICE_ES : DEVICE_HELP;
  const devices =
    input.device === "unknown"
      ? [...DEVICE_ORDER]
      : [input.device, ...DEVICE_ORDER.filter((id) => id !== input.device)];
  const details = devices
    .map((id) => {
      const entry = help[id];
      return `<details${id === input.device ? " open" : ""}><summary>${entry.summary}</summary>
    <div data-removal${hidden(status.trust === "new-required")}><p>${words.remove}</p><ul>${entry.removal.map((line) => `<li>${line}</li>`).join("")}</ul></div>
    <ol>${entry.install.map((line) => `<li>${line}</li>`).join("")}</ol>
    ${(entry.notes ?? []).map((line) => `<p class="note">${line}</p>`).join("")}</details>`;
    })
    .join("");
  const safeWords = JSON.stringify(words).replaceAll("<", "\\u003c");
  const script = `
const words = ${safeWords};
const button = document.getElementById("connection-repair");
const status = document.getElementById("connection-status");
const error = document.getElementById("connection-error");
button?.addEventListener("click", async () => {
  if (button.disabled) return;
  button.disabled = true;
  status.textContent = words.busy;
  error.textContent = "";
  try {
    const response = await fetch("/setup-api/connection/repair", { method: "POST", credentials: "omit", redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error();
    const result = await response.json();
    if (result.state !== "healthy" || !["retained", "new-required"].includes(result.trust) || result.caAvailable !== true) throw new Error();
    const newTrust = result.trust === "new-required";
    document.getElementById("trust-retained").hidden = newTrust;
    document.getElementById("trust-new").hidden = !newTrust;
    document.querySelectorAll("[data-removal]").forEach((node) => { node.hidden = !newTrust; });
    document.getElementById("connection-download").hidden = false;
    document.getElementById("connection-help").hidden = false;
    document.getElementById("connection-continue").hidden = false;
    document.getElementById("connection-fingerprint").textContent = typeof result.fingerprint === "string" ? result.fingerprint : "";
    status.textContent = words.ready;
    button.hidden = true;
    status.focus();
  } catch {
    error.textContent = words.failed;
    status.textContent = words.needed;
  } finally { button.disabled = false; }
});`;
  return `<!doctype html><html lang="${locale}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Waitron — ${words.title}</title>
<style>${STYLE}</style>
<script>try { const theme = localStorage.getItem("waitron-theme"); if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme; } catch {}</script>
</head><body data-connection-state="${status.state}"><main>
<div class="logo">${TRUST_PAGE_LOGO_SVG}</div>
<nav aria-label="${words.language}"><a href="?lang=en" lang="en"${locale === "en" ? ' aria-current="page"' : ""}>${CONNECTION_TEXT.en.languageName}</a><a href="?lang=es" lang="es"${locale === "es" ? ' aria-current="page"' : ""}>${CONNECTION_TEXT.es.languageName}</a></nav>
<h1>${words.title}</h1><p>${words.intro}</p><p class="note">${words.publicOnly}</p>
<p id="connection-status" role="status" tabindex="-1">${operator ? words.operator : ready ? words.ready : status.state === "refused" ? words.failed : words.needed}</p>
<p id="connection-error" role="alert"></p>
${(!ready || retry) && !operator ? `<button id="connection-repair" type="button">${retry && ready ? words.reconnect : words.repair}</button><noscript><p>${words.failed}</p></noscript>` : ""}
<section${hidden(!operator)}><div id="trust-retained"${hidden(status.trust === "retained")}><h2>${words.retained}</h2><p>${words.retainedHelp}</p></div>
<div id="trust-new"${hidden(status.trust === "new-required")}><h2>${words.newTrust}</h2><p>${words.newTrustHelp}</p></div>
<div id="connection-download"${hidden(status.caAvailable)}><p><a class="button" href="${escape(input.caDownloadPath)}" download="waitron-ca.crt">${words.download}</a></p><p class="note">${words.downloadHelp}</p><p class="note">${words.fingerprint}</p><p id="connection-fingerprint">${escape(status.fingerprint ?? "")}</p></div>
<div id="connection-help"${hidden(status.caAvailable)}><h2>${words.install}</h2><p class="note">${words.managed}</p>${details}</div></section>
<section><p>${words.warning}</p><a id="connection-continue" class="button" href="${escape(input.httpsUrl)}"${hidden(ready || operator)}>${words.continue}</a><ul>${input.reachUrls.map((url) => `<li><a href="${escape(url)}">${escape(url)}</a></li>`).join("")}</ul></section>
</main><script>${script}</script></body></html>`;
}
