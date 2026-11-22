# Save set-menu dish surcharges together

You can change several surcharges in **Dishes**, then choose **Save** or **Cancel** in one
sticky bar. A blank amount means **Included**. Enter uses the same Save. Leaving with
unsubmitted edits offers **Keep editing** or **Discard**. The watcher queued this on
2026-11-22 after the owner's 21:41 “ok” to making dish prices wait for Save like Price
overrides. This supersedes the blur-save instruction in the [A1515 dashboard plan](2026-11-18-a1515-set-menu-dashboard.md).
The Variants dialog keeps its own Save. Course, Add, Copy and Remove keep their current actions.

- In `apps/dashboard/src/widgets/set-menu-dishes.ts`, reuse the Price overrides pattern
  for `draftScopeFor`, `saveActionState`, `submitOnEnter`, `FormFeedback` and
  `wt-form-actions`. Track edits by menu item and compare valid amounts in cents. Remove
  the blur write. Escape restores one field and Cancel restores all. Save opens quiet.
  Recheck the draft when details change. Keep edits for dishes that move between courses
  and omit dishes that go away. Remove clears the removed dish's draft as it does today.
- Validate all changed amounts with `validSurcharge` on Save. Show local errors and
  field-specific refusals at the inputs, with one message above the buttons. Name the
  dish in that message when its course table hides the surcharge column. Put other
  surcharge refusals there too. Keep the Course/Remove alert and the load error separate.
  Isolate the course tables as Price overrides does so the headers sit behind the bar.
  The bar stays within Dishes and the Inclusions form keeps its own buttons.
- Send the batch as one task in the existing `ListWriteQueue`, using
  `updateMenuItem(menuId, itemId, { grossPrice })` for each changed row. Blank sends
  null. Freeze surcharge input and both actions while sending. Use accepted prices as
  the baseline before one refresh. Keep refused edits ready to retry and offer Try again
  if the refresh fails. Separate requests can save some prices when others are refused.
  A submitted batch can finish after leaving. Its feedback lives in Dishes.
- Start red in `widgets/set-menu-dishes.test.ts` for blur without a write, then check
  multi-dish Save, Enter, Cancel, equal amounts, validation and partial refusal with retry.
  Keep the field and general refusal assertions and cover a failed refresh after an accepted
  write. Extend `widgets/set-menu-dishes.unsaved.test.ts` for Keep and Discard in its existing
  leave fixture. The shared breadcrumb and history check already has screen coverage in
  `menus-screen.prices.unsaved.test.ts`. Run the changed files and
  `set-menu-dishes.a11y.test.ts` with Dashboard Vitest. Inspect the bar and its neighbours
  in both languages and themes at phone and desktop widths.
- Update `apps/server/src/guide/{en,es}/products.md`, `docs/developers/design-system.md`
  and the A1515 dashboard paragraph in `docs/backlog/menu.md`. Run the guide content and
  guide link tests.

Estimate +105–155/−60–90 production lines and +110–180/−45–80 test lines. About
10–20 lines of guide and backlog edits. The batch reuses the current API and storage.
