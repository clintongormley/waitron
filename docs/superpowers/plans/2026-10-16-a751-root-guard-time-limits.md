# A751 — the root project's time limits under load: plan

Spec: lane B's queue item A751 (copied below), with the owner's 2026-10-05 test-change decision.
Worktree `/Users/clintongormley/workspace/worktrees/waitron-feat-a751-root-guard-time-limits`,
branch `feat/a751-root-guard-time-limits`. Receipts: `~/waitron-campaign-b/a751-receipts/`.

> **What happened:** lane G's push of A182-2 (2026-10-16 ~14:44) failed the hook's root project:
> `Tests 8 failed | 6729 passed`, `Duration 242.66s`. One was a real stale pointer (fixed). The
> other seven were time limits under load: `scripts/migration-upgrade.test.ts` "Still running after
> 174060 ms, past the 174000 ms deadline"; `scripts/migrations-match-schema.test.ts` staffing and
> venue-service "drizzle-kit generate did not report…" at ~30 s; `scripts/ci-workflow.test.mjs` the
> jobs-API cross-check "spawnSync bash ETIMEDOUT" (killed after 10000 ms) twice plus "expected 2 to
> be 1" on the paging case, and "cover every package declaring test:coverage exactly once" "Test
> timed out in 60000ms".
> **Do:** reproduce under realistic load first, say what the failing case prints, and measure each
> of the four files' own time and the spawned children's. Then fix whichever is wrong: a deadline
> below its own worst case, a slow test that can be made faster at its cause, or the hook's
> scheduling of the root project. The "expected 2 to be 1" paging case may be a real ordering
> assumption that only load exposes — check it on its own. No assertion weakened; no deadline
> raised without a receipt that it clears the child's measured worst case with margin.

## What was measured (macOS, 18 cores, 64 GB, Node v26, Vitest 4.1.11)

| Scenario | Walk total | Slowest walk phase | drizzle case | "cover every package" | jobs-API default case | Root failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| file alone | 54–60 s | 0.5–0.9 s | 1.2–3.1 s | 3.2 s | ~0.5 s | — |
| whole root, idle machine | 72 s | — | 11–13 s | 16 s | 3.2 s | 0 |
| root + 16 CPU burners (`loaded16`) | >173 s (failed) | — | 22 s | 34 s | 1.9 s | 1 |
| walk beside root + burners, deadline lifted (`loaded16b`) | 377 s | 6.5 s | — | — | — | — |
| three roots at once + 8 burners, load avg ~60 (`heavy3`) | >173 s (failed) | — | >30 s (all 15 killed) | 162 s (failed) | 4.6 s | 30–33 each, in 10 files |
| lane G's failing push (243 s run) | >174 s | — | >30 s | >60 s | >10 s (killed) | 7 |
| heavy3 sustained ~20 min, limits lifted (`heavy3-lifted`) | 1,108 s wall; 115 s main-thread CPU (125 s process) | 34 s (largest gap between watch events) | up to 140 s (staffing; venue-service 105 s) | — | — | — |

Alone, the walk used 56 s of process CPU (`upgrade-probe-alone.log`: 43.6 s user + 12.8 s sys).

**Numbers this plan sets from those receipts.** Walk work budget: unchanged formula (30 s + 500 ms
per step, 173 s today) on main-thread CPU — 1.5x the heaviest loaded 115 s, the same margin today's
budget has over CI's slowest passing wall time (105 s). Walk no-progress limit: 120 s, 3.5x the
largest measured gap (34 s); a hang is now named within two minutes (today 174 s). Walk Vitest
bound: 1,800 s, 1.6x the heaviest measured wall (1,108 s) — a backstop only. drizzle-kit generate:
300 s (2.1x 140 s); its per-test bound 330 s.

Memory was never short (58–60% free): the slowness is CPU starvation, and the root project starves
its own heavy files 3–5x even on an idle machine.

**The "expected 2 to be 1" cause** (`orphan-probe-*.log`): `spawnSync`'s timeout SIGTERMs the outer
`bash -c '…'` only. The inner `bash -e -c "$VERDICT_SCRIPT"` survives as an orphan, keeps looping,
and its `gh` stub writes `count` into the ONE stub directory every case shares — after the next
case has reset it. Not an ordering assumption in the script; a leak in the test harness.

