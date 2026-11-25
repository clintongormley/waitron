# Stop new card reconciliation when the box steps down

The outgoing box stops starting payment reconciliation runs when it begins stepdown. The same
job signal stops it from starting more runs at ordinary shutdown. An ongoing SumUp run can send
the refunds it has already marked. It leaves unmarked refunds for the next sweep. An ongoing Stripe
run keeps its existing behavior. The shutdown deadline still applies to both providers.

## Changes

- Forward the job runner's signal through `reconcileJob` in `apps/server/src/fiscal-jobs.ts`,
  `reconcilePassFor` in `apps/server/src/reconcile-duty.ts`, and the `runDue` call in
  `apps/server/src/boot.ts`. Keep existing scheduler callers without a signal working.
- In `packages/payments/src/reconciliation-schedule/run.ts`, stop the pass when signalled and
  return `null` from the queued claim callback if it has been cancelled. Check again when the
  claim returns, immediately before starting `duty.run`. Return no next due time when cancelled
  and retain the outcomes of runs that finished. A claim already committed at that point follows
  the existing stale-claim recovery. Forward the signal through the period duty into the SumUp
  reconciler. Check it after refund admission and before marking the batch of abandoned payments.
  On stop, omit only admitted payments that met the claim criteria from the missing-payment alert.
  Keep them visible in the audit and keep the one-day retry.
- In `apps/server/src/handover-stepdown.real.test.ts`, sample the counts when the real gate closes.
  Hold the scheduler's next pass as soon as the first reconciliation runs. Release it after the
  stepdown answer.
  The existing checks still cover the admitted sale, payment refusals, AEAT and the card sweep.
- Check the signal inside the menu activation transaction. Give attendance's existing primary
  check the signal so it can refuse a queued write turn. Card follow-up still drops the signal
  before settling captured bill payments. Lane L's SETTLE-STEPDOWN owns that invoice-writing path.
  The demo printer would need a separate change at its send boundary.

## Checks

1. Run `handover-stepdown.real.test.ts` before the fix. The delayed pass must reach Stripe after
   gate close and fail the zero-new-calls check. The scratch probes show this and the separate
   pre-gate false positive. The hosted log cannot distinguish those cases. After the fix, disable
   `signalDuties` once in a disposable checkout and require that the Stripe and sweep checks fail.
2. In `packages/payments/src/reconciliation-schedule/run.test.ts`, check that cancellation before
   the claim leaves the period eligible. Use the existing drain test's staged signal pattern for
   cancellation just after claim commit. Verify the row can be reclaimed. Let one started duty
   finish and check that cancellation does not start a subsequent one.
3. In `apps/server/src/menu-activation.test.ts`, reuse the held-transaction setup to check an
   overdue publication stays queued when shutdown reaches the job before its transaction begins.
   Check that attendance leaves a due day untouched when shutdown reaches the job before its
   write turn. Check that SumUp leaves a refund unclaimed when stopped during its evidence read,
   sends it once on a later sweep and still sends a refund it had already marked. The audit keeps
   the row and an unrelated charge still raises the alert. A separate test checks the scheduler
   passes the same signal to SumUp. Run the changed suites and the server job-runner suites.
4. Verify the branch in CI, land it, then send Lane F the merge SHA. F dispatches the full nightly
   after all three fixes land. Lane K reads and records shard 16 from that run.

The original estimate was 35–50 production and 110–170 test additions. The watcher added the SumUp
alert change after review. The claim predicate is shared with that check. The lane queue owns the
open item.
