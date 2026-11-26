import type { Database } from "@waitron/db";
import type { TranslationContext } from "@waitron/menu";
import { type ContentLanguageRules, FALLBACK_LOCALE } from "@waitron/shared";
import type { TradingContext } from "./trading-context.js";

/** Menu and content-language routes. One taxpayer per database, so nothing filters by one. */
export interface MenuApiDeps {
  managementOrigin?: string;
  /** The content languages the venue must keep; none when absent. */
  contentLanguageRules?: ContentLanguageRules;
  db: Database;
  venueLocale?: string;
  /** Required by the routes that correct a live menu's allergens, which print kitchen slips. */
  venueCfg?: TradingContext;
}

export function translationContextFor(
  deps: Pick<MenuApiDeps, "venueLocale" | "contentLanguageRules">,
): TranslationContext {
  return {
    fallbackLanguage: deps.venueLocale ?? FALLBACK_LOCALE,
    required: deps.contentLanguageRules?.required ?? [],
  };
}
