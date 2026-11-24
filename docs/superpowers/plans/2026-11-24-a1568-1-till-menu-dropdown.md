# A1568-1 Till menu dropdown and filter implementation plan

On Table and Counter, staff can switch running menus from **Menu** beside **Search**, including to a
staff menu. **Menu** appears only when more than one menu is available. The filter becomes an icon
with an accessible name and its active count. Ended menus, station times, warnings and product marks
belong to later pieces. Lane C’s active #4238 diff has no `menu-browser.ts` changes and its A1515-4
slice is waiting. Keep the work at the top of the browser for that slice and Lane D’s settings.
[Approved design, section 5 and piece 1](../specs/2026-11-24-last-orders-per-station-design.md)

- [ ] **Replace the selector.** In `widgets/menu-switcher.test.ts`, add failing cases for the
  Menu/Carta label changing live, the plain closed value, the ordered list of running customer and
  staff menus, and a keyboard choice that emits one `menu-selected`, returns focus and changes the
  value only if the app accepts it. Keep the zero and one menu cases. In `widgets/menu-switcher.ts`,
  reuse `orderableMenus` and `wt-combobox` with `preserve-order`, `search="never"` and
  `LocaleChangeController`. Reconcile the combobox’s own changed value with `selectedId` after
  forwarding the pick. Check the open and closed states in `widgets/menu-switcher.a11y.test.ts`.
- [ ] **Put the controls in one row.** Add failing Chromium cases in
  `screens/till-{table-order,counter}-screen.test.ts` for a handheld row and first choice with focus
  retained, including a Table with set-menu copies. In `widgets/menu-browser.ts` give the Search row
  a leading picker slot. Mount the same browser in both screens when a menu is shown or there is a
  choice, including when there is no selected menu and no tile to draw. In the waiting state, draw
  the picker alone until a choice supplies Search, Filter and tiles. Keep widths shrinkable and
  remove the old chooser wrappers and spacing. Keep the Table browser’s existing inert state while
  sending, while edits are locked or when ordering is barred. The dropdown will be unavailable in
  those states along with the rest of the row. Ask the watcher to clear that change and test it.
- [ ] **Use a counted icon.** In `widgets/diet-filter.test.ts`, require a rendered funnel, the
  accessible names **Filter** and **Filter 2**, the visible count and the unchanged dialog action.
  Make that pass in `widgets/diet-filter.ts`. Reuse the existing table-filter path and register it
  where the widget loads. Keep the button’s dialog semantics, use shared size tokens and run its
  existing accessibility tests in both themes.
- [ ] **Verify and describe the change.** Run the changed Till files with
  `pnpm --filter @waitron/till exec vitest run <file>`. Adapt selectors in `till-app.test.ts` and
  `till-app-menu-refresh.test.ts`. In `till-app-{table-service,menu-timetable}.test.ts`, check no
  menu or tiles are shown before a choice, even when the picker-only browser is mounted. Keep the
  draft, history, menu-memory and zone assertions, and record changed checks in the PR. Run
  `till-counter-{cleanup.look,screen.layout}.test.ts`, the guide checks and the file-size guard.
  Update `apps/server/src/guide/*/{table-service,products}.md` in both languages. Call it the Menu
  field beside Search and the Filter icon, and leave only the remaining A1568 work in the backlog.
  Inspect Table and Counter on phone and desktop in both languages and themes. Send local captures
  based on `dropdown.png` and the queue’s filter-icon correction to the watcher for the owner’s OK.

Estimate about 120 production lines added and 70 removed, 180 test lines added and 90 removed,
and a few guide lines. No new test support is planned.
