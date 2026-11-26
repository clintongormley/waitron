# A1570 PR 2 · Inherited values in dashboard Products

A manager can see what a blank product setting uses, or set the same value so it stays fixed.
The list and folded details keep the facts staff need. Reuse the shared fields from #4281 and
Dashboard’s `inherit.value` and `inherit.suffix` strings. Keep the fallback rules and submitted
values. The product editor serves Products and Menus, and its related forms also serve Modifiers
and Units. Menu-specific fields and the wording guard are later work.
[Owner’s design](../specs/2026-11-24-inherited-values-design.md).

1. In `apps/dashboard/src/widgets/`, pass the existing product and modifier name fallbacks to
   `.inherited` in `form-fields.ts`, `product-editor.ts`, `variant-form.ts`, `option-list-form.ts`,
   `option-label-form.ts`, `extra-list-form.ts` and `unit-form.ts`. Make inheritance optional at
   the shared helpers and set it at the product callers. Preserve the region, base-language and
   existing default precedence and each name’s source. A variant description follows its parent’s
   map only while the variant has no description in any language. Use `inTable: true` for extra
   prices. Use `namesLine` for the extras name summary and remove `effectiveNamesLine` and the
   tests for its retired summary. In the sibling form tests, assert the displayed fallback and
   keep the payload checks for blank and explicit values, including an extra priced at exactly its
   inherited price. Extend `section-details-form.test.ts` to keep its menu placeholder as a prompt.
2. In `product-editor.ts`, give variant Course and Takeaway VAT a first empty combobox option with
   `inherited: true`, localized `label`, effective `valueLabel` and the localized suffix. Include
   the same course ID or tax rate in the ordinary rows. A parent with no course reads “Inherit:
   None” in the list. Keep the parent product’s existing picker and the missing-course wording.
   Fold only entered course and description, plus effective allergens, diet and VAT. Keep the
   unreviewed warning. In `product-nutrition-picker.ts`, use the localized “Inherit” chip. Remove
   the unused inherited branch of `foldedValue` and the old VAT and allergen strings from
   `apps/dashboard/src/i18n/strings.ts`. In `product-editor.test.ts`, `.nutrition.test.ts` and
   `product-nutrition-picker.test.ts`, check the retained summary facts and warning. Choose the
   course and VAT rows by value. Check `null` against an explicit `mains` or `10.00` when the
   parent has that value, and distinguish the saved choices when reopened. For allergens use a
   parent with “Contains none” and check inherited `null` against the variant’s own empty set.
3. Use solid, full paint in `swatch-styles.ts`, `product-media.ts`, `product-appearance.ts` and
   `image-upload.ts`. Preserve the accessible names and disabled Remove action. Reuse
   `color-field.ts`’s `noneChoice` for the product and categories with “Inherit” and a chip when
   there is a colour. Preserve the accessible description of the product’s colour chip. Retire
   the old `categoryColor`/`inheritedFrom` picker options and their strings. In `product-browser.ts`,
   `category-color-form.ts`, `category-create-form.ts` and `product-editor-dialog.ts`, resolve the
   colour from the category’s parent ID or venue default. The create form uses its draft parent ID.
   Keep “No colour” for the venue default editor. In `product-list.test.ts`,
   `product-appearance.test.ts`, `image-upload.test.ts` and `color-field.test.ts`, compare inherited
   and own paint and keep the accessible names and row actions. In `product-browser.test.ts`,
   `category-color-form.test.ts` and `category-create-form.unsaved.test.ts`, pin a different parent
   colour, recompute on a parent change, and distinguish null from fixing the same palette colour.
4. Update the English and Spanish `apps/server/src/guide` Products and Modifiers guides, keeping
   heading IDs, and the product examples in `docs/developers/design-system.md`. Keep the menu slice
   and wording guard in `docs/backlog.md`. Run the changed Dashboard browser tests red then green,
   the Dashboard typecheck, guide guards, and Lane H’s fiscal and till gates. Open Products in
   English and Spanish at phone and desktop widths in both themes. Inspect blank and filled fields,
   the two picker rows, folded details and a photo. Keep pictures in Lane H’s local folder.

Estimate about 220 production and 310 test lines changed. Report additions and removals separately.
