# A353 PR 3. Undo product placement changes from Preview

The 09:02 Lane D queue assignment takes up PR 3 of the [parent plan](2026-11-06-a353-preview-undo.md#pr-3--products-in-this-menus-own-lists). The owner's ask for Preview Undo is recorded in [the menu backlog](../../backlog/menu.md#a353--previews-changes-an-undo-link-that-puts-one-change-back-to-the-live-version). PR 2 landed in #4021. Claude reviewed the original slice plan. The watcher cleared the revised plan and refusal wording at 09:16 on 22 November 2026, with the changes below.

When you add, move or remove a product in a menu's own lists, use **Undo** on Preview to restore its published placement where one write can do it. Preview reads again after the write. Changes from included menus keep their existing Edit action. Section, include, order and shortcut changes belong to later PRs.

- Extend `thisMenuAction` in `packages/menu/src/menu-undo.ts`. Compare the published and working offer paths using section IDs. Resolve the affected lists through the existing Structure snapshot, stopping at included menus. Match a removal to the stored member ID. To put a product back, insert after its nearest preceding published sibling still held in that list, or first if none remains. Match a product by product ID, a section or include by section ID, and a set menu by menu ID. Count every stored member, including those absent from Preview.
- If a new product now has exactly one placement and that placement is own, remove it with `removeSectionMember`. For a move, one added path calls remove, one lost path calls add, and one lost plus one added path calls `moveSectionMembersInto` between distinct own lists, keeping the menu's offer and its prices. If both paths end in the same list, the section moved while the product stayed in it. Leave that, multiple independent moves and unresolved lists without an action. For a complete removal, require exactly one published placement in an own list that still exists, no stored placement anywhere in the menu tree including through an include, and no published own dish or variant price.
- In `apps/dashboard/src/api/client.ts`, pass optional `position` through `addSectionMember`. Send the same computed position through the existing `moveSectionMembersInto` argument when moving a product back. The route in `apps/server/src/menu-api.ts` already accepts it and calls `addMember`. Keep the existing request for ordinary adds. Map the three commands in `api/menu-undo.ts`. Reuse the screen's current queue, Preview action, refresh and refusal display. Add the watcher-settled words in `i18n/strings.ts` and the parent plan.

## Refusal wording settled by the watcher

| Code | Commands | English | Spanish |
| --- | --- | --- | --- |
| `menu_section.not_found` | Add | The list {name} was in has been deleted. | Se ha eliminado la lista en la que estaba {name}. |
| `menu_section.not_found` | Remove, move | The section is gone or {name} is no longer in it. | La sección ya no existe o {name} ya no está en ella. |
| `menu_section.member_duplicate` | Add, move | That list already contains {name}. | Esa lista ya contiene {name}. |
| `menu_section.membership_invalid` | Add | {name} is inactive, so it can't be put back. Make it active in Products, then try again. | {name} está inactivo y no se puede volver a añadir. Actívalo en Productos y vuelve a intentarlo. |

## Checks

- Write failing cases in `packages/menu/src/menu-undo.db.test.ts` first. Use its real menu fixture and the same writers as the routes. Cover the parent plan's add, move and remove cases and the same-list case when a whole section moves. For an offered Undo, run the command and check that only the unrelated Dinner change remains and that the Lunch preview stays the same. Check the stored order after both an add and a move, with a sibling that Preview omits and an include or set menu as the published anchor. Check the price after a move. Use `menu-undo.test.ts` for planner-only states that are awkward to reach through a stored menu.
- In dashboard `api/client-routes.test.ts`, keep the existing ordinary add body assertion and add a positioned add at index zero. Use `api/menu-undo.test.ts` for command arguments and refusal wording. In `screens/menus-screen.preview-undo.test.ts`, hold a Structure reorder open, click a placement Undo and check the write waits and Preview refreshes.
- Run the changed menu and dashboard test files and their type checks, the browser-purity guard, and the guide checks. Inspect Preview in English and Spanish, light and dark, at phone and desktop widths. Update the English and Spanish Products guides, the design-system Preview note and both A353 backlog entries.

Expected additions are 170–240 production lines, 390–560 test lines including up to 25 fixture lines, and 35–65 guide, backlog and plan lines. Existing schema, server routes and published snapshots.
