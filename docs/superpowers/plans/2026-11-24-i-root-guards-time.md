# Run root guards in two parallel jobs

CI should return root test and coverage results in about four minutes on each runner type, with every test file and the existing 98/98/98/95 thresholds intact.

| Run (attempt 1) | Runner | Job / Vitest step / checkout |
| --- | --- | --- |
| [45417839560](https://github.com/clintongormley/waitron/actions/runs/45417839560), file-size guard on main | GitHub | 260 / 230 / 11 s |
| [45415535862](https://github.com/clintongormley/waitron/actions/runs/45415535862), file-size guard PR | Server | 216 / 186 / 12 s |
| [45418943035](https://github.com/clintongormley/waitron/actions/runs/45418943035), subsequent main | Server | 220 / 180 / 11 s |

These post-guard runs are diagnostic because checkout exceeded ten seconds. The earlier qualified PRs
[45368398364](https://github.com/clintongormley/waitron/actions/runs/45368398364) and
[45388224759](https://github.com/clintongormley/waitron/actions/runs/45388224759) took 259 and 205 s respectively.
The new guard took 90 ms on GitHub. Installer tests took 91 s, and four other files took 30–37 s each.
Replaying Vitest's size-based scheduling with three workers and the logged suite times gives 184 s of
test time on GitHub. Even perfect ordering has a 183 s lower bound in that replay. Vitest's own
two-way shard selector puts 112 files on each runner, with replay estimates of 75 and 129 s.
These estimates exclude setup, coverage and queue time.

1. In `.github/workflows/ci.yml`, turn `root-guards` into a two-leg matrix with full-history checkout on
   both legs. Keep the existing job condition and use the current placement and watchdog rules with
   matrix indices 1 and 2. Run Vitest's default `--shard`, writing a coverage blob per leg with the
   existing Node shard flags and two bounded upload attempts. Add `root-guards-coverage`, using a
   hosted runner and the existing bounded blob download helper. Require both blobs, then use Vitest's
   Node merge command to enforce the unmodified root config on the combined results. Run coverage
   whenever the shards succeed, including after a failed change classification. Require the shard
   matrix and coverage result in `ci` except for the existing server-probe path.
2. In `scripts/ci-workflow.test.mjs`, make the matrix, failed-classifier, placement and aggregate
   checks fail on the current workflow first. Cover the case where coverage is skipped despite
   successful shards and the server-probe exception. Keep the checkout and cancellation checks.
   Run that file and the existing download helper tests. Record changed workflow guard assertions
   in the PR. Expect about 130 workflow lines added and 8 removed, with about 45 test lines added
   and 10 changed. The root config and test support need no edits.
3. On the current PR head, compare the union of shard log paths and case totals with the unsharded
   inventory, accounting for the new guard cases. Run the actual merge on the two blobs and record
   a higher-threshold failure using copies. Report both job times, coverage merge time and elapsed
   time from the first shard's start to the merge's end, including waits. Compare healthy runs by
   runner type, recording checkout, download failures and incident history. Flag any time above
   240 s and return to the watcher if the split gives no measured improvement. Update
   `docs/developers/ci-and-gates.md` and the CI timing pointer in `docs/backlog.md` with the results.
