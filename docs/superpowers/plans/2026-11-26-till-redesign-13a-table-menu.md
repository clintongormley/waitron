# Till redesign 13a. Open table actions from the table name

Tap the table name to open a sheet with Allergies, Guests, Name the party, the Bill requested
switch, Move to another table, Join tables and Split the table. Finish table sits by itself at the
bottom. Each choice opens its current screen or runs its current command.

The [design, §§6, 9.12 and frame i](../specs/2026-11-26-till-handheld-redesign-design.md) at
`46a29becbb` and the [pass-1 split](2026-11-26-till-handheld-redesign-pass-1.md#prs-after-the-bill-picker)
set the scope. The 20:18 watcher note on 26 November applies the owner’s pass-2 decision to take
Floor plan details out of the sheet. Floor editing belongs to pass 2. PR 13b redesigns the bill
menu. PRs 14a–d redesign the action panels, including A1290 and A1359.

## Build

- In `apps/till/src/screens/table-party-menu.ts`, reuse PR 1’s `wt-row-actions` bottom sheet at
  phone and till widths. Put the table name on its trigger and the current allergy summary,
  guest count and party name beside their choices when known. In `till-table-order-screen.ts`, use
  `partyTablesLabel` for the name. Pass `#activeTableTitle()` from both mounts in `till-app.ts`
  for an unseated table. Use the localized Table actions label when neither name is available.
  Offer Join and Move when there is no party, and Split once the party spans two tables.
- In `table-bill-controls.ts`, keep the existing anchored ⋮ for the current bill, under its current
  selector so Full invoice returns focus there. Retain the bill actions and their existing guards.
  The bill picker is the route to **+ New bill**. Reuse current handlers and discard checks. Return
  focus to the trigger that opened each panel or dialog when Back or Escape closes it.
- Use `wt-switch` for Bill requested and take its checked state from `billRequestOf`. Keep the
  busy guard. Close the sheet on an accepted toggle and send the existing `request-bill` event once
  with the desired state. The floor refresh supplies the result on reopening. Add any new English
  and Spanish labels in `apps/till/src/i18n/strings.ts`.

## Verify and hand off

- Start in `till-table-order-screen.table-menu.test.ts` with a real click that fails because the
  table trigger is missing. Check both menus, the switch in each state and its busy gate. Measure
  Finish table at the A1265 sizes (390×844 and 1280×900) and scroll to it on shorter screens.
  Keep the bill-state assertions. Cover Keep, Discard and focus in `till-table-order-screen.actions-unsaved.test.ts`
  and check both themes in `till-table-order-screen.bill-controls.a11y.test.ts`. Retarget moved
  table-action locators while keeping the existing assertions. Run those suites, the bill-switcher
  suite and every changed test file with `pnpm --filter @waitron/till exec vitest run <files>`.
- Update the EN and ES `apps/server/src/guide/*/table-service.md` pages, `docs/developers/design-system.md`
  and the remaining scope in the backlog. Estimate 150 changed production lines and 220 test lines.
  After watcher clearance, capture before and after on phone and till widths, in portrait and
  landscape, both themes and both languages. Share the paths with the watcher and keep pictures
  outside Git. Landing needs the recorded owner OK on pictures and green CI on the current head.
