# Browser Back on Products

From Products, Back closes an edit or Add product and leaves the list in view. Opening a variant
from its product makes the product the previous stop. Back with unsaved edits uses the existing
Keep editing or Discard prompt. Save and Cancel retrace the step the editor opened. A linked editor
closes to Products, and after reload one extra Back is allowed. Category changes replace the
current address as before. The scope is Products navigation, under decision 7.3 of the
[approved Products design](../specs/2026-11-24-products-list-redesign-design.md#7-faults-fixed-with-it).
Menu Structure keeps its own editor entry and close behavior.

## Build

- In `apps/dashboard/src/navigation.ts`, give Add product its own address, `/products/editor/new`.
  Preserve the category in view and the category chosen by the Add action separately, so the
  heading still opens an unseeded form and a category action can seed it again on Forward. Keep
  existing `/products/product/<id>` and photo links.
- In `apps/dashboard/src/screens/products-screen.ts`, push through `UrlStateController` for a
  successful list or nested variant opening and for Add product. Use the controller's accepted
  address to restore the editor on Back or Forward, including a return to the parent product.
  An address-driven open must issue no push. Stop a pending editor read on an accepted address
  change so a late reply cannot reopen it. Keep the existing editor read errors and focus return.
- Track the Products editor entry in the screen using the navigation guard's position, as
  `closePainter` in `packages/venue-service/src/dashboard/opening-hours-screen.ts` does. Use Back
  when Save or Cancel closes a step this screen pushed. For direct links or after reload, replace
  the address with the list and clear the photo field. Keep the existing draft handling and commit
  the saved draft before Back. For a variant opened inside its product, its return stop is the
  product. A small `products-editor-history.ts` can hold the address and entry handling if needed.
- In `apps/dashboard/src/widgets/product-editor-dialog.ts`, distinguish an open requested inside
  the editor from an address-driven open if the existing hooks need it. Keep the shared editor's
  default for Menu Structure. Preserve the Add to menus step and row reveal after a successful
  product save. Update the English and Spanish Products guides and remove the completed backlog
  entry.

## Test first

- In `apps/dashboard/src/screens/products-screen.test.ts`, make the current simulated Back case fail
  against actual `history.back()`. Prove a row opens one step, Back closes it, Forward restores it,
  Save or Cancel uses the entry, and the following Back from the list reaches the previous page.
  Cover Add from the heading and from a category, a variant opened inside its product, direct links
  including photo focus, and a category change that adds no step. Check writes by spying on
  `pushState` and `replaceState`. Wait for the accepted address and dialog close before asserting
  subsequent steps. Keep the existing late-read, late-refusal and Add to menus assertions.
- In `apps/dashboard/src/dashboard-app.unsaved-changes.test.ts`, use the real shell and a browser
  Back to prove that Keep editing retains a dirty editor and its address, and Discard closes it
  on Products. Exercise guarded Save and Cancel through the same history flow where needed. Run
  the Products and shell suites, the Menu Structure editor suites and the dashboard typecheck.

Expect 70–140 added product lines and 110–200 added test lines, plus the guides and backlog edit.