**What is NOT changed and why.** Under `heavy3` seven more files fail (`brand-build`,
`guarded-teardowns`, `menu-sections-upgrade`, `mutation-shard`, `pre-push`, `run-with-deadline`,
`write-path-tables`); none failed under `loaded16` or in lane G's push. They go to the backlog with
the receipts, not into this change (a finding is not a licence to widen the item). The product's
`removeChangeFeed` drops 561 triggers one statement at a time (85–180 ms; 43–48 ms in one
transaction, `probes/feed-probe`) — a product change in `packages/db`, recorded in the backlog.

## Task 1 — `scripts/ci-workflow.test.mjs`: the leaked script, and the serial `pnpm ls` calls

1. **Failing test first — isolation, not "nothing after the kill".** A killed run's `$(…)`
   subshells outlive the kill even with `exec` (plan review, 40 of 40 runs both ways), so one more
   `gh` call after a kill is normal. What must hold is that it cannot reach ANOTHER run. Shape: run
   A on the default-window input with a `sleep` stub that really sleeps (the stub reads an
   environment variable, e.g. `STUB_SLEEP`, default instant) and a kill after ~100 ms; then run B
   (one `gh` call expected); wait ~1 s; re-read B's `count`: it must still be 1. Watch it fail on
   today's shared directory.
2. Fix: the two stub EXECUTABLES stay built once per file (CLAUDE.md §4) in their own directory on
   `PATH`; each `runCrossCheck` call gets its own fresh STATE directory passed as `STUB_DIR` (which
   the stubs already read), removed in `afterAll`. Also `exec` the inner bash in `runVerdict` and
   `runCrossCheck` (`'exec bash -e -c "$VERDICT_SCRIPT" 2>&1'`): it does not stop the leftover but
   shortens it — say exactly that, no more.
3. `VERDICT_SPAWN_TIMEOUT_MS` 10 s → 30 s: heavy3's worst default-window case was 4.6 s (6.5x;
   `heavy3/root{1,2,3}.json`); lane G's was killed past 10 s; idle full root 3.2 s. Each case that
   runs the script gets a per-test bound above the sum of its runs' kill bounds, as a NAMED constant
   (`scripts/spawn-timeout-budget.test.ts` resolves only plain sums of numbers and constants, so no
   inline arithmetic).
4. The two shard cases ("cover every package declaring test:coverage exactly once", "give each
   package its dedicated shard"): their `selects(...)` calls run CONCURRENTLY (async `execFile`
   with the same per-call `timeout`, all started before any is awaited), memoised per filter set so
   the second case reuses the first's answers. Rules: cache only a SUCCESSFUL answer (a failure must
   not fail the other case); abort every still-running child when its case ends (an `AbortSignal`
   passed to `execFile`, aborted in `afterEach` or a `finally`); `workspaceListing()` stays
   synchronous (`scriptsByPackage()` runs at collection time). Same calls, same answers, same
   assertions. Keep the helper's contract tests (exit status, killed child, timeout passed, real
   kill), adapted to the async runner and at least as strict; add one for the abort. Update the
   two-timeouts comment to what is now true for these cases.
5. Run `pnpm exec vitest run scripts/ci-workflow.test.mjs` from the worktree root; all pass.

## Task 2 — the upgrade walk: budget its own WORK, and name a phase that stops

The walk's budget is documented as "a workload budget" (ci-and-gates.md, "The upgrade deadline
grows with the walk"), sized from CI walks of 80–105 s. Measured in wall-clock time it also
measures the other lanes. Keep the budget and its formula unchanged (30 s + 500 ms per step, today
173 s), but measure the walk's OWN processor time (`process.threadCpuUsage()`, main thread: the
engine is synchronous on it). In CI the walk's scratch is in memory and the runner is its own, so
there wall ≈ CPU and the check behaves as today (CI numbers to cite: run 38137016367).

