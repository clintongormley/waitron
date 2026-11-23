# Show the nightly SumUp check for paired readers

In **Reporting → Check card payments → SumUp comparison**, choose a calendar day in the venue’s
zone. **Paired readers** lists each charge’s amount, reference and status. It opens on problems
and shows the day’s matched and to-check counts while you filter. Charges SumUp reports without a
recorded charge in Waitron appear once in the comparison.

## Keep the evidence from the existing check

- In `packages/payments/src/reconcile.ts`, use the existing classification to retain the refs of
  captured payments with an equal provider charge and no finding. A skipped hold or an initiated
  payment with no charge is no match. For `missingLocal` charges retain the provider reference,
  amount, charge time and any hinted Waitron payment ref. Request this optional `chargeAudit` result
  in `packages/payments-sumup/src/reconciler.ts` and save it in the existing SumUp summary in
  `apps/server/src/reconcile-duty.ts`. Keep the existing findings
  and their wire shapes. This adds no provider reads or changes to the check or refund decisions.
- Extend the existing manager-only `/management-api/payments/backup-audit` in
  `apps/server/src/payments-api.ts` with `pairedAudit`. Share the latest-successful-run selection and
  calendar-day bounds in `backup-audit-day.ts`. Read SumUp payment rows with a reader ID. Use capture
  time when present and include an unfinished attempt only with a saved finding. Show a captured
  payment with no saved result as **Not checked**, including a charge refunded before it was checked.
  Preserve a saved match after a refund and show a staff-resolved hold as **Resolved**. Attach all
  open findings to its row and count it once. Scope the incomplete notice to missing run coverage,
  older summaries without charge evidence or unreadable charges already counted by the duty.
- Place provider-only rows by charge time, deduplicated by SumUp reference. Count a provider-only
  charge in the paired results if its hinted Waitron attempt identifies a reader. Keep existing
  unlinked charges in the standalone findings, outside the paired count. Show any remaining charge
  with no known reader as SumUp-only. The provider charge alone cannot identify a paired reader.
- Reuse the comparison that `apps/dashboard/src/screens/payments-screen.ts` opens. Extend its
  API type in `apps/dashboard/src/api/client.ts` and render the rows in `widgets/backup-audit.ts`
  with `wt-data-table` and a labelled status filter. Keep the day and refresh controls. Update
  English and Spanish `apps/dashboard/src/i18n/strings.ts` and the two `apps/server/src/guide/`
  `table-service.md` guides. Send the watcher the mock-up for the owner before finishing the screen.
  This uses the existing endpoint and summary, with no new table or manual rerun.

## Prove the result

- In `packages/payments/src/reconcile.test.ts` and `apps/server/src/reconcile-duty.test.ts`, start
  with failing checks for a confirmed match and provider-only charge time and hint in saved evidence.
  Keep the existing SumUp and Stripe assertions and run their focused reconciler files.
- In `apps/server/src/payments-api.test.ts`, verify the Madrid day across UTC midnight, newest successful
  findings, a matched then refunded payment, two reasons on one payment counted once, a hold resolved by
  staff and a provider-only charge counted once. Check that an unpaid attempt stays out, an unlinked
  charge already in the standalone list stays there, and old, missing or unreadable evidence reads incomplete.
- In `apps/dashboard/src/widgets/backup-audit.test.ts`, check the initial filter, one problem type,
  all rows, fixed totals and a date change. Run the existing screen comparison case. Open both
  languages and themes at phone and desktop widths. Remove the finished `docs/backlog/payments.md`
  bullet with the implementation.

Target 300–365 production lines including copy and 190–235 test lines. Read the changed files again
before the branch review and report the code and test sizes separately.
