# Draw special days from each date’s business-day start

In Opening hours, you can read and paint each selected date on its own time scale, even when the
business-day start changes between dates. The mixed-start notice goes away. The watcher queued
this as SPECIAL-DAY-OWN-START at 10:51 on 22 November 2026. See the
[service-periods backlog](../../backlog/service-periods.md#a-special-day-grid-uses-the-first-dates-changeover).

## One change

1. Start with a failing browser case in `packages/venue-service/src/dashboard/special-day-painter.paint.test.ts`.
   Replace the first-date notice assertion with a two-date case whose starts are 05:00 and 06:10.
   Check the ruler labels and the position of the same stored hours on both dates. Paint from the
   second date’s top to its 07:00 mark and check the saved endpoints are 06:10 and 07:00. Cover the
   second date’s zone overlay at its boundary and retain the shared-ruler check for equal starts.
   Run the new cases first with
   `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/special-day-painter.paint.test.ts`.
   The base’s one ruler and first-date stroke conversion must fail the new expectations.
2. In `special-day-painter.ts`, give each `PaintColumn` its start via the existing `dateCutover(date)`
   lookup, which uses the business-day clock while the season read is unavailable. Include starts
   in the column cache. Use each date’s start for zone paint, zone underlays and the two period
   replacement paths. Where `paint-model.ts` iterates by day in `savedBlocks` and `refill`, accept
   a date lookup alongside the existing single-start input. Key the zone paint cache by its source
   and the resolved starts. Remove the mixed-start message and its English and Spanish strings.
3. In `paint-grid.ts` and `paint-grid-parts.ts`, let a column supply an optional start, with the
   grid start as the default. Use the column’s start for block positions, hour lines, pointer
   snapping, preview, release and block menu edits. Reuse the existing hour-label markup for
   each column when starts differ, reserving room beside the blocks within their CSS grid tracks.
   Equal starts keep the pinned ruler. Pass the key to the existing `ColumnStroke` lookup so
   staffing’s single-start callback still works. Keep copied clock times by value and the
   existing server validation. Check a valid cross-date copy and how the editor handles ranges
   that cross the destination’s start before settling the layout.
4. Re-run the painter, paint-grid and paint-model tests and the relevant staffing grid tests as
   consumers of the shared helpers. Check the unchanged golden invoice hash and immutability
   tests and the queue’s Review Focus 1 and 2 gates. Open the mixed grid at phone and desktop
   widths in both themes and languages. Update the opening-hours guides in English and Spanish
   and the design-system description. Remove both backlog entries with the working fix.

Allow about 180–250 changed lines of production code and 100–170 of tests. The work stays in
the Opening hours editor and its drawing helpers. The staffing painter belongs to Lane K’s A712.
Changes to day length, stored dates, schema and the save API are outside this item.
