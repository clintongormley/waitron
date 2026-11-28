# PR 14c · Move dishes, Merge bills and Move this bill

From the bill’s ⋮, open each action in the order column on a wide till and full screen on a
phone. Back stays visible while the list scrolls. Move dishes lets you choose how many to
move and names the destination in the final button. [Design §§6, 12 and 14](
../specs/2026-11-26-till-handheld-redesign-design.md) · [Pass 1 split](
2026-11-26-till-handheld-redesign-pass-1.md). The bill menu from #4495 is on main.

## Build after watcher clearance

- In `apps/till/src/screens/till-table-order-screen.ts` and `table-action-panel.ts`, extend
  14b’s tracked `wt-dialog full-screen`, `tableActionStep` and measured inset to all three
  bill actions. Name the dialog and its scroll area. Use the existing leave check for Back
  and Escape, wait for `wt-close` to return focus to the bill’s ⋮, and keep the live inset
  during resize. Replace the old aside, its scroll-on-open and its separate Back.
- Keep the existing target labels, filters and immediate selection in Merge bills and Move
  this bill. Reuse the latter’s table picker and Counter choice. Preserve the merge direction
  (the open bill receives the other), relocation preparation, revision and conflict handling,
  unsent-draft and invoice questions. Check that these questions appear above the panel or
  after it closes, as appropriate to their existing flow.
- Use the scoped Move dishes look in `apps/till/src/widgets/portion-picker.ts`. Use
  `pickedCount` and `setCount` from `state/portion-selection.ts` for the stepper, starting
  at zero, and keep the limits and reasons supplied by the existing rows. Show selected
  rows and destination pills as in frame h 3. In `i18n/strings.ts`, add EN/ES singular and
  plural button text from the eligible picks and the shown destination. Use the existing
  quiet button until the choice is actionable. Preserve the existing new bill and other open
  bill in this party choices, and clear the actionable state if the chosen bill leaves the list.
- The frame also shows “Another table…”. The current Move dishes write checks that the
  receiving bill belongs to the same party (`apps/server/src/bill-actions.ts`, `moveDishes`).
  Recommend keeping this PR to the current bill choices. Staff can move to New bill then use
  Move this bill to take it to another table. A direct move across parties needs a separate
  decision. Print, invoice, Name, Comp and unpaid departure follow in 14d.

## Verify and document

- Start red in `till-table-order-screen.action-panel-layout.test.ts` with all three bill
  menu paths and a long list. Check phone fill, wide order bounds after resize, and Back
  and Move visible while the rows scroll. Reuse `till-table-order-screen.move-dishes.test.ts`
  for 0 → 1 → 2 picks, the named destination, revocation and the dispatched ids.
- Keep Back, Escape, Keep/Discard and the immediate merge assertions in
  `till-table-order-screen.actions-unsaved.test.ts`. Run the changed files with
  `pnpm --filter @waitron/till exec vitest run` and their `src/` paths. Include
  `till-table-order-screen.parties.test.ts`, `till-app-parties.test.ts`,
  `till-app-split-table.snapshot.test.ts`, and the portion-picker and its axe suite.
- Update both table-service guides and mark the 14c part of A1290 done in
  `docs/backlog/till.md`. Run the server guide-content and root guide-links tests.
  Measure the approved HTML frames h 3, i 3, m and s 1. Compare captures at 390 × 844,
  820 × 1180 and 1180 × 820 in EN/ES and light/dark. Lane P reviews the images before
  the watcher sends them to the owner. Land after the recorded picture OK and current-head CI.

Allow three hours to open the PR. Estimate 280 changed product lines and 190 changed test lines.
