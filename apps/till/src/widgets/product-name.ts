import { currentLocale } from "../i18n/t.js";
import { descriptionFor } from "./dish-format.js";
import type { TillProduct } from "../api/client.js";

/**
 * A product's display name in `locale` (default: the current operator locale).
 *
 * Names are DATA, not UI chrome (spec §9): each product carries a `descriptions` map keyed by
 * locale, so this reads `descriptions[locale]` rather than a translation key. The default is the
 * current operator locale, so tiles follow the operator's UI; the LEGAL RECEIPT
 * (`till-ticket-view`) passes the INVOICE locale explicitly, so a product prints in the invoice's
 * language regardless of the operator's UI language (findings §14). When the requested locale is
 * absent it degrades to any description the product does carry (a name in the wrong language beats a
 * blank tile), and to the product id only if it carries none at all — that last case is a catalogue
 * defect, but something tappable/printable must still render.
 */
export function productName(product: TillProduct, locale: string = currentLocale()): string {
  return descriptionFor(product.descriptions, product.id, locale);
}
