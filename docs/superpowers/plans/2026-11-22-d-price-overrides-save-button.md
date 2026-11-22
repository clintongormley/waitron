# Save a menu's price overrides together

Owner, 2026-11-22 19:17, as recorded in Lane D's PRICE-OVERRIDES-SAVE-BUTTON queue item:
“also editing price overrides shouldn't autosave but should have a save button at the bottom (which doesn't scroll away)”.
The same item records the watcher's instruction to remove this tab's Undo message.

- [ ] In `apps/dashboard/src/widgets/menu-prices-table.ts`, make edits to a menu's product and variant
  overrides a single draft tracked by `draftScopeFor`. Keep the existing exact price comparison, row
  labels, inherited-price hints, filters and Escape to reset one field. Typing, Enter in a field,
  and moving focus send no writes. Use the sticky `wt-form-actions` below the table, with Cancel
  to restore saved values and Save quiet until a value changes. Validate on Save, show field errors
  and the localized correction line via `FormFeedback`, then keep Save disabled until corrected.
  Remove the price toast and Undo handler.
- [ ] In `apps/dashboard/src/screens/menus-screen.ts`, let the existing guarded URL change select
  the tab and menu after the leave decision. Keep the Prices view and its draft while deciding.
  Use one draft per open Price overrides tab. Keep editing retains the draft, and Discard leaves
  without writing. Save sends only changed fields, in sequence, through `updateMenuItem` and
  `setMenuVariantPrice` as today. Block a second submit while that Save is in progress. Acknowledge
  each successful write and refresh once if any succeeded. Keep only refused edits available to
  retry and show named refusals by the field or other refusals above the buttons. Keep refresh
  errors separate and report a refusal that arrives after leaving through the existing Menus
  notice. The current routes save independently, so one refusal can leave other prices saved.
  The set-menu surcharge editor in `set-menu-dishes.ts` has its own handler and keeps it.
- [ ] Start with failing browser cases in `apps/dashboard/src/screens/menus-screen.test.ts` for
  several edits with zero writes before Save, existing route payloads including blank-as-clear,
  a partial refusal with one refresh and retry of only what failed, and a failed refresh after
  a successful write. In `apps/dashboard/src/widgets/menu-prices-table.test.ts`, cover equal prices,
  malformed input, Cancel, filtered or collapsed drafted rows, and the bar remaining in view
  through a long scroll. Preserve row, inheritance and error coverage when retiring cases for
  autosave or Undo. In `apps/dashboard/src/screens/menus-screen.unsaved.test.ts`, drive a tab click
  and browser Back through Keep and Discard. Run those files and `menus-screen.a11y.test.ts`
  with dashboard Vitest, and inspect English and Spanish in light and dark at phone and desktop widths.
- [ ] Remove stale outcome strings from `apps/dashboard/src/i18n/strings.ts`. Update the English and
  Spanish `apps/server/src/guide/*/products.md` guide and the row-edit exception in
  `docs/developers/design-system.md`. Remove the A343 Undo keyboard entry from
  `docs/backlog/menu.md` and its index entry in `docs/backlog.md`. Run the guide content and link
  tests before branch review.

Expected additions are 160–260 product lines and 220–350 test lines, with about 250–380 product
lines and 450–700 test lines removed as the per-field send, queue and toast cases go away.
