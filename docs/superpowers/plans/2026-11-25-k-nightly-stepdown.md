# Stop new card reconciliation when the box steps down

The outgoing box stops starting payment reconciliation runs when it begins stepdown. The same
job signal stops it from starting more runs at ordinary shutdown. A reconciliation already inside
its provider's `reconcile()` method can finish, including any refunds that method sends as part of
its run. Its existing shutdown deadline still applies.

## Changes

- Forward the job runner's signal through `reconcileJob` in `apps/server/src/fiscal-jobs.ts`,
  `reconcilePassFor` in `apps/server/src/reconcile-duty.ts`, and the `runDue` call in
  `apps/server/src/boot.ts`. Keep existing scheduler callers without a signal working.
- In `packages/payments/src/reconciliation-schedule/run.ts`, stop the pass when signalled and
  return `null` from the queued claim callback if it has been cancelled. Check again when the
  claim returns, immediately before starting `duty.run`. Return no next due time when cancelled
  and retain the outcomes of runs that finished. A claim already committed at that point follows
  the existing stale-claim recovery. The schema and provider adapters stay outside this change.
- In `apps/server/src/handover-stepdown.real.test.ts`, sample the counts when the real gate closes.
  Pause a reconciliation pass at the scheduler entrance and release it after the stepdown answer.
  The existing checks still cover the admitted sale, payment refusals, AEAT and the card sweep.
- Of the jobs marked to stop, the external workers already use their signal apart from payment
  reconciliation. Menu activation starts its local work in one queued transaction, so check the
  signal inside that callback in `apps/server/src/menu-activation.ts`. Attendance and the demo
  printer also drop the signal. They perform local work and need changes across their worker and
  write boundaries, beyond the one-check fixes the watcher asked for at 04:07.

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
   Run changed suites and the server reconcile and job-runner suites. The real handover test
   covers signal forwarding through those server layers.
4. Verify the branch in CI, land it, then send Lane F the merge SHA. F dispatches the full nightly
   after all three fixes land. Lane K reads and records shard 16 from that run.

Expected size is 25–35 production lines and 90–140 test lines. The lane queue owns the open item.
