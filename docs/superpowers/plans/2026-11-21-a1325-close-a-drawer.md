# Closing a drawer (A1325 and A239)

_2026-11-22 (A1325 slice 6). Sales now reads daily figures from recorded transactions. The
saved day report and its chain described below are historical. See the
[retirement slice](2026-11-21-a1325-close-a-drawer-6-retire-daily.md)._

The last member of staff can count a drawer, take out what is needed for the bank and leave the rest.
The owner can see both counts, who made them and what was withdrawn. The owner said “a close is
really just a withdrawal” at 15:34 on 6 November and “Give cash.drawer to all staff yes” at 15:46 in
the same design session (watcher transcript `d871c8b8`, quoted in Lane F’s questions.md on
21 November at 18:02). Claude reviewed this plan. The watcher cleared it on 21 November at 18:02
and put the till close before cash in and out at 18:06.
[Design record](../specs/2026-11-06-a1325-close-a-drawer-design.md)

| Pull request | Result |
| --- | --- |
| [1. Record movements](2026-11-21-a1325-close-a-drawer-1-movements.md) | Payments and refunds record where the money moved |
| [2. Save a count](2026-11-21-a1325-close-a-drawer-2-counts.md) | The server can resume a count after a till closes |
| [3. Read history](2026-11-21-a1325-close-a-drawer-3-history.md) | The owner can see counts and print slips from Sales |
| [4. Close at the till](2026-11-21-a1325-close-a-drawer-4-till-close.md) | Staff can finish the close. Printer deletion offers a close first |
| [5. Cash in and out](2026-11-21-a1325-close-a-drawer-5-cash-entries.md) | Staff record top-ups and withdrawals |
| [6. Retire the frozen day report](2026-11-21-a1325-close-a-drawer-6-retire-daily.md) | Sales reads the selected date from the recorded facts |
| [7. Warn and email](2026-11-21-a1325-close-a-drawer-7-warning.md) | The dashboard warns and the existing email includes closes and differences |

The refund prerequisite landed in #3971 at `528063f5e9`. Trace its completion paths before adding
movement writers. The watcher coordinates lane L's manual returns so their actual cash movement uses
the same writer. Verify all cash paths before showing a balance. State the pre-live venue reset in the
first line of each schema PR. [Refund plan](2026-11-08-a1308-os13-refunds.md)
Cash from a device with no assigned drawer still appears in Sales. A240 waiter floats, bank matching
and payroll are outside this item. The approved design allows the optional tips split to follow.

## Where a later entry goes

Sales and the daily email use the existing reporting date, including when a later write belongs to
an earlier date. A drawer close keeps the saved count and
withdrawal. A cash entry written after the finish belongs to the next drawer interval. The watcher
settled this on 21 November at 17:54 from design decisions 3, 4, 9 and 10. The reader can use a saved
day in tests, and the live tree has no caller writing one outside fixtures and the benchmark.
[Daily report reader](../../../apps/server/src/daily-sales-figures.ts) ·
[date and money calculation](../../../packages/reporting/src/daily-close.ts).

## Checks for each pull request

Each slice targets three hours to PR open. Write and run the named failing tests before implementing,
then rerun every changed test file. Run tests with `pnpm --filter <package> exec vitest run <files>`.
Inspect changed screens in EN/ES, both themes and phone and desktop widths. Update the matching
guides. Run the server's protection list before and after the slice. For schema changes rebuild
`migration-baseline rebuild --set core` and run the schema and unchanged immutability guards from
[the data conventions](../../developers/conventions-data.md). A change to fiscal issuance, an invoice
number, a fiscal chain or an AEAT submission goes back to the watcher before implementation.
