# Run root guards in two parallel jobs

Get the root guard results back in about four minutes while running every case and enforcing the
existing 98/98/98/95 root coverage thresholds.

After the file-size guard, the watcher read 54 successful jobs on 24 November. GitHub took
246–275 s on the faster runners and 339–372 s on the slower ones. The server took 198–277 s, with
15 of 47 jobs over 240 s. Slow GitHub [job 138541017574](https://github.com/clintongormley/waitron/actions/runs/45421132097/job/138541017574)
took 372 s, with 335 s in the test step and 755 s summed across test files. The seven-file split
is estimated to put both jobs near 240 s on that runner speed. Measure their actual times in CI.

1. Run the unfiltered root coverage twice at the same source and compare per-file covered and
   total counts with a third run that excludes `waitron-sh`, `pre-push`, `tunnel-container`,
   `ci-setup-pnpm`, `waitron-box-sh`, `personal-log-params` and `deploy-image-env`. Require passing thresholds and take any difference beyond the control runs to the watcher.
2. In `.github/workflows/ci.yml`, keep `root-guards` under its existing name, condition,
   routing and full-history checkout. Run the rest of the root project there with coverage. Run
   the seven suites on `ubuntu-latest` in `root-process-guards`, which uses the same job condition
   and the standard bounded setup. Use one workflow list for both commands, add the second job
   to `ci.needs`, and keep both jobs independent. The published server controller expects the
   original root job name and refuses a second root label.
3. In `scripts/ci-workflow.test.mjs`, run both extracted check commands against a pnpm stub,
   check every named file exists, and require coverage only on the first job. Extend the existing
   failure and cancellation checks for the new job and retain the full-history checkout checks.
   Record the red run before editing the workflow. Expect about 65 workflow lines and 35 test
   lines added, with no new scripts or test support.
4. On the current PR head, check both jobs’ file and case totals against the baseline, allowing
   the new workflow cases, and read the root coverage result. Record both job times, elapsed time
   from first start to last finish and queue waits. Compare hosted runs at the same speed, using
   Vitest’s file times. Seek a gain of at least 20 s and both jobs within 240 s on slow GitHub
   runners. Report server timings separately. Check for GitHub incidents and failed downloads,
   and report checkout duration. Bring a missed target to the watcher. Update the CI guide and
   the existing CI routing qualification backlog with the second job’s server dependency.

Claude reviewed the split on 24 November. The watcher cleared it at 16:14 with seven suites, two
coverage controls and the slower GitHub timing target, then cleared the hosted second job at 16:29.
