# A1570 PR 2 · Inherited values in dashboard Products

A manager can see what a blank product setting uses, or deliberately set the same value so it
stays fixed. The list and folded details keep the facts staff need. Reuse the shared fields from
#4281 and the Dashboard's `inherit.value` and `inherit.suffix` strings. Keep the current fallback
rules and submitted values. Menu screens and the wording guard are later work. The product editor
shared with Menu Structure gets the same product fields wherever it opens.
[Owner's design](../specs/2026-11-24-inherited-values-design.md).

1. In `apps/dashboard/src/widgets/`, give the existing product and modifier name fallbacks to
   `.inherited` in `form-fields.ts`, `product-editor.ts`, `variant-form.ts`, `option-list-form.ts`,
   `option-label-form.ts`, `extra-list-form.ts` and `unit-form.ts`. Opt in at the Products callers
   of helpers also used by menu screens. Preserve region → base language → existing default and
   each name's current source. A variant description follows the parent's map only while the
   variant has no description in any language. Use `inTable: true` for the extra price column.
   Keep the extras name summary to entered names with `namesLine`. In the existing `product-editor`,
   `variant-form`, `option-list-form`, `option-label-form`, `extra-list-form` and `unit-form` tests,
   check the inherited field value and its source. Keep the submitted payload checks, including an
   empty price, an explicitly equal price and avoiding stored copies of fallback text.
2. In `product-editor.ts`, use a first empty `wt-combobox` option with `inherited: true`, localized
   `label`, effective `valueLabel` and the localized suffix for variant course and takeaway VAT.
   Keep the same choice with its own ID or rate in the ordinary list and keep the parent product's
   existing picker. Fold only entered course and description, plus effective allergens, diet and
   VAT. Keep the warning for unreviewed allergens. In `product-nutrition-picker.ts`, label the
   inherit chip “Inherit” in `apps/dashboard/src/i18n/strings.ts` and keep the explicit None action.
   In `product-editor.test.ts`, `.nutrition.test.ts` and `product-nutrition-picker.test.ts`, check
   the two rows and saved values, the omitted summary fields and the retained facts and warning.
3. Use solid, full paint for inherited colours and photos in `swatch-styles.ts`, `product-media.ts`,
   `product-appearance.ts` and `image-upload.ts`. Preserve source names for screen readers and the
   disabled Remove action. In `color-field.ts`, use a localized Inherit choice for the product and
   category callers, with the already resolved colour when present. In `product-browser.ts`,
   `category-color-form.ts`, `category-create-form.ts` and `product-editor-dialog.ts`, pass the
   existing parent/venue lookup, including a changed parent in the create form. Keep No colour for
   the venue default editor. Reuse the existing muted inherited price and allergen styles in the
   product list and variant table. In `product-list`, `product-appearance`, `variant-form`,
   `product-browser` and `category-color-form`/`category-create-form` tests, check the computed solid
   paint, accessible source and choice that saves `null`. Keep the media and row-action assertions.
4. Update `apps/server/src/guide/{en,es}/{products,modifiers}.md`, preserving heading IDs, and
   `docs/developers/design-system.md` where it describes the dashed product swatches. Leave the
   menu slice and wording guard in the A1570 backlog entry. Use the existing Dashboard browser
   tests ahead of each change. Observe the new checks fail on the old display, then run all changed
   suites green before the Dashboard typecheck. Run the guide guards and Lane H’s fiscal and till
   gates. Open Products at phone and desktop widths in English and Spanish and both themes. Look
   at an empty field, its filled equivalent, the two picker rows, the folded details and a photo.

Estimate about 220 production lines and 310 test lines changed. Report additions and removals
separately and keep the visual receipts in Lane H's local folder.
