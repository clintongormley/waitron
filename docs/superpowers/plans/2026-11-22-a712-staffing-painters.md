# A712 Staffing painters

The watcher's 2026-11-22 10:51 queue assignment and the [A585 design](../specs/2026-10-13-a585-staffing-and-rota-design.md) as written define this work. Claude reviewed the plan, and the watcher cleared it with the two-pull-request split below at 11:03. No owner approval of the design is claimed or needed for this item.

## Pull request 1

Staff can switch from either Staffing painter into Opening hours for the same season or special day, step between staffing seasons and close back to the Staffing month without adding history entries, and see inherited staffing when a special date follows its season. The first stroke on such a date starts with the inherited blocks. Follow restores the seasonal display, and Clear leaves an empty override.

- In `packages/dashboard-kit/src/contract.ts`, add the optional replacement choice to `CalendarViewHost.open`. In `packages/venue-service/src/dashboard/opening-hours-screen.ts`, reuse the guarded address write and existing paths for the two Opening hours painters. Regular opens still push and Opening hours closes as before. In Staffing's `staffing-painter-base.ts`, `staffing-season-painter.ts`, `staffing-special-day-painter.ts` and `strings.ts`, use the shared segmented control in the frame's picker slot. A season switch carries the current department or defaults for a prep station. A declined leave keeps Staffing selected.
- In Staffing's `paint.ts` and `staffing-types.ts`, use the date plan's season and weekday with the existing paint query to supply seasonal blocks for each area and date, including dates with a saved override. In `staffing-grid.ts`, draw inherited blocks faintly with their usual text and without edit handles. A stroke can start from those blocks. No schema or save format change.
- Run the Opening hours painter tests for history writes with and without the leave guard. The Staffing painters' navigation tests check the destination and replacement argument, and that declining to leave keeps Staffing selected. Test the inherited read in `paint.test.ts`, and the display and first stroke in the special-day painter and grid suites. Update both opening-hours guides and narrow A712 in the backlog to the remaining work. Inspect both languages and themes at phone and desktop widths.

## Pull request 2

Start after Lane H's SPECIAL-DAY-OWN-START lands. Staff can paint special dates at each date's own business-day start. In Staffing's `paint.ts`, `staffing-types.ts`, `routes.ts` and painter and grid components, use `cutoverForBusinessDay` for the date read and save check. Reuse H's column pointer conversion, labels and Copy to… check. If any destination cannot fit the clock times, name the date, keep the chooser open and copy nothing. Use `paint.test.ts` for the dates' reads, `routes.test.ts` for accepted and refused blocks, and the special-day painter and grid suites for the mixed-start display, stroke and copy. Remove the remaining A712 backlog entry.

Estimated across both pull requests, 230–310 production lines and 240–340 test and fixture lines.
