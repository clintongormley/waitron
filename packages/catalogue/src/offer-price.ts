import type { Decimal } from "@waitron/shared";

/**
 * The price a menu charges for a variant (spec §15.3): the most specific price that is set wins —
 * the variant's price on this menu, the variant's own price, the parent's price on this menu, the
 * parent's own price. Zero is a price, not a blank.
 *
 * `variantPrice` is the variant's RAW `products.unit_price`. The effective value
 * (`effectiveProductColumns.unitPrice`) is already `coalesce(variant, parent)` and never blank, so
 * passing it would skip the parent's menu price and charge the parent's catalogue price.
 *
 * `parentMenuPrice` cannot be blank while `menu_items.gross_price` is NOT NULL, so the fourth step,
 * `parentPrice`, is not reached yet.
 */
export function resolveOfferPrice(prices: {
  variantMenuPrice: Decimal | null;
  variantPrice: Decimal | null;
  parentMenuPrice: Decimal;
  parentPrice: Decimal;
}): Decimal {
  return prices.variantMenuPrice ?? prices.variantPrice ?? prices.parentMenuPrice;
}
