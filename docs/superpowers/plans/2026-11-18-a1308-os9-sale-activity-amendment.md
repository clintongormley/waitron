# A1308 os9 · Keep Orders history

On 19 November 2026 the owner chose “Keep for good”. The watcher recorded the decision in
Lane H's `questions.md` at 13:55. Orders keeps showing when receipt copies were requested
and when invoice PDFs were downloaded. Keep `receipt_reprints` and `invoice_pdf_downloads`
with their writers, readers, live subscriptions, keys, indexes and append-only triggers.
These records stay in their own tables and outside the activity log's housekeeping.

[#3779](https://github.com/clintongormley/waitron/pull/3779) already added
`print_jobs.tender_refund_id` and the person key on `invoice_deliveries`. Retaining
`receipt_reprints` leaves the earlier history lookup available. Keep the landed link so the
print queue and move action can decide where a refund receipt can print from the job itself.
The original job stores the id and each retry carries it forward. The
[os13 plan](2026-11-08-a1308-os13-refunds.md) repoints the key to `refunds(id)`.

The [os9 plan](2026-11-08-a1308-os9-sale-activity.md#expected-protection-list-difference) records
the changes that landed in #3779. This amendment closes the remaining work in documentation.
It expects an equal protection list before and after.
