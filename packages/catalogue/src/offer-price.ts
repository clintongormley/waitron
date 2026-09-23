import { centsToDecimal, type Decimal } from "@waitron/shared";

/** A stored price column read at the row, where null is a blank price rather than zero. */
export const priceOrNull = (cents: number | null): Decimal | null =>
  cents === null ? null : centsToDecimal(cents);

/**
 * The price a menu charges for a variant (spec §15.3): the most specific price that is set wins —
 * the variant's price on this menu, the variant's own price, the parent's price on this menu, the
 * parent's own price. Zero is a price, not a blank.
 *
 * `variantPrice` is the variant's RAW `products.unit_price`. The effective value
 * (`effectiveProductColumns.unitPrice`) is already `coalesce(variant, parent)` and never blank, so
 * passing it would skip the parent's menu price and charge the parent's catalogue price.
 *
 * An offer with no variant chosen walks the same chain with both variant steps blank: its menu
 * price (`menu_items.gross_price`, blank meaning "the product's own"), else the product's own.
 * `parentPrice` is never blank, because `products_top_level_owns_ck` makes a top-level product own
 * its price.
 */
export function resolveOfferPrice(prices: {
  variantMenuPrice: Decimal | null;
  variantPrice: Decimal | null;
  parentMenuPrice: Decimal | null;
  parentPrice: Decimal;
}): Decimal {
  return (
    prices.variantMenuPrice ?? prices.variantPrice ?? prices.parentMenuPrice ?? prices.parentPrice
  );
}
