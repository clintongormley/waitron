# Retire Price overrides from the menu editor

[Menu editor redesign, delivery 2(e)](../specs/2026-11-24-menu-editor-redesign-design.md#delivery)

Managers open Structure to set prices and resolve clashes, then save arrangement and prices together. The three tabs are Structure, Home page and Preview, and they fit on a 390 px phone. The owner reviewed the design picture by picture and said “otherwise all good”, as recorded in the spec and in the watcher's Lane D note at 12:29 on 26 November.

## 1. Open clashes in Structure

- In `apps/dashboard/src/screens/menus-screen.ts` remove the Prices tab, table, draft and standalone price subscription. Route clash links from the list, status line and `widgets/menu-preview.ts` to `/menus/menu/<id>/view/structure/filter/clashes`. Use the existing address parser and fallback to Structure, retaining the clash filter for a saved old clash address. Ordinary links retain normal click, new-tab and Back behaviour.
- Pass the address's clash selection to `widgets/menu-structure-table.ts`. Once the table is ready, use `wt-data-table.chooseFilter("price", ["clashes"])` with the existing Structure filter. Apply on navigation, so a live read or re-render leaves the manager's subsequent filter choices alone. A clash link on the open Structure tab sets the filter without discarding the draft. Keep the shared tabs and other navigation as they are.
- Start red in `screens/menus-screen.test.ts` and `widgets/menu-preview-top.test.ts`. Check the three tabs, list and heading destinations, a direct or new-tab address, and that a clash and its tree ancestors show while a non-clashing dish is filtered out. Keep live-read and unsaved-navigation assertions that still apply in the Structure suites. Remove `widgets/menu-prices-table.ts`, its two suites, the retired Prices leave suite and unused wording in `i18n/strings*.ts`. Keep wording shared with Structure and Preview.

## 2. Remove the requests the old price editor replaced

- In `api/menu-api.ts`, `api/live-queries.ts` and `apps/server/src/menu-details-routes.ts`, remove the standalone `GET /menus/:id/prices` and keep its read dependencies on the coordinated `getMenuRead` prices part. In `menu-item-prices-routes.ts` remove the individual variant price PATCH and the old variant collection GET and PUT, which have no product caller. Keep the item PATCH used by `widgets/set-menu-dishes.ts` and leave section and Home page requests to their own work. Keep menu pricing rules and the combined read and Save.
- In `apps/server/src/menu-api.test.ts` first assert 404 for the four retired requests with the manager signed in. Move live pricing assertions and fixture setup that still matter to the coordinated read, Structure Save or existing domain helpers. Keep the real set-menu surcharge assertion. Update any affected client and route inventories and run their guards along with the changed dashboard, route and guide files.

Update the English and Spanish Products guides, `docs/developers/design-system.md` and `docs/backlog/menu.md`. Before landing, send the watcher the 1440 and 390 px pictures in both themes and languages, showing unsaved and unpublished changes, Select mode and a menu without photos. Expect about +100/−1,450 production lines and +160/−5,200 test lines, chiefly the retired table and its cases.
