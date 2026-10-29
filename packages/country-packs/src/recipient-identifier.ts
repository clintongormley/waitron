import type { RecipientIdentifierType } from "@waitron/country";
import {
  COUNTRY_PACKS,
  FALLBACK_RECEIPT_LOCALE,
  RECIPIENT_IDENTIFIER_LABELS,
  receiptLabelsFor,
} from "./registry.js";

export function recipientIdentifierLabel(
  type: RecipientIdentifierType | undefined,
  locale: string,
): string {
  if (type === undefined || type === "tax-number") return receiptLabelsFor(locale).nif;
  const receiptLocale = COUNTRY_PACKS.some((pack) => pack.receiptLabels?.[locale] !== undefined)
    ? locale
    : FALLBACK_RECEIPT_LOCALE;
  const language = new Intl.Locale(receiptLocale)
    .language as keyof typeof RECIPIENT_IDENTIFIER_LABELS;
  return RECIPIENT_IDENTIFIER_LABELS[language][type];
}
