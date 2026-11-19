# Staffing month day box implementation plan

Lane D, DASH-STAFFING-DAY-BOX. Assignment: `~/waitron-campaign-d/questions.md`, WATCHER 2026-11-19 21:24. Verbatim ask in that lane's `queue.md`:

> the Staffing month's day box lists each area's number of staff only; the A720 mockup shows each role and its times ("Head chef ×1 16:00–01:30"), which needs the month read to carry each block. Backlog: `docs/backlog/workforce.md` → "Staffing's day box: each area's staff roles and times"; Decision 13 of `docs/superpowers/plans/2026-10-15-a720-calendar-year-month.md`.

Deliver each visible area's roles, headcounts and times. The queue references A720's mockup without fresh owner design approval. Exclude A763 point 9 and A644/A708.

## Carry the existing resolved blocks

In `packages/staffing/src/staffing-types.ts`, add required `blocks` to `StaffingMonthArea`, with `staffRoleName`, `headcount`, `startsAt` and `endsAt` on each entry. In `packages/staffing/src/month.ts`, carry the existing `resolveStaffing` blocks. Read role ids and names in one `staff_roles` select and use the ids to look up names in memory. Preserve block order and `HH:MM` times. Reuse the resolver's per-area special-day replacement, including empty paint and seasonal fallback. Keep `needed`, `unfilled`, closures and whole-week dates. Use the existing `routes.ts` endpoint and storage.

## Show the blocks through the shared box

In `packages/staffing/src/dashboard/staffing-month.ts`, retain blocks through `#shown`, sharing the cell's area filter. Keep the compact `calendar-day-box` and its description-list rows. Append ` · Head chef ×1 16:00–01:30` for each block to the area's count text. Reuse the painter's block formatting through one exported helper in `packages/staffing/src/dashboard/format.ts`, used by `staffing-grid.ts` and the month. Keep the painter's spoken wording, such as “Head chef, 1 person, 16:00–01:30”. Use no-break spaces in each month block and a word joiner after the dash. In `packages/venue-service/src/dashboard/calendar-day-box.ts`, let a row carry optional spoken text and draw it with the existing visually hidden style beside the visible text marked aria-hidden. A720 board 10 shows the details inline (`git show 3ef533f4fe^:docs/backlog/mockups/a718-a727-calendar-and-stations/10-staffing-month.png`). Empty paint shows zero and a closure shows Closed.

Preserve cell bars, labels, actions, rota links and keyboard handling. Reuse `StaffingApi.watchMonth` in `dashboard/client.ts`, its `QueryController` and passive snapshots. `dashboard/live-queries.ts` already watches roles and paint. Refresh open box rows through this path.

## Implement with focused behavioral tests

Paths below are under `packages/staffing/src/`. Add **“carries resolved blocks and role names in the month”** to `month.test.ts`, using two roles with distinct time spans in `painted()`. Assert both role names, partial special-day replacement, empty paint and stored overnight endpoints. Run `pnpm --filter @waitron/staffing exec vitest run src/month.test.ts -t 'carries resolved blocks'` before production edits and observe the absent blocks fail. Implement and rerun. Preserve count and single-table-read assertions.

Give `testing/staffing-month-fixture.ts` multiple named roles matching existing totals. Extend `routes.test.ts`'s **“reads a month's slot counts to a viewer”** to pin the viewer's response. Update exact month-area expectations in `month.test.ts` and `rota.test.ts`, retaining count assertions.

In `dashboard/staffing-month.test.ts`, extend **“the box names the season it follows and each shown area's number”** and **“the box rows carry each area's unfilled count”**. See the role assertions fail first, then assert the rendered text for multiple or repeated roles, overnight ranges and the selected area. Preserve the count, Closed and navigation assertions. Fill hand-built areas with matching blocks. In the existing 390 px bounds test, measure that a long row wraps between blocks and each block sits on one line. Assert that Staffing passes the spoken wording. In `packages/venue-service/src/dashboard/calendar-day-box.test.ts`, test the visible and spoken rendering once. Use the fixture in `dashboard/staffing-month.a11y.test.ts` for populated writer and viewer boxes. Run those files and inspect wrapping at 390 and 1280 px in English and Spanish and both themes.

Update the `#seasons` section of `apps/server/src/guide/en/opening-hours.md` and its `es/` twin, and the Staffing description in `docs/developers/design-system.md`. Run `apps/server/src/guide-content.test.ts`. Delete the shipped point and bundle bullet in `docs/backlog/workforce.md` and correct the count there and in `docs/backlog.md`. Retain A763. Add a dated pointer to the A720 decision in `docs/backlog/service-periods.md`.

Estimate **50–80 production lines** and **105–170 test and fixture lines**, plus short documentation edits, in one PR.
