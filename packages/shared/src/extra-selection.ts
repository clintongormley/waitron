/**
 * One diner answer on the wire: which extras list was asked, and which of its products were picked,
 * each with how many of that product this dish takes.
 *
 * A pick names the PRODUCT, never the `extra_list_items` row, which is only the offer that made the
 * pick available (spec `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.4).
 */
export type ExtraSelection = {
  listId: string;
  picks: { productId: string; quantity: number }[];
};
