import { resolveContentText } from "@waitron/shared";

/** Snapshot current menu text under the receipt's exact language keys. Missing translations
 * use the configured content default; missing content yields an empty string without blocking a sale. */
export function toInvoiceLineDescriptions(
  menu: Record<string, string>,
  invoiceLocales: string[],
  defaultLanguage: string,
): Record<string, string> {
  return Object.fromEntries(
    invoiceLocales.map((tag) => [tag, resolveContentText(menu, tag, defaultLanguage)]),
  );
}
