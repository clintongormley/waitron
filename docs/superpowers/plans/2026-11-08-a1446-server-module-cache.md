# A1446: measure server module-cache savings before shipping

Task assignment: Lane E questions.md, WATCHER 2026-11-08 16:45, “Take A1446 now … Server test shards reuse Vitest’s on-disk module cache. Budget 1 hour to an open pull request.” Plan approval is pending. Claude’s first read found that workflow-only changes skip server jobs and main-only saving makes pre-landing measurement impossible. This revised measurement-first route needs watcher approval before any implementation. Exclude approval wait from the one-hour draft-PR budget.

First retain the existing 24 server-shard logs from run 42482001733. Their Duration summaries total 526.62 seconds of transform time, 3,423.55 seconds of imports and 8,853.30 seconds of tests; these are diagnostic observations, not savings or a qualified performance baseline. Check the GitHub incident history, download errors and checkout durations under the shared CI-failure rule before using any run to decide performance. The potential saving must exceed 120 aggregate worker-seconds plus cache overhead.

If approved, use one disposable draft PR, never merge it, and no new jobs. A temporary comment in `apps/server/src/email-sender-name.ts` selects the existing server shards. Run the unchanged baseline, then enable the CLI fsModuleCache flag only without coverage and save under an experiment-only PR key, then remove saving and deliberately break that module’s result, then restore it. Finish each run before pushing the next. The broken run must fail its existing behavioral assertion while DEBUG=vitest:cache:fs shows other modules read from cache; the restored run must pass. Retain actual hits/misses, runner labels/workspace paths, test counts and run IDs. Measure on hosted runners with identical checkout paths; do not change shared runner settings. If that cannot be arranged without changing other lanes, ask the watcher.

Before adding a cache exporter, populate the complete noncoverage server test set locally in a disposable checkout and measure its cold cache and compressed size; estimate storage for all shard copies. Re-read GitHub’s cache inventory: the 8 November observation is 4,849,363,717 bytes, consisting of pnpm entries and Playwright. Name the entries the proposal would compete with. Do not delete shared caches. Use stable lockfile/config/Node/platform/workspace-path/shard boundaries for the experiment, including package tsconfigs; omit duration-table hashes. Use an experiment prefix with no per-commit accumulation.

Compare aggregate server test-step time cold versus warm, subtract restore overhead and report save overhead separately. Confirm transform time also falls; a warm-cache hit alone is not a speed-up. Stop with a write-up if the net saving is below 120 seconds or measurements cannot distinguish it from noise. A production exporter is conditional on this evidence and watcher approval of its storage/refresh policy: do not land an unmeasured main-only seed. Main-cache reuse must eventually be observed on a PR, separately from this benefit measurement.

Files: this plan; `.github/workflows/ci.yml` (about 35–55 configuration lines for the temporary experiment); `apps/server/src/email-sender-name.ts` (temporary comment and one-line broken-source control, restored); `scripts/ci-workflow.test.mjs` (about 20–30 focused guard lines only if proceeding to production); `docs/developers/ci-and-gates.md` (about 15–25 lines only if shipping). No backlog entry currently names A1446. Observe failing guards before implementing production wiring. Product behavior, coverage, shard allocation and stream jobs remain unchanged. The finish line is a measured go/no-go with retained real-CI results; shipping requires the ordinary hook, review and current-head checks as well.

Approval update, 8 November: Lane E questions.md WATCHER 16:13 approved this experiment; 16:47 replaced local whole-suite sizing with hosted cold-run sizing and approved this branch’s temporary hosted server routing and matching guard. Restore the routing and guard before any production PR; shared repository variables remain untouched. WATCHER 17:17 granted the renewed experiment window and requires measured results under `READY TO SHIP` before the production step. These decisions supersede the pending-approval and local-sizing sentences above.


## Experiment disposition, 8 November 2026

The watcher ended the experiment at 19:30, whether or not measurements were complete
(Lane E questions.md, WATCHER 18:01). The baseline and cold-cache runs completed;
the hosted changed-source control and restored warm run did not. You cannot use
these results to claim either a speed-up or a lack of benefit. No production cache
change is being shipped. [Disposable PR #2613](https://github.com/clintongormley/waitron/pull/2613)
is closed without merging.

| Observation | Baseline | Cold cache enabled |
| --- | ---: | ---: |
| CI run | [42502923814](https://github.com/clintongormley/waitron/actions/runs/42502923814) | [42506217462](https://github.com/clintongormley/waitron/actions/runs/42506217462) |
| Head | `38fe80791680639dd25021848b3cca3199c6cf44` | `e117f7492ee9b8745904e011f125d39822d2a0cd` |
| Server shards | 24 | 24 |
| Passed tests | 31,487 | 31,487 |
| Sum of server test-step seconds | 3,190 | 2,982 |
| Sum of Vitest transform seconds | 533.24 | 545.60 |

Both CI runs completed successfully. The times above are sums across workers,
not elapsed pull-request time. The cold run also spent 87 worker-seconds on cache
restore misses, 25 on sizing and 114 on saving. Its 24 stored cache entries occupied
263,556,548 bytes; the recorded inventory, including pnpm and Playwright entries,
totalled 4,938,532,333 bytes. This measures one set of experimental cache entries,
not the storage cost of a production refresh policy.

The cold run's full incident-history and checkout qualification was unfinished.
Treat these figures as diagnostics, not an accepted performance comparison. In
particular, subtracting the two test-step totals does not measure warm-cache savings.

The changed-source control at `e7bc190ec73b3b7db5e00fe5b717067bdce407bd`
returned a wrong email sender name. Its existing local sender tests reported six
failures and seven passes. Restoring the source at private head
`08058b2464` reported 13 passes. The PR was conflicting and GitHub reported no
checks for the broken head; no hosted cache-invalidation result was established.
No warm-run benefit or reuse of a main cache by a PR was established either.

The retained Lane E receipts are `receipts/a1446/baseline-ci.json`,
`baseline-ci.log`, `baseline-measurements.json`, `cold-resume-1914.json`,
`cold-logs.zip`, `cold-measurements.json`, `cold-cache-inventory.json`,
`broken-local.log` and `restored-local.log`. The final readback recomputed the
24 baseline step times from their recorded shard rows, the cold step times from
job timestamps, both transform totals and passing-test counts from retained
summaries, and stored bytes from the cache inventory. These receipts stay outside
the repository; the linked Actions runs provide the hosted records.
