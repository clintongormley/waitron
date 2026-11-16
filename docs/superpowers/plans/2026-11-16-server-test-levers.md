# Server test levers implementation plan

**Goal:** Deliver measured test-only savings in unheld files and guards that follow the server shard matrix, in one PR.
**Source:** Lane I SERVER-TEST-LEVERS, quoted in the review brief; `docs/backlog/ci.md` → “Server test time levers left after A1297”. Codex drafted this plan; Claude reviewed the corrections, and the watcher cleared it at 07:13 on 16 November in Lane I questions.md. No owner design approval is claimed.
**Approach:** Reuse `test/fixture-salt.ts`, the archive-key cache, the host memo’s exact-input behaviour and existing workflow readers. Execute inline with `superpowers:executing-plans`, using TDD for new behaviour.

## Scope and measurement

- [ ] Refresh open-branch diffs and uncommitted changes before each file. Current reservations are in Lane I `receipts/server-test-levers-20261116/`. Skip held files and preserve their exact backlog points: `src/testing/staged-hour-crash.ts`, `test/hour-recovery-host.ts`, `src/hour-recovery-host.test.ts`, placement-1/2/3 and restore-emergency-crash.
- Leave production, crypto algorithms/costs, global Vitest setup, `first-fiscal-hour*` restart work, fixed-secret work and the migration-template decision out. No new caching framework or deliberately broken CI run.
- [ ] Baseline the three unheld `apps/server/src/` restore files: `restore-emergency.test.ts` (committed estimate 6.6s), `restore-emergency-attempts.test.ts` (20s), `restore-paper-export.test.ts` (11.9s). Separately baseline `handover-stepdown.crash.test.ts` (46.9s) and `handover-activation-repair.test.ts` (36.2s).
- Run each file in three fresh processes before and after each retained change: `/usr/bin/time -p pnpm --filter @waitron/server exec vitest run src/<file> --maxWorkers=1`. Keep flags/runtime comparable, record load, counts, samples and medians outside the repo. Measure salt and memo separately. Keep an optional optimisation only when savings exceed observed noise and justify its complexity; claim no whole-suite or CI gain.

## 1. Reuse existing fixture work

- [ ] In a disposable probe, instrument archive sealing through `derivedKeyStats()` and observe the repeated-setup assertion fail with fresh salts. Then replace `encryptArtifact` in `apps/server/src/testing/staged-hour-restore.ts` with `sealFixtureArtifact` from `test/fixture-salt.ts` and observe the same assertion pass. Keep expensive repeated setup out of permanent behaviour suites; the existing cache/crypto tests retain ownership of key correctness.
- [ ] Run all four existing consumers unchanged: the three restore files above and `src/device-after-offline-restore.test.ts`. They own archive/stream results, publication recovery and old-key acceptance. The held crash helper remains open.
- [ ] Before building any memo, count and time real `verifySecretAsync` calls in disposable instrumentation. Keep it only if repeated checks cost at least 0.5s per measured file and three before/after samples show a gain beyond their observed noise. Otherwise record the measurement and leave that backlog point open.
- [ ] If earned, reuse the host’s small inline `vi.mock("@waitron/identity")` pattern inside `src/testing/staged-hour-restore.ts`, which already owns the four consumers’ mocks. Cache exact secret/stored-hash Promise pairs, evict rejection and yield `setImmediate` on hits. Leave the held host untouched; merging the copies waits for its release. Add no shared memo framework or global setup.
- [ ] Before memo implementation, write focused failing cases in `src/testing/staged-hour-restore.memo.test.ts`: real derivation counts for repeated/concurrent pairs, separate wrong-secret/changed-hash answers, rejection retry and a real event-loop turn on hits. Keep identity verification real, observing only crypto calls; then implement and run green. This suite owns memo semantics, restore files own recovery results.
- [ ] Run unchanged controls `src/recovery-operation.test.ts`, `src/pin-check-ahead.test.ts`, `src/testing/derived-key-cache.test.ts` and `src/artifact-cipher-file.test.ts`. None of the four restore consumers currently loads watched-scrypt; refresh that check before memo adoption. Preserve every crypto and derivation assertion.

## 2. Measure remaining child loading

- [ ] Time spawn → existing startup mark per child in the two unheld handover suites, count children and compare the resulting total with the file baseline. This includes startup beyond tsx, so it is an upper bound on loader savings, not an isolated loader cost.
- [ ] Stop at measurement if that upper bound is below 10% of the file’s elapsed median. If larger, take the measurement and smallest concrete candidate back to the watcher before building a loader change. No prebuilt-child infrastructure is authorised by this plan. Retain `registerHooks`, paired clocks, the 1.1s control, IPC and all kill/recovery assertions unchanged; held placement files stay untouched.

## 3. Follow the actual workflow matrix

- [ ] Replace only the authorised `24` upper bound in `scripts/vitest-duration-sequencer.test.mjs` with `test-server`’s matrix length read from `ci.yml`, using the adjacent reader’s approach but limiting extraction to the test-server job block, so a missing matrix cannot select the next job. Require a found nonempty matrix and preserve uniqueness/completeness assertions for every count from two through that bound.
- [ ] Prove the existing `scripts/ci-workflow.test.mjs` “expects as many reports…” check (currently line 6076) against wrong first and second server-download counts independently in disposable copies. It already compares helper downloads with needed shard/stream uploads; add no duplicate guard if both controls fail correctly. Correct the stale backlog claim with the executed receipt. If a real gap appears, demonstrate it first and make the smallest added check using the existing readers.
- [ ] Run `pnpm exec vitest run scripts/vitest-duration-sequencer.test.mjs scripts/ci-workflow.test.mjs` with actual counts. Use disposable controls that remove or rename test-server’s shard line and remove its stream contribution, requiring the relevant guard to fail. Restore each control. An expanded matrix alone is not a control: packing can pass for either bound. These check workflow text, not hosted execution.

## 4. Finish the useful result

- [ ] Narrow only delivered points in `docs/backlog/ci.md` and its bundle/index in `docs/backlog.md`; preserve held work, unbuilt loader work, restart/fixed-secret work and migration-template receipts. Refresh only measured entries in `apps/server/test-durations.json` if samples justify it, counting their lines in the size report.
- [ ] Obtain Claude’s plan review and watcher clearance before build. Then signed-off commits, `finish-branch`, required current-head CI and `land-branch`. Report usable result and what remains; no owner design approval is claimed.

**Size/time:** production 0; tests about 90 changed lines; support 40; docs 70; duration data up to 10; total 210, outside opinion before 315 (1.5×). Keep the PR within 3 active hours, excluding outside waits. A material change returns to the watcher first.
