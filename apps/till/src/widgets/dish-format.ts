import { resolveEnabledContentText, resolveSnapshotText } from "@waitron/shared";
import { currentContentLanguages } from "@waitron/ui";
import { currentLocale } from "../i18n/t.js";

/**
 * Shared display formatting for a till line: the pure string transforms several surfaces were
 * duplicating. Text is DATA keyed by locale (spec §9) and a quantity is `numeric(_,3)` carried as
 * text, so neither is UI chrome.
 *
 * A line's DISH NAME is not one of them: the kitchen queue and the expo screen render the
 * server-resolved `item.name` as sent, and the table order screen reads the line's frozen `name`,
 * importing only {@link trimQuantity} from here. What the locale-map resolvers serve is unit
 * labels, an extras child line's name, and the live catalogue text the basket, the modifier picker
 * and `product-name.ts` show. A dish's frozen OPTIONS answers do not come through here: their three
 * wordings are built by `packages/catalogue/src/option-snapshot-labels.ts`, reached from
 * `widgets/option-snapshot.ts`.
 */

/**
 * Trim a `numeric(_,3)` quantity's trailing zeros for display ("2.000" → "2", "0.320" → "0.32") —
 * unit-agnostic: the regex only touches zeros AFTER a decimal point, so a bare integer is untouched.
 */
export function trimQuantity(quantity: string): string {
  return quantity.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Resolve live catalogue text against enabled languages and the configured content default. */
export function descriptionFor(
  descriptions: Record<string, string>,
  fallback: string,
  locale: string = currentLocale(),
): string {
  return resolveEnabledContentText(descriptions, locale, currentContentLanguages()) || fallback;
}

/** Stored order names keep their receipt-language text when content settings change. */
export function snapshotDescriptionFor(
  descriptions: Record<string, string>,
  fallback: string,
  locale: string = currentLocale(),
): string {
  return (
    resolveSnapshotText(descriptions, locale, currentContentLanguages().defaultLanguage) || fallback
  );
}
