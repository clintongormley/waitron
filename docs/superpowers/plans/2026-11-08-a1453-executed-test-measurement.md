# A1453: measure test selection and remembered results

**Pending watcher approval.** You get numbers for selecting tests by executed functions and
reusing earlier passing results, not a selector or result store. Lane D's queue assignment
(2026-11-08 17:36) quotes the owner: “it doesn't need to run all the tests”. The watcher added
remembered results at 17:39, recording owner “y”, and raised the budget to three active hours.
The watcher owns the subsequent design. This measurement does not reverse A1427's stop on
selection machinery. No product change, recurring workflow or design proposal lands here.

**Files and size.** This plan and `docs/backlog/ci.md`: about 90 documentation lines total;
`docs/backlog.md`: 0–3 lines only if its index changes. Committed code/tests: zero.
Temporary files under `~/waitron-campaign-d/receipts/a1453-20261108/`: `collector.mjs`, `replay.mjs`
(up to 350 code lines together), `qualify.test.mjs` (up to 90 test lines), and captured evidence.
A disposable checkout's `.github/workflows/a1453-measure.yml` and `a1453.config.ts` (up to 80
configuration lines together) require an explicit exception to “no workflow change” before creation.
Existing dispatch has no instrumentation input (`.github/workflows/ci.yml:38`); the inspected
nightly `server-blob-2` from run 42437905513 has merged coverage, not per-test-file attribution.

1. **Freeze the sample and ceiling first (30 minutes, proposed simpler route).** Pin the latest
   40 merged PRs, historical base/head SHAs and all recorded CI attempts. Before results, define
   the denominator as four-suite file execution seconds from each PR's last completed run on its
   final head, using `[file-progress] end` logs; absent files/logs make evidence incomplete.
   Compare within the same job/runner and coverage mode; do not turn concurrent file time into
   job minutes. Count full-suite fallbacks, then bound combined selection/reuse savings by giving
   every remaining test a free skip, except known required tests. A ceiling below 30% is a drop;
   above 30% proves nothing. Watcher approval must resolve whether this early stop replaces collection.

2. **Qualify then collect (65 minutes).** After hosted-route approval, collect at or before the
   oldest sampled PR's base, matching that historical base version, never a future head. Retain
   SHA, project, environment, single test path, raw function ranges/counts and source maps through
   V8 `onAfterSuiteRun({coverage,testFiles})` before merge, including workspace dependencies.
   Test first: two files call different functions while importing an uncalled third; prove correct
   inclusion/exclusion and reject multi-file attribution/missing maps. Repeat in Node and concurrent
   Chromium pages. Record runtime spawns; tests with unqualified child/worker/bundle/browser paths
   always run, and uncertain attribution forces full affected packages. Run all four suites only
   on hosted machines, including server stream/full-disk and every dashboard project. Reconcile
   expected/executed inventories. No local whole-suite run; unproven coverage is missing evidence.

3. **Replay selection and reuse (60 minutes).** Use each attempt's own base/head diff. Changed
   production top-level code/config/migrations/lockfiles, new/deleted production functions,
   indirect assets, shared helpers and uncertain correspondence fall back to affected packages
   and dependents; unknown scope means all four. Changed tests always run. Match source/ranges,
   not names; report stale-map fallbacks by PR age. Keep all other packages/checks unchanged.
   Replay passing results chronologically across PR/main/other recorded runs; only an earlier pass
   is reusable. Proposed measurement key: test/project, test/setup/helper/config/lockfile/runtime
   identity, executed function bodies and their files' top-level code. Unknown external inputs or
   unqualified execution prevent reuse; fallbacks cannot be bypassed by reuse. Report selection
   alone, extra reuse, remaining files per PR, store entries/bytes, map bytes and rebuild overhead.
   Audit every observed failed test on every head/attempt against both selection and reuse. List
   misses and known recurring failures separately; a passing rerun alone proves neither flakiness
   nor safety. Missing heads/logs remain gaps. Report “no miss among N observed failures”, not safety.

4. **Write the decision (25 minutes).** Reject under 30% combined file-time saving after fallbacks,
   or any missed observed failure not covered by a justified fallback; missing evidence is inconclusive.
   Qualify hosted timing via incident history, no download 5xx and checkout under about 10 seconds.
   Report estimated file seconds separately from actual jobs/minutes, empty-job opportunities,
   unchanged setup/checks, runner/concurrency effects, map/result-store size and nightly rebuild cost.
   Explain that asset/top-level fallbacks may retain the logo example and unmapped fiscal tests.
   Stop at three active hours with exact gaps. Recommend build/drop only from adequate evidence;
   the watcher's later design decides selection, remembered results and a warm large runner.
