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
  waiting at 06:00:00.000 UTC on November 5. Assert the settled list in order and compare the
  split with `businessDayBoundaryAt` at those instants.
- Run `pnpm --filter @waitron/shared exec vitest run src/business-day-clock.test.ts` and see the
  missing helper fail. Add `splitBusinessDayChanges(clock: BusinessDayClock, currentBusinessDay:
  string): { settled: CutoverChange[]; waiting: CutoverChange[] }` beside `businessDayAt` in
  `packages/shared/src/business-day-clock.ts`, and export it from `src/index.ts`. Split the clock's
  ordered changes after the last effective date at or before the supplied business day. The caller
  supplies the day resolved by the clock. When boundaries increase, a change has taken effect
  if its date is at or before that day. The dated writer checks the affected day bounds in
  `firstTransitionDay`. Keep the existing handling of unreadable clocks. Re-run the shared test.

## Callers and checks

- In `apps/server/src/business-day-{changeover,start}.ts` and
  `packages/venue-service/src/business-day-schedule.ts`, use the shared split with the existing
  `businessDayAt` result. Keep the planner's replace-or-keep rule, the status readers' unreadable
  clock response and the same `startsAt` from `businessDayBoundaryAt` for the first waiting change.
- In `packages/venue-service/src/service-day-context.ts`, use the split for `settledClock` and
  `inForceClock`. Both return early with no changes, before doing any time-zone lookup, as does
  the waiting-hours check. Reuse the split
  in the waiting-hours check instead of recovering the waiting set from object identity. Keep its
  date order, first-conflict refusal and existing writer checks.
- In `apps/dashboard/src/screens/business-day-start-editor.ts`, use the same split with the day
  supplied by the server, so the existing re-read can still refresh an old model. With a null
  day, keep returning an empty list. Use the split for the
  waiting-change refusal in `packages/provisioning/src/configuration-transfer.ts` as well.
- Run the existing tests with `pnpm --filter @waitron/<package> exec vitest run <files>`.
  In server, use `src/business-day-{changeover,start}.test.ts` and `src/configuration-export-api.test.ts`.
  In dashboard, use `src/screens/business-day-start-editor.test.ts`. In venue-service, use
  `src/{business-day-schedule,special-days,menu-timetable,period-delete,seasons,season-weeks,zone-closed-times}.test.ts`.
  Keep the existing checks for a conflict on the second waiting start, writes with an unreadable
  zone, the editor's re-read of a stale model, and export refusing a waiting change.

## Scope for watcher clearance

This slice proposes the shared rule named in the queue title. Update `docs/backlog/service-periods.md`
and its `docs/backlog.md` index to reflect the completed helper. The write gate and repeated hours
reads stay with the remaining bundle work until the watcher settles scope. There are no schema,
display or response shape changes. Expect about +40/−40 production lines (roughly even) and
+25–40 test lines. Work test-first and commit with sign-off.
