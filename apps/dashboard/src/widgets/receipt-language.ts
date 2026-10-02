import { html, nothing, type TemplateResult } from "lit";
import { contentLanguageCode, languageDisplayName, type ContentLanguages } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";

function languageCode(tag: string): string | null {
  try {
    return contentLanguageCode(tag);
  } catch {
    return null;
  }
}

export function receiptLanguageName(tag: string, standalone = true): string {
  return languageDisplayName(tag, currentLocale(), standalone);
}

/** Customer text missing in the receipt's language prints in the default content language. */
export function receiptLanguageWarning(
  receiptLanguage: string,
  content: ContentLanguages,
): TemplateResult | typeof nothing {
  const code = languageCode(receiptLanguage);
  if (code === null || content.languages.includes(code)) return nothing;
  const text = t("receipt_language.warning")
    .replace("{receipt}", receiptLanguageName(receiptLanguage, false))
    .replace("{default}", receiptLanguageName(content.defaultLanguage, false));
  return html`<p class="warning" role="note" data-test="receipt-language-warning">${text}</p>`;
}
