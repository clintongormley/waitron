# A877 business-day changes implementation plan

The Business day card, start planner, opening-hours checks and configuration export use one rule
for which dated starts have taken effect. A start belongs to the new business day at its exact
changeover. Staff keep the same controls, refusals and display. The scope comes from Lane F's
A877-ONE-HELPER item and [the A877 backlog entry](../../backlog/service-periods.md#loose-ends-left-by-a788).

## Shared rule

- Write a failing case in `packages/shared/src/business-day-clock.test.ts` named “splits dated starts
  at their actual changeover”. In Madrid, a 05:00 start moves to 03:00 on November 4, 2026, then
  to 07:00 on November 5. Through `businessDayAt`, assert both changes are waiting at
  01:59:59.999 UTC on November 4, only the second is waiting at 02:00:00.000 UTC, and neither is
  waiting at 06:00:00.000 UTC on November 5. Assert that the settled list contains the rest in order.
- Run `pnpm --filter @waitron/shared exec vitest run src/business-day-clock.test.ts` and see the
  missing helper fail. Add `splitBusinessDayChanges(clock: BusinessDayClock, currentBusinessDay:
  string): { settled: CutoverChange[]; waiting: CutoverChange[] }` beside `businessDayAt` in
  `packages/shared/src/business-day-clock.ts`, and export it from `src/index.ts`. Split the clock's
  ordered changes after the last effective date at or before the supplied business day. The caller
  supplies the day already resolved by the clock. Re-run the shared test.

## Callers and checks

- In `apps/server/src/business-day-{changeover,start}.ts` and
  `packages/venue-service/src/business-day-schedule.ts`, use the shared split with the existing
  `businessDayAt` result. Keep the planner's replace-or-keep rule, the status readers' unreadable
  clock response and the same `startsAt` from `businessDayBoundaryAt` for the first waiting change.
- In `packages/venue-service/src/service-day-context.ts`, use the split for `settledClock` and
  `inForceClock`, keeping the empty-change path for writers with an unreadable zone. Reuse the split
  in the waiting-hours check instead of recovering the waiting set from object identity. Keep its
  date order, first-conflict refusal and existing writer checks.
- In `apps/dashboard/src/screens/business-day-start-editor.ts`, use the same split with the day
  supplied by the server, so the existing re-read can still refresh an old model. Use it for the
  waiting-change refusal in `packages/provisioning/src/configuration-transfer.ts` as well.
- Run the existing `business-day-changeover.test.ts`, `business-day-start.test.ts`,
  `business-day-schedule.test.ts`, `business-day-start-editor.test.ts` and
  `configuration-export-api.test.ts` in their owning packages with `exec vitest run src/<file>`.
  Keep the existing assertions for two waiting starts, start-at-boundary, a clash only on the second
  pending start, unreadable clocks and the editor's re-read of a stale model.

Update `docs/backlog/service-periods.md` and its `docs/backlog.md` index to remove the completed
split work. Keep A877's hours-write gate and repeated hours reads as the remaining writer work,
along with the bundle's other entries. Those are beyond the queue's one-helper finish line.
No schema, response shape or display changes. Expect about 55–85 added production lines and
25–40 added test lines, with duplicate checks deleted. Work test-first and commit with sign-off.
