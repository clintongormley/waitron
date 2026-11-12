# Recovery stress test wait budget

Lane H's `CI-recovery-race` queue item asks to investigate CI 43228135671 attempt 2,
reproduce its busy failure under load, and fix the lock or the four-start test's wait;
no retry loop or skip. This plan is written by Codex; no owner approval of its design
is claimed. The watcher clears the plan after Claude's read.

**Finish line:** the four child processes complete all 100 recovery updates during
a slow run, and the unlocked control still demonstrates lost updates. The production
lock keeps its existing 10-second refusal and nonblocking polling.

**Evidence:** the existing lock and race files pass all 11 cases. Temporarily holding
each many-role read for 175 ms instead of 10 ms reproduces errcode 5 at
`recovery-lock.ts:31` and the existing stderr assertion, in 15.38 seconds. The retained
CI failure has the same error in a 15.527-second case, but has no individual lock timings;
the diagnosis of that CI run's slow I/O remains an inference.

**Reuse and scope:** reuse `withRecoveryLock`'s existing `waitMs` argument and the
race fixture's child deadline. Change only `apps/server/src/recovery-race.test.ts`:
pass a 30,000 ms wait through a child-local wrapper, both for whole updates and
for the unlocked control's write-only lock; set its child deadline to 45,000 ms
and each test's deadline to 120,000 ms. Keep every original behavioral assertion.
No production changes, fairness queue, new helper file, retry, skip or new test case.
Audit the backlog for this queue-only failure; remove an entry only if one exists.

**Build and checks:** run the original case with the 175 ms diagnostic hold and
observe the expected busy failure (already retained). Apply the test budget and
run the same slowed schedule; all 100 updates must survive and the unlocked
control must still lose updates. Restore the 10 ms hold and run both complete
`recovery-lock.test.ts` and `recovery-race.test.ts` files. Repeat the slowed schedule
in a disposable checkout with the wait correction removed, then restore it:
the existing stderr/count assertions must distinguish them. Do not commit the
slowdown or add a test of the numeric constants. Existing lock tests own production
timeout, invalid-file, release and event-loop behavior. The normal hook and current-head
CI provide repository checks. Two run-it reviews apply because this tests concurrency.

**Expected diff:** production 0 lines; tests about 12 additions / 5 removals;
this plan about 35 lines. If the slowed run needs more than these budgets, retain
the result and return to diagnosis rather than increase the timeout again.
