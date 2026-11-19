# Staffing month day box implementation plan

Lane D, DASH-STAFFING-DAY-BOX. Assignment: `~/waitron-campaign-d/questions.md`, WATCHER 2026-11-19 21:24. Verbatim ask in that lane's `queue.md`:

> the Staffing month's day box lists each area's number of staff only; the A720 mockup shows each role and its times ("Head chef ×1 16:00–01:30"), which needs the month read to carry each block. Backlog: `docs/backlog/workforce.md` → "Staffing's day box: each area's staff roles and times"; Decision 13 of `docs/superpowers/plans/2026-10-15-a720-calendar-year-month.md`.

Deliver each visible area's roles, headcounts and times. The queue references A720's mockup without fresh owner design approval. Exclude A763 point 9 and A644/A708.

## Carry the existing resolved blocks

In `packages/staffing/src/staffing-types.ts`, add required `blocks` to `StaffingMonthArea`, with `staffRoleName`, `headcount`, `startsAt` and `endsAt` on each entry. In `packages/staffing/src/month.ts`, carry the existing `resolveStaffing` blocks. Read role ids and names in one `staff_roles` select and use the ids to look up names in memory. Preserve block order and `HH:MM` times. Reuse the resolver's per-area special-day replacement, including empty paint and seasonal fallback. Keep `needed`, `unfilled`, closures and whole-week dates. Use the existing `routes.ts` endpoint and storage.

## Show the blocks through the shared box

In `packages/staffing/src/dashboard/staffing-month.ts`, retain blocks through `#shown`, sharing the cell's area filter. Keep the compact `calendar-day-box` and each area's existing count text. Append ` · Head chef ×1 16:00–01:30` for each block in the area's row. A720 board 10 shows these details inline. Empty paint still shows zero and a closure still shows Closed.

Preserve cell bars, labels, actions, rota links and keyboard handling. Reuse `StaffingApi.watchMonth` in `dashboard/client.ts`, its `QueryController` and passive snapshots. `dashboard/live-queries.ts` already watches roles and paint. Refresh open box rows through this path.

## Implement with focused behavioral tests

Paths below are under `packages/staffing/src/`. First add **“carries resolved blocks and role names in the month”** to `month.test.ts` using its real-database `painted()` fixture. Run `pnpm --filter @waitron/staffing exec vitest run src/month.test.ts -t 'carries resolved blocks'`. Observe absent-`blocks` failure before production edits, then implement and rerun. Assert seasonal blocks, partial special-day replacement, empty paint and overnight endpoints. Preserve count and single-table-read assertions.

Give `testing/staffing-month-fixture.ts` multiple named roles matching existing totals. Extend `routes.test.ts`'s **“reads a month's slot counts to a viewer”** with blocks. Update exact `month.test.ts` and `rota.test.ts` expectations, retaining count assertions.

In `dashboard/staffing-month.test.ts`, observe **“shows each resolved role block under its filtered area”** fail before rendering changes. Assert rendered rows for multiple/repeated roles, overnight ranges, empty paint and Closed. Retain **“the box rows carry each area's unfilled count”**, cell and navigation assertions. Add **“refreshes open role rows through the passive month read”** for changed names, times and passive requests. Exercise populated writer/viewer boxes in `dashboard/staffing-month.a11y.test.ts`, both themes. Run these files and inspect long names at 390/1280 pixels after content arrives.

Update the `#seasons` section of `apps/server/src/guide/en/opening-hours.md` and its `es/` twin, and the Staffing description in `docs/developers/design-system.md`. Run `apps/server/src/guide-content.test.ts`. Delete the shipped point and bundle bullet in `docs/backlog/workforce.md`, correcting the count there and in `docs/backlog.md`. Retain A763.

Estimate **35–65 production lines** and **90–155 test and fixture lines**, plus short documentation edits, in one PR.
