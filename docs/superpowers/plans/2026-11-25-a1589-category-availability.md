# A1589 Products category availability

The watcher recorded the owner’s 25 November 20:18 choice, “Act on everything in it
(Recommended),” under A1589 in `~/waitron-campaign-h/queue.md`.
This updates the Products redesign’s [Select mode](../specs/2026-11-24-products-list-redesign-design.md#5-select-mode).

**What staff can do.** In Products Tree, tick Oysters and choose **Mark unavailable** or
**Mark available**. The action includes products in its subcategories and any individually ticked
products, including those hidden by search or filters. Each product counts once. The result
says how many products the box applied the choice to.

- [ ] **Test first.** In `apps/dashboard/src/widgets/product-browser.test.ts`, keep the Spanish
  phone case’s fit and empty assertions and enable both actions for mixed ticks. Use Beer with
  only inactive Lager for the empty-category case. Add an active child product for a Tree case
  with a parent, its subcategory, an explicit tick inside it and one outside. Hide the category,
  then assert one request with unique IDs and the result count. Extend the existing deferred
  write and deleted-product cases to check a pending child, a new child tick during a batch,
  and a refusal that names a child with no tick of its own. Check that an unrelated switch's
  refusal survives the batch result and Done. Check that a late reply after Done and a
  product-only success open no notice. Run these cases and see the expected failures first.
- [ ] **Expand the ticks.** Put `activeProductIdsInCategories(categoryIds, products, categories)`
  beside `categoryWithDescendants` in `widgets/category-form.ts`. Reuse it in
  `widgets/product-browser.ts` for availability and Delete’s existing contents count. Delete
  still counts active products only. Availability combines the helper’s active top-level
  product IDs with explicit product ticks from the full snapshot. Use these IDs in readiness,
  pending and focus checks and in one all-or-none request. On success, clear the tick keys
  captured at press time in the same selection session.
- [ ] **Show the result.** In `widgets/product-availability-actions.ts`, give `changeSelected`
  a flag from the captured category ticks and put the count in `batchNotice` only on their success.
  Keep row refusals independent. Clear the batch notice on Close, a selection reset or a new
  write. Reuse the bottom `wt-toast` in `widgets/product-list-action-feedback.ts`. Rename its
  hook to `batch-availability-notice` and apply the same visibility check to both outcomes.
  Use the toast's eight-second timeout for success and keep refusals until dismissed. Hold the
  success toast while the popover opens, then release it two frames later so the empty
  `role="status"` is visible first. The watcher cleared the bottom notice and eight-second
  timeout at 22:01. Keep the existing focus return.
  Use the existing count helper in `widgets/count-text.ts` and strings in `i18n/strings.ts`.
  Use “Marked 1 product available.” / “Marked {count} products available.” and
  “1 producto marcado como disponible.” / “{count} productos marcados como disponibles.”
  Use “unavailable” and “no disponible(s)” for the other action. Count the IDs in the successful
  request, including products already in the requested state. A refusal keeps the ticks.

**Delivery.** Update the actions paragraph in the redesign’s §5, Selection mode in
`docs/developers/design-system.md` and Moving and deleting in `docs/developers/product-categories.md`.
Update both guides to say that search and filters can hide products included by a category tick.
Run the browser and accessibility suites, the existing Delete coverage in the same browser
file, the server availability and guide checks, and the queue’s unedited fiscal and menu-refresh
gates. Inspect the result at phone and desktop widths in English and Spanish, light and dark.
Expect 75–105 production and 85–125 test lines. Tell the watcher before passing 130 production
or 160 test lines. Use the existing endpoint and its explicit-ID request. Category membership
comes from the browser’s snapshot when staff press the button. Send the watcher one picture each
at 390 and 1180 px.

**Watcher clearance, 22:30.** Select all in Products Tree ticks only rendered matches. Categories
shown for a matching product keep their individual boxes. A category matching by name is included
when search is the only narrowing. A product column filter still requires matches in those products.
Opt in through `wt-data-table` so availability, Move and Delete share the same ticks. Test a
column filter, a deliberate category tick under that filter and a category-name search.
