# Certificate child deadlines under Linux scheduling load

**Status:** Draft for driver checking, commit, Claude plan review and watcher clearance before building. No owner design approval exists. One PR; implementation stays inline.

**Request:** `/Users/clintongormley/waitron-campaign-i/queue.md`, CERT-CHILD-DEADLINE:
> **Ask:** under ~/waitron-campaign-shared/ci-failure-rule.md: find why the child's record or exit is not seen in time on a loaded CI runner (the 1 ms work / 200 ms cleanup fixture is a first suspect, not a conclusion), fix the cause, and show it with a run that loads the runner the way CI does. A retry that passes is not a fix. Leave the diagnosis product code's behaviour alone unless the cause is there; if it is, it is fiscal-adjacent, so say so in the plan.

**Evidence and ownership:** Preserve `receipts/cert-child-deadline-20261116/linux-summary.json` and `linux-*.jsonl` under the lane directory. Their runtime metadata reports Node **26.13.1**, differing from the supplied 26.13.0 description. With four busy threads, compressed cleanup failed startup 9/30 and native 3/10 at CPU quota 2; native failed 1/10 at quota 4. Corresponding 2,000 ms cleanup samples passed 10/10 each. Timelines reproduce scheduling delay exhausting cleanup before observed exit; they do not establish historical CI scheduling. A full unchanged process-file run under quota2/four threads failed 3 of22 cases: abort-ignore-term and stop found their exact PID still present, native-deadline received unavailable;19 passed (`linux-full-baseline.log`). The production runner owns deadlines, termination and admission; these tests own real-process integration. No product defect is claimed.

1. **Preserve the failing control before editing.** Retain unchanged Linux failures, kill/exit timelines and CPU-throttling evidence. Reuse the existing isolated Linux probes and compile-once fixture. Demonstrate the empty/partial-marker diagnostic failure in a disposable candidate before correcting it. No new suite, helper, fixture protocol, workload, workflow or shared configuration.

2. **Make only the named test changes.**
   - In `apps/server/src/fiscal-certificate-diagnosis-process.test.ts`, change explicit startup cleanup from 200 to 2,000 ms and synchronous-opening cleanup from 200 to 2,000 ms.
   - In `apps/server/src/fiscal-certificate-diagnosis-bundle.test.ts`, change `cleanupMs` to 2,000 for both parameterized native cancellation cases, `body` and `cleanup`.
   - In process `afterEach`, read raw marker text for diagnostics so empty/partial JSON cannot suppress the timeline. Keep `records()` and behavioral assertions unchanged.
   - Set the process helper’s default cleanup to2,000ms, covering the reproduced abort/stop failures too; explicitly keep the cache-housekeeping case at200ms so its300ms loader control still discriminates. Existing explicit2,000ms cases stay unchanged. Preserve selected outcomes, exact-PID disappearance, TLS closure and subsequent admission.

3. **Explicit changed-check request for watcher:** change only the native process elapsed assertion from `<3,000` to `<4,000` ms: 1,500 work + 2,000 cleanup + 500 margin. Existing longer-cleanup samples reached 3,328 ms. Startup remains `<3,000`. Exact deadline, SIGTERM/SIGKILL and admission assertions in `fiscal-certificate-diagnosis-runner.test.ts` remain unchanged. Any required production change is fiscal-adjacent and returns to Claude/watcher before building.

4. **Verify under matching load.** In a temporary Linux dependency tree, repeat the full process and bundle files five times at each CPU quota, 2 and 4, with the same four-thread load and traces enabled. From `apps/server`, reuse:
   `DIAGNOSIS_PROCESS_TRACE=1 node ../../scripts/repeat-test.mjs 5 120 --load node -e 'const {Worker}=require("node:worker_threads"); for(let i=0;i<4;i++) new Worker("for (;;) {}",{eval:true});' -- pnpm exec vitest run src/fiscal-certificate-diagnosis-process.test.ts src/fiscal-certificate-diagnosis-bundle.test.ts --reporter=default --silent=false` (unset AI_AGENT/CLAUDECODE).
   Inspect test counts, named assertions, PID/TLS disappearance and timelines. Run the focused runner and cleanup suites. In disposable candidates, prove raw diagnostics survive empty/partial markers and deleting deadline scheduling fails an existing controlled-timer deadline assertion; restore and verify green. Retain compact receipts and remove only owned temporary resources.

5. **Close only demonstrated scope.** If compressed-deadline bundle cancellation cannot be reproduced, report that evidence gap to the watcher before claiming it solved or deleting its sighting. Passing unrelated reruns establish no historical cause. Update `docs/backlog.md`’s CI summary and `docs/backlog/ci.md`; remove the certificate incident text only once its named scope is demonstrated. Add a dated pointer near `docs/developers/testing-guide.md:1975`, preserving historical prose.

6. **Finish through the driver.** After clearance and focused checks, run `finish-branch`: initial rebase, two Claude run-it seats for concurrency, fixes and fresh Claude read, normal hook, required current-head CI, then landing only with the required authorization.

**Forecast:** production 0; tests approximately +12/−12; support 0; documentation including plan approximately +40/−25: about 90 changed physical lines. Seek an outside opinion above 1.5× that estimate.
