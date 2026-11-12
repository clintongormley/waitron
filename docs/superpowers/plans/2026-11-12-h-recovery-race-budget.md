# Recovery stress test wait budget

Lane H's `CI-recovery-race` queue item asks to investigate CI 43228135671 attempt 2,
reproduce its busy failure under load, and fix the lock or the four-start test's wait;
no retry loop or skip. Codex wrote this plan. Claude reviewed its first version in
`~/waitron-campaign-h/receipts/ci-recovery-race/plan-review.md` (148 seconds).
The watcher clears it before building; no owner approval of this design is claimed.

**Finish line:** four children complete all 100 recovery updates in the controlled
slow schedule, and the unlocked control still demonstrates lost updates. Production
keeps its existing 10-second refusal and nonblocking polling.

**Cause and history:** `withRecoveryLock` polls every 25 ms; the child that releases
it can immediately reacquire it for its next update before another child polls.
One waiter can therefore wait behind many of the other children's 75 updates.
A 175 ms hold per update reproduced errcode 5 at `recovery-lock.ts:31` and the
existing stderr assertion, in 15.38 seconds. At that rate, 75 updates exceed 10 seconds.
Thirty seconds gives this finite workload headroom, roughly 400 ms per competing
update; this is a budget, not a guarantee about host scheduling. The real start does
not run this test's loop of 25 counted failures. No production fairness change is asked.
The CI case has the same error after 15.527 seconds but no per-lock timings, so its
specific timing cause remains an inference. Retained history: 24 recent runs, attempt
1/2 of the named run, and failed logs from 43215712748, 43208119577 and 43203880502;
none of those older failed logs names this race. The baseline lock/race files pass
all 11 cases. A traced run at ambient load 12.77 passed: each child acquired 25 times in a row;
the longest wait was 1,557 ms. This observes unfair reacquisition under real ambient
load, but only the injected 175 ms hold reproduced the timeout.

**Scope:** change only `apps/server/src/recovery-race.test.ts`. Give the `many` role
an explicit 30,000 ms wait through a child-local wrapper around `withRecoveryLock`,
covering whole updates and the unlocked control's write-only lock. Only that role's
child deadline becomes 45,000 ms, and only the hundred-update test gets 120,000 ms.
Keep every original assertion and the other cases' existing budgets. No production
change, fairness queue, helper file, retry, skip, new test case or permanent slowdown.
The backlog grep found no entry for this queue-only failure, so no backlog edit.

**Build and checks:** the expected failure with a 175 ms hold is retained. Apply
the budget and run the identical slowed schedule: assert 100 counted updates and
lost updates in the unlocked control. Restore the 10 ms hold and run both complete
`recovery-lock.test.ts` and `recovery-race.test.ts` files. The first failing run already
supplies the negative control; do not repeat it just for ceremony. The lock suite
owns timeout, invalid-file, release and event-loop behavior. Write the requested two
progress.log lines, cause and fix. The normal hook and current-head CI supply repository
checks. RUNNER H8 and finish-branch require two run-it reviews for concurrency, including
concurrency tests; they are required workflow, not extra product scope.

**Expected diff:** production 0; tests about 20 additions / 6 removals; plan about
45 lines, no generated files. If the slowed run exceeds these budgets, retain it and
return to diagnosis rather than raise the timeout again.
