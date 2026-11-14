# A1398-2: stream clock readiness polling

Ask verbatim — `/Users/clintongormley/waitron-campaign-i/queue.md`, A1398-2:
> every CI test job finishes in about four minutes (owner, 2026-10-09 and 2026-10-11; CLAUDE.md §2: "Fix the cause, never cut a check"). Measure the cause before a performance plan; at most one page, Claude review and watcher clearance.

Smallest result: shorter readiness waits in the existing stream tests, with the same checks and timeout budgets. The separate high-effort Codex draft received Claude's 114-second plan read; the watcher has not cleared this design. No owner design approval is recorded. Claude questions whether 244–250-second jobs already meet “about four minutes”; the watcher settles that priority before build.

14 November 2026 update: the opening paragraph records the proposal before clearance; see the dated watcher clearance at the end.

## Measured cause

At `4a7ad1ca745ee104485824968a47f1fcd50d3e9b`, unchanged `supervisor.test.ts` passes 153/153 in 49.34 s wall / 48.187 s tests. Timing-only instrumentation also passes 153/153, in 49.50 / 48.67 s: 593 delayed successful `ManualClock.asleep` checks cost 30.557 s; 14 refusals cost 4.220 s. The instrumentation is removed; no candidate is built.
Receipts: `/Users/clintongormley/waitron-campaign-i/receipts/a1398-remaining-20261114/stream-{baseline,profile,profile-summary}.json` and `stream-asleep-profile.jsonl`. The one-off local performance check already fails: 48187.175 ms is not below 35000 ms (`stream-timing-red.txt`). This is neither a permanent timing test nor hosted qualification.

## Build and checks, after watcher clearance

1. In `packages/stream/src/testing/manual-clock.ts`, pass `{ timeout, interval: 1 }` to `ManualClock.asleep`'s existing `vi.waitFor`. Preserve the sleeping-length predicate, immediate check, default 1000 ms timeout, callers' 300 ms budgets, wake limit, `next`/`until` ordering and cancellation. Keep every existing test assertion and explicit timer/I/O wait.
2. Run the helper's two existing consumers **three times**, in their ordinary unshuffled order, recording each JSON separately outside the checkout:
   `pnpm --filter @waitron/stream exec vitest run src/supervisor.test.ts src/supervisor.cancel.test.ts --reporter=default --reporter=json --outputFile.json=<receipt-for-this-run>`
   Each run must pass exactly **153 supervisor cases and 14 cancellation cases, with zero skipped in either file** (the unchanged cancellation baseline passes 14/14 in 3.15 s; `stream-cancel-baseline.json`). The sum of individual test durations in **`supervisor.test.ts` alone** must be **below 35000 ms**, more than 13 s below each retained original; report wall times separately. No new tests or whole-package run. Three passes are bounded timing-risk evidence, not proof that flakes cannot occur. A failure returns to the watcher before any expanded fix.
3. Update only the existing A1398-2 entry in `docs/backlog.md` and section in `docs/backlog/ci.md` to record this slice and remaining qualification. Run `finish-branch` reviews, the normal pre-push hook and current-head required CI. No guard assertion changes. The earlier predicate-deletion exercise is dropped: it does not test the changed polling interval.

## Hosted acceptance and limits

Request exactly **one** current-head full hosted qualification, separately cleared by the watcher, using the existing per-run hosted-attempt marker. Preserve global routing and concurrent markers; do not dispatch or rerun without clearance. Require coverage ON, complete matching file/project/status inventories, existing 98/98/98/95 coverage thresholds and every selected current-head job green. Apply the incident-history, download-5xx and roughly ten-second checkout health checks.
The speed criterion is **both light-a and light-b whole hosted jobs at most 240 s**. Only light-a runs stream; light-b is included for the overall goal, not because this cut changes it (retained diagnostic times 247/191 s). A light-b miss does not establish a regression from this cut. Report the supervisor file time too; do not substitute it for the whole-job criterion or claim a delta against unqualified figures. Any miss returns to the watcher, without another run.
Retained full runs 43555982953/43572788079 attempt 2 show light-a at 250/244 s and supervisor at 46.930/46.874 s; these light figures remain diagnostic, not qualified baselines. The dashboard and till cuts already have watcher-accepted timings (14 November 06:51 and 09:44); do not describe them as unfinished. Server2 is separate (226/238/254 s); no server change is required by this slice. Keep the whole item open for any remaining unqualified gap.

Expected build: test support **+1/-1**, production **+0/-0**, new tests **+0/-0**, docs about **+4/-2** besides this plan. No package moves, new helper, scheduler, shard, worker, table, workflow change or product behavior change. Campaign finish/land authorisation remains subject to plan clearance and all qualification gates.

Watcher clearance, 14 November 2026 11:18 (`~/waitron-campaign-i/questions.md`): “Cleared, inside A1398-2. Light jobs at 244–250 s are just over the owner's four-minute target, and a one-line test-clock change that saves about 30 s locally, without dropping any check, is the cheapest way under it. Three bounded runs as you propose, plus the hosted job time on the PR's own CI. Land it, then close A1398-2 if nothing else in it is over four minutes, and say which jobs still are, if any.” This clears the build and replaces the separate full qualification request above with timing from this PR's CI; no additional dispatch or rerun is authorised.

Watcher correction clearance, 14 November 2026 11:38 (`~/waitron-campaign-i/questions.md`): the completed run-it review found that faster polling exposes the real child-exit wait in “kills a leftover that ignores the polite signal, after the grace”. Add `once(leftover, "exit")`, drive the existing clock through the grace until the replacement fake starts, then await the real exit; retain the exact `SIGKILL` assertion. The watcher cleared this test repair, the delayed-exit control, three consumer-file runs and the single corrections read, with no further review wave. This supersedes the original requirement to leave that test unchanged.
