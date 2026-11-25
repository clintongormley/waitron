# A1589 Products category availability

The owner chose “Act on everything in it” on 25 November at 20:18, as recorded in the
[A1589 queue item](#delivery) by the watcher. This updates the Products redesign’s
[Select mode](../specs/2026-11-24-products-list-redesign-design.md#5-select-mode).

**What staff can do.** In Products Tree, tick Oysters and choose **Mark unavailable** or
**Mark available**. The action includes products in its subcategories and any individually ticked
products, even when search or filters hide them. A product covered by more than one tick counts
once. The result says how many products the box applied the choice to.

- [ ] **Test first.** In `apps/dashboard/src/widgets/product-browser.test.ts`, update the existing
  Spanish phone case so it keeps the empty and fit assertions and expects the two actions to work
  with mixed ticks. Add a Tree case with a parent, its ticked subcategory, a separately ticked
  product inside it, and one outside. Hide the category before pressing the action. Assert one
  request with unique product IDs, the acknowledged count, and that the submitted ticks clear.
  Check that an empty category alone sends nothing. Run the new cases and see the failure before
  changing product code. Reuse the suite’s deferred write and refusal cases for selection and
  focus during a save.
- [ ] **Expand the ticks.** In `widgets/product-availability-actions.ts`, add
  `selectedProductIds(selection: ProductSelection, categories: readonly CategorySummary[]): string[]`
  using the existing `categoryWithDescendants` and the browser’s full product snapshot.
  Include active top-level products in the selected subtrees and preserve explicit product IDs.
  In `widgets/product-browser.ts`, use the same expanded IDs at render and press time so the
  existing toolbar enables and waits on the right products. Capture the tick keys at press time.
  After a successful write, clear the captured ticks only in the same selection session.
- [ ] **Show the result.** Reuse the bottom `wt-toast` in `widgets/product-list-action-feedback.ts`
  to report a successful batch with category ticks. Add English and Spanish singular and plural
  strings in `i18n/strings.ts` and use `widgets/count-text.ts`. The count is the number of unique
  products acknowledged by the batch, including any already in the requested state. Keep the
  notice dismissible and clear it on Done, view switch or the next availability write. Retain
  the existing refusal copy and selection on failure, and the existing keyboard focus return.
  The existing request still sends explicit IDs to the all-or-none endpoint.

## Delivery

Update Select mode in the redesign, `docs/developers/design-system.md` and
`docs/developers/product-categories.md`. Update both `apps/server/src/guide/{en,es}/products.md`
guides. The backlog’s remaining Products work already lists the unfinished editor and Back work.
Run the changed browser and accessibility suites, the server availability and guide cases, and
the queue’s unedited fiscal and menu-refresh gates. Inspect the result on phone and desktop in
English and Spanish, light and dark. The A1589 queue entry is in Lane H’s `queue.md`. Plan for
60–85 production lines and 55–85 test lines. Scope ends at the existing Dashboard request and
bottom notice. Category membership comes from the product snapshot at the time of the press.
