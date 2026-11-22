# Add a Save bar for menu price overrides

Owner, 2026-11-22 19:17, recorded in Lane D's PRICE-OVERRIDES-SAVE-BUTTON queue item:
“also editing price overrides shouldn't autosave but should have a save button at the bottom (which doesn't scroll away)”.
The watcher assigned this tab's Undo removal at 19:41 after the owner's 19:16 request
“meh, i think let's remove undo altogether. better than having it half done”.

- [ ] In `apps/dashboard/src/widgets/menu-prices-table.ts`, track the menu's product and variant
  draft via `draftScopeFor`. Keep price comparison by amount, row labels, inheritance, filters and
  Escape to reset one field. Typing stages changes and moving focus sends nothing. Enter invokes the same
  Save button via `submitOnEnter`. Use `wt-form-actions` below the table, with its built-in sticky
  positioning and focus clearance. Use `saveActionState` to keep Save quiet when clean. Cancel
  restores saved values.
  Validate on Save and show errors via `FormFeedback`, with Save disabled until corrected.
  Reveal a collapsed invalid row. Name filtered-out errors above the buttons and keep the filter.
  Remove the toast and Undo wiring.
- [ ] In `apps/dashboard/src/screens/menus-screen.ts`, reset the tab strip's eager selection as
  `venue-settings-screen.ts` does and let the guarded URL restore select the tab. Defer
  `#backToList` under the same guard. Mount the price draft only on its tab, keyed by menu.
  The widget passes its changed price rows to the screen's async Save callback. Use the existing
  `updateMenuItem` and `setMenuVariantPrice` routes in sequence. The submitted values are shown
  read-only, with Save and Cancel disabled while pending. The widget applies the callback's
  saved keys and field or form refusals, clears only saved edits, then asks the screen for one
  refresh if anything saved. Refused edits remain available to retry. The routes save separately,
  so one refusal can leave other prices saved. Keep a refresh error separate. A refusal after
  leaving goes to the Menus notice or the existing session-scoped late notice in
  `apps/dashboard/src/dashboard-app.ts` through a separate price reporter. The set-menu surcharge editor
  (`set-menu-dishes.ts`) owns its own save handler.
- [ ] First run failing browser cases in `menus-screen.test.ts` for no writes on blur or tab change,
  exact payloads on Save including blank-as-clear, retry after partial refusal, and a failed refresh
  after success. In `menu-prices-table.test.ts`, test equal prices, Enter through Save, malformed
  and hidden fields, Cancel, and the bar above the sticky table header when scrolling, with the old
  outcome spacing removed. Preserve price
  rendering and refusal assertions when retiring autosave and Undo tests. Add
  `screens/menus-screen.prices.unsaved.test.ts` for tab click, menu breadcrumb and browser Back
  with Keep and Discard. Update `widgets/menu-prices-table.a11y.test.ts` for the footer. Run these
  files and `menus-screen.a11y.test.ts` with dashboard Vitest. Inspect EN/ES, both themes, phone and desktop.
- [ ] In `apps/dashboard/src/i18n/strings.ts`, retire `menu_prices.saved`, `menu_prices.cleared` and
  `menu_prices.undo` and add the late price notice in English and Spanish. Update both `apps/server/src/guide/*/products.md` variant sections to tell
  readers to edit prices and choose Save, or Cancel to discard. Update both Price overrides
  exceptions in `docs/developers/design-system.md`. Delete the A343 Undo entry in
  `docs/backlog/menu.md` and its `docs/backlog.md` pointer. Run the guide content and link tests.

Claude reviewed the plan at `9d462272c5`. The watcher cleared `33a26ae2f3` on 2026-11-22 at
20:36, with the separate late price reporter and the narrower scroll test recorded above.

Estimate: +180–270 and −250–380 product lines, +230–370 and −450–700 test lines.
