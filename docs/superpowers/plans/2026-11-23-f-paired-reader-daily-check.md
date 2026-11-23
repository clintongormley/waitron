# Show the nightly SumUp check for paired readers

In **Reporting → Check card payments → SumUp comparison**, a manager selects a calendar day in
the venue’s time zone. **Paired readers** shows that day’s matched and to-check totals, opens
on problems, and filters to all payments, matches, or a particular problem. Each row shows the
amount, reference and status. A charge that SumUp reports without a Waitron entry has its own row.

## Use the existing nightly check

- The saved duty summary in `apps/server/src/reconcile-duty.ts` holds the number examined and
  the problem lists. The count alone cannot identify which rows were matched. The current
  `missingLocalMismatch` in `packages/payments/src/reconcile.ts` also drops the provider charge
  time, which is needed because the duty runs in UTC and the screen shows a venue calendar day.
  Keep the matching payment refs and provider-only charge times in the existing SumUp summary
  using the results already in hand. Use the existing problem lists for problem statuses.
- Extend the manager-only `GET /management-api/payments/backup-audit` in
  `apps/server/src/payments-api.ts` with `pairedAudit` containing rows, matched and to-check
  counts and an incomplete indicator. Reuse the calendar-day bounds and latest successful run
  selection in `backup-audit-day.ts`. Read the day’s SumUp payments with a reader ID, using
  capture time for collected payments and the saved finding for unfinished ones. Attach all
  saved reasons to each affected payment, counting it once, and use provider time to place
  provider-only rows. Count rows with positive match evidence as matched. Show that a check is
  incomplete where evidence has not arrived or an older summary lacks it. A local payment with
  no result appears as not checked rather than matched.
- In `apps/dashboard/src/api/client.ts` and `widgets/backup-audit.ts`, use the existing date and
  refresh controls and add a labelled status control and `wt-data-table`. Keep totals fixed when
  the filter changes. Use the English and Spanish strings and update both `table-service.md`
  guides. Show the mock-up to the watcher for the owner before finishing the screen.
- Use the same summary and comparison read. No new table, provider request, manual rerun,
  refund action or change to matching and remediation rules. Older summaries can show the
  problems they can substantiate, but full matched totals begin with new checks.

## Prove the result

- Start with failing cases in `packages/payments/src/reconcile.test.ts` and
  `apps/server/src/reconcile-duty.test.ts` for a positive match, an unchecked row, and the
  provider charge time in the saved result.
- In `apps/server/src/payments-api.test.ts`, use Madrid’s calendar day crossing UTC midnight.
  Assert the newest successful findings, a paired match, a payment with two findings counted
  once, a provider-only charge, and a date with missing or older evidence. A standalone payment
  stays out of the paired results and the existing access and passive-read assertions still hold.
- In `apps/dashboard/src/widgets/backup-audit.test.ts`, assert the starting filter, problem-type
  and all-payment filters, stable totals, and the next date’s result. Run the changed Vitest
  files and the existing screen’s comparison test, then check the screen in both themes,
  both languages and at phone and desktop widths. Remove the finished bullet in
  `docs/backlog/payments.md` with the implementation.

Expected change is about 230–300 production lines including copy and 160–220 test lines.
