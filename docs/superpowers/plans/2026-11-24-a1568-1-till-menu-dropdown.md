# A1568-1 Till menu dropdown and filter implementation plan

On the Table and Counter order screens, staff can choose another running menu from **Menu** beside
**Search** and open the dietary filter from a labelled icon that shows its active count. The dropdown
appears only when there is a choice and includes staff menus. The design’s section 5 and first piece
set this scope. Ended menus, station times, warnings and product marks belong to later pieces.
[Approved design](../specs/2026-11-24-last-orders-per-station-design.md)

- [ ] **Start with failing Chromium checks.** In `widgets/menu-switcher.test.ts`, check the closed
  field’s name and value, the open list’s running customer and staff menus in order, the empty and
  single-menu cases, and selection by keyboard with one `menu-selected` event and focus returned.
  In `widgets/diet-filter.test.ts`, check the named icon opens the existing dialog and keeps the
  active count visible. In `screens/till-table-order-screen.test.ts` and
  `screens/till-counter-screen.test.ts`, check the controls are in one row at handheld width and
  the picker remains reachable when the screen is waiting for a menu choice.
- [ ] **Build the row using the existing controls.** Use `wt-combobox` in `widgets/menu-switcher.ts`
  with `orderableMenus`, the localized Menu/Carta label, the current menu name and the existing
  `menu-selected` event. Let the app continue to own the choice. Add a leading slot to the existing
  Search and filter row in `widgets/menu-browser.ts`, with shrinkable widths and no gap for an
  absent picker. Wire the picker from `screens/till-table-order-screen.ts` and
  `screens/till-counter-screen.ts`. Keep it reachable when there are choices but no selected menu
  yet, and preserve the table’s existing restrictions on Search, Filter and dish actions during a
  send or when ordering is barred. Keep new rendering in the small widgets and leave the menu
  browser’s grid and search logic alone for Lane C. In `widgets/diet-filter.ts`, use the existing
  button with an icon, the localized accessible name and active count. Use shared tokens for sizes.
- [ ] **Check the result and update the guides.** Run the changed widget and screen cases with
  `pnpm --filter @waitron/till exec vitest run <file>` and exercise the existing switcher and filter
  accessibility suites in both themes. Update selectors for the new controls in the affected
  switcher, screen and app tests, including `till-app.test.ts` and `till-app-menu-refresh.test.ts`,
  keeping their selection, zone reopening, draft, history and menu-memory assertions. Record changed
  assertions in the PR. Update both language twins of `apps/server/src/guide/*/{table-service,products}.md`
  and keep the remaining A1568 pieces in `docs/backlog.md`. Run the guide and file-size checks.
  Inspect Table and Counter on phone and desktop in both languages and themes. Send local captures
  through the watcher for the owner’s OK before landing. Use the approved `dropdown.png` layout
  with the queue’s correction to the filter icon.

Estimate about 120 production lines added and 70 removed, 180 test lines added and 90 removed,
and a few guide lines. No new test support is planned.
