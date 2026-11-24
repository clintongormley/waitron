# Diagnose the Server typecheck kills and reduce their risk

Measure a previously failed head on the disposable CI server. Use the result to choose the
smallest change that lets the existing full typecheck finish with memory and time to spare.

Five disposable jobs exited 137 on 24 November. [First](https://github.com/clintongormley/waitron/actions/runs/45455114871),
[second](https://github.com/clintongormley/waitron/actions/runs/45468324299),
[#4258's PR](https://github.com/clintongormley/waitron/actions/runs/45474194511),
[#4261's merge](https://github.com/clintongormley/waitron/actions/runs/45478090008) and
[#4258's merge](https://github.com/clintongormley/waitron/actions/runs/45479529468).
Four exact heads passed a GitHub-hosted retry. Of 16 disposable attempt-1 typechecks on main
in the 18:00–20:54 UTC run-creation window, 12 passed and four failed. The other package
compilers had finished before Server started in all five failures. A split would repeat that
order. The release `f4c9c3c82fc6`, installed on 23 November, assigns 16,384 MiB and four CPUs
to both typecheck and the manual server probe. The pre-A1454 host also assigned 16,384 MiB.
The failed logs contain no guest memory readings. GitHub lists 16 GB for its public Ubuntu
runners. [GitHub runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#standard-github-hosted-runners-for-public-repositories).

| Mac checkout, TypeScript 7.0.2 | Peak resident memory | Files | Types | Instantiations |
| --- | ---: | ---: | ---: | ---: |
| 1 Nov `eee4006f8362` | 7.80 GiB | 5,234 | 2,606,934 | 10,792,009 |
| 10 Nov `53bb877a5e15` | 7.55 GiB | 5,546 | 2,823,326 | 11,598,795 |
| 24 Nov `c5e7ee392417` | 11.38 GiB | 6,342 | 3,209,294 | 13,271,509 |

These are frozen installs and successful `/usr/bin/time -l pnpm --filter @waitron/server typecheck
--extendedDiagnostics` runs. Intermediate samples put the largest observed jump between
`519f7f1f7ebb` (19 Nov, 9.07 GiB) and `260e14bbb481` (20 Nov, 11.20 GiB). The 20 November
revision peaked at 5.91 and 9.93 GiB on the two later runs. On current main,
`--generateTrace` showed four workers creating types from shared libraries, and the heap profile
put about 1.1 GiB under symbol-table instantiation. The compiler reported 4.10 GiB of `Memory used`
on 1 November and 5.17 GiB on 24 November, a rise of 26%. Logs and profile summaries are in Lane I's
`receipts/typecheck-memory-20261124/`.

On the failed merge in a four-CPU Linux arm64 container, default settings passed at a 12 GiB
cap and peaked at 10.76 GiB. At 9 GiB they exited 137 with one kernel memory kill.
`GOMEMLIMIT=6GiB` passed both caps with the same 6,327 files and 13,107,016 instantiations,
peaking at 8.37 GiB in the 12 GiB container and reaching the 9 GiB ceiling without a kill.
Go uses a soft memory target. [Go's garbage collector guide](https://go.dev/doc/gc-guide#Memory_limit).

The watcher cleared a single 6 GiB trial on 24 November at 22:15 and made the temporary setting
the first change at 22:35 after two more failures. Use the manual `server_probe` job on an unmerged
scratch ref, with the normal typecheck setup and five-minute job limit. Check out
`01ec75f7e065115f07892bd110250716c8135aab` and run `pnpm typecheck`. Record the elapsed time,
guest memory, swap, group memory peak and memory-kill counters, and the kernel log. Save the run
and remove the scratch ref. Apply the two-line setting when the job passes in under 4m30s.
Try 8 GiB once if the 6 GiB run takes longer. If the probe cannot run within the hour, the watcher
cleared the 6 GiB setting with a Server comment change to select typecheck on the pull request.

Verify a deliberately mistyped test file still fails and the existing whole-workspace guard
passes. A workflow-only PR and merge skip typecheck. Record their exact checks and follow the
first code-selected disposable main run with the change. The stopgap is two workflow lines plus
a short CI guide receipt and backlog pointer, with no committed tests.

On 24 November at 22:53 the watcher ended the search for one commit because the measured peaks
varied between runs of the same revision. After the setting lands, use `--generateTrace` to name
the two or three heaviest type areas in Server. Make one small change if three measurements show
it cuts peak memory by at least a fifth. Otherwise record the trace findings in the CI guide and
close the investigation.
