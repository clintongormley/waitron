import { html } from "lit";
import { FALLBACK_LOCALE, SUPPORTED_LOCALE_CODES } from "@waitron/shared";
import { t } from "./i18n/t.js";

export function trustInstructions(opts: { hostname?: string; languages?: readonly string[] } = {}) {
  const languages = opts.languages ?? navigator.languages;
  const locale =
    languages
      .map((language) =>
        SUPPORTED_LOCALE_CODES.find(
          (code) => code.split("-")[0] === language.split("-")[0]?.toLowerCase(),
        ),
      )
      .find((code) => code !== undefined) ?? FALLBACK_LOCALE;
  return html`
    <main
      lang=${locale}
      style="box-sizing:border-box;max-width:calc(var(--wt-space-6) * 16);margin:calc(var(--wt-space-6) * 2) auto;padding:0 var(--wt-space-5);font-family:var(--wt-font-family);font-size:var(--wt-font-size-md);color:var(--wt-color-text);background:var(--wt-color-bg);overflow-wrap:anywhere"
    >
      <h1 style="font-size:var(--wt-font-size-xl)">${t("trust.title", locale)}</h1>
      <p>${t("trust.explanation", locale)}</p>
      <p>
        <a
          style="color:var(--wt-color-primary-text)"
          href="http://${opts.hostname ?? location.hostname}/"
          >${t("trust.open_setup", locale)}</a
        >
      </p>
    </main>
  `;
}
