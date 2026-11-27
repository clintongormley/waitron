# A1618 UI mutation shard repack

The UI mutation workflow needs to report a score with the A1618 regression tests on main. Run
45962184332 had 30 of its 32 reports. Jobs 27 and 31 reached the 50-minute limit during mutation
testing, so the aggregate had no score. The watcher assigned the repack at 10:08 CET on
27 November after PR #4478 landed.

Use the median-duration recipe in [CI and gates](../../developers/ci-and-gates.md#dbs-mutation-shards-are-packed-by-estimated-cost)
to refresh `packages/ui/mutation-costs.json`. Take the 30 reports from 45962184332 and the
complete report sets from 45943691418 and 45786406477. The two complete sets give weights to
files on the cancelled jobs without treating their missing records as zero. Preserve the recipe's
byte fallback for files absent from all reports.

Set the UI matrix in `.github/workflows/mutation.yml` to 38 jobs. The existing packer keeps the
26 dedicated source ranges and spreads the remaining files over 12 jobs instead of six. On the
current tree, the largest whole-file weight drops from 7,193 to 3,535 using the refreshed table to
score both layouts. The floor map accounts for that entire 3,535 and gets its own job. All other
whole-file weights are at most 3,050. These weights sum individual mutant durations and do not
predict job wall time. The existing dedicated ranges, 50-minute limit and 90% aggregate floor
stay in force. Add a dated receipt to the CI guide with the input runs and measured packing.

First update the existing matrix assertion in `scripts/ci-workflow.test.mjs` to expect 38 UI
jobs and run that case against the old matrix. It must fail on the missing six jobs. After the
configuration change, run that file, `scripts/mutation-shard.test.mjs`,
`scripts/mutation-break-thresholds.test.mjs` and `scripts/mutation-aggregate.test.mjs` with
`pnpm exec vitest run`. Run the production selector for all 38 jobs. Compare its flattened
targets to the old 32-job list, requiring every shard to be nonempty and every target to occur
exactly once. The largest recent dedicated range took about 45 minutes in the mutation step,
so check its full job time as well as the repacked jobs in the confirmation.

Allow about 100 changed configuration lines, one guard line and six CI guide lines. No product
or mutation-target changes. After the normal review and CI, land the PR and start
`gh workflow run mutation.yml --ref main -f packages=ui`. Record the run SHA, all 38 reports,
the longest jobs and the aggregate. A1618 is complete when that run reports at least 90%.
