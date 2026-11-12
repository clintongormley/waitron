# CI repeated-run rig and certificate fixture plan

**Source:** `/Users/clintongormley/waitron-campaign-i/queue.md`, “CI-flaky-rig”; `docs/backlog/ci.md`, “Bundle: One repeated-run rig, then each named test”. Queue: “One pull request for the rig plus the fiscal-certificate fix; later fixes may share one.”

**Finish line:** Repeat one exact test file sequentially, alone or beside chosen load, retain evidence, and reproduce and correct the certificate test’s orderly-exit allowance. Draft awaiting driver inspection, Claude review and watcher clearance; no implementation or tests before clearance.

## 1. Build the small rig with TDD

- [ ] Create `scripts/repeat-test.test.mjs` first: “rejects invalid counts, deadlines and non-file targets”, “runs N sequential attempts with separate logs”, “retains earlier failure after later success”, “captures nonzero and deadline diagnostics”, and “interrupts attempts and stops only its load group”. Observe expected failures before implementation.
- [ ] Create `scripts/repeat-test.mjs`; export runner and CLI parser for root coverage. Accept `--package <directory> --file <package-relative-test-file> --repeat <N> --timeout <seconds> --output <directory> [--load <executable> <args...>]`. Require an existing exact test file inside the package, not a pattern or directory. Invoke package-local `pnpm exec vitest run` without coverage; select that file’s full path. Pass arguments without shell evaluation.
- [ ] Run N attempts without overlap in the same worktree. Log command, attempt number, exit status and both output streams; report counts and fail overall if any attempt fails. Interruption stops further attempts. Use fresh output directories outside the repository.
- [ ] Spawn the existing `scripts/run-with-deadline.mjs` CLI with `--diagnostics`, redirecting its output to each log. Reuse its bounded timeout, survivor cleanup and pre-termination process snapshot; leave its API unchanged. On ordinary nonzero exit, append `createDeadlineDiagnostics().report()` to the attempt log, acknowledging that the failed child may already have exited.
- [ ] Start optional load once, as an owned process group. In `finally`, including SIGINT/SIGTERM, forward cancellation to the attempt wrapper, await bounded cleanup, then TERM/KILL only the load group. Retain load output. Tests use child fixtures, verify unrelated witness survival and exercise imported code and CLI. `scripts/run-with-deadline.test.mjs` owns deadline mechanics. General orphan cleanup remains manual `pnpm reap`.

## 2. Reproduce, then correct the certificate fixture

- [ ] Modify `apps/server/src/testing/certificate-diagnosis-child.ts` and `apps/server/src/fiscal-certificate-diagnosis-process.test.ts`. Add input-controlled orderly-exit delay after `runCertificateDiagnosisEntry` returns, following channel closure. Keep once-per-suite compilation and lifetime trace hooks.
- [ ] In “resolves only after its exact child exits and permits the next attempt”, request 300 ms delay. Run with the existing 200 ms cleanup allowance: expect completed-result failure and trace showing TERM after approximately 150 ms. This budget hypothesis remains unproved until RED.
- [ ] Give this success case 2,000 ms cleanup, matching production. Preserve selected-result equality, exact PID disappearance and next-attempt admission; verify exit without TERM/KILL. Keep refusal/deadline cases at 200 ms and all assertions. Reverting the allowance must fail the delayed-exit control. Leave production runner, dispatch and fiscal hash/filing tests unchanged.

## 3. Validate and hand off

- [ ] Run `pnpm exec vitest run scripts/repeat-test.test.mjs scripts/run-with-deadline.test.mjs`; run server process, runner and bundle suites via `pnpm --dir apps/server exec vitest run src/fiscal-certificate-diagnosis-{process,runner,bundle}.test.ts`. Require actual Tests counts.
- [ ] Use the rig for 20 certificate-file attempts alone and 20 beside explicitly recorded load, in separate invocations. First record `memory_pressure` and heaviest processes; browser load needs well above 15% free and no background whole-workspace coverage. Retain traces outside the repository. Clean repeats support stability, not proof of repair.
- [ ] Add short usage to `docs/developers/testing-guide.md` and a dated pointer beside its historical 200 ms experiment. Delete only the finished certificate entry from `docs/backlog/ci.md`; change both bundle counts there and in `docs/backlog.md` from seven to six. Investigate those six only after this PR with the same rig; later deletions require stated loaded-run counts, never a repair claim from repeat success.

**Size:** tool code 150–210 added lines; tests 220–300 added; test support 10–20 added; docs 20–35 added, 6–10 removed. Product code 0; generated 0. No new CI job, cache, dependency, protocol, controller or threshold change. Driver owns finish-branch and current-head CI; scoped package tests and root coverage remain CI’s responsibility.
