# Open the product editor from Menu Structure

**Finish line.** In Structure, choose **Edit product** from a row or choose its photo to open the existing product editor over that menu. Save the product immediately or close the window and continue at the same row. Keep the menu address, open folders, search and selection through the visit. The photo opens the editor at its existing image control.

[Menu editor redesign](../specs/2026-11-24-menu-editor-redesign-design.md#delivery), piece 2(c) and §4.

## Reuse the existing editor

- Move the product editor's open, save and nested-form wiring from `screens/products-screen.ts` to `widgets/product-editor-dialog.ts`. Follow `ProductChildCreate`'s Lit controller pattern so the existing editor and child forms still render in the caller's tree. Expose `openExisting(productId, initialField?)`, `openNew(categoryId)`, `close()` and `render(choices)`. The caller provides its API and choices, and handles the opened id, close, save and lookup refresh. Keep the current draft, refusal and nested-form behavior in the shared code.
- Products keeps its list reads, address handling, list focus and Add to menus after creation. Structure already reads products, categories and menu settings. In `screens/menus-screen.ts`, use those and the current content languages, and fetch units, courses and modifier lists with the existing background client when the editor is requested. Use the menu's current editor request when opening after those reads. A late read from a menu already left cannot open a window.
- Add the in-place row and photo requests in `widgets/menu-structure-table.ts` with the row key and optional `image` field. Reuse `productMedia`'s callback and keep the links' Products deep links for opening in a new tab. Restore focus with the table's row focus methods after `wt-close`. In `dashboard-app.ts`, pass the existing Products access decision to Menus so the in-place opener follows the same access rule as the links.
- In the English and Spanish `apps/server/src/guide/*/products.md`, say how to edit from Structure. Update the Structure section in `docs/developers/design-system.md` and the remaining work in `docs/backlog/menu.md`. This piece leaves the Structure table redesign and whole-menu draft for 2(d), and removal of Price overrides for 2(e). The Units, Preview warnings and Price overrides entry points keep their current Products links.

## Checks and size

- First make the Structure browser case fail on today's navigation. Then use the real dialog in `menus-screen.test.ts` to exercise a row-menu save with one product update, unchanged address and expanded folder, and focus back at that row. Open from the photo and check initial focus reaches the image control. Check that a late read after leaving Structure does not open the editor and a refused save stays in the window.
- In `menus-screen.product-editor.unsaved.test.ts`, exercise Escape and Keep editing with a changed product in the shared editor, then close and check the original menu row. Run the existing Products screen, accessibility and related-form cases to cover the existing route, new-product placement, nested writes and refusals. Run the dashboard typecheck and the guide link and content checks.
- Capture before and after at 1440 and 390 px, in English and Spanish and both themes. Include the edited product, unpublished menu changes, Select and a menu with no photos. Get the owner's picture approval via the watcher before landing.
- Estimate 500–600 product lines added and 350–450 removed, mostly wiring moved out of Products. Estimate 150–210 test or support lines added and up to 30 removed. Keep new files below 1,000 lines and the existing files inside their recorded limits.
