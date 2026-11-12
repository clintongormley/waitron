# A1473 correction: reduce mutation competition for planner admission

**Authority.** Watcher request, `~/waitron-campaign-i/questions.md`, 2026-11-12 06:31, ahead of A1454. The owner has not approved this design. This is PLAN FOR APPROVAL: build only after the parent's source check, Claude review and watcher clearance.

**Finish line.** Reduce the hosted jobs competing with `changes`, the planning step, during a complete mutation run, and measure whether ordinary planners start sooner. Add `strategy.max-parallel: 2` to each existing mutation matrix. One all-package run then admits at most eight jobs together: two each for ui-core, ui and db, plus node-db and handover; each aggregate replaces its completed matrix. This removes the observed mutation run's ability to hold fifteen runners, but leaves planners hosted. Other workflows or overlapping mutation runs can still fill GitHub; this does not guarantee immediate planning or independent server admission. Mutation completion takes longer.

**Reuse and boundary.** Reuse `mutation.yml`'s matrices, package selector, `fail-fast: false`, artifact uploads, complete-report aggregation and 90-point floors. Keep all 4/30/13 shards, both unsharded packages, existing commands, timeouts and schedules. No new scheduler, service, credential, capacity snapshot rule, reservation, controller change or skipped check.

Server placement needs its own fallback qualification: Cloud recognises `changes-1`, and admitted-job fallback accepts non-PR events (`ci-canary.mjs:353`), but full-pool `overflowOrdinary` requires a PR (`:207–213`). This plan chooses the mutation option the watcher named, leaving independent planner placement open.

**Exact edits and checks, one task.**

- [ ] In `scripts/ci-workflow.test.mjs`, extend the existing mutation-workflow case to require `max-parallel: 2` in all three strategies and exact existing shard membership. Preserve selector, dependencies, `fail-fast`, commands and aggregate assertions. No existing guard expectation is relaxed; `scripts/ci-server-first.test.mjs` continues to pin `changes` hosted. These are text guards, not admission measurements.
- [ ] Run the changed test file and observe the missing-cap assertion fail. Add exactly three cap lines in `.github/workflows/mutation.yml`, then rerun it. Also run `pnpm exec vitest run scripts/ci-server-first.test.mjs scripts/mutation-break-thresholds.test.mjs scripts/mutation-aggregate.test.mjs`. Routing belongs to the first suite; floors and missing-report refusal belong to the latter suites. Keep their behavioural assertions.
- [ ] In `docs/developers/ci-and-gates.md`, under the nightly mutation section, describe the per-matrix limits, longer completion and remaining hosted-planner dependency; retain historical measurements. Update the existing CI capacity/fallback bundle in `docs/backlog.md` and `docs/backlog/ci.md` with the exact qualification still open; delete no other work.

**Live qualification.** Before activation, retain the actual workflow SHA, repository routing settings and mutation run/attempt. Use job API timestamps to calculate `changes.started_at − changes.created_at`. Main runs 43160361482/43160592016/43160837699 gave 98/340/512 seconds; `~/waitron-campaign-i/receipts/firing-20261112-0624/planner-job-waits.json` contains observations, not qualified baselines.

Qualify those runs or collect three replacement main pushes during mutation activity. After landing, wait for any active all-package mutation run to finish, then dispatch `gh workflow run mutation.yml --ref main` and collect three comparable natural main pushes. Record hosted competition, mutation job start/end overlaps, planner waits, server pickup and total mutation completion. Confirm every shard/report and floor completed, with at most two shards per matrix running together. Compare median and individual waits, not total CI speed.

For both samples follow `~/waitron-campaign-shared/ci-failure-rule.md`: incident history clear for the run intervals, no download HTTP 5xx, slowest checkout under about ten seconds. Otherwise timing remains unqualified. Finish only with lower qualified planner waits and a complete mutation run before the next nightly. Missing samples, unchanged/worse waits or incomplete mutation work leave the outcome open for the watcher; do not keep tuning caps or rerunning unchanged failures.

**Expected diff:** production +0/−0; configuration +3/−0; tests +15–25/−0; documentation +8–12/−0, excluding this plan.

| External claim | Source words | Application |
| --- | --- | --- |
| Matrix limit | [GitHub documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations#defining-the-maximum-number-of-concurrent-jobs): “a maximum of two jobs at a time” | `max-parallel: 2` limits each matrix, not the account. |
