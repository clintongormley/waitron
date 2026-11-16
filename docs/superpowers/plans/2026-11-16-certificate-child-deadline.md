# Certificate child deadlines under Linux load

**Goal:** Repair the reproduced real-process test failures without changing diagnosis product behaviour. One PR; Codex builds inline after watcher clearance. Separate Sol/high draft checked by the driver; Claude reviewed the first plan. No owner design approval is claimed. Bundle scope below needs the watcher’s decision.

**Request:** Lane I `queue.md`, CERT-CHILD-DEADLINE:
> under ~/waitron-campaign-shared/ci-failure-rule.md: find why the child's record or exit is not seen in time on a loaded CI runner (the 1 ms work / 200 ms cleanup fixture is a first suspect, not a conclusion), fix the cause, and show it with a run that loads the runner the way CI does. A retry that passes is not a fix. Leave the diagnosis product code's behaviour alone unless the cause is there; if it is, it is fiscal-adjacent, so say so in the plan.

**Evidence:** Lane-local `receipts/cert-child-deadline-20261116/{diagnosis.md,linux-summary.json,signal-margins.json}` and logs retain every result. The unchanged whole process file failed three cases under Linux CPU load: two exact-PID checks and the native deadline. Compressed-cleanup standalone failures disappear in the measured production-cleanup controls. The 200 ms allowance leaves 25 ms termination steps; measured SIGKILL-to-exit reaches 59.9 ms. Production gives 250 ms steps. Four busy threads under Docker quotas of two/four CPUs model competition from CI’s other file workers and coordinator; this is controlled stress, not proof of historical scheduling. Record CPU quota/throttling, Node version and marker/signal delays. Linux is arm64 Node 26.13.1.

## Small test-only repair

- [ ] In `apps/server/src/fiscal-certificate-diagnosis-process.test.ts`, use production’s 2,000 ms cleanup for the helper default and the explicit startup/native cases. Keep result, immediate exact-PID disappearance and next-admission checks. Change native elapsed `<3,000` to `<4,000` ms explicitly: 1,500 work + 2,000 cleanup + 500 margin; startup stays `<3,000`.
- [ ] For the cache case, propose 2,000 ms cleanup and a 2,500 ms directory-opening delay, preserving the compiled-fixture regression check. Prove the source-loader variant still fails before restoring the compiled fixture. Watcher clearance must explicitly supersede its earlier 200/300 ms exception.
- [ ] Print the timeline despite empty/partial/unreadable markers and always remove owned scratch. Use raw marker text for diagnostics; keep `records()` assertions. Demonstrate the old empty-marker teardown failure first.
- [ ] Leave product code, fixture protocol, workflow, dependencies and shared settings unchanged. No new helper or framework.

## Evidence and finish line

- [ ] Reuse `scripts/repeat-test.mjs`: five full process-file attempts at each Docker CPU quota with the same four-thread load, traces enabled, agent output suppression unset, a 60-second attempt bound and retained logs. Run focused runner and cleanup suites. Delete deadline scheduling in a disposable candidate: the existing “uses thirty seconds…” controlled-timer assertion must fail; restore and pass. Report marker/signal delays and the expected four-to-ten-second file cost; refresh durations only if packing needs it.
- [ ] **Bundle decision before build:** five original bundle runs at two cores and two at one core passed all nine cases. Recommend repairing the demonstrated process scope now, leaving the bundle sighting open in its existing incident paragraph; do not change its tests or call that cause fixed. If the watcher instead requires bundle reproduction first, keep this branch unbuilt. Any bundle verification must cover both 180-second build allowances.
- [ ] Update `docs/backlog.md` and `docs/backlog/ci.md` for demonstrated scope; retain the bundle point with its corrected case citation. Add one short dated pointer/current rule in `docs/developers/testing-guide.md`, preserving historical receipts.
- [ ] After watcher clearance: finish-branch with two Claude run-it seats, one fixes read, normal hook, current-head CI and authorised landing. Keep the item open for undelivered scope.

**Size:** production 0, tests about +20/−12, support 0, docs including plan about +45/−25: approximately 110 changed physical lines. Seek an outside opinion above 165. No production fix is planned; any such discovery is fiscal-adjacent and returns to the watcher before building.
