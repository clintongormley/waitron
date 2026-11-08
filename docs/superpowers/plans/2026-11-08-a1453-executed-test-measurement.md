# A1453: measure selection by executed functions

**Status: pending plan approval.** Lane D queue assignment, watcher 2026-11-08 17:36,
quotes the owner: “it doesn't need to run all the tests, eg running the verifactu tests when i change the logo”.
This authorizes measurement only; the driver arranges the Claude read and watcher approval before building.
You get a short evidence-based recommendation for server, ui, dashboard and till, within two active hours.
Reject below 30% saved test-execution minutes after fallbacks, or any observed failure missed without a valid fallback.
Missing evidence means inconclusive, never safe. No product selector, landing workflow change or recurring workflow.

**Files and size.** Commit this plan (about 50 doc lines) and `docs/backlog/ci.md` (about 35 doc lines); only if recommending build, add `docs/superpowers/plans/2026-11-08-a1453-test-selection-proposal.md` (at most one page, Claude-read before owner approval).
Touch `docs/backlog.md` only if its index actually changes (0–3 doc lines). Committed code: 0; tests: 0.
After watcher approval only, put temporary work beneath `/Users/clintongormley/waitron-campaign-d/receipts/a1453-20261108/`:
`collector.mjs`, `replay.mjs` (combined ≤250 code lines), `qualify.test.mjs` (≤60 test lines),
`hosted/` (disposable checkout; config ≤40 lines, workflow ≤40 lines, only if explicitly approved), plus `raw/`, `maps/`, `replay/` for evidence. No temporary scripts in the landing tree.

1. **Authorize the collection route and freeze the sample (20 active minutes).** A1427's decision in `docs/backlog/ci.md` stopped import selection for cost; this experiment does not revive it.
   Pin the latest 40 merged PRs at measurement start, their base/head SHAs and every recorded CI head/run/attempt.
   `.github/workflows/ci.yml:38` has `workflow_dispatch` without inputs; dispatch enables full coverage,
   but existing aggregate reports/blobs do not establish per-file attribution. No proven collection route yet.
   If capture requires disposable workflow/config instrumentation on a nonlanding branch, obtain an explicit
   watcher decision permitting that exception to “no workflow change”, including exact paths, before creating it.

2. **Qualify, then collect once on hosted machines (45 active minutes).** Use the installed V8 provider's
   `onAfterSuiteRun({coverage,testFiles})` hook before merge; retain SHA, project, environment and single test path.
   Reference: `node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:732`; provider `dist/index.js` and `dist/browser.js`.
   Capture raw function ranges/counts above zero and source maps before provider filtering/aggregation loses detail;
   include executed workspace dependencies. Reject multi-file attribution rather than assigning the union to each file.
   First observe a failing qualification, then qualify two files calling distinct functions: each selects its caller,
   excludes the other, and excludes an imported but uncalled function; injected multi-file/missing-map input forces fallback.
   Check browser isolation and worker/child-process/bundled-code gaps; any unqualified path forces full affected-package tests.
   Then run all four suites, including dashboard projects and server's separate stream/full-disk jobs, on hosted runners.
   Reconcile expected/executed file inventories; capture coverage, timings, source identity and overhead. No local whole-suite run. Unsupported collection or missing suites means inconclusive.

3. **Replay and audit failures (40 active minutes).** Match functions across each PR's base/head and collection SHA
   by source/body correspondence and mapped ranges, never names alone. A later map has look-ahead bias:
   use a function only when its collected body matches the relevant historical version; otherwise fall back. Label results retrospective estimates, not historical qualification.
   Changed top-level code/config/migrations/lockfiles, new/deleted functions, missing maps, indirect assets/tests,
   uncertain mapping or correspondence force the full affected-package suite, including dependent packages;
   unknown affected scope forces all four. Keep all other checks and packages as CI actually ran them.
   Enumerate every failing test across all recorded heads and attempts of all 40 PRs, including cancelled/failed runs;
   report selected/direct, covered by a justified fallback, or missed. Out-of-scope tests remain retained and listed.
   Missing logs, unknown test identities and infrastructure failures are missing evidence, never passing safety checks.

4. **Report the decision (15 active minutes).** Use timings only after incident-history checks for Actions/Git/API/Webhooks,
   no download HTTP 5xx, and slowest checkout under about 10 seconds; record qualifying run/attempt IDs and rejected runs.
   Separate estimated summed test execution, measured job time, possible empty-job elimination, worker/concurrency effects,
   unchanged setup/other checks and collection/replay overhead; compare like coverage modes, never sum parallel time as elapsed time.
   Report per-package/total savings, fallback frequency, raw/compressed map bytes and nightly rebuild job-minutes/elapsed cost.
   Recommend build or drop only with complete evidence; otherwise list exact gaps and the next watcher decision needed.
   At two active hours stop with honest partial evidence. A build recommendation includes the one-page owner proposal above; it never authorizes building a selector here.
