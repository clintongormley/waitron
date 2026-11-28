# PR 14c · Move dishes, Merge bills and Move this bill

From the bill’s ⋮, each action opens in the order column on a wide till and full screen on a
phone. Back stays visible while the list scrolls. Move dishes shows the quantity and names the
destination on the final button. [Design §§6, 12 and 14](../specs/2026-11-26-till-handheld-redesign-design.md) ·
[Pass 1 split](2026-11-26-till-handheld-redesign-pass-1.md).

The watcher’s 27 November 19:47 note puts 14c after A1515-4 slice 1 and A1626’s next PR open.
Both are open. Base this work on main with bill menu #4495. Claude’s first read found enough
picker work for a second PR. Each slice keeps today’s receipt and invoice issuance.

## First slice · Merge bills and Move this bill

- Start red in `apps/till/src/screens/till-table-order-screen.action-panel-layout.test.ts`.
  Replace Merge’s below-order assertion with the new bounds, using both bill menu entries.
  Check phone fill, the wide order inset after resize and visible Back on a long list.
- Extend `table-action-panel.ts` and `till-table-order-screen.ts` to use 14b’s tracked
  `wt-dialog full-screen`, `tableActionStep` and measured inset. Label the dialog and scroll
  area for the bill action. Use the shared choice tiles for targets with their current names,
  state and Counter choice. Keep existing filters and tap-to-choose. The current bill receives
  the other on Merge. Preserve draft, relocation, revision, conflict and invoice questions.
- Send Back and Escape through the same leave check. Test that focus returns to the bill’s ⋮
  after `wt-close`. Keep the product’s later refusal and question paths visible. Run the layout,
  actions-unsaved, screen parties and `till-app-parties.test.ts` cases. Estimate 160 changed
  product lines and 110 changed test lines.

## Second slice · Move dishes

- Add a `quantity` mode to `apps/till/src/widgets/portion-picker.ts`. Use the shared
  `wt-stepper` with `pickedCount` and `setCount` from `state/portion-selection.ts`, starting at
  zero. Keep existing limits, blocked reasons, weighed dishes as whole items and set-menu
  grouping. Apply the selected-row tint. Check keyboard focus at the limits. Split keeps its
  checkbox mode. Use a pill variant in shared `wt-choice-tile` retaining `aria-pressed`, with
  the dark selected fill from h 3. Check token painting and axe in both themes.
- Use the same dialog with a Move dishes step. In `i18n/strings.ts` use the existing `_one`
  pattern and add EN/ES text, for example “Move 2 dishes to Bill 2”. Get the Spanish wording
  cleared through the watcher. Use the current selected ids and shown label for the button.
  It stays quiet until eligible dishes and a destination are chosen. Clear the actionable
  state if the chosen bill leaves the list. Retire the old aside and its Back and scroll-on-open
  call. Keep the scroll helper for foot notices.
- Start red in `till-table-order-screen.move-dishes.test.ts` for 0 → 1 → 2, destination
  removal and the exact ids submitted. Preserve the Keep/Discard, Escape and stale-opening
  checks in `till-table-order-screen.actions-unsaved.test.ts`. Keep the app’s request and recovery
  assertions in `till-app-move-dishes.test.ts` and its read in
  `till-app-split-table.snapshot.test.ts`. Run the portion-picker and split-picker suites,
  their axe checks, and the shared choice tile cases. Estimate 250 changed product lines and
  230 changed test lines.
- **Owner decision before this slice builds.** The approved h 3 draws “Another table…”.
  `moveDishes` in `apps/server/src/bill-actions.ts` requires the receiving bill’s party to
  match. Recommend shipping New bill and another open bill in this party, recording the frame
  difference for Lane P, and queuing direct cross-party moves separately. Today New bill and
  Move this bill get the dishes to a separate bill there. Merge puts them onto an existing bill.

## Check and land each slice

Run the named and changed Till files with `pnpm --filter @waitron/till exec vitest run`.
Update the EN/ES table-service guides and narrow A1290 in `docs/backlog/till.md`. Run the
guide-content and guide-links checks. Measure h 3 for Move dishes, i 3 for entry, and m and
s 1 for wide and upright placement, under the approved local HTML directory. Compare captures
at 390 × 844, 820 × 1180 and 1180 × 820 in EN/ES and both themes. Lane P reviews before the
watcher shows the owner. Land each slice after the recorded picture OK and green current-head CI.
Allow about three hours per PR. Print, invoice form, Name, Comp and unpaid departure follow in 14d.
