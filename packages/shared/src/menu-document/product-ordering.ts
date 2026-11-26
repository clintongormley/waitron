/**
 * Who may order a product on its own (`products.ordering`). A dish can still be offered as an
 * extra under every setting.
 *
 * A browser-safe leaf: the dashboard and the till import it.
 */
export const PRODUCT_ORDERINGS = ["public", "staff_only", "not_sold_separately"] as const;
export type ProductOrdering = (typeof PRODUCT_ORDERINGS)[number];

export function isProductOrdering(value: unknown): value is ProductOrdering {
  return PRODUCT_ORDERINGS.includes(value as ProductOrdering);
}
