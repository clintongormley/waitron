# Closing a drawer (A1325 and A239)

The last member of staff can count a drawer, take out what is needed for the bank and leave the rest.
The owner can see both counts, who made them and what was withdrawn. The owner approved the
[design](../specs/2026-11-06-a1325-close-a-drawer-design.md) on 6 November. The Lane F plan below
requires watcher clearance.

| Pull request | Result |
| --- | --- |
| [1. Record movements](2026-11-21-a1325-close-a-drawer-1-movements.md) | Payments and refunds record where the money moved |
| [2. Cash in and out](2026-11-21-a1325-close-a-drawer-2-cash-entries.md) | Staff record top-ups and withdrawals |
| [3. Save a count](2026-11-21-a1325-close-a-drawer-3-counts.md) | The server can resume a count after a till closes |
| [4. Close at the till](2026-11-21-a1325-close-a-drawer-4-till-close.md) | Staff can finish the close and get a slip |
| [5. Read history](2026-11-21-a1325-close-a-drawer-5-history.md) | The owner sees counts and can reprint. Printer deletion offers a close first |
| [6. Retire the frozen day report](2026-11-21-a1325-close-a-drawer-6-retire-daily.md) | Sales reads the selected date from the recorded facts |
| [7. Warn about missed closes](2026-11-21-a1325-close-a-drawer-7-warning.md) | A missed close shows in the dashboard |
| [8. Email the daily summary](2026-11-21-a1325-close-a-drawer-8-summary.md) | The daily email includes closes and differences |

Build in order after [os13](2026-11-08-a1308-os13-refunds.md) merges. PR #3962 combined the refund
tables in os12. Trace os13's landed completion paths before adding movement writers. Verify all cash
paths before showing a balance. State the pre-live venue reset in the first line of each schema PR.
Cash from a device with no assigned drawer still appears in Sales. A240 waiter floats, bank matching
and payroll are outside this item. The approved design allows the optional tips split to follow.

## Decision for the owner

I recommend keeping each Sales figure on its existing reporting date even if it was written later.
Sales can then update an earlier date after a drawer closes. The saved count and withdrawal stay as
recorded. Cash posted after the close belongs to the drawer's next interval. May Sales update a past
date this way? This decision gates PR 6. The date view and daily email currently share
[the frozen reader](../../../apps/server/src/daily-sales-figures.ts), which uses a saved snapshot for
each closed node. The [live calculation](../../../packages/reporting/src/daily-close.ts) already
assigns dates to sales, payments and refunds.

## Checks for each pull request

Each slice targets three hours to PR open. Write and run the named failing tests before implementing,
then rerun every changed test file. Run tests with `pnpm --filter <package> exec vitest run <files>`.
Inspect changed screens in EN/ES, both themes and phone and desktop widths. Update the matching
guides. Run the server's protection list before and after the slice. For schema changes rebuild
`migration-baseline rebuild --set core` and run the schema and unchanged immutability guards from
[the data conventions](../../developers/conventions-data.md). A change to fiscal issuance, an invoice
number, a fiscal chain or an AEAT submission goes back to the watcher before implementation.
