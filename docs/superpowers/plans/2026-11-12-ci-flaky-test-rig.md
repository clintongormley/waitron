# Repeat tests and reproduce the certificate child-exit failure

**Request:** Lane I `queue.md`, CI-flaky-rig: “the smallest repeated-run rig: run one named test file N times, alone and beside a chosen load, keeping each run's log and a process snapshot on failure.” First reproduce the certificate-process failure with delayed child exit and fix it in the test. One PR delivers that rig and fix; the other six investigations follow.

**Authority:** Lane I RUNNER.md quotes the owner's 2026-11-10 rule: “The owner's request, as your queue item states it, already authorises the work inside it; a written plan does not add an owner approval to wait for.” Claude reviewed this approach (226 seconds); the watcher cleared it on 2026-11-12 at 16:39 with the three changes incorporated below. No owner design approval is claimed.

**Finish line:** You can repeat a named test command, retain every attempt's log and failure snapshot, and run the certificate success case with a delayed orderly exit while preserving its assertions. Product code and fiscal records do not change.

## Small tool, test first

- [ ] In `scripts/repeat-test.test.mjs`, first observe failures for four behaviours: N sequential attempts have separate logs; an early failure survives a later success; cancellation stops the owned load while an unrelated process survives; an early load exit makes the experiment invalid and fails. Keep one five-second cancellation case. Use real small child commands. Existing deadline tests own escalation and stalled-pipe mechanics.
- [ ] Add `scripts/repeat-test.mjs`, exporting the loop for same-process root coverage and skipping only the CLI block: repeat count, per-attempt seconds, literal test-command arguments and optional literal load-command arguments; create and print a fresh temporary evidence directory. Pass arguments directly, with no shell evaluation. Accept multiple named files through the command, so later concurrent investigations need no tool extension. No package parser or file-containment validator.
- [ ] Launch each attempt through the existing `run-with-deadline.mjs --diagnostics`, redirecting both streams into its own log. Record command and exit status; return failure if any attempt fails. Start optional load once through the same wrapper. On interruption/finally, signal those owned wrappers and await their existing bounded cleanup; add no second TERM/KILL implementation. Record unexpected load exit and treat the loaded experiment as invalid. On ordinary assertion failure append a bounded plain `ps` snapshot labelled “after exit”; deadline snapshots already precede termination. General orphan cleanup stays manual `pnpm reap`.

## Certificate reproduction and correction

- [ ] Before changing the test, retain 44 loaded whole-file attempts on the original tree, with `DIAGNOSIS_PROCESS_TRACE=1` and `AI_AGENT`/`CLAUDECODE` unset. Use two owned Node CPU workers as the recorded load. Capture memory headroom and existing processes first; browser work requires well above 15% free and no background whole-workspace coverage. This sample may reproduce the sighting; absence does not establish its cause.
- [ ] In `apps/server/src/testing/certificate-diagnosis-child.ts`, retain an input-controlled delay in module scope and await 300 ms after entry/channel closure. The existing “resolves only after its exact child exits and permits the next attempt” and “does not forward credential environments…” cases request it, in `fiscal-certificate-diagnosis-process.test.ts`. With its current 200 ms cleanup, observe the completed-result assertion fail and retain signal timing. This proves the delay mechanism, not the historical run's cause.
- [ ] Give both naturally exiting cases 2,000 ms, matching production. Keep selected-result equality, exact PID disappearance and next-attempt admission; add an assertion for no recorded kill. Reverse the allowance once to prove the control fails. Keep every other case unchanged, including the 200 ms cache regression. No claim that all naturally exiting cases are repaired; no speculative backlog entry for an unseen failure.

## Verification and delivery

- [ ] Run root `scripts/repeat-test.test.mjs` and `scripts/run-with-deadline.test.mjs`; server `src/fiscal-certificate-diagnosis-process.test.ts`, `src/fiscal-certificate-diagnosis-runner.test.ts` and `src/fiscal-certificate-diagnosis-bundle.test.ts`. Require actual Tests counts. Repeat the corrected whole process file 44 times under the same load, retaining traces; report baseline and corrected counts separately from the deterministic control.
- [ ] Add usage to `docs/developers/testing-guide.md`, with a dated pointer beside its historical 200 ms experiment. Delete only the certificate entry from `docs/backlog/ci.md`, retire “except the last” wording, and change bundle counts there and in `docs/backlog.md` to six. Leave six investigations open. Complete finish-branch, current-head CI and authorised landing.

**Expected size:** tool +70–100; tests +100–170; fixture support +10–20; docs +30–45/−6–10; product and generated code zero. No new CI job, dependency, cache, controller, coverage threshold or existing-guard change.
