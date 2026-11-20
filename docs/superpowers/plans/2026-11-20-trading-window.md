# Trading window implementation plan

## Decision before building

On 20 November the owner proposed a trading end, such as 03:00, and a separate start, such as 09:00, to make time for closing tables, reports and backups. A 04:00 sale belongs to the trading day that begins later that morning.

Claude reviewed the two-time draft and found a simpler way to get that behaviour. With the existing **Business day starts at** field set to 03:00, any 04:00 sale already counts on the new date, the automatic bill job uses 03:00 to decide which bills are due, and the automatic archive schedule targets 03:30–03:40 on selected days. A manager can run the previous day's report in Sales & takings during that window. The scheduled archive deadline has a delay and does not depend on a completed report.

Recommend using that setting if 09:00 is when staff expect to reopen. Ask the watcher what Waitron should do at 09:00 if the owner wants the second time saved. Opening hours, special days, kept-open zones and attendance use the existing start. If those readers must work from 09:00 while the trading reports roll over at 03:00, return with a revised plan that names each reader and protects tables still in service at closing time.

## Decide which day's report contains the automatic close

`apps/server/src/close-of-day.ts` makes bills due by their trusted opening time and issues them using the clock when it runs. `packages/reporting/src/business-day.ts` selects ordinary issued sales by their actual issue timestamp. An automatic bill issued after the cutoff is therefore counted in the new day's sales totals. Ask the watcher whether that bill should appear instead in the report for the day the job closed, including after a delayed pass. Coordinate any change with lane L's #3398. Keep the invoice's operation date tied to the calendar date on which the table was closed.

## Verification

The existing shared `business-day-clock.test.ts` tests a 03:00 change and its before/after day labels. The server's `backup-schedule.test.ts` pins a 03:36 backup on a 03:00 cutoff. For a separate start or a new report rule, name focused tests and a size estimate in the revised plan after the watcher answers. The recommendation here uses existing product behaviour and requires zero production or test lines.
