# Paper kitchen dark alert — implementation plan

**Status:** design only; Claude plan review and watcher clearance pending. No owner design approval claimed. Execute inline only after clearance.

**Request:** Lane H queue, `PAPER-KITCHEN-DARK-ALERT` (2026-11-16): distinguish paper service from a failed station screen without hiding unprinted waiting dishes. Smallest usable result: suppress the station dark-screen warning only when every otherwise qualifying waiting dish has qualifying printed paper.

## Proposed signal and traced evidence

For each waiting `ticketItems` row, require a `printJobs` document with `status = 'done'`, linked through `kitchenPrintJobLines` to its `workingOrderLineId` and through `kitchenPrintJobs` to its current order and station, with **`printJobs.createdAt > ticketItems.firedAt`**. A station still warns if any waiting dish lacks that evidence; one printed dish cannot cover its neighbour.

`apps/server/src/kitchen-print.ts:768–829,874–926` builds route-specific line/station links; “rest of order” text does not add line links. `working-order.ts:2530–2605,2883–2973` stamps/releases items before enqueueing. `order-groups.ts:2407–2453` also enqueues linked HOLD paper before firing. Therefore use job creation, never delivery time or link insertion order, to reject earlier paper, even if delivered later. Reprints enqueue fresh linked jobs (`kitchen-print.ts:2462–2598`); transferred links preserve their dates (`:2838–2946`).

The strict comparison deliberately retains the warning on equal timestamps: millisecond timestamps alone cannot establish which came first. A later completed reprint qualifies. `packages/printing/src/runtime.ts:197–247` records `done` after a successful transport outcome; this is delivery evidence, not proof staff read paper. Queued/printing/failed jobs do not qualify. Printers-screen resends have no kitchen links (`packages/printing/src/outbox.ts:108–146`); do not broaden this first signal to them through `printedOrResent`.

## One implementation task, test first

- [ ] **Database behavior:** extend `apps/server/src/station-outputs-down.test.ts`, reusing its `useVenueDb`, `setup`, `waitingItem`, `stationScreenDevice`, `job` and `darkScreenAlertKeys`. Let `job` return its inserted id for link fixtures. First reproduce the false warning: a dark screen and waiting dish with qualifying completed paper must yield no dark row/key. Watch that assertion fail before production changes.
- [ ] Add cases retaining the warning with no printer and with linked queued/printing/failed jobs; unrelated completed receipt, wrong-station ticket, and a printed first dish beside an unprinted second dish must not suppress it. Old linked HOLD/earlier paper must not qualify even when delivered after firing; equality must retain the warning, a later completed linked ticket must clear it. Assert `stationsWithWaitingDishes` still includes printed waiting work.
- [ ] **Production:** change only `apps/server/src/station-outputs-down.ts`. Add an optional fourth `waitingDishesQuery` option `{ withoutPrintedPaper?: boolean }`, default false, applying a per-item `NOT EXISTS` for the signal above. Only `stationScreensDark` opts in. Keep the three-minute/hour windows, `kitchenWork()` and all existing behavioral assertions.
- [ ] **Integration/regression:** assert the alert-source key disappears for qualifying paper while the closed station's printer error remains. Run `pnpm --filter @waitron/server exec vitest run src/station-outputs-down.test.ts src/kitchen-print.shared-printers.test.ts`; require reported passing test counts. Existing cases own sightings, other waiting conditions, printer-down and pass/monitor behavior; add no duplicate suites or planner claims.

## Boundaries, size and clearance

`stationsWithWaitingDishes` also gates closed-station printer alerts (`apps/server/src/alert-sources.ts:746–763`). Printer reads also serve `device-api.ts:615` and `till-api.ts:2296`; preserve them. `passScreensDark` feeds its separate source; `boot.ts:3883–3886` registers both sources. No schema, records, clock service, cache, framework, concurrency or renderer changes.

Expected production **+30–50/−2–5 lines**; tests **+110–170/−0–3**. On completion delete the dark-screen entry from `docs/backlog/kitchen.md` and its `docs/backlog.md` index. No EN/ES guide addition planned: the kitchen-service, printers and till-notices instructions do not describe this warning's gating; change both languages only if implementation makes an existing instruction wrong.

**Watcher decision requested after Claude review:** clear this per-dish, linked completed-document signal, including conservative timestamp equality and direct linked jobs only. Record the watcher's decision before building; any different signal returns for review.
