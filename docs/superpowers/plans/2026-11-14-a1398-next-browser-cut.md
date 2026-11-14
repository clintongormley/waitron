# A1398-2: next browser CI cut

Draft only. Build inline after Claude plan review and watcher clearance; neither has happened here.
No human design approval is claimed. Land this plan as docs-only only when cleared; expect one implementation PR.

The exact ask in `~/waitron-campaign-i/queue.md`, A1398-2, is:
> every CI test job finishes in about four minutes (owner, 2026-10-09 and 2026-10-11; CLAUDE.md §2: "Fix the cause, never cut a check"). Measure dashboard and till on current main first; a performance plan needs measured causes and expected saving, at most one page, Claude review and watcher clearance.

## Evidence and proposed result

Use the retained coverage-on main samples, both successful with 85 selected jobs:
scheduled `43545365252`, head `58d3c38bddfc9dae66fbc5bf60c7b11f16121724`, and
coordinated `43544246652`, head `03313e5cb242ee03f76364a34ebd6dfb23e4ae89`.
Watcher's `questions.md`, 2026-11-14 03:51, accepts scheduled's 11-second maximum checkout
with clean HTTP 5xx and incident checks. Its receipt is `receipts/dialog-close-20261114/scheduled-qualification.json`
(the watcher's note supersedes its pending verdict). Coordinated's 12-second maximum makes it corroboration only.
All receipt paths below are under `~/waitron-campaign-i/receipts/a1398-next-cut-20261114/`; input logs remain local.

`measurements.json`: dashboard shards 1–4 take 330/301/263/268 s scheduled, 247/313/270/239 s coordinated;
their test steps take 295/274/234/215 s and 220/274/236/210 s respectively. Outside-step time is 27–53 s scheduled.
Both complete 534 distinct paths, totalling 2635.6/2456.4 file-seconds (scheduled/coordinated).
Slowest dashboard files under `apps/dashboard/src/screens/`: `menus-screen.test.ts` 145.2/114 s,
`printers-screen.test.ts` 89.1/89.5 s, `printers-screen.a11y.test.ts` 78.5/79.6 s.
Current packing gives scheduled file loads 755.6/701.1/613/565.9 s: substantial aggregate work and unequal packing;
setup is a minority. These observations do not profile the slow files' internals.

Smallest usable result: six dashboard shards with completed healthy evidence of jobs around four minutes.
Reuse `durationSequencer`/`balancedShards`, the existing duration table and largest-first order.
Preserve workers, every test file/assertion, coverage thresholds, deadlines, diagnostics and route policy.
No test splitting, generated JSON refresh, new protocol, record, capacity service, host-memory policy or workaround.

`unchanged-table-packing-model.json` forecasts busiest file schedules for five shards at 190/172.2 s,
six at 159.9/142.8 s. Add 79.3 s, the worst observed job-minus-modeled-schedule residual, rounded up:
five becomes 269.3/251.5 s; six 239.2/222.1 s. `packing-model.json`'s refreshed four-way weights
still forecast 299/284.1 s including that residual. Choose six without table churn.
These forecasts replay all paths on three workers and transfer observed overhead; they are not built-change measurements.
`concurrency-by-project.json` observes three regular browser files plus separate touch/Node work; the replay is an approximation.
Expected worst-dashboard saving is about 90 s from 330 s, with two extra setups of roughly 27–53 s each;
total runner-minutes may increase. Till stays at seven: jobs span 170–271/171–221 s; `src/till-app-parties.test.ts`
takes 223.5/185 s, a floor shard count cannot shorten. Its internal cause remains unprofiled; A1398-2 stays open.

## Build and qualification after clearance

1. Trace every dashboard count consumer, including routed-job allowlists, coverage merge and watchdogs. In `.github/workflows/ci.yml`, change the matrix, shard denominator, both coverage-download expected counts and `server-queue-watchdog`'s dashboard family count from four to six. Keep routing rules intact.
2. First change `scripts/ci-workflow.test.mjs`'s “pin each sharded package's shard count” dashboard expectation to six. Run `pnpm exec vitest run scripts/ci-workflow.test.mjs -t 'pin each sharded package'` and observe the expected four-versus-six failure. Make the five workflow edits, then run `pnpm exec vitest run scripts/ci-workflow.test.mjs scripts/vitest-duration-sequencer.test.mjs`; require passing test counts. Preserve matrix/denominator, coverage-report-count and watchdog assertions. Name every changed check in the PR. The real dashboard discovery case already reads the workflow count; retain its original-spec and project-identity assertions without rewriting it.
3. Update dashboard count prose and dated receipts in `docs/developers/ci-and-gates.md`. Shrink only this item's dashboard claims in `docs/backlog.md` and `docs/backlog/ci.md` after candidate measurement; leave till and any unproved archiver saving explicit. Estimate: workflow +5/−5, tests +1/−1, docs about +25/−10; revise if consumer tracing changes this scope.
4. Run normal `finish-branch`, including Claude's built-work review, hook and current-head PR CI. Qualify one current-head hosted full CI candidate with coverage on: retain all dashboard job/test-step times, completed paths, coverage merge and healthy timing checks (checkout, HTTP 5xx, incident overlap). Compare whole jobs, including archive/upload waits, with the scheduled baseline. No package-wide local run or extra baseline full run for one second. If the forecast fails, retain the evidence and reopen diagnosis with the watcher before proposing another change. Report only the dashboard result; the whole queued ask remains open.
