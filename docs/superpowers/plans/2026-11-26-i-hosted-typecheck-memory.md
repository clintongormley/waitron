# Cap hosted compiler memory and retain timeout evidence

A1601 asks why hosted typecheck reaches five minutes and for a fix that brings the job back to
about four. Every selected job checks the whole workspace with `pnpm typecheck`.

From 25 November 20:10 to 26 November 08:05 UTC, three of nine ordinary hosted typechecks
timed out. All three finished setup in 26–36 seconds and entered the compiler step. GitHub has
no compiler exit for them, and its logs endpoint returns 404. The exact failed revision
passed self-hosted and in the hosted experiments. Attribution of those three deadlines is open.
Two matched Server checks with the default left 0.29 GiB available and wrote to swap. The 6 GiB
Go target stopped new swap writes but added 34–40 seconds to Server. The largest package was
Server in both full hosted controls. The full 8 GiB probe checked 53 projects in a 2m49s job and
left at least 5.50 GiB available in the samples. The first 8 GiB guest had a different CPU model.
[6 GiB pairs](https://github.com/clintongormley/waitron/actions/runs/45781005039).
[Full 8 GiB check](https://github.com/clintongormley/waitron/actions/runs/45781577832).

## Workflow change

- Use the `typecheck` step's existing environment expression to set `GOMEMLIMIT=8GiB` on hosted
  runners and `6GiB` on disposable ones. Use the paired 8 GiB and default Server results to check
  memory headroom and added time before building.
  [8 GiB pairs](https://github.com/clintongormley/waitron/actions/runs/45782727177).
- In `.github/workflows/ci.yml`, start a hosted deadline marker at the first job step. At the
  compiler step, run the existing command with `scripts/run-with-deadline.mjs` and the time left
  from 280 seconds since that marker. The extra time inside the five-minute job is for the runner
  to print the reason and close the step. This may refuse a check that would have finished in the
  last seconds of the job. The recorded 244-second successful compiler run fits its setup window.
- In that hosted step, print a brief sample of available memory, kernel swap counters and the
  current control group's `memory.peak` and `memory.events` before, during and after the compiler.
  Print command exit and elapsed time. Each package already prints start and completion lines with
  GitHub timestamps. Use the same lines to locate a stalled package. A lost runner may still lose logs.
- Update the existing whole-workspace assertion in `scripts/ci-workflow.test.mjs` to check the
  exact `pnpm typecheck` arguments through the wrapper as well as the disposable direct path.
  Record in `docs/developers/ci-and-gates.md` that the target is soft and per compiler process,
  and cite observed job peaks. Review a hosted exit 137, deadline or job over 4m30s using its samples.

## Verification

- Run the changed whole-workspace guard first on the old workflow. After it passes on the change,
  run the changed `scripts/ci-workflow.test.mjs` file. In a scratch run give the wrapper an
  ten-second budget while compiling. Confirm the output names started packages, prints the memory
  sample and reports exit 124 before the job deadline. Use a full-budget run as the control.
- Exercise the actual changed job steps from the candidate tree on hosted and disposable runners
  before landing. Record the two chosen targets, 53 project completions, the job duration and the
  selected PR CI. If CI skips `typecheck` on this workflow-only PR, use a branch probe with the
  changed steps and the candidate checkout for each runner. Apply the usual five-minute job limit.
- Keep A1601 in Lane I's queue through the first nine ordinary code-selected hosted jobs after
  landing. Check their job durations, pressure and exits against the baseline.
  If a timeout comes back, use the new evidence to decide what to change next. Revert 8 GiB if the
  measured cause is the added time from that setting.

Expected size is about 30 workflow lines, 10–15 lines in the existing guard and 10 guide lines.