1. `scripts/step-watch.mjs`: `reportStallAfter` takes two limits —
   `{ workMs, idleMs }` (names are the implementer's): (a) **work**: the body fails once its
   main-thread CPU time passes `workMs` — checked at every watch event and at the end ("Used N ms
   of processor time, past the M ms budget", plus the summary), so a synchronous hold that burns
   CPU and then lets go still fails, as today's "Finished after" does; (b) **no progress**: the
   body fails when no phase starts or finishes for `idleMs` of WALL time — the main timer checks the
   gap at each event BEFORE re-arming (a hold longer than `idleMs` fails even though the old timer
   never fired), and the watchdog thread's due time is re-armed from each message it reads, so a
   synchronous hold is reported `graceMs` after the LAST event. The stall report keeps today's
   content. Failing tests first in `scripts/step-watch.test.mjs` for each: a long-wall, low-CPU
   body whose phases keep moving passes; CPU past `workMs` fails; a gap past `idleMs` fails naming
   the phase; a held thread past `idleMs` that lets go fails; the watchdog reports a hold after the
   last event.
2. `scripts/migration-upgrade-budget.mjs`: `workMs` = today's formula; `idleMs` 120 s; Vitest
   bound 1,800 s (receipts above).
   Rewrite `scripts/migration-upgrade-budget.test.mjs` to pin: the captured CI workload (110,242 ms)
   still passes as WORK; a walk at its work budget fails; the Vitest bound clears the measured
   loaded wall total with margin and the idle limit plus grace.
3. `scripts/migration-upgrade.test.ts`: use the new budget; the printed line names both limits and
   the walk's CPU and wall time. No migration, row, reset or trigger assertion changes.
4. The Vitest bound is above CI's `root-guards` job limit (`timeout-minutes: 8`): in CI the work
   budget fails first (wall ≈ CPU there), so the report still comes. State that in the docs.
5. Run `pnpm exec vitest run scripts/step-watch.test.mjs scripts/migration-upgrade-budget.test.mjs scripts/migration-upgrade.test.ts`.

**Why not the hook's scheduling.** The spec offers it. The root project does slow its own files 3–5x
(idle machine), but every lever there is a count: fewer Vitest workers (the watcher named dropping
to 2 workers a workaround), or a lower `maxConcurrency` for the drizzle cases (alone, 1 took 21 s
and 5 took 10 s — the file gets slower, each process a little faster). The limits that failed are
hang detectors and a work budget; fixing what they measure is the cause-level change.

## Task 3 — `scripts/migrations-match-schema.test.ts` bounds, and the receipts under load

1. `GENERATE_TIMEOUT_MS` and `TEST_TIMEOUT_MS`: raised to clear the worst case measured with the
   limits LIFTED under heavy3 (`heavy3-lifted/mms.json`, run before implementation) with at least
   2x margin; the per-test bound clears the generate bound plus the copy and comparison.
2. Verification on the finished branch: rerun heavy3 (three root projects + 8 burners) with the
   JSON reporter; read each drizzle case, both shard cases and their per-call `pnpm ls` times (the
   30 s per-call limit, now with calls side by side), the walk's wall, CPU and largest gap, and the
   default-window cases. Pass condition: none of the four named files fails under heavy3, and
   nothing fails in an idle root run. Record both runs' numbers in the PR.

## Task 4 — docs, backlog, CLAUDE.md

1. `docs/developers/ci-and-gates.md`: rewrite "The upgrade test names the phase it stalled in" and
   "The upgrade deadline grows with the walk" for the progress deadline, with this plan's receipts;
   keep every older measurement that is still true, mark retired ones as history in one line.
2. `docs/developers/testing-guide.md` + CLAUDE.md §4, one line: **a `spawnSync` timeout kills only
   the process it started; the script's own children keep running, so each run keeps its files
   apart** (`exec` shortens the leftover, it does not end it). Cost: A751's "expected 2 to be 1".
   Also update `vitest.config.ts`'s `testTimeout` comment where it cites ci-workflow's 60 s, and
   `docs/backlog.md`'s line linking `#the-upgrade-deadline-grows-with-the-walk` (the pointer guard
   skips anchors).
3. `docs/backlog.md`: (a) the seven other root files that fail at load ~60, with heavy3's numbers;
   (b) `removeChangeFeed` dropping triggers one statement at a time, with the probe's numbers.
4. PR description: "Changed test checks" section listing every changed check with before/after;
   FYI entry in `~/waitron-campaign-b/questions.md`.
