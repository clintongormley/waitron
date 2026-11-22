# A474 floor drop follow-ups

**Finish line.** When you move two tables before the first answer arrives, both stay drawn where you dropped them while their changes are being saved. When a drop would seat guests at a table that needs clearing or moving, the till shows what to do before trying again. Source is the watcher's 2026-11-22 07:02 Lane H assignment and the A474 entry in [the till backlog](../../backlog/till.md#a474--todays-floor-changes-on-the-till-follow-ups).

## Keep each drop visible

- [ ] In `apps/till/src/screens/till-floor-screen.today.test.ts`, hold two move answers with promise gates. Drop two tables in the same room and check both drawn positions while the first answer is held. Resolve the first and assert that the second sends the new room revision. Apply the first move's fresh floor read while the second is pending, then refuse the second and check that only its table returns to the saved place. Run the test before changing the screen.
- [ ] In `apps/till/src/screens/till-floor-screen.ts`, keep the placements from `pendingPlaces` for each submitted drop and draw them together. Give the unsent merge or join preview its own lifetime. Cancel or retire only that preview. A refused write drops its own preview, and a successful write keeps its preview until an updated floor read replaces it. Reuse the screen's per-room write turns and carried revisions for consecutive direct moves. Preserve the room revision captured when a drop opens a seats prompt so that confirming it still checks the floor the person saw. Use the existing floor context when retiring views and reporting answers.

## Check which tables can take guests

- [ ] In `apps/till/src/screens/till-floor-screen.today-joins.test.ts`, exercise a fixed-table drop onto a table needing clearing and a seated party dropped onto a free table needing moving. Assert the reason shows and the till neither opens a seats prompt nor sends a join in the refused path. Keep the existing successful drop cases as controls. The same drop path handles a pick from **Join with…**.
- [ ] In the screen and `apps/till/src/state/floor-today.ts`, use the tables named by `dropAction` to check where a drop would seat guests. For a seat, check the dragged table and every table it would add. For a join that adds a free table, check that table and the other members it brings. Reuse the existing service-mode, clearing and needs-moving checks and wording. Keep free-table layout merges available as layout changes.
- [ ] In `apps/server/src/till-api.today-joins.test.ts`, pin the /join refusal for a target needing clearing or moving, using the existing fixed-clock venue fixture. Check the named error and that the party's tables and revision stay as they were. The existing `floor-today-seat-api.test.ts` case covers rolling back a seat when its added table needs clearing.

Run the changed test files and the neighbouring seat and Join with suites. Keep the unchanged fiscal and menu refresh checks named in Lane H's queue. Update both `apps/server/src/guide/{en,es}/table-service.md` under `#join-tables` with what to do when a table cannot take guests. Remove the two finished bullets from `docs/backlog/till.md`. The saved-place refusal, visual redesign, pointer-move performance and test setup follow-up remain in A474.

Estimate 130–200 production lines, 240–350 test lines and small guide and backlog edits.
