# A763-9 implementation plan · Lane D

Watcher queued this on 2026-11-22 at 04:29. Owner wording in `docs/backlog/workforce.md`:

> **Staffing month: the Monday "Rota for this week" link goes**
> (board 6; today the `rota-week` button in
> `staffing-month.ts`), so Monday's box is the same height as the others. The day box already
> offers "Rota for this week" on every day (A720 Part 5); it is still to state where that week's
> rota stands. The Rota tab opens the week of the day last picked in the month, else the current
> week.

`gh pr list --state all --search 'A724 in:title'` returned only merged #1782. Open PR and issue searches for A724 returned none. The former A724 point 3 asked for the shared day box and its special-day and standard-week painter links. #1806 delivered those and removed the entry. #3855 added roles and hours. Both are on main. The plan branch removes the stale dependency wording from the two live backlog files. The old spec keeps its dated history.

Claude reviewed the plan at `f7c8b0d630`. The watcher cleared it at 06:55 on 2026-11-22 with four changes, recorded in Lane D's questions.md. The 07:02 note asked for this update before the first test.

## PR 1 · Read the week’s phase from the day box

- In `packages/staffing/src/{month,staffing-types}.ts`, expose a sparse `weekStatus` map keyed by Monday. Reuse the roster versions selected for the day counts. The existing month route supplies the phase to venue viewers with those counts.
- In `packages/staffing/src/dashboard/{staffing-month,strings}.ts`, remove the Monday grid button and its styles. Use the existing Draft and Published labels in a translated week line, with Draft for a week without a version, matching the Rota bar. Show it where the existing Rota action is available. Keep each area’s daily counts and the existing Rota destination, including All areas.
- Add an optional `detailLine` in `packages/venue-service/src/dashboard/calendar-day-box.ts` after the rows or Closed message. Keep painter actions, focus, and the live month subscription.
- Test first. In `src/month.test.ts`, check a rota whose Monday is in the previous month and omit weeks without a rota. In `src/routes.test.ts`, extend the existing venue viewer case to read the phase. In `src/dashboard/staffing-month.test.ts`, replace the Monday-link cases with the day-box phase and equal day heights. Keep the 2 unfilled assertion and the existing day-box action and focus tests. Set the default phase map in `src/testing/staffing-month-fixture.ts`.
- Update the English and Spanish `apps/server/src/guide/{en,es}/opening-hours.md` at `#seasons` and the day-box description in `docs/developers/design-system.md`. Leave the Rota tab work in the backlog. Estimate 20–35 added production lines and 20–35 removed, and 35–65 added test and fixture lines and 45–60 removed, plus docs.

## PR 2 · Open the Rota tab on the last picked week

- In `packages/dashboard-kit/src/contract.ts` and `packages/venue-service/src/dashboard/opening-hours-screen.ts`, give views an optional `carryMonthOnTab` with the existing default. Add optional `host.today`, empty while opening hours load, then set it to the venue business date or the browser date if a settled read cannot give one.
- In `packages/staffing/src/dashboard/{index,staffing-month}.ts`, opt Rota out of month carry. Keep the last Staffing pick in a `WeakMap` keyed by the shared Calendar context. Only day-button activation records a pick. A tab click uses the pick or the current week. Preserve direct month-only and explicit Monday addresses and the Rota title link.
- Test first. In `packages/staffing/src/dashboard/index.test.ts`, exercise the two Staffing views with a shared context and verify moving focus or changing month records no pick. In `packages/venue-service/src/dashboard/opening-hours-screen.test.ts`, check the opt-out and default carry and the venue business date after a pending read across the Sunday-to-Monday change.
- Update `docs/developers/conventions-ui.md` and the guide text for the Rota tab. Remove the remaining backlog entry on delivery and add a dated pointer to the A585 spec. Estimate 35–55 added production lines and 0–10 removed, and 50–85 added test lines and 0–10 removed, plus docs.

For each PR, run the named cases red then green with `pnpm --filter @waitron/<package> exec vitest run <paths> -t <case>`, then rerun the full changed files. For PR 1 also run the shared day-box suite. Inspect both languages and themes at 390 and 1280 px. Run `apps/server/src/guide-content.test.ts` for guide edits. Finish and land each signed-off PR separately.
