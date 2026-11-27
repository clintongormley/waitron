# A1618 UI mutation shard repack

The UI mutation workflow needs to report a score with the A1618 regression tests on main. Run
45962184332 had 30 of its 32 reports. Jobs 27 and 31 reached the 50-minute limit while testing
mutations, so the aggregate had no score. The watcher assigned the repack at 10:08 CET on
27 November after PR #4478 landed.

Refresh `packages/ui/mutation-costs.json` with the median-duration recipe in
[CI and gates](../../developers/ci-and-gates.md#dbs-mutation-shards-are-packed-by-estimated-cost).
Use the 30 reports from 45962184332 at `d9287f3328` (#4478) and the complete report sets from
45943691418 at `eac61f3007` and 45786406477 at `af212697b9`. The last two predate #4478, so their
weights for jobs 27 and 31 are estimates for the current tests. The 15 whole files absent from
all reports are re-exports or type declarations. Keep the packer's byte fallback for them.

Set the UI matrix in `.github/workflows/mutation.yml` to 37 jobs. The packer keeps the 26
dedicated source ranges and spreads the whole files over 11 jobs instead of six. Scored with
fresh weights, the existing layout peaks at 7,193. Repacking with 33 through 38 jobs gives
5,298, 4,635, 4,122, 3,713, 3,535 and 3,535. At 37, the floor map gets its own job and sets
that floor. These sums compare workloads. The fresh CI run measures elapsed time. Keep the
50-minute limit and 90% aggregate floor. Add a dated CI guide receipt superseding the 32-job
layout, with the input runs and the packing comparison.

The dedicated data-table shard 9 finished its three recent jobs in 37:31, 44:41 and 45:30.
Keep the range boundaries for this PR, subject to the watcher's clearance on that margin. In
the latest reports, shifting the data table from 12 to 13 or 14 equal ranges would put 12 or 13
previously reported mutants across new boundaries. Record shard 9's full job time on the fresh
run. If a job times out, save its logs and report the cause to the watcher before a further change.

First update the existing matrix guard in `scripts/ci-workflow.test.mjs` to expect 37 UI jobs and
run that case against the old matrix. It must fail on the missing five jobs. After the
configuration change, run that file, `scripts/mutation-shard.test.mjs`,
`scripts/mutation-break-thresholds.test.mjs` and `scripts/mutation-aggregate.test.mjs`.
Run the production selector for all 37 jobs. Require every job to be nonempty and the same 133
targets as the old layout, each once.

Allow about 100 configuration lines added and 75 removed, one guard line and six CI guide lines.
After review, CI and landing, run `gh workflow run mutation.yml --ref main -f packages=ui`.
Record the run SHA, 37 reports, longest jobs and aggregate in the lane receipts. Answer the
watcher's questions.md note with the score. A1618 is complete when that run reports at least 90%.
