# Server test levers implementation plan

**Goal:** Deliver measured test-only savings in unheld files and guards that follow the server shard matrix, in one PR.
**Source:** Lane I SERVER-TEST-LEVERS, quoted in the review brief; `docs/backlog/ci.md` → “Server test time levers left after A1297”. Codex drafted this plan; Claude review and watcher clearance are pending.
**Approach:** Reuse `test/fixture-salt.ts`, the archive-key cache, the host memo’s exact-input behaviour and existing workflow readers. Execute inline with `superpowers:executing-plans`, using TDD for new behaviour.

## Scope and measurement

- [ ] Refresh open-branch diffs and uncommitted changes before each file. Current reservations are in Lane I `receipts/server-test-levers-20261116/`. Skip held files and preserve their exact backlog points: `src/testing/staged-hour-crash.ts`, `test/hour-recovery-host.ts`, `src/hour-recovery-host.test.ts`, placement-1/2/3 and restore-emergency-crash.
- Leave production, crypto algorithms/costs, global Vitest setup, `first-fiscal-hour*` restart work, fixed-secret work and the migration-template decision out. No new caching framework or deliberately broken CI run.
- [ ] Baseline the three unheld `apps/server/src/` restore files: `restore-emergency.test.ts` (committed estimate 6.6s), `restore-emergency-attempts.test.ts` (20s), `restore-paper-export.test.ts` (11.9s). Separately baseline `handover-stepdown.crash.test.ts` (46.9s) and `handover-activation-repair.test.ts` (36.2s).
- Run each file in three fresh processes before and after each retained change: `/usr/bin/time -p pnpm --filter @waitron/server exec vitest run src/<file> --maxWorkers=1`. Keep flags/runtime comparable, record load, counts, samples and medians outside the repo. Measure salt and memo separately. Keep an optional optimisation only when savings exceed observed noise and justify its complexity; claim no whole-suite or CI gain.

## 1. Reuse existing fixture work

- [ ] In `apps/server/src/testing/staged-hour-restore.ts`, replace `encryptArtifact` with `sealFixtureArtifact` from `test/fixture-salt.ts`. Before implementation, add a regression in `src/restore-emergency-attempts.test.ts` that observes repeated fixture sealing with the same passphrase through `derivedKeyStats()` and requires no second archive-key derivation. Use independent existing database fixtures if repeated setup requires them. Observe the expected failure, then make the swap and run green.
- [ ] Rerun all four existing consumers: the three restore files above and `src/device-after-offline-restore.test.ts`, without changing their assertions. They own archive/stream results, publication recovery and old-key acceptance. The held crash helper remains open.
- [ ] Create `test/recovery-key-memo.ts`, `src/testing/recovery-key-memo-setup.ts` and `src/testing/recovery-key-memo.test.ts`. Export `memoizeSecretVerifier(real: (secret: string, stored: string) => Promise<boolean>)` returning the same signature. Follow the existing host’s exact secret/stored-hash Promise map, rejection eviction and `setImmediate` yield on hits. Explicit setup imports opt in only measured useful restore files; never install universally or inside their shared helper.
- [ ] Test the helper first: repeated and concurrent identical pairs call through once; wrong secrets and changed hashes remain separate and preserve false answers; rejected checks retry; a hit yields a real event-loop turn. Helper tests own caching; existing suites own recovery. Do not move the held host memo or its counter; do not opt watched-crypto suites in.
- [ ] Run unchanged controls `src/recovery-operation.test.ts`, `src/pin-check-ahead.test.ts`, `src/testing/derived-key-cache.test.ts` and `src/artifact-cipher-file.test.ts`. Preserve all crypto and derivation assertions. Adopt no memo if measurements do not justify it.

## 2. Measure remaining child loading

- [ ] Inspect the two unheld handover suites and `src/testing/handover-activation-kill-child.ts`. Try a simpler loader/build only when the baseline suggests useful savings, including build cost. Keep `registerHooks` substitutions effective, paired wall/steady clocks, the 1.1s control, IPC and existing kill/recovery assertions.
- [ ] Use existing assertions as the failing control where they detect a lost substitution; add a behaviour test first only for a missing check. Keep a loader change only after its full files pass and three after samples justify it. Otherwise record the measured reason and retain that exact backlog point. Held placement files remain untouched.

## 3. Follow the actual workflow matrix

- [ ] Replace only the authorised `24` upper bound in `scripts/vitest-duration-sequencer.test.mjs` with `test-server`’s matrix length read from `ci.yml`, following the adjacent dashboard/till reader. Require a found nonempty matrix and preserve uniqueness/completeness assertions for every count from two through that bound.
- [ ] Prove the existing `scripts/ci-workflow.test.mjs` “expects as many reports…” check (currently line6076) against wrong first and second server-download counts independently in disposable copies. It already compares helper downloads with needed shard/stream uploads; add no duplicate guard if both controls fail correctly. Correct the stale backlog claim with the executed receipt. If a real gap appears, demonstrate it first and make the smallest added check using the existing readers.
- [ ] Run `pnpm exec vitest run scripts/vitest-duration-sequencer.test.mjs scripts/ci-workflow.test.mjs` with actual counts. Use disposable controls to show the sequencer follows an expanded matrix and the count guard rejects a missing stream contribution; restore each control. These check workflow text, not hosted execution.

## 4. Finish the useful result

- [ ] Narrow only delivered points in `docs/backlog/ci.md` and its bundle/index in `docs/backlog.md`; preserve held work, unbuilt loader work, restart/fixed-secret work and migration-template receipts. Refresh only measured entries in `apps/server/test-durations.json` if samples justify it.
- [ ] Obtain Claude’s plan review and watcher clearance before build. Then signed-off commits, `finish-branch`, required current-head CI and `land-branch`. Report usable result and what remains; no owner design approval is claimed.

**Size/time:** production0; tests about180 changed lines; support130; docs90; total400, outside opinion before600 (1.5×). Keep the PR within3 active hours, excluding outside waits. A material change returns to the watcher first.
