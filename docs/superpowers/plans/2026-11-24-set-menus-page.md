# Set menus page implementation plan

You can open, add, copy and delete set menus from their own dashboard page and see which menus offer
them. The [owner’s design](../specs/2026-11-24-menus-list-tabs-design.md) sets the layout and wording.
Menu Delete landed in #4255. Build after watcher clearance and deliver one PR before the dashboard
client split. The scope is dashboard navigation, lists and their read data, plus the demo and guide.
The watcher cleared this plan on 24 November at 20:14. The set menu editor's own page, set-menu
rework piece 5, products Delete and image-library changes are outside this build.

## 1. Return the menus that offer each set menu

In `packages/menu/src/set-menus.ts`, share the existing `heldBy` calculation with
`listDashboardMenus(tx)`. Reuse `listMenus` and one `SectionGraph` for the whole list. Add
`heldBy: { id: string; name: string }[]` to set-menu rows using graph roots and `menusContaining`.
Export through `packages/menu/src/index.ts` and call it from `GET /management-api/menus` in
`apps/server/src/menu-api.ts`. In `apps/dashboard/src/api/{client,live-queries}.ts`, extend the list
response type and watch `sections` and `section_members` alongside `menus`. Create, copy and
structure keep their existing response types.

Start with direct, nested and repeated placements, a deleted holder and an unused set menu in
`packages/menu/src/set-menus.dishes.test.ts`. Keep the detail check. In
`menu-api.set-menus.test.ts`, check that GET returns the holder field. Pin the list dependencies
in `live-queries.test.ts`.

## 2. Open and use the two pages

In `apps/dashboard/src/{dashboard-app,navigation}.ts`, add the `menu.manage` sidebar entry and
`/set-menus/menu/<id>` with route key `setMenu` and segment `menu`. The distinct key lets a sidebar
click drop the open ID. Unknown or wrong-kind IDs show their own page’s list. Add
`screens/set-menus-screen.ts` with the editor wrapper, list actions and Add form lifted from
`screens/menus-screen.ts`. Reuse the terms form, editor, copy and Delete dialogs and draft guards.
Make each Add open its own form and keep it in the table when the list is empty. Open a created set
menu immediately with `heldBy: []` until the list catches up. The breadcrumb opens its own list.

Filter the Menus rows and selected editor to active full menus. Keep the whole read for name checks,
copy and the set-menu picker. Move the Menus list's width measuring and CSS into
`screens/menu-list-layout.ts` for both tables. Keep the `part` styles.
Menus keeps its table key, Name, Status, Main menu, Staff menus, pinned actions, and All / Published /
Requiring attention. Set menus has its own key, search and no filter, with Name, numeric Price,
Offered on and pinned actions. On phones, stack price and labelled holder links under the name.
Show muted **Not on any menu** when empty. A holder link opens only the full menu.

Retarget set-menu links in `widgets/{menu-preview,menu-structure-table}.ts`. Write the new destination
from `wt-set-menu-open` in `menus-screen.ts` through the navigation guard before clearing any draft.
Carry the owning menu kind on translation page rows through `packages/menu/src/content-translation-{candidates,pages,types}.ts`
and branch the menu link in `widgets/content-translations-window.ts`. Keep the translation save
baseline as it is. The dashboard has no set-menu photo field, and existing image-library folder and
published-version uses open full menus.
Translate labels in `apps/dashboard/src/i18n/strings.ts`.

Start with failing browser checks in `navigation.test.ts`, `dashboard-app{,.search-destinations}.test.ts`
and `screens/set-menus-screen.test.ts` for direct and wrong-kind addresses, sidebar clicks from both
editors, search, both Add flows, price order, holder clicks and a placement refresh. Change the mount
and route of existing set editor and row-action cases in `screens/menus-screen.set-menu.test.ts` as
needed. Preserve ordinary-menu and draft checks. Test the translation row and link in
`content-translation-pages.test.ts` and `content-translations-dialog.fixes.test.ts`, and update affected
preview and structure link checks. Cover the new list in `set-menus-screen.a11y.test.ts` and adjust
the set-menu and Status cases in `menus-screen.a11y.test.ts`.

## 3. Verify and deliver

Rename the demo’s holding menu in `packages/country-es/src/demo/casa-delgado-es.ts`. Use **Lunch menus**
(en), **Menús de mediodía** (es), **Menús de migdia** (ca and ca-ES-valencia) and **Menús do xantar**
(gl). Update the corresponding expectations in `apps/server/scripts/demo-seed/seed{,.integration,.madrid-baseline}.test.ts`
and `packages/country-es/test-fixtures/demo/plain-name-changes.en.json`. Update
`apps/server/src/guide/{en,es}/products.md`, `docs/developers/design-system.md` and the page note in A1515
in `docs/backlog/menu.md`, including the outdated order of products Delete. Lower the Menus screen cap in `scripts/product-file-size-limits.json` if the
size guard calls for it.

Watch the changed checks fail before implementation, then pass in their owning packages.
Run the guide links and content checks. Give the watcher screenshots of both pages and the sidebar at
desktop and phone widths in both themes and languages before landing. Finish the branch with its
normal reviews and CI, then tell Lane D when it lands.

Estimate 480 production lines added and 245 removed, and 365 test lines added and 80 removed.
The watcher cleared the expected scope up to about 1,250 changed lines.
