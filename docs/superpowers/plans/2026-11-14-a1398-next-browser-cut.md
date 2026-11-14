# A1398-2: next browser CI cut

Codex draft, reviewed by Claude on 14 November; watcher clearance is pending. Build inline only after clearance.
The ask in `~/waitron-campaign-i/queue.md` is:
> every CI test job finishes in about four minutes (owner, 2026-10-09 and 2026-10-11; CLAUDE.md §2: "Fix the cause, never cut a check"). Measure dashboard and till on current main first; a performance plan needs measured causes and expected saving, at most one page, Claude review and watcher clearance.

## Evidence and result

Coverage-on main runs: scheduled [43545365252](https://github.com/clintongormley/waitron/actions/runs/43545365252),
`58d3c38bddfc9dae66fbc5bf60c7b11f16121724`; coordinated [43544246652](https://github.com/clintongormley/waitron/actions/runs/43544246652),
`03313e5cb242ee03f76364a34ebd6dfb23e4ae89`. Both passed 85 selected jobs.
Watcher `questions.md` 2026-11-14 03:51 accepts scheduled's 11-second checkout maximum and clean 5xx/incident checks;
coordinated's 12-second maximum makes it corroboration only. No owner design approval is claimed.
Receipts: `~/waitron-campaign-i/receipts/a1398-next-cut-20261114/{measurements,unchanged-table-packing-model,packing-model,concurrency-by-project}.json`.

Dashboard shards 1–4: 330/301/263/268 seconds scheduled, 247/313/270/239 coordinated;
test steps: 295/274/234/215 and 220/274/236/210. Scheduled setup and other steps take 27–53 seconds.
Both complete 534 paths. Scheduled file work totals 2635.6 seconds, unevenly packed at 755.6/701.1/613/565.9.
Slowest dashboard files in `src/screens/`: menus 145.2/114 seconds, printers 89.1/89.5, printers-a11y 78.5/79.6.

Next usable result: six dashboard jobs finishing within 240 seconds each on a qualified candidate run.
Reuse the sequencer and existing weights. The approximate three-worker replay plus worst observed residual (79.3 seconds)
forecasts five shards at 269.3/251.5 seconds, six at 239.2/222.1; refreshing four weights alone gives 299/284.1.
Even equal scheduled packing averages about 220 file-seconds per three-worker job before overhead.
These estimates identify aggregate work and packing as a capacity candidate, not proof that smaller internal optimizations cannot work.
Separate touch/Node projects overlap the three normal browser files; transferred overhead and predicted savings need hosted verification.
Expect roughly 90 seconds off the worst dashboard job, with two extra setups on every selected PR and full run;
runner-minutes and queue time may increase. Preserve workers, tests, assertions, weights, coverage, deadlines, diagnostics and routing policy.
Till remains seven shards: jobs reach 271/221 seconds; parties alone takes 223.5/185. Its internal cause remains unprofiled, so A1398-2 stays open.

## Build only after clearance

1. **External prerequisite:** Cloud's `deploy/disposable-tests/session.py:61` currently names dashboard `[1-4]`; `ci-session.test.py:197–204` explicitly refuses shard 5. The installed controller source has the same bound. Have the watcher assign/clear the small Cloud change to accept 5–6 and refuse 7, with its identity checks preserved, then publish it through the existing deployment workflow. Prove admission of the new labels before qualifying Waitron; do not turn routing off to hide this dependency. No Cloud change is built or authorised by this draft.
2. In Waitron, change the dashboard count pin in `scripts/ci-workflow.test.mjs:4055` to six; run `pnpm exec vitest run scripts/ci-workflow.test.mjs -t 'pin each sharded package'` and observe four versus six failing. Change `.github/workflows/ci.yml`'s dashboard matrix, denominator, both coverage-download counts and watchdog family count. Run `pnpm exec vitest run scripts/ci-workflow.test.mjs scripts/vitest-duration-sequencer.test.mjs`; require passing counts and preserve every behavioral assertion. Name the deliberate count-pin change in the PR.
3. Update `docs/developers/ci-and-gates.md`'s four-way prose and package table. Shrink only A1398-2's dashboard work in `docs/backlog.md` and `docs/backlog/ci.md` after qualification; keep till and unproved archiver savings open. Expected Waitron diff: configuration +5/−5, tests +1/−1, docs about +25/−10. Cloud prerequisite estimate: production +1/−1, tests +3/−1, plus existing deployment; no new tooling or table refresh.
4. Run `finish-branch` and its required reviews, hook and current-head PR CI. **Before merge**, run one full coverage-on candidate CI. Require all six dashboard jobs at most 240 seconds, successful package coverage merge, all 534 baseline paths retained plus any new main paths, and healthy checkout/5xx/incident evidence. Retain whole-job/test-step times, queue times and whole-run duration. Compare with scheduled baseline; queue/run duration is context, not another gate. If the candidate misses, do not merge: retain evidence and return to the watcher. No package-wide local run or additional baseline run is needed. Land the plan docs-only only after watcher clearance.
