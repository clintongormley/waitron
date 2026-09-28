import { resolveEnabledContentText, resolveSnapshotText } from "@waitron/shared";
import { currentContentLanguages } from "@waitron/ui";
import { currentLocale } from "../i18n/t.js";

/**
 * Text is DATA keyed by locale and a quantity is a three-place decimal string, so neither is UI
 * chrome.
 */

/** "2.000" → "2", "0.320" → "0.32"; a bare integer is untouched. */
export function trimQuantity(quantity: string): string {
  return quantity.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** A line counted in Each shows no unit: "2× Croqueta". */
export function dishLine(
  line: {
    quantity: string;
    unitName?: Record<string, string> | null;
    soldInEach?: boolean;
  },
  name: string,
): string {
  const unit =
    line.unitName == null || line.soldInEach === true
      ? ""
      : ` ${snapshotDescriptionFor(line.unitName, "")}`;
  return `${trimQuantity(line.quantity)}${unit}× ${name}`;
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
