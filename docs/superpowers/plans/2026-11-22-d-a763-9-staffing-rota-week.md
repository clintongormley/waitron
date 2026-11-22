# A763-9 implementation plan · Lane D

Watcher queued this for planning on 2026-11-22 at 04:29. Owner wording in `docs/backlog/workforce.md`:

> **Staffing month: the Monday "Rota for this week" link goes**
> (board 6; today the `rota-week` button in
> `staffing-month.ts`), so Monday's box is the same height as the others. The day box already
> offers "Rota for this week" on every day (A720 Part 5); it is still to state where that week's
> rota stands. The Rota tab opens the week of the day last picked in the month, else the current
> week.

The driver found no separately open A724 Part 2. A724 #1782 delivered the guide bands. A720 Part 5 #1806 retired A724’s day-box entry and shipped the shared box and links. #3855 added role and hour details. Both day-box changes are on the branch base.

## Implementation

1. **Reuse the month read.** In `packages/staffing/src/month.ts` and `staffing-types.ts`, add a sparse `weekStatus` map keyed by Monday from the existing `readRotaRows().selected`. A working draft takes precedence over its published predecessor. Expose only the phase through the existing `venue.view` month route, which already returns roster-derived counts. Full Rota data and actions retain `schedule.manage`. Reuse the passive `watchMonth` subscription, which already watches roster versions and shifts.
2. **Put the status in the day box.** In `packages/staffing/src/dashboard/staffing-month.ts`, remove the Monday button and its styles. Sum the seven displayed dates’ existing unfilled counts for the selected area or All areas, including dates outside the month. Show zero for a stored version and show Draft without a count when no version exists. In `strings.ts`, reuse the localized Draft, Published and unfilled wording within a localized Rota line. Add one optional `detailLine` string to `packages/venue-service/src/dashboard/calendar-day-box.ts`, using its existing line style after the details or Closed message and before the actions. Keep the daily counts, painter and Rota actions, popover close sequence and return focus.
3. **Remember explicit picks.** Add `today` to the generic `CalendarViewHost` in `packages/dashboard-kit/src/contract.ts`. In `packages/venue-service/src/dashboard/opening-hours-screen.ts`, derive it with the existing venue business-date and browser fallback used by `moduleMonth`. Both views get the same Calendar context. In `packages/staffing/src/dashboard/index.ts`, key the last Staffing pick to that context in a `WeakMap` so rerendering or changing tabs keeps it and a new context starts fresh. Pass a callback to `staffing-month.ts` and record only activation of a day button. Rota uses a valid explicit Monday, then the picked date's Monday, then today's Monday via the existing `calendar-grid.ts` helper. Keep area parameters and both existing links. No new routes, queries, storage or background reads.

## Failing-first checks

- `pnpm --filter @waitron/staffing exec vitest run src/month.test.ts src/routes.test.ts -t 'week status'` — the phase map is absent. Cover no version, published and draft over published, including a month-edge week. Retain the single-read assertion and prove a venue viewer gets the phase while full Rota returns 403.
- `pnpm --filter @waitron/staffing exec vitest run src/dashboard/staffing-month.test.ts -t 'weekly rota|cell heights'` — the status line is absent and Monday still has its extra button. Update `src/testing/staffing-month-fixture.ts` in that package. Check localized status between details and actions, whole-week versus daily totals, area filtering, zero, Draft without a count, live refresh and Closed. Replace the Monday-link assertion with checks for one day button per cell and equal heights in the same row. Retain action order, Escape and focus tests.
- `pnpm --filter @waitron/staffing exec vitest run src/dashboard/index.test.ts -t 'real Calendar'` — the actual radio switch loads the month’s first week. Mount both contributions through the real Calendar. Check the venue’s Sunday business date before Monday cutover, mouse and keyboard picks across tab switches, focus and month stepping without a pick, and explicit Monday and area precedence. Confirm the Rota read starts only when opened.

## Finish

Rerun the focused suites green, including `packages/venue-service/src/dashboard/calendar-day-box.test.ts` and `opening-hours-screen.test.ts`. LOOK in Chromium at 390 and 1280 px in English and Spanish, both light and dark. Update `apps/server/src/guide/en/opening-hours.md` and `apps/server/src/guide/es/opening-hours.md` at `#seasons`, run `apps/server/src/guide-content.test.ts`, and update `docs/developers/design-system.md`. Delete the delivered point and its bundle from `docs/backlog/workforce.md` and the stale wait entry from `docs/backlog.md`. Add a dated pointer above the preserved history in `docs/superpowers/specs/2026-10-13-a585-staffing-and-rota-design.md`.

Estimate **80–110 production lines** and **150–220 test and fixture lines** changed, plus documentation. After Claude review and watcher clearance, deliver one signed-off PR with current-head CI green, then land it.
