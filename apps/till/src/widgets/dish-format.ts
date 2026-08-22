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

/**
 * A locale-keyed description with a first-available fallback: the requested `locale`'s text (default
 * the current operator locale), else ANY description the map carries (a name in the wrong language
 * beats a blank), else the caller's `fallback` (a product id for a catalogue name, "" for a queue
 * line). The explicit-locale path is load-bearing — the legal receipt passes the invoice locale so a
 * product prints in the invoice's language regardless of the operator's UI language.
 */
export function descriptionFor(
  descriptions: Record<string, string>,
  fallback: string,
  locale: string = currentLocale(),
): string {
  return descriptions[locale] ?? Object.values(descriptions)[0] ?? fallback;
}
