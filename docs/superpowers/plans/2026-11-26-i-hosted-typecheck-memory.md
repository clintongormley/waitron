# Capture the cause of a hosted typecheck deadline

A1601 asks why hosted typecheck reaches five minutes and for a fix that brings the job back to
about four. Every selected job checks the whole workspace with `pnpm typecheck`.

From 25 November 20:10 to 26 November 08:05 UTC, three of nine ordinary hosted typechecks
reached the job deadline after successful setup. GitHub recorded no compiler exit and returned
404 for their logs. The same revision passed self-hosted and with every completed hosted setting.
Among the six hosted completions, the slowest job was 272 seconds, including 244 for the compiler.

Server was the longest project in both full hosted controls. In matched runs, default Server left
0.27–0.29 GiB available and wrote to swap. A 6 GiB target avoided swap writes and added 34–40
seconds. In the completed 8 GiB pair, it avoided swap writes and added 22 seconds. A full 8 GiB
probe checked 53 projects in 2m49s on a different CPU model. These runs show a trade between
memory and time. Capture the next failure before choosing a hosted memory setting.
[6 GiB pairs](https://github.com/clintongormley/waitron/actions/runs/45781005039).
[Full 8 GiB check](https://github.com/clintongormley/waitron/actions/runs/45781577832).
[8 GiB pairs](https://github.com/clintongormley/waitron/actions/runs/45782727177).

## Workflow change

- In `.github/workflows/ci.yml` record the start time in the first hosted job step. Use one
  `pnpm typecheck` invocation on both routes. On a hosted runner, prefix it with
  `node scripts/run-with-deadline.mjs <remaining-seconds> --`, where the remaining time ends 280
  seconds after the marker. Preserve the compiler's exit code. If setup uses the budget, print
  that reason and exit 124. The extra time in the five-minute job lets the wrapper and runner
  finish reporting. A check that would finish in the last seconds can end early. The 244-second
  successful compiler run fits its setup window. Keep Go's existing disposable-runner target.
- For hosted runs, print the CPU model once and available memory, swap counters, control group
  peak and events, and CPU, memory and disk stall measures every ten seconds. Missing readings
  print as unavailable. Stop only the sampler started by the step. Print final samples, elapsed
  time and the command exit. Use the existing timestamped pnpm package lines to locate a stall.
  Record the difference between exit 124, a compiler error and a runner that stops reporting in
  the current typecheck section of `docs/developers/ci-and-gates.md`.

## Verification

- Read the hosted step- and job-timeout control logs before building. In
  `scripts/ci-workflow.test.mjs`, extend the existing whole-workspace check to pin the one exact
  `pnpm typecheck` command and its optional prefix. Run the assertion against the old workflow
  first, then run the changed file on the revised workflow.
- Run the candidate steps on hosted and disposable Linux before landing. Require successful
  completion of all 53 projects and an ordinary compiler refusal for a deliberately mistyped
  test on each route. A ten-second hosted budget must yield exit 124, started-package output and
  final readings. Use branch probes with the actual candidate steps if workflow-only PR CI skips
  typecheck. Check required PR CI and the first nine ordinary hosted jobs after landing.
- Keep A1601 open in Lane I's queue. Use a captured timeout to choose a cause-specific fix. If
  nine ordinary hosted runs give no deadline and each finishes near four minutes, record the
  evidence and ask the watcher whether to close or continue monitoring.

Expected size is about 30 workflow lines, 10–15 lines in the existing guard and 10 guide lines.
