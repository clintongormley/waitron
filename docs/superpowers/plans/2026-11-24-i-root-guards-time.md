# Run root guards in two parallel jobs

Get the root guard results back in about four minutes while running every case and enforcing the
existing 98/98/98/95 root coverage thresholds.

| Run (attempt 1) | Runner | Job / Vitest step / checkout |
| --- | --- | --- |
| [45417839560](https://github.com/clintongormley/waitron/actions/runs/45417839560), file-size guard on main | GitHub | 260 / 230 / 11 s |
| [45415535862](https://github.com/clintongormley/waitron/actions/runs/45415535862), file-size guard PR | Server | 216 / 186 / 12 s |
| [45418943035](https://github.com/clintongormley/waitron/actions/runs/45418943035), subsequent main | Server | 220 / 180 / 11 s |

Checkout puts those runs outside the ten-second qualification cutoff. Earlier qualified PRs
[45368398364](https://github.com/clintongormley/waitron/actions/runs/45368398364) and
[45388224759](https://github.com/clintongormley/waitron/actions/runs/45388224759) took 259 and 205 s.
The file-size guard took 90 ms on GitHub. The `waitron-sh`, `pre-push`, `tunnel-container` and
`ci-setup-pnpm` suites took 195 s of the combined 549 s of file time. Replaying the cold Vitest order
with three workers puts the remaining tests at 120 s of execution and the four process suites at
91 s, before import, coverage and setup.
Vitest listed 220 and 4 files with those filters, exactly the 224 in the unfiltered list.

1. Before editing the workflow, compare the root coverage JSON counts per file with and without
   those four suites, at the same source and with the current thresholds. Require identical covered
   and total counts and the same passing thresholds. Take a difference to the watcher before building.
2. In `.github/workflows/ci.yml`, use one `root-guards` matrix with legs 1 and 2 and retain the
   current condition and full-history checkout. Derive leg 1's exclusions and leg 2's positional
   arguments from one list in the job. Leg 1 runs the rest of root Vitest with full root coverage.
   Leg 2 runs the four process suites. Keep `ci` depending on the matrix and update the planner and
   watchdog family to two indexed jobs. This adds one runner per run and uses one more server slot
   when available. Root coverage is still produced in one job.
3. In `scripts/ci-workflow.test.mjs`, make the existing root job guard exercise both commands
   against a pnpm stub. Pin complementary arguments, coverage on leg 1, the required matrix,
   both routing indices and the failed-classifier and server-probe paths. Keep both full-history
   checkout checks. Record the red run first, finish with the focused file and cite changed guards
   in the PR. Estimate 20–30 added workflow lines and 35–50 added test lines, with no test support.
4. Compare the current PR head's test files and case counts with the baseline, allowing the named
   new workflow cases. Check the root coverage result. Report both job times and the elapsed time
   from first start to last finish, including waits. Seek qualified hosted evidence of at least a
   20 s improvement and completion within 240 s, with server timings reported separately. Check
   checkout, download errors and GitHub incident history. Take a missed target to the watcher.
   Update the CI guide and CI timing pointer in the backlog with the measured result.
