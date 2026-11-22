# Draw special days from each date’s business-day start

In Opening hours, you can read and paint a one-off special day on each date’s own time scale. The
mixed-start notice goes away. The watcher queued SPECIAL-DAY-OWN-START at 10:51 on 22 November
2026 against the first-date ruler entry in [the service-periods backlog](../../backlog/service-periods.md).

## Decisions for the watcher

For **Every year**, use one ruler at the venue’s start in force, matching the existing save rule.
Season hours still come from each selected date. For **Copy to…**, keep valid ranges at the same
clock times. If a selected destination cannot take a copied range on its own scale, keep the
chooser open, name that date and tell the manager to paint it separately. Copy none until all
selected destinations fit. A range such as 05:30–07:00 from a 05:00 date cannot be shown as one
block on a 06:10 date. This protects staff from copying hours they cannot see or save.

## Test and build

1. In `packages/venue-service/src/dashboard/special-day-painter.paint.test.ts`, start with a
   failing 05:00 and 06:10 one-off case. The same 07:00 block starts 120 and 50 minutes down
   the two columns. Check both ruler labels, then paint from the second date’s top to 07:00
   and assert the save sends 06:10–07:00. Add a zone closure at that boundary, a valid and an
   incompatible copy, and the annual shared-ruler case. Keep the equal-start and all-day
   checks. Run the named file with `pnpm --filter @waitron/venue-service exec vitest run` first.
2. In `special-day-painter.ts`, give each `PaintColumn` an optional start. For one-offs use
   `dateCutover(date)` with its existing clock fallback. For yearly repeats use `model.dayCutover`.
   Cache columns by the resolved starts. Layer season and zone context with each season day’s
   start, and normalize zone draft paint on its column’s scale. Give the zone draft cache
   the source and resolved starts. Use each edited date’s scale in `savedBlocks` and `refill`
   in `packages/venue-service/src/paint-model.ts`, keeping the existing string argument usable
   by the season painter. Remove the mixed-start notice and its strings from `strings.ts`.
   Follow the existing save refusal path for times that fit only a waiting start (A869).
3. In `paint-grid.ts` and `paint-grid-parts.ts`, apply each column’s start to painted blocks,
   underlays, hour lines, pointer snapping, preview, release and block menu edits. Reuse the
   existing ruler labels. For mixed starts, replace the pinned ruler track with a ruler inside
   each date and give its track enough extra width to keep the current minimum paint area.
   Keep the single ruler when starts agree. Pass the column key to `ColumnStroke` and keep its
   existing zero-argument staffing caller. Give the copy chooser only the range check and
   message it needs for incompatible destinations.
4. Run the focused painter, grid, paint-model and staffing-grid tests. Run the unchanged fiscal
   hash and immutability gates and the sell-published and menu-refresh gates from the lane queue.
   Open the mixed grid at phone and desktop widths in both themes and languages. Update both
   `opening-hours.md` guides and the design-system description. Remove the finished backlog
   detail and index, and update the Opening hours reference in `docs/backlog/workforce.md`.

Allow about 220–285 changed production lines and 120–170 test lines. Lane K owns the staffing
painter. This change uses the current 24-hour drawing scale and existing stored data, save API
and server rules.
