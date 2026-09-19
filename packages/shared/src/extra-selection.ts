/**
 * One diner answer on the wire: which extras list was asked, and which of its products were picked,
 * each with how many of that product this dish takes.
 *
 * A pick names the PRODUCT, never the `extra_list_items` row: an extra becomes a child sale line of
 * the dish carrying the product's own price, VAT and names (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.4), so the list row is only the
 * offer that made the pick available. There is no snapshot type beside this one, unlike
 * `OptionSelection` — an extra's frozen facts live on its child line rather than in a JSON column on
 * the parent.
 *
 * Nothing on the order path builds this yet: Task 7 of
 * `docs/superpowers/plans/2026-09-18-modifiers-extras-options.md` is where the till's body reaches
 * `validateExtraSelections`.
 */
export type ExtraSelection = {
  listId: string;
  picks: { productId: string; quantity: number }[];
};
