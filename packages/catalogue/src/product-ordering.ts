/**
 * Who may order a product on its own (`products.ordering`). `staff_only` is for guest ordering,
 * which does not exist yet, so today it behaves exactly as `public`. `not_sold_separately` refuses a
 * standalone line; being offered as an extra does not read the setting.
 *
 * A browser-safe leaf: the dashboard and the till import it.
 */
export const PRODUCT_ORDERINGS = ["public", "staff_only", "not_sold_separately"] as const;
export type ProductOrdering = (typeof PRODUCT_ORDERINGS)[number];

export function isProductOrdering(value: unknown): value is ProductOrdering {
  return PRODUCT_ORDERINGS.includes(value as ProductOrdering);
}
