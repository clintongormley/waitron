# Recovery stress test wait budget

**Ask and authority.** Lane H's `CI-recovery-race` item asks to investigate CI
43228135671 attempt 2, reproduce its busy failure under load, and fix the lock or
the four-start test's wait; no retry or skip. Codex wrote this plan; Claude read it
(`receipts/ci-recovery-race/plan-review.md`, 148 seconds). Watcher 12 November 15:41
cleared building once the trigger, history and Linux measurement below were added;
no new plan read was required. No owner approval of this design is claimed.

**Cause and finish line.** #2777 (`b1a93be193`, merged 10 November 23:26:08 UTC)
changed `writeRecoveryState` to flush both file and folder; its diff confirms this
trigger. A child can immediately retake the polling lock for 25 updates while a
waiter sits behind the other children's 75 updates. At 175 ms each that exceeds
the production 10-second wait. The same hundred-update assertions must pass with
that controlled delay; the unlocked control must still demonstrate lost updates.
Production keeps its current timeout and nonblocking polling.

**Evidence.** Original lock/race files: 11 passes. Injected 175 ms hold: expected
errcode 5 at the existing stderr assertion, 15.38 seconds. Ambient load 12.77:
1 pass, 25 consecutive acquisitions per child, longest wait 1,557 ms. CI's exact
timing remains inferred. History covers 40 runs before and 40 after #2777 and all
7 failed logs in those samples: no matching failure; post-trigger 42957142327
passed this case in 7,886 ms. Unchanged production read/change/durable-write on
Node 26.13.0/Linux overlayfs: 10 unloaded updates max 2.21 ms; 100 alongside two
64 KiB fsync writers p95 4.16 ms, max 4.67 ms. This measures that filesystem, not
the failed CI runner. Raw receipts live outside the repo under the lane's
`receipts/ci-recovery-race/`, including `linux-flush.log`.

**Only implementation file:** `apps/server/src/recovery-race.test.ts`. Give the
`many` role a 30,000 ms wait through a child-local wrapper around `withRecoveryLock`,
for both whole updates and the unlocked control's write-only lock. Give only its
child a 45,000 ms deadline and only the hundred-update case 120,000 ms. Thirty
seconds allows roughly 400 ms per competing update; it is a finite test budget,
not a host-scheduling guarantee. Keep every original assertion and other role's
budget. No production change, fairness queue, helper file, retry, skip or new case.

**Checks.** Reuse the observed failing run. Apply the budget, run the identical
175 ms schedule and require 100 updates plus lost updates when unlocked. Restore
the 10 ms hold, then run complete `recovery-lock.test.ts` and `recovery-race.test.ts`
files. Existing lock cases own production timeout/release/event-loop checks.
Write the requested cause/fix lines in progress.log. No backlog entry exists for
this queue-only failure. Run the normal hook and current-head CI via finish-branch;
RUNNER H8 requires two run-it reviews for concurrency. If the slowed run exceeds
the proposed budgets, retain it and return to diagnosis rather than raise them.

**Expected diff:** production 0; tests about 20 additions / 6 removals; this plan
about 45 lines. No generated files or permanent slowdown.
