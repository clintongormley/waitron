# PR 14b · Move, Join, Split and Finish table

From the table name, Move, Join and Split open with Back at the top of the screen. Finish table
still takes one press. If dishes need attention first, its existing confirmation gets the same
layout. The panels fill a phone or cover the order column on a wide till. This addresses A1359.
The watcher assigned 14b at 05:24 CET on 27 November, stacked on 14a at `b11f658219`.
[Design §§6 and 14](../specs/2026-11-26-till-handheld-redesign-design.md) ·
[Pass 1 split](2026-11-26-till-handheld-redesign-pass-1.md)

## Build after watcher clearance

- In `apps/till/src/screens/till-table-order-screen.ts`, render Move, Join and both Split steps
  in a small `table-action-panel.ts` template using `wt-dialog full-screen` with `trackDialog`,
  `wt-full-screen-panel`, `wt-top-bar` and `wt-foot-button-bar`. Name the dialog and its scroll
  body. Set `--wt-dialog-inset-inline-start` on the dialog from `#placeOrderPanels` and the existing
  `orderPaneInset` on open and resize. Use zero on a phone. Keep the aside for bill actions,
  including the `move-bill` verb’s shared table picker and Counter choice.
- Keep one modal through Split’s steps and set a stable `beforeClose`. Back calls `requestClose`
  and uses the same guard as Escape. If the all-selected question is visible, dismiss it and keep
  the modal open. From the Split editor, run the existing leave decision, step back to the list
  on discard and keep the modal open. Close at the first step after its leave decision proceeds.
  Guard delayed answers by the opening and step. Preserve focus on the heading or recovery action
  after updates and return it to the table name on exit. Use the top bar as the sole Back control.
- Keep Move and Join’s target filters and `#prepareRelocation`, including Split’s Move guests
  path. Give `TableRelocationOpenDetail` a refusal callback alongside `ready`. In `till-app.ts`,
  deliver preparation errors to that callback for the table panel and retain the banner for other
  callers. Show the current choice’s error above the foot. Back retires the choice. Preserve
  revision checks, queued saves, refused writes and recovery.
- Keep the direct action in `table-party-menu.ts` and the finish handlers in `till-app.ts`.
  Convert `apps/till/src/widgets/finish-table-dialog.ts` to the shared panels and bars. Pass
  the active order’s live inset from `#renderFinishTable` as the allergy editor does. Keep the
  draft guard, the supervisor prompt above it, and the existing actions and refusals. Close this
  panel before revealing the unpaid-bill notice or money-held error, in today’s order.
  [Menu dispatch](../../../apps/till/src/screens/till-table-order-screen.ts#L7037) ·
  [Refusal handoff](../../../apps/till/src/till-app.ts#L20245)

## Verify and document

- Start red in `apps/till/src/screens/till-table-order-screen.{table-menu,parties,split-table,split-table.unsaved}.test.ts`.
  Reproduce Split low on a long 1280 × 800 order. Check wide bounds, phone fill, visible Back and
  Split while rows scroll, and preserved choices on resize. Exercise Keep/Discard and Escape.
- In `apps/till/src/till-app-parties.test.ts`, show a failed destination read in the current
  panel and verify a held answer cannot act after Back. In `till-app-parties-closing.test.ts`
  and `widgets/finish-table-dialog.{test,unsaved.test,a11y.test}.ts`, check the Finish placement,
  Back, and the existing payment refusals after close. Keep the handheld checks for one press.
- Run the named and changed files with `pnpm --filter @waitron/till exec vitest run` and their
  `src/` paths. Include `till-app-{drafts,split-table,handheld-pay}.test.ts` and the screen files
  that read `data-action-panel`, as listed by `rg -l 'data-action-panel' src -g '*.test.ts'` in
  `apps/till`. Keep revision, draft and bill-action assertions. Wait for `wt-close` when it drives
  the assertion. Update both table-service guides and the A1359 backlog references. Run
  `apps/server/src/guide-content.test.ts` and `scripts/guide-links.test.ts`.
- Measure the approved HTML under `~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/html/`.
  Use `i` 2 for entry, `h` 3 for shared bars and `m` and `s` 1 for wide placement. Follow §14.1.
  Compare captures outside Git at 390 × 844, 820 × 1180 and 1180 × 820 in EN/ES and both themes.
  Lane P reviews the pictures before the watcher shows the owner. Land after recorded picture OK
  and green CI on the current head.

Allow about three hours. Estimate 300 changed product lines and 240 changed test lines.
The bill panels and A1290 follow in 14c–d. This slice uses today’s floor actions and payment,
refund, receipt, invoice and filing flows.
