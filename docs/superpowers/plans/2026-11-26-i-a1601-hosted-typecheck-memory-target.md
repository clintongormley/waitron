# Apply the tested memory target to hosted typecheck

A1601 asks for the full hosted typecheck job to finish in about four minutes. The first ordinary
hosted run with the diagnostics from #4399 reached its five-minute deadline and left no compiler
result. The 26 November 12:43 watcher note calls for applying the tested 8 GiB setting now and
measuring ordinary main runs.

In the completed pair on one hosted runner, Server took 74 seconds at 8 GiB and 52 seconds at
the default. At its lowest, available memory was 5.97 GiB at 8 GiB and 0.27 GiB at the default.
Only the default wrote to swap. That measures the trade on one runner. The cancellation log
gave no memory readings, so the cause of that timeout is still unverified.
[Paired probe](https://github.com/clintongormley/waitron/actions/runs/45782727177).
[Cancelled job](https://github.com/clintongormley/waitron/actions/runs/45810570195/job/139877545684).

## Change and checks

- In `.github/workflows/ci.yml`, set the existing `GOMEMLIMIT` on the `Run pnpm typecheck` step
  to `8GiB` on GitHub-hosted runners and `6GiB` on disposable runners. Reuse the runner environment
  condition and the one full `pnpm typecheck` invocation there. Keep both deadlines, runner routing
  and the existing diagnostics.
- In `docs/developers/ci-and-gates.md`, record both values and the measured hosted trade in the
  existing typecheck section. The repository backlog has no A1601 entry. Keep the lane item open
  for the main-run evidence.
- Check the memory values on both routes against the workflow before and after the edit. Run
  `pnpm exec vitest run scripts/ci-workflow.test.mjs` for the existing workflow guards, including
  the full command and its failure exit on both routes. Let the push hook and required PR CI run.
  If the classifier skips typecheck for this workflow-only change, say so in the PR.
- After landing, record the first five ordinary main runs that actually select a hosted typecheck.
  Keep the run, attempt, head, job conclusion, total job time and compiler time where available.
  Read the existing memory samples when present. Take neither a disposable job nor a manually
  dispatched run as hosted main-push evidence. Close A1601 after five completions without a
  deadline if the elapsed times meet the roughly four-minute goal. If a timeout recurs, give the
  watcher the affected runs. If the jobs complete but stay above the goal, report the timings
  before closing.

Expected implementation size is one workflow line replaced, about six guide lines added and
no new test code. Finish and land via the normal Lane I workflow, then qualify on main.
