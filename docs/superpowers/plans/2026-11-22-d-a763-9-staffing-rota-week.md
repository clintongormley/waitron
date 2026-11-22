# A763-9 implementation plan · Lane D

Watcher queued this on 2026-11-22 at 04:29. Owner wording in `docs/backlog/workforce.md`:

> **Staffing month: the Monday "Rota for this week" link goes**
> (board 6; today the `rota-week` button in
> `staffing-month.ts`), so Monday's box is the same height as the others. The day box already
> offers "Rota for this week" on every day (A720 Part 5); it is still to state where that week's
> rota stands. The Rota tab opens the week of the day last picked in the month, else the current
> week.

`gh pr list --state all --search 'A724 in:title'` returned only merged #1782. Open PR and issue searches for A724 returned none. The former A724 point 3 asked for the shared day box and its special-day and standard-week painter links. #1806 delivered those and removed the entry. #3855 added roles and hours. Both are on main. The plan branch removes the stale dependency wording from the two live backlog files. The old spec keeps its dated history.

## Build

1. **Read the week phase.** In `packages/staffing/src/{month,staffing-types}.ts`, add a sparse `weekStatus` map keyed by Monday from the existing selected roster versions. Draft already wins over published. The month route already shares unfilled counts with venue viewers. Add only the phase there and show the status in the UI where the Rota action is offered.
2. **Show that week's status.** In `packages/staffing/src/dashboard/staffing-month.ts`, remove the Monday grid button and styles. Reuse the month's unfilled counts for all seven dates, including dates outside the month, filtered by Show. Use `strings.ts` for the localized week line, reusing Draft, Published and unfilled. Match the Rota bar's Draft when no version exists, omitting the count then. Display the line through an optional `detailLine` on `packages/venue-service/src/dashboard/calendar-day-box.ts` after the details or Closed message. Keep the painter actions, focus, and live month subscription. The Rota action opens the selected area, or Everyone when viewing All areas, so its counts agree with the box.
3. **Choose the week on the tab.** In `packages/dashboard-kit/src/contract.ts` and `packages/venue-service/src/dashboard/opening-hours-screen.ts`, give views an optional `carryMonthOnTab` with the existing default and expose the venue business date as `host.today` after the opening-hours read settles. Use the browser date if the settled read cannot give a venue date. In `packages/staffing/src/dashboard/index.ts`, opt Rota out of month carry so a tab click defaults to the last picked date or current week. Keep direct month-only addresses and valid explicit Monday addresses working. Keep the last Staffing pick in a `WeakMap` keyed by the shared Calendar context, recording only day-button activation. The Rota title still links to its month. A tab switch without a month address returns to the usual default month. No new routes, queries, storage or off-screen reads.

## Test first

- Staffing `src/month.test.ts` and `src/routes.test.ts`, names matching **week status**. Observe the missing phase map first. Cover absent, published and draft over published across the month edge, plus viewer response and existing Rota denial. Keep the table-read limit.
- Staffing `src/dashboard/staffing-month.test.ts`, names matching **weekly rota** or **day heights**. Observe the missing week line and the extra Monday button first. Use `src/testing/staffing-month-fixture.ts`. Check whole-week counts versus a day's counts, area versus Everyone, closed day, live read and viewer display. Replace the three old link-only cases while retaining the 2 unfilled cell assertion, action order, close and focus checks.
- Staffing `src/dashboard/index.test.ts` and venue-service `src/dashboard/opening-hours-screen.test.ts`, names matching **Rota tab** or **venue business date**. Exercise the two Staffing views with a shared context and the real Calendar's switch with its existing stub views. Observe the absent pick and venue date first. Pin mouse and keyboard activation, focus and month movement without a pick, pending hours across the Sunday to Monday cutover, direct addresses and the default carry for other views.

Run the named files with `pnpm --filter @waitron/<package> exec vitest run <paths> -t <case>` red then green. Rerun the full changed files and the shared day-box suite. Look at 390 and 1280 px in both languages and themes. Update English and Spanish `apps/server/src/guide/{en,es}/opening-hours.md` at `#seasons`, `docs/developers/{design-system,conventions-ui}.md`, and run `apps/server/src/guide-content.test.ts`. On delivery remove the completed backlog entry and add a dated pointer to the A585 spec. Estimate 90–125 production and 150–220 test and fixture lines changed, plus docs. Deliver one signed-off PR after watcher clearance.
