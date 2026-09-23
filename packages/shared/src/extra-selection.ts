/**
 * One diner answer on the wire: which extras list was asked, and which of its products were picked,
 * each with how many of that product this dish takes.
 *
 * A pick names the PRODUCT, never the `extra_list_items` row: an extra becomes a child sale line of
 * the dish carrying the product's names (always its own), its VAT (its own, or its parent's where
 * a variant leaves it blank, never the dish's) and the price the offer resolved (spec
 * `docs/superpowers/specs/2026-09-18-one-product-model-design.md` §3.4), so the list row is only the
 * offer that made the pick available. There is no snapshot type beside this one, unlike
 * `OptionSelection` — an extra's frozen facts live on its child line rather than in a JSON column on
 * the parent.
 *
 * `quantity` is required, not defaulted: `validateExtraSelections`
 * (`packages/catalogue/src/extra-contract.ts`) puts every pick's count through a whole-number check
 * that refuses an absent one, so a request that leaves it out is answered `extras.invalid` naming
 * `quantity`.
 */
export type ExtraSelection = {
  listId: string;
  picks: { productId: string; quantity: number }[];
};
