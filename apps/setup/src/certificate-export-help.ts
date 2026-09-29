import { html, nothing } from "lit";
import type { StringKey } from "./i18n/strings.js";
import { t } from "./i18n/t.js";

const GUIDES = [
  {
    id: "windows",
    title: "cert_help.windows.title",
    href: "https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1501-como-puedo-exportar-un-certificado-digital-con-google-chrome-en-windows-",
    steps: ["cert_help.windows.step1", "cert_help.windows.step2", "cert_help.windows.step3"],
  },
  {
    id: "mac",
    title: "cert_help.mac.title",
    href: "https://www.sede.fnmt.gob.es/eu/preguntas-frecuentes/android-mac/-/asset_publisher/1RphW9IeUoAH/content/1379-como-puedo-exportar-mi-certificado-desde-el-llavero-de-mac-",
    steps: ["cert_help.mac.step1", "cert_help.mac.step2", "cert_help.mac.step3"],
  },
  {
    id: "firefox",
    title: "cert_help.firefox.title",
    href: "https://www.sede.fnmt.gob.es/en/preguntas-frecuentes/exp-imp-y-elim-de-certificados/-/asset_publisher/EwGOMAWPq4DV/content/1399-como-puedo-exportar-mi-certificado-con-mozilla-firefox-",
    steps: ["cert_help.firefox.step1", "cert_help.firefox.step2", "cert_help.firefox.step3"],
  },
] as const satisfies ReadonlyArray<{
  id: string;
  title: StringKey;
  href: string;
  steps: readonly StringKey[];
}>;

function guideBody(guide: (typeof GUIDES)[number]) {
  return html`<ol>
      ${guide.steps.map((step) => html`<li>${t(step)}</li>`)}
    </ol>
    <a href=${guide.href} target="_blank" rel="noopener noreferrer"
      >${t("cert_help.fnmt_link")}</a
    >`;
}

function closedGuide(guide: (typeof GUIDES)[number]) {
  return html`<details>
    <summary>${t(guide.title)}</summary>
    ${guideBody(guide)}
  </details>`;
}

/**
 * The guide for the computer guessed from the user-agent is shown above the list, not opened inside
 * it, so the first guide a reader meets is their own computer's.
 */
export function certificateExportHelp(userAgent: string) {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(userAgent);
  const platform = mobile
    ? undefined
    : /Firefox\//.test(userAgent)
      ? "firefox"
      : /Windows/.test(userAgent)
        ? "windows"
        : /Macintosh/.test(userAgent)
          ? "mac"
          : undefined;
  const chosen = GUIDES.find((guide) => guide.id === platform);
  return html`<section data-test="certificate-export-help" aria-label=${t("cert_help.aria_label")}>
    <h2>${t("cert_help.heading")}</h2>
    <p>${t("cert_help.intro")}${chosen ? nothing : ` ${t("cert_help.choose")}`}</p>
    ${chosen === undefined ? html`<p>${t("cert_help.transfer")}</p>` : nothing}
    ${
      chosen
        ? html`<div data-test="export-guide">
              <h3>${t(chosen.title)}</h3>
              ${guideBody(chosen)}
            </div>
            <details data-test="other-guides">
              <summary>${t("cert_help.other_guides")}</summary>
              <p>${t("cert_help.transfer")}</p>
              ${GUIDES.filter((guide) => guide !== chosen).map(closedGuide)}
            </details>`
        : GUIDES.map(closedGuide)
    }
  </section>`;
}
