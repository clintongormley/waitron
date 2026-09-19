import type { ExtraListItem } from "./extra-contract.js";

/**
 * What one of this extra costs on a line: the menu offer's price if that offer set one, else the
 * list item's own, else the product's `unitPrice` (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.3).
 *
 * Only null and undefined fall through — `"0.00"` is a price a venue chose and is kept, which is
 * what makes a free bread expressible. VAT does not resolve this way at all: an extra always carries
 * its product's own rate.
 */
export function resolveExtraPrice(
  item: ExtraListItem,
  product: { unitPrice: string },
  menuPrice?: string | null,
): string {
  return menuPrice ?? item.price ?? product.unitPrice;
}
