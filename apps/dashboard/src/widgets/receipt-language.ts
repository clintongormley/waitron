import { html, nothing, type TemplateResult } from "lit";
import { capitaliseFirst, contentLanguageCode, type ContentLanguages } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";

function languageCode(tag: string): string | null {
  try {
    return contentLanguageCode(tag);
  } catch {
    return null;
  }
}

/** A receipt language's name in the page's language: capitalised to stand alone, or as it reads
 * inside a sentence. A stored value that is not a language is shown as it is. */
export function receiptLanguageName(tag: string, standalone = true): string {
  const code = languageCode(tag);
  if (code === null) return tag;
  const locale = currentLocale();
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(code)!;
  return standalone ? capitaliseFirst(name, locale) : name;
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
