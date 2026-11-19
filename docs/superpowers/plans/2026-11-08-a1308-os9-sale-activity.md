# A1308 orders and sales, PR 9 · Orders history and refund receipt links

[#3779](https://github.com/clintongormley/waitron/pull/3779) landed the refund link on print jobs
and the person key on invoice deliveries on 18 November 2026. The lane landed that PR with a core
migration reset.

On 19 November the owner chose to keep Orders history for good. The
[amendment](2026-11-18-a1308-os9-sale-activity-amendment.md) retires the planned activity-log work.
Both history tables, their protections and the dashboard's live subscriptions stay in place.
The [os13 plan](2026-11-08-a1308-os13-refunds.md) carries the refund job's key into the merged
refund table.

## Expected protection-list difference

The print-links PR produced these differences in the venue database with each fiscal composition.

| Table | Difference | Phases |
| --- | --- | --- |
| `invoice_deliveries` | `extra table invoice_deliveries.foreignKeys[person_id->persons(id)]` | sql-only, migrated, change-feed |
| `print_jobs` | `extra table print_jobs.columns[tender_refund_id]`, `extra table print_jobs.foreignKeys[tender_refund_id->tender_refunds(id)]`, `changed table print_jobs.columnOrder` | sql-only, migrated, change-feed |
| `print_jobs` | `changed trigger waitron_change_print_jobs_update.when` | change-feed |

The history amendment changes documentation only. Its protection-list comparison should print
`EQUAL`. The keys, indexes and append-only and live-update triggers of `receipt_reprints` and
`invoice_pdf_downloads` stay in place.
