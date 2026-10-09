# A438 — "Move to station" on a paid counter order waiting for hand-over

Owner, 2026-10-09, during the A366 slice 4 decisions: "we will need some way of manually moving an
order from one station to another". Backlog entry it closes: "Move to station on a paid counter
order" (`docs/backlog.md`, till area; no detail file).

## What is true today (checked 2026-10-09 on main 87b46b024)

- `moveDishesToStation` (`apps/server/src/station-move.ts`) refuses an order only when it is
  abandoned (`working_order.not_open`) or handed over (`working_order.already_collected`). A settled
  order not yet handed over is accepted; `apps/server/src/station-move.test.ts`, case "moves a %s
  bill without updating its frozen line", runs it on a `settled` bill. The route
  (`POST /api/working-orders/:id/lines/move-station`, `apps/server/src/till-api.ts`) takes
  `lineIds` (1–100) and a `stationId`, and requires the `take-orders` action.
- The till cannot list a paid order's dishes: `GET /api/working-orders/:id/lines` calls
  `readTabLines`, which starts with `assertTabOpen` and refuses any order whose status is not
  `open` (`tab.not_open`).
- The "Paid, not handed over" rows come from `GET /api/orders/counter-waiting`
  (`listCounterWaiting`, `apps/server/src/working-order.ts`) and are drawn by
  `apps/till/src/widgets/counter-waiting.ts`, which offers Pay, Hand over and Cancel and credit but
  no move.
- The table screen offers "Move to station…" per dish row only (`#moveStationButton`,
  `apps/till/src/screens/till-table-order-screen.ts`); an extras row never gets one ("An extras row
  offers only Cancel, Give away and Discount"). The app opens `till-station-choice-dialog` in `move`
  mode (`#onMoveStation`, `#onStationChosen`, `#renderMoveStationDialog` in `apps/till/src/till-app.ts`).

## Decisions (defaults; the owner may override)

1. **The button moves the whole order.** One "Move to station…" button per paid row. Choosing a
   station sends ONE move request naming every dish of the order that can still move. A dish is
   named when it is a top-level line (`parentLineId` null) with a kitchen record that
   `stillMovable` accepts (queued, not away, not made here, nothing served). Extras rows are never
   named, as on the table screen.
2. **Shown only when something can move**: on a `settled` row with at least one such dish. A
   `placed` row (sent, not paid) gets no button in this item: it is paid through the basket, and the
   backlog entry asks for the paid list only.
3. **The data travels with the waiting list**, not through a new route: each row of
   `listCounterWaiting` gains `movableDishes: { lineId: string; stationId: string }[]`, empty on a
   placed row. No new route means no new row in the profile-action or zone maps; the list's existing
   zone filter (`visibleOrders`) still decides which rows a till sees. One extra query for all the
   settled rows at once, never one per row.
4. **The dialog is the existing one.** Its dish name is the row's scope (`#12 Mesa 4`, as the row's
   other buttons' labels use), and its current station is the station every named dish shares, or
   none when they are at different stations.
5. **After the answer** (moved or refused) the till reads the waiting list again, and the station
   card, as a hand-over does. A refusal shows in the dialog the way the table's move shows one; the
   string `move_station.refused.working_order.already_collected` exists already.
6. Button: `wt-button` `variant="secondary"`, `data-waiting-move-station`, text and aria-label from
   `table.move_station` ("Move to station…" / "Cambiar de estación…") plus the row's scope in the
   aria-label. No new strings expected.

## Task (one implementer)

Work test-first in `/Users/clintongormley/workspace/worktrees/waitron-feat-move-paid-counter-order`.

1. **Server.** Failing tests first in `apps/server/src/counter-handover.test.ts`, describe
   `GET /api/orders/counter-waiting` (or beside `listCounterWaiting`'s other cases): a settled
   order with a queued dish lists it with its station; a started (`preparing`) dish, a made-here
   record and an extras row are not listed; a placed row has `movableDishes: []`. Then add the
   field to `CounterWaitingOrder` and `listCounterWaiting`, reusing `stillMovable`. Grep the server
   and till suites for a `toEqual` pinning a whole counter-waiting row and add the key there
   (allowed: a whole-shape pin may gain a new key with every existing value unchanged; list each in
   the PR).
2. **Till client type.** `CounterWaitingOrder` in `apps/till/src/api/client.ts` gains the same
   field. Every test fixture that builds a row gains `movableDishes: []` (fixture growth, list it).
3. **Widget.** Failing tests first in `apps/till/src/widgets/counter-waiting.test.ts`: the button
   is drawn on a settled row with movable dishes, not on one without, not on a placed row; pressing
   it emits `move-waiting-order` (`bubbles`, `composed`) with `{ id }`. Extend
   `counter-waiting.a11y.test.ts` to cover a row with the button in both themes.
4. **App.** Failing tests first (the till-app suite that already drives the waiting list, e.g.
   `apps/till/src/till-app-boot-and-counter.test.ts`): pressing the button loads the stations and
   opens the move dialog headed with the row's scope; choosing a station calls `moveDishStation`
   once with the order id and every movable line id; the waiting list is read again afterwards; a
   refusal (`working_order.already_collected`) shows in the dialog and the list is read again.
   Keep the table and counter-basket move paths unchanged (their existing tests must pass
   unedited).
5. **Look.** Mount the waiting list (or the counter screen) with a paid row carrying a movable dish
   and screenshot it in EN and ES, light and dark, at 1280 and 390 px wide, plus the open dialog;
   save to `~/waitron-campaign-b/a438-shots/`. Open the shots and check the button fits beside Hand
   over at phone width.
6. **Backlog.** Delete the entry "Move to station on a paid counter order" from `docs/backlog.md`.

Checks to run: `pnpm --filter @waitron/server exec vitest run src/counter-handover.test.ts
src/station-move.test.ts src/till-api.station-move.test.ts`, `pnpm --filter @waitron/till exec
vitest run src/widgets/counter-waiting src/till-app-boot-and-counter.test.ts` plus any suite you
changed, `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/till typecheck`,
`pnpm format:check`, `pnpm lint`. Prove each new check by deleting the code it guards and watching
it fail.
