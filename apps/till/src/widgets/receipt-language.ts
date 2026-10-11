import { languageDisplayName } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";

/** The stored language while the location still offers it. One no longer offered is filed in the
 * location's (`saleLanguageFor`, apps/server/src/venue-locale.ts), so the till shows that instead. */
export function offeredReceiptLanguage(
  stored: string | undefined,
  offered: readonly string[],
): string | undefined {
  return stored !== undefined && offered.includes(stored) ? stored : undefined;
}

/** The language a receipt prints in: the chosen or stored one, else the location's, listed first. */
export function shownReceiptLanguage(
  chosen: string | undefined,
  offered: readonly string[],
): string {
  return offeredReceiptLanguage(chosen, offered) ?? offered[0] ?? "";
}

/** "Receipt: Catalan", in the screen's language. */
export function receiptLanguageLabel(language: string): string {
  const name = languageDisplayName(language, currentLocale());
  return t("receipt_language.button").replace("{language}", () => name);
}
