# 3. Read drawer counts and print a close from Sales

[Shared plan](2026-11-21-a1325-close-a-drawer.md). After PR 2. Estimate 440 production and 360 test
lines. A Sales viewer can find unfinished counts and reprint a saved close. This also gives the
till flow somewhere to recover a slip when the drawer printer cannot print it.

Add `apps/server/src/drawer-close-report.ts` and mount its date/drawer list and close reprint in
`report-api.ts`. Use `report.view` and Sales history-node scope. Show pending counts, both counts
and actors, difference, the finished amounts and whether cash moved during counting. Resolve names
from recorded ids. Indicate when a drawer lacks an assigned till so a manager can assign one again.

Add `apps/server/src/drawer-close-ticket.ts` using the configured receipt layout and document queue.
Include the date interval, drawer, actor, cash sales and refunds, cash in/out, expected, counted,
difference, bank withdrawal, cash left and card total. When cash moved during counting, say so.
Print on a selected active receipt printer, including for a drawer that has been deleted.

Add `apps/dashboard/src/widgets/drawer-close-history.ts` to `screens/dashboard-sales-screen.ts`.
Reuse the passive Sales query controller and client. Subscribe to changes and keep date and drawer
selection through refreshes.

Fail first in `drawer-close-report.test.ts` for history-node scope, pending counts, date/drawer
filters, authority and document reprint. `drawer-close-ticket.test.ts` owns contents and receipt
layout. Dashboard history and accessibility tests own filters, passive refresh and reprint
feedback. Run Sales and subscription tests and update both Sales guides. The database protection
list should be equal.
