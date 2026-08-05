import { currentLocale } from "../i18n/t.js";
import type { TillProduct } from "../api/client.js";

/**
 * A product's display name in the current locale.
 *
 * Names are DATA, not UI chrome (spec §9): each product carries a `descriptions` map keyed by
 * locale, so this reads `descriptions[currentLocale()]` rather than a translation key. When the
 * current locale is absent it degrades to any description the product does carry (a name in the
 * wrong language beats a blank tile), and to the product id only if it carries none at all — that
 * last case is a catalogue defect, but a tile must still render something tappable.
 */
export function productName(product: TillProduct): string {
  return (
    product.descriptions[currentLocale()] ?? Object.values(product.descriptions)[0] ?? product.id
  );
}
