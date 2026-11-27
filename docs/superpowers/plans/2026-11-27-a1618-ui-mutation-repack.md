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

Set the UI matrix in `.github/workflows/mutation.yml` to 39 jobs. Set the data-table entry
in `scripts/mutation-shard.mjs` to 14 ranges, for 28 dedicated jobs in all. Pack the same 107
whole files over 11 jobs. On the rebased tree the recorded weights peak at 8,231 seconds for the
old whole-file layout and 3,535 for the new layout. The floor map gets its own job. Keep each
job's 50-minute limit and the aggregate's 90% floor.

The watcher cleared the repack and shorter data-table ranges at 10:37 CET on 27 November.
Matching report durations to the current source put the heaviest of 13 ranges at 6,053–6,569
summed seconds, and 14 ranges at 5,478–6,154, against 7,062–8,313 in the old jobs. The
instrumenter emits 3,080 mutations from the whole file. Compared with 12 ranges on the same
source, 14 ranges drop 14 and recover 20. The hosted run measures elapsed time. If a job reaches
the limit, save its logs and report the cause to the watcher before making a further change.

First update the matrix guard in `scripts/ci-workflow.test.mjs` and the range expectations in
`scripts/mutation-shard.test.mjs`. Run against the old configuration and expect failures for the
missing seven jobs and two ranges. After the change run both files, plus
`scripts/mutation-break-thresholds.test.mjs` and `scripts/mutation-aggregate.test.mjs`. Run the
production selector for all 39 jobs. Verify all are nonempty, each whole-file target appears once,
and the 14 ranges cover all 3,500 data-table source lines without gaps or overlap.

Allow about 100 configuration lines added and 75 removed, eight guard lines and a dated CI guide receipt.
After review, CI and landing, run `gh workflow run mutation.yml --ref main -f packages=ui`.
Record the run SHA, 39 reports, longest jobs and aggregate in the lane receipts. Answer the
watcher's questions.md note with the score. A1618 is complete when that run reports at least 90%.
