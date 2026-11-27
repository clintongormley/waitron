# PR 14b · Move, Join, Split and Finish table

From the table name, each action opens with Back and reaches the top of the screen. On a phone it
fills the screen. On a wide till it covers the order column. This addresses A1359. The watcher
assigned 14b at 05:24 CET on 27 November, stacked on 14a at `b11f658219`.
[Design §6](../specs/2026-11-26-till-handheld-redesign-design.md#6-the-tables-menu-and-the-bills-menu) ·
[§14](../specs/2026-11-26-till-handheld-redesign-design.md#14-how-it-looks) ·
[Pass 1 split](2026-11-26-till-handheld-redesign-pass-1.md)

## Build after Claude review and watcher clearance

- In `apps/till/src/screens/till-table-order-screen.ts`, render Move, Join, both Split steps and a
  Finish step with a small `table-action-panel.ts` template. Use `wt-dialog full-screen`,
  `wt-full-screen-panel`, `wt-top-bar` and `wt-foot-button-bar`. Name the dialog and scrolling body.
  Reuse `#placeOrderPanels` and `orderPaneInset` on open and resize. Use zero on narrow screens.
  Dim the display and scroll the body. The existing aside still serves the bill actions for 14c.
- Keep the screen’s action state, target filters and draft scope. Route Back and Escape through
  the same leave check. In Split, Back dismisses the all-selected question first, then steps back
  to the table list, then the order. Keep the modal open between those steps. Keep draft protection,
  live and refused selections, and focus on the relevant heading or recovery action. Return focus
  to the table name after closing. Reuse `trackDialog` for the nested prompts.
- Reuse `#prepareRelocation`, including Split’s Move guests route. In `apps/till/src/till-app.ts`,
  show current preparation refusals where the modal leaves them visible. Back retires that choice
  so an old answer cannot send or replace a new action. Keep the current revision checks, queued
  saves, refused writes and recovery.
- Keep the outlined **Finish table** button in `table-party-menu.ts`. Have it open a panel naming
  the table, with Back and **Finish table**. Move the existing finish event to the panel’s explicit
  action. Send it once for the current opening and close the panel so existing outcomes can show.
  Keep the current party write and recovery routes, including the unserved-dish confirmation.
  [Menu dispatch](../../../apps/till/src/screens/till-table-order-screen.ts#L7037) ·
  [Handler](../../../apps/till/src/till-app.ts#L19897) · [POST](../../../apps/till/src/api/floor-api.ts#L367)

## Verify and document

- Start red in `apps/till/src/screens/till-table-order-screen.{table-menu,parties,split-table,split-table.unsaved}.test.ts`.
  At 1280 × 800, reproduce Split below a long order. Assert phone fill, wide bounds and Back and
  Split visible while rows scroll. Resize with choices held. Exercise Back, Escape, Keep/Discard
  and return focus. Verify that opening or backing out of Finish sends zero requests and confirming
  sends one in `apps/till/src/till-app-parties.test.ts`.
- Run those files, `till-app-parties-closing.test.ts`, `till-app-split-table.test.ts`,
  `till-app-drafts.test.ts`, the screen’s `*.actions-unsaved.test.ts` and `*.move-dishes.test.ts`,
  and every changed suite with `pnpm --filter @waitron/till exec vitest run` and the `src/` paths.
  Preserve the existing assertions, including the handheld Finish cases in
  `till-app-handheld-pay.test.ts`. Wait for `wt-close` where it drives the result.
- Update `apps/server/src/guide/{en,es}/table-service.md` and the A1359 entries in `docs/backlog.md`
  and `docs/backlog/till.md`. The bill panels and A1290 follow in 14c–d. This slice changes how staff
  reach the table actions. It reuses today’s floor, payment, refund, receipt, invoice and filing flows.
- Measure the approved HTML in `~/waitron-campaign-shared/mockups/2026-11-26-till-handheld-redesign/html/`.
  Use `i` 2 for entry, `h` 3 for shared bars and `m` and `s` 1 for wide placement. Follow §14.1.
  Compare captures outside Git at 390 × 844, 820 × 1180 and 1180 × 820, in EN/ES and both themes.
  Lane P reviews the pictures, then the watcher sends them to the owner. Land after the owner’s
  recorded picture decision and green CI on the current head.

Allow about three hours. Estimate 240 changed product lines and 240 changed test lines.
