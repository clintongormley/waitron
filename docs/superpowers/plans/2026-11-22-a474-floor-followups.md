# A474 floor drop follow-ups

**Finish line.** When you move two tables before the first answer arrives, both stay drawn where you dropped them while their changes are being saved. When a drop would seat guests at a table that needs clearing or moving, the till shows what to do before trying again. The watcher assigned this in Lane H's queue at 07:02 on 2026-11-22 from the A474 entry in [the till backlog](../../backlog/till.md#a474--todays-floor-changes-on-the-till-follow-ups).

## Keep each drop visible

- [ ] In `apps/till/src/screens/till-floor-screen.today.test.ts`, hold two move answers with promise gates. Drop two tables in one room and check both drawn positions while only the first request is sent. Resolve it and assert that the second sends the new room revision. Apply a floor read started after the first answer while the second is pending, then refuse the second. Only its table should return to the saved place. Run the test before editing the screen.
- [ ] In `apps/till/src/screens/till-floor-screen.ts`, keep the placements from `pendingPlaces` for each submitted drop and draw them together in drop order so the latest drop of a table wins. Retire only that drop's preview after refusal or after applying a floor read started after its success. Use the existing floor context to retire stale work. A refusal from another action leaves drop previews alone. Cancel unsent merge and join previews with their own prompt or preparation.
- [ ] Reuse the screen's per-room write turns and carried revisions for direct moves. Keep the room revision captured when a drop opens a seats prompt. If another move changes the room before the server checks the confirmed merge, the existing stale-floor refusal still applies.

## Check which tables can take guests

- [ ] In `apps/till/src/screens/till-floor-screen.today-joins.test.ts`, use a fixed-table drop onto a table needing clearing and a seated party dropped onto a free table needing moving. Assert the reason and that the till opens no seats prompt and sends no join. Use the existing successful drops as controls. Cover a blocked destination in the **Join with…** list in `till-floor-screen.sheet.test.ts` if its existing cases miss it.
- [ ] In the screen and `apps/till/src/state/floor-today.ts`, reuse the area's seating rule and check clearing and moving for the tables that would take guests. For a seat, keep the dragged table's existing checks first, then check each added table. For a join, check the free table and its group, whether the free table is the source or the destination of the drag. Share the check with `#joinTargets`, and use the existing refusal wording. Free-table layout merges remain available.
- [ ] In `apps/server/src/till-api.today-joins.test.ts`, use the fixed-clock fixture for one HTTP join with a merge whose added table needs clearing. Assert the error names that table and the room revision, party revision and table membership stay as they were. The existing `party-table-actions.test.ts` and `floor-today-seat-api.test.ts` cases cover the other server refusals.

Run the changed tests, the neighbouring seats and Join with suites, the unchanged fiscal `write-path.e2e.test.ts` and `inmutabilidad.test.ts`, Review Focus 1 and 2 in `till-api.sell-published.test.ts` and `till-app-menu-refresh.test.ts`. Update both `apps/server/src/guide/{en,es}/table-service.md` under `#join-tables` with the drag route alongside **Join with…** and how to choose an available table. Remove the two finished bullets from `docs/backlog/till.md`. A474 retains the saved-place refusal, visual redesign, pointer-move performance and test setup follow-ups.

Estimate 130–200 production lines, 240–350 test lines and small guide and backlog edits.
