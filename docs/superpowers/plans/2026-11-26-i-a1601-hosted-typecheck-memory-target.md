# Try the tested memory target on hosted typecheck

A1601 asks for the full hosted typecheck job to finish in about four minutes. In the earlier
sample, three of nine selected hosted main jobs reached their deadline. The first such job with
the diagnostics from #4399 also timed out, with no compiler result. The watcher directed this
trial in Lane I's questions.md on 26 November at 12:43: “apply the setting that avoided swap to
the hosted typecheck, and check it over the next several ordinary main runs (record each one's time).”

The completed pair checked Server alone twice in one hosted job. It took 74 seconds at 8 GiB and
52 seconds at the default. Available memory fell to 5.97 GiB at 8 GiB and 0.27 GiB at the default,
and only the default wrote to swap. A separate 8 GiB hosted probe checked all 53 projects, with
144 seconds in the typecheck step and 169 seconds for the job. The cancellation left no memory
readings. How the setting affects ordinary full jobs and what caused the timeout remain open.
[Server pair](https://github.com/clintongormley/waitron/actions/runs/45782727177/job/139781855396).
[Full probe](https://github.com/clintongormley/waitron/actions/runs/45781577832/job/139778076732).
[Cancelled job](https://github.com/clintongormley/waitron/actions/runs/45810570195/job/139877545684).

## Change and checks

- In `.github/workflows/ci.yml`, change the fallback on the `Run pnpm typecheck` step's
  `GOMEMLIMIT` from empty to `8GiB`. The self-hosted branch keeps `6GiB`. Keep the one full
  `pnpm typecheck` invocation, both deadlines, runner routing and the existing diagnostics.
- In `docs/developers/ci-and-gates.md`, rename the existing memory-target heading and record
  both values, that each Go compiler process has its own soft target, and the measured hosted
  trade. Keep the separate disposable recheck threshold in its paragraph. There is no A1601
  entry in the repo backlog.
- Manually verify the workflow's two memory values using the before-and-after YAML diff. Run
  `pnpm exec vitest run scripts/ci-workflow.test.mjs` for the existing guards, including
  the full command and its failure exit on both routes. Let the push hook and required PR CI run.
  Report whether the classifier selected typecheck and which route ran it.

## Verify on main

Record the first five attempt-one ordinary main pushes that select a GitHub-hosted typecheck.
Keep each run, head, job conclusion, total job time and compiler time where available. Read the
existing memory samples when present. Close A1601 after five successes within 4m15s each, and
report the measured result as a five-job sample. If a timeout recurs, write WATCHER-NEEDED
with the affected run. If the jobs finish but miss 4m15s, ask the watcher whether to close or
keep the time goal open. Checkpoint the sample count after 48 hours if fewer than five eligible
jobs have completed.

Expected implementation size is one workflow line replaced, about six guide lines added and
no new test code. Use Lane I's finish and land workflow.
