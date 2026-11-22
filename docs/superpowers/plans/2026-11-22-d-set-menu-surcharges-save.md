# Save set-menu dish surcharges together

You can change several dish surcharges in **Dishes**, then choose **Save** or **Cancel** in
one sticky bar. A blank amount means **Included**. Enter in a surcharge field uses the same
Save. Leaving with edits offers **Keep editing** or **Discard**. The watcher queued this on
2026-11-22 after the owner's 21:41 “ok” to making dish prices wait for Save like Price
overrides. The existing Variants dialog has its own Save. Course, Add, Copy, Remove, terms,
inclusions and publication are outside this change.

- In `apps/dashboard/src/widgets/set-menu-dishes.ts`, follow `menu-prices-table.ts` for
  `draftScopeFor`, `saveActionState`, `submitOnEnter`, `FormFeedback` and `wt-form-actions`.
  Keep pending edits by menu item across course tables. Compare valid amounts in cents.
  Remove the blur write and keep Escape to restore one field. Cancel restores all fields.
  Save starts quiet and enables on a change. Use `validSurcharge` on Save and show invalid
  amounts beside their fields with one message above the buttons. If the surcharge column
  is hidden, name the affected dish by the buttons.
- Send changed rows in sequence through the existing `ListWriteQueue` and
  `updateMenuItem(menuId, itemId, { grossPrice })`. Blank sends null. Freeze the submitted
  fields and disable both buttons during the batch. Accepted prices become the baseline
  before one refresh. A failed refresh still offers Try again. Keep refused prices to
  retry, and show field refusals alongside their fields. Separate requests can save some
  prices when others are refused. The existing guarded breadcrumb and browser history
  protect unsent edits. If a refusal arrives after leaving, pass the dish names through
  `set-menu-editor.ts` and `screens/menus-screen.ts` to the existing late-save notice
  pattern in `dashboard-app.ts`, with surcharge wording in `i18n/strings.ts`.
- Start red in `widgets/set-menu-dishes.test.ts`. Cover no request on blur, multi-dish
  Save and Enter with the exact amounts, Cancel, an equal amount, validation, partial
  refusal and retry, and a refresh failure after an accepted write. Replace the old
  autosave cases with these checks and retain the prior field and general refusal cases.
  Use `screens/menus-screen.set-menu.unsaved.test.ts` for breadcrumb and browser Back
  with Keep and Discard, and for a late refusal. Run these files and the existing
  `set-menu-dishes.unsaved.test.ts` and `set-menu-dishes.a11y.test.ts` with Dashboard
  Vitest. Inspect the bar in both themes and languages at phone and desktop widths.
- Update `apps/server/src/guide/{en,es}/products.md` and run the guide contents and link
  checks. Update the A1515 dashboard paragraph in `docs/backlog/menu.md` and add a dated
  pointer here from the historical A1515 dashboard plan's blur-save instruction.

Estimate 125–190 added production lines, 150–240 added test lines and 10–20 lines of
guide and backlog edits. The batch reuses the current API and storage.
