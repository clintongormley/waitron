# A565, A566 and A860 floor reset waits

After a reset, staff can still find an ordinary table with food on its way at the
same place. Members of a split group keep their places while a member has an open
delivery order, even before anything goes to the kitchen. Once the reason clears,
the existing catch-up completes the reset or asks staff to mark a physical move.
The Lane H watcher assigned these outcomes on 21 November at 20:43, after A594.

- [ ] **Ordinary tables.** In `apps/server/src/floor-today-store.test.ts`, use a paid
  Paella delivery and reset a table whose saved place changes or disappears. Assert
  that its current place and order link survive and its reset row stays pending.
  Collect the order and run catch-up. A new place is marked for moving and a removed
  table goes away. Watch the layout and pending assertions fail on main's code.
  Then expand the existing batched `foodComingTo` read in `catchUpPass` to zone tables
  and feed its result into waiting for both live rows and groups. In
  `floor-reset-plan.ts`, give the food hold its own flag so it keeps the row pending
  without seeding an off-floor table. Keep `tablesTied` for removals after a hold ends.
- [ ] **Split groups.** Extend the same suite's `longTable` and `delivery(tableId, false)`
  fixture. Assert the order is open with no kitchen ticket, keep the split geometry
  and order link through reset, then abandon the order and check catch-up and the
  final group after Mark moved. Watch the old reset reform the group too early.
  In `delivery-release.ts` and `floor-today-store.ts`, batch the open delivery order
  check by pending saved-group member and add it to `waitingTogether` alongside the
  existing holds. Department transfer acceptance can assign such an order even
  after a table was marked for moving
  (`packages/venue-service/src/department-transfers.ts`, `acceptDepartmentTransfer`).
  Extend the existing Mark moved refusal test and `floor-today-mark-moved.ts` to
  report that member using the same open-order check. Add `table.open_delivery_order`
  to server errors, till status mapping and English and Spanish till messages. Staff
  can finish the open order before marking the tables moved.
- [ ] **Automatic placement.** In `apps/server/src/floor-catch-up.test.ts`, pair the
  SQL `catchUpDue` result with the resulting map and pending rows. Use the existing
  taken-off, Needs moving and saved-position controls, and add an off-map pending
  member whose new place overlaps a moving member of the same saved group.
  Confirm each relevant exclusion with a failing deletion control in a disposable
  checkout. Keep the existing `reset-row-moves.test.ts` geometry checks. Leave the
  SQL as a conservative preview and extend it only if a placement check shows it
  can miss progress. Manual placement keeps its existing overlap rules.
- [ ] Run the three floor suites above, the error-code guards and the lane's unchanged
  fiscal and published-menu gates. Update the floor rules in `conventions-data.md`
  and both table-service guides, remove the closed backlog bundle and add a dated
  pointer to the A803 plan.

Expected size is about 45 production lines and 110 test lines added, plus docs.
