# Browser Back on Products

From Products, Back closes an edit or Add product and keeps the list in view. Back from a variant
opened inside its product returns to the product. Back with edits uses the existing Keep editing
or Discard prompt. Save and Cancel retrace the step the editor opened. A direct link closes to
Products. After reload one extra Back is allowed. Opening and closing categories adds no step.
This is decision 7.3 of the [approved design](../specs/2026-11-24-products-list-redesign-design.md#7-faults-fixed-with-it).
Menu Structure 2(c) already landed in #4357 and keeps its own editor flow.

## Build

- In `apps/dashboard/src/navigation.ts`, give Add product `/products/editor/new`. Keep existing
  product and photo links. Add from a category still picks it on the initial click. The address
  keeps the category in view. Forward or reload opens an empty form without a chosen category.
  Wait for the normal Add prerequisites on address-driven opens. Keep load retry and return to the
  list if loaded choices leave Add disabled.
- Put new history logic in `apps/dashboard/src/screens/products-editor-history.ts` and wire it in
  `products-screen.ts`. Use `UrlStateController` and its guarded address writes. Give each
  successful list or nested variant opening and each Add its own entry. Keep the requested photo
  focus in that entry alone. Restore from accepted addresses without pushing again. Reuse the
  editor's generation check when abandoning an open in progress.
- Remember both Product and variant steps by guard epoch, index and editor address, using the
  opening-hours painter’s position check. Keep earlier steps on Back and Forward. For a screen
  without a guard, use the painter's fallback history-state marker. Save and Cancel go Back over
  an owned step. Replace the address and clear the photo field when closing a link or after reload.
- In `apps/dashboard/src/widgets/product-editor-dialog.ts`, let Products distinguish a list or
  nested open from one driven by the address. Keep the saved draft committed before leaving.
  On a completed close, update the screen's address tracking before navigation. When the list
  address arrives, close only an open or loading editor, so it cannot invalidate a completed save's
  row reveal or Add to menus step. Keep the dialog's existing Cancel without a question.
- Update `apps/server/src/guide/{en,es}/products.md` for Back and the return from a nested variant.
  Remove “The Products list: dishes first, a List and a Tree” from `docs/backlog.md`.

## Test first

- `apps/dashboard/src/screens/products-screen.test.ts` replaces the simulated Back and unnamed
  Add cases with real Back and Forward. Cover the Add entrances, nested variant return followed by
  product close, a link closing to the list, photo focus and category writes that add no step.
  Spy on `pushState` and `replaceState`. Keep the late-read, late-refusal and save assertions.
- `apps/dashboard/src/dashboard-app.unsaved-changes.test.ts` uses the real shell. Back asks for
  Keep editing or Discard, dirty Cancel goes straight to the list, and the following Back leaves
  Products. Check a shell-routed link closes to the list, a saved row is revealed, and a save after
  loading the Add address opens Add to menus. Run both files, the Menu Structure editor suites,
  the guide checks and the dashboard typecheck.

Expect 100–175 added product lines and 140–225 added test lines, plus guides and backlog.
