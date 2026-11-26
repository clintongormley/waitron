# Give hosted typecheck more room in memory

A1601 asks why hosted typecheck reaches its five-minute deadline and for a fix that brings the job
back to about four minutes. Keep the existing whole-workspace `pnpm typecheck` and its deadline.

## What the probes found

The setup and frozen install passed on all three cancelled hosted jobs. GitHub retained neither
compiler output nor a compiler exit for those jobs. The same revision passed self-hosted and in a
hosted comparison, so the cause of those particular cancellations remains unverified.

On two hosted Azure guests, running the same Server check with and without a Go memory target on
each guest isolated one problem. The default left 0.29 GiB of memory available and wrote to swap on
both guests. The existing 6 GiB target avoided new swap writes and left over 6 GiB available, but
made Server's check 34–40 seconds longer. Server was the longest package in both full hosted
checks. Their installs both hit the dependency cache.
[Paired Server checks](https://github.com/clintongormley/waitron/actions/runs/45781005039).
[Full hosted checks](https://github.com/clintongormley/waitron/actions/runs/45780272777).

## Change and verification

- In `.github/workflows/ci.yml` use `8GiB` for the hosted `typecheck` step's Go memory target and
  retain `6GiB` on self-hosted runners. Reuse the step's existing environment expression. Runner
  selection, compiler command and job limit stay as they are. The 8 GiB probe on the exact failed
  revision finished all 53 checks in a 2m49s job, with at least 5.50 GiB available in the samples,
  no swap writes, a cache hit, no HTTP 5xx in the downloaded log and a nine-second checkout. That
  guest had a different CPU model from the earlier comparisons.
  [8 GiB qualification run](https://github.com/clintongormley/waitron/actions/runs/45781577832).
- Record the measured result and its limits in `docs/developers/ci-and-gates.md`, beside the
  disposable typecheck's existing receipt. The repository backlog has no A1601 entry.
- Run `pnpm exec vitest run scripts/ci-workflow.test.mjs -t 'typechecks the whole workspace'`
  and confirm the existing guard passes. The hosted experiment checks that all 53 packages
  report completion and that typecheck returns zero. Check both values of the workflow's
  runner expression in the diff. No new committed test is needed for this setting.
- Verify required PR CI. This workflow-only diff can skip typecheck. Verify the first ordinary
  code-selected hosted run after landing and record the selected runner, elapsed time and compiler
  exit. Keep A1601 open if typecheck still hits its deadline. A successful diagnostic by itself
  does not establish that the recurring timeout is gone.

Expected size is one replaced workflow line, about ten guide lines and zero added test lines.
