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
5. **After the answer** (moved or refused) the till reads the station card and then the waiting
   list again, as a hand-over does, but with refresh messages of its own (`refresh.*_after_hand_over`
   describes a hand-over; add `refresh.station_after_move` and `refresh.waiting_after_move`, or reuse
   a generic `refresh.*` key if one exists).
6. **Refusals.** The move is all or nothing: one started dish refuses the whole request
   (`ticket.already_started`, `station-move.ts`). The table's refusal strings speak of "this dish",
   which would read as if the others moved. Add whole-order wordings, EN and ES, for every refusal
   code the route can answer whose existing string names a single dish (at least
   `ticket.already_started`; check `move_station.refused.*` one by one). After a refusal the list is
   read again: when the row is still there with dishes that can move, the dialog stays open showing
   the refusal; when it is gone or has nothing left to move, the dialog closes and the refusal shows
   in the till's message line.
7. **Button**: `wt-button` `variant="secondary"`, `data-waiting-move-station`, text and aria-label
   from `table.move_station` ("Move to station…" / "Cambiar de estación…") plus the row's scope in the
   aria-label. **Drawn only when the device's profile allows `take-orders`** (the route requires it;
   the held-orders card asks for no capability, `apps/till/src/card-contract.ts`): pass it down the
   way the card grid passes other capabilities, and test both cases. If Hand over is already gated on
   its own action, follow the same pattern.
8. **The till keeps a third kind of move.** `movingStation` today holds one `lineId` and a `counter`
   flag, checks `#orderVisit`, and reloads the table's lines after a non-counter move. Add a third
   kind (for example `kind: "table" | "counter" | "waiting"`), checked against the operator's session
   and the opening token only. When a station is chosen, the line ids are taken from the CURRENT
   `counterWaiting` row, not from the moment the dialog opened; if the row is gone or has nothing to
   move, the dialog closes without sending. Table and counter-basket moves keep their behaviour.
9. **At most 100 dishes per request** (the route refuses more, `till-api.ts`). The till sends the
   first 100 by the order the server lists them; any left over are still listed after the re-read, so
   a second press moves them. Tested with 101.
10. **Extras with a kitchen record of their own stay where they are** when their dish moves: that is
   today's route behaviour (`station-move.test.ts`, "moves a dish without moving its split-off chips
   at another station") and the table screen's too. Not a defect of this item.

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
   once with the order id and every movable line id taken from the list as it is at that moment; the
   station card and the waiting list are read again afterwards; a refusal whose row still has
   dishes keeps the dialog open with the whole-order wording; a refusal whose row has gone closes it
   and shows the message line; a row that vanished before the choice sends nothing; 101 movable
   dishes send 100; a profile without `take-orders` draws no button; a session change while the
   stations load opens nothing.
   Keep the table and counter-basket move paths unchanged (their existing tests must pass
   unedited).
5. **Look.** Mount the waiting list (or the counter screen) with a paid row carrying a movable dish
   and screenshot it in EN and ES, light and dark, at 1280 and 390 px wide, plus the open dialog;
   save to `~/waitron-campaign-b/a438-shots/`. Open the shots and check the button fits beside Hand
   over at phone width.
6. **Backlog.** Delete the entry "Move to station on a paid counter order" from `docs/backlog.md`.

Checks to run: `pnpm --filter @waitron/server exec vitest run src/counter-handover.test.ts
src/station-move.test.ts src/till-api.station-move.test.ts`, `pnpm --filter @waitron/till exec
vitest run src/widgets/counter-waiting src/widgets/card-grid src/till-app-boot-and-counter.test.ts
src/till-app-table-service.test.ts src/till-app-counter-adjustments.test.ts src/api/client.test.ts
src/i18n` plus any suite you changed (fixtures that build a waiting row live at least in
`till-app.test.ts`, `till-app-counter-cancel-credit.test.ts`, `api/client.test.ts`, `card-grid.test.ts`,
`till-app.a11y.test.ts` and the `counter-waiting` tests), `pnpm --filter @waitron/server typecheck`, `pnpm --filter @waitron/till typecheck`,
`pnpm format:check`, `pnpm lint`. Prove each new check by deleting the code it guards and watching
it fail.
