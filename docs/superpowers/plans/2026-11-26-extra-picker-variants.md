# Let the extras picker list variants

In Modifiers or from the Products editor, a manager can choose Wine (Glass) as an extra, set its portion and price, and recognise it when reopening the list. The [decision](../../backlog/till.md#decisions-and-deliberate-limits) records the watcher’s instruction to show variants that can already be saved as extras.

## Prove the picker and saved row

1. In `apps/dashboard/src/widgets/extra-list-form.test.ts`, search for the staff name of an active measured variant, choose it by keyboard and save a portion. Check the variant id and portion in the submitted item and the price hint derived from its own effective price and its parent’s unit. Give the parent and variant distinct staff, customer and prep station names. Check that the variant drops out of the picker once added and retains its staff name on reopening. Extend the full options assertion to include Wine (Glass), keeping Wine disabled and Cider selectable. In the search case assert Wine is still disabled with its reason, alongside selectable Wine (Glass). Run the file before implementation and observe the missing variant.
2. In `apps/dashboard/src/screens/modifiers-screen.test.ts`, check that a saved variant appears under Items with the same paired staff name. The form is shared by both editors. Run the existing Products create-extras cases to check its other entry point.

## Use the catalogue the dashboard already reads

3. Add `apps/dashboard/src/widgets/extra-product-choices.ts`. Project the existing `Product[]` into the rows these surfaces need. Under each active parent, list its active variants in the catalogue’s order, including those temporarily unavailable. Use each variant’s id and `effective.unitPrice`, the parent’s unit, and `staffPresentationName` for the paired label. Keep the distinction between a product with active variants and one whose variants are all inactive.
4. Use the projected rows in `extra-list-form.ts` for its options and its existing id lookup. Keep the current searchable `wt-combobox`, disabled-parent hint and Save action. Use the same row names in `modifiers-screen.ts` for its Items column, search and sort. The existing management read and write cover this flow. This slice covers the dashboard and its guides. Sent-order routing is A692.
5. Update `apps/server/src/guide/{en,es}/modifiers.md` to tell managers to pick the specific variant. In `docs/developers/modifiers.md`, name the source of its label, unit and effective price. Remove the picker bullet from `docs/backlog/till.md` and its clause from `docs/backlog.md`.
6. Add one case in `packages/menu/src/extra-projection.test.ts` showing that a variant of a measured product takes its parent’s unit and uses its own price for a portion when the list price is blank. Check that the write refuses a portion finer than that parent’s unit. This pins the behaviour the dashboard depends on.
7. Run the Dashboard form, form accessibility, Modifiers and focused Products tests. Run the Menu projection file, the Server `menu-api.test.ts` case “includes an inherited variant’s extras list in its parent’s unit-change usage”, `guide-content.test.ts` and the root `scripts/guide-links.test.ts`. Inspect the open picker in English and Spanish, light and dark, at phone and desktop widths. Give the changed option assertions and their reason in the PR.

Expected size is about 45 added product lines and 105 added test lines, plus the guide and backlog edits.
