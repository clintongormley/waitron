import { resolveEnabledContentText, resolveSnapshotText } from "@waitron/shared";
import { currentContentLanguages } from "@waitron/ui";
import { currentLocale } from "../i18n/t.js";

/**
 * Shared display formatting for a line's dish (quantity × name), used by both the kitchen queue
 * ({@link "./station-queue.js"}) and the table order screen. Names are DATA keyed by locale (spec §9),
 * quantities are `numeric(_,3)` carried as text — neither is UI chrome, so this holds the two pure
 * string transforms both surfaces were duplicating.
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
