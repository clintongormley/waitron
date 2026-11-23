# Show the nightly SumUp check for paired readers

In **Reporting → Check card payments → SumUp comparison**, managers can choose a venue day and
see a status for each paired-reader payment, with the day's matched and to-check totals. The
status filter opens on problems. A SumUp charge with no recorded charge in Waitron appears once.

Claude reviewed the plan on 23 November. The watcher cleared it at 20:52 that day and split it
into two pull requests so the nightly check can start collecting evidence while the screen is built.
The watcher clarified at 21:06 how to handle refunds recorded only at SumUp.

## PR 1 — Save the nightly evidence

- In `packages/payments/src/reconcile.ts`, record payment refs for captured rows with an equal
  SumUp charge and no finding. Keep whether SumUp reports each matched charge as refunded.
  For provider charges without a recorded local charge, retain the
  reference, amount, charge time and any linked Waitron payment ref. Keep the existing findings
  and their wire shapes.
- Request this evidence in `packages/payments-sumup/src/reconciler.ts` and save it in the existing
  summary in `apps/server/src/reconcile-duty.ts`. Preserve the refund status in
  `packages/payments-sumup/src/report-source.ts` without adding provider reads. Keep reconciliation
  decisions. Leave the manager's backlog entry open.
- In `classify.test.ts`, distinguish an exact capture from drift, orphans, unpaid attempts and
  resolved holds. In the SumUp `reconciler.test.ts`, check that the adapter supplies the evidence,
  including a charge dated outside the run's day. In `reconcile-duty.test.ts`, read the saved
  evidence back from a successful scheduled run. Run the existing Stripe reconciler checks too.
- Expected size about 35–50 production lines and 45–65 test lines.

## PR 2 — Show the paired-reader results

- Start the screen work by sending the watcher a mock-up showing rows, the status filter, totals
  and the incomplete-check notice. Build the endpoint while the owner looks at it.
- Add `pairedAudit` to the manager-only `/management-api/payments/backup-audit` in
  `apps/server/src/payments-api.ts`. Share the latest successful runs and day bounds in
  `backup-audit-day.ts`. Use capture time for a Waitron payment and charge time for a SumUp-only
  row. A SumUp-only charge linked to a Waitron payment on a paired reader counts in Paired readers.
  The standalone panel shows the remaining unlinked charges, outside the paired totals.
- A refund recorded after a match keeps that result. **Refunded before the check** is filtered
  with matched payments by default and adds nothing to **To check**. When SumUp reports a refund
  but Waitron has no matching refund, show it as a problem. Show resolved holds as
  **Resolved**. Attach all open findings to a single row and count the row once. Show **Not
  checked** for a capture with no evidence. Leave unpaid attempts out unless a finding shows
  that SumUp took money. Show the incomplete notice for a missing day, old summaries without
  evidence, or unreadable charges.
- Reuse the comparison opened by `apps/dashboard/src/screens/payments-screen.ts`, its API type
  in `api/client.ts`, and `wt-data-table` in `widgets/backup-audit.ts`. Keep the day and refresh
  controls. Update dashboard translations and both `table-service.md` guides. Remove the
  finished `docs/backlog/payments.md` entry.
- In `backup-audit-day.test.ts`, check newest successful runs, day coverage and incomplete
  evidence. In `payments-api.test.ts`, cover Madrid midnight, statuses, counts, deduplication,
  unpaid attempts, unlinked charges and one endpoint wiring case. In `backup-audit.test.ts`,
  check the default filter, a problem status, all rows, totals and a date change. Run the
  existing screen comparison test and open both languages and themes at phone and desktop widths.
- Expected size about 265–315 production lines including copy and 145–170 test lines.

Both pull requests use the existing duty and data store.
