# Stop new card reconciliation when the box steps down

The venue needs its outgoing box to stop starting payment audits when it closes admission for
handover. A pass that has already called a provider may finish and record the result. The test
samples the server’s actual gate close, so an audit before that event cannot make it fail.

## Changes

- In `apps/server/src/boot.ts`, pass the existing `handoverGate.closed` signal to the payments
  scheduler. The job runner already stops scheduling further passes at stepdown.
- In `packages/payments/src/reconciliation-schedule/run.ts`, accept an optional signal. Stop before
  starting each duty, check for cancellation inside the queued claim transaction, and check again
  just before starting the provider call. Let an already-started call complete normally. If the
  signal arrives just after a claim commits, that row follows the existing stale-claim recovery
  rule. Keep the existing schedule, schema, claim ownership checks, and active provider requests.
- In `apps/server/src/handover-stepdown.real.test.ts`, observe `closed` on the real gate and use
  that event for the existing call counts. Pause an already-started reconciliation pass at the
  real scheduler entrance and release it after the stepdown response. Check for no new Stripe or
  card-sweep calls after the gate closes and wait for the box to finish closing. Keep the existing
  behavior checks for the admitted sale, the refused payments, and the held AEAT batch.

## Checks

1. Run the server test with the event and pause before changing production. The Stripe call after
   the gate must fail the existing zero-additional-calls check. The two scratch probes already
   produced this result and showed that the old snapshot can flag a pre-gate call.
2. In `packages/payments/src/reconciliation-schedule/run.test.ts`, use the existing database fixture
   and fake duty to check cancellation while waiting for the claim, completion of a provider call
   already started, and leaving subsequent work eligible. Run these checks before the fix.
3. Run the changed suites and the existing server reconcile and job-runner suites after the fix.
   The pre-push hook and current-head CI provide the remaining checks. Lane F dispatches the full
   nightly after the three fixes land, under the watcher's 03:53 instruction.

Expected size is about 15–25 production lines and 65–100 test lines. The nightly failure has no
entry in `docs/backlog.md` or `docs/backlog/`. Its open-work entry is `NIGHTLY-STEPDOWN` in the lane queue.
