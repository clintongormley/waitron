# A565, A566 and A860 floor reset waits

After a reset, staff can still find an ordinary table with food on its way at the
same place. A split group also waits for an open delivery order at a member, even
before anything goes to the kitchen. When the hold clears, the existing catch-up
applies the reset or asks staff to mark a physical move. This is the Lane H queue
ask assigned by the watcher on 21 November at 20:43 after A594. Build awaits the
watcher's clearance of that scope. Claude reviewed the plan and the watcher
cleared the two holds as described here on 21 November at 22:43.

- [ ] **Ordinary tables.** In `apps/server/src/floor-today-store.test.ts`, use a paid
  Paella delivery and reset a table whose saved place changes or disappears. Check
  that its place and order link survive and its reset row stays pending. Collect
  the order and check that catch-up marks the move or removes the table. Food at
  one member also holds today's merge together. Extend the existing saved-group
  food case for a plain table becoming a member if its assertions need it.
- [ ] **Split groups.** In the same suite, use `longTable` and `delivery(tableId, false)`.
  Check the order is open with no kitchen ticket, the split geometry and link
  survive reset, and abandoning it allows catch-up and Mark moved to reform the
  group. Use `department-transfer-api.test.ts`'s receiving desk fixture for a real
  acceptance onto a member after the group is marked. Check Mark moved refuses
  with that member's id and preserves the marked group.
- [ ] Watch the two reset cases and the refusal case fail before changing code.
  Reuse the batched delivery lookup in `delivery-release.ts` and `catchUpPass`
  (`floor-today-store.ts`). Match `foodOnItsWay()` for the zone, or
  `status = 'open'` at a member of a pending saved group. Feed that set through
  `waitingTogether` and remove its separate food argument. A delivery hold in
  `floor-reset-plan.ts` leaves the row pending and keeps an off-floor table off.
  Keep the existing removal rule for unpaid orders. Update its test fixture in
  `floor-reset-plan.test.ts`. Like a seated party, these waits can leave a zone
  eligible for a catch-up read while the hold lasts.
- [ ] In `floor-today-mark-moved.ts`, reuse the open-order lookup for actual members of
  pending saved groups reached by the action, including a member already placed.
  After the existing food, party, clearing and module refusals, report
  `table.open_delivery_order` before the generic needs-moving answer. Register it
  in server `errors.ts` and the `till-api.ts` status map, and in till
  `till-app.ts` and `i18n/codes.ts` with EN/ES wording to finish the open order first.
- [ ] **Automatic placement.** In `apps/server/src/floor-catch-up.test.ts`, assert
  `catchUpDue` before the floor read and map and pending rows after it. Pair
  existing taken-off and saved-position cases with a sole Needs moving blocker
  (`sixBehindEight`, move 8 away) and a pending sibling overlapping its moving
  saved-group member before marking. Confirm the expected failure when deleting
  each exclusion in a disposable copy. Record each deletion and assertion in the
  build receipt. Keep the geometry tests and the existing manual overlap rules.
- [ ] Run the four floor suites, the transfer suite, error-code guards, and unchanged
  fiscal and published-menu gates. Update `conventions-data.md`, both table-service
  guides and the backlog, and add a dated pointer to the A803 plan.

Expected size is about 55 production lines and 150 test lines added, plus docs.
